// @ts-check
/**
 * `src/layout.js` —— **版面守门**的判据（纯函数，不碰 GPU、不碰 DOM）。
 *
 * ## 为什么要有这一层
 *
 * 钠那期视频（`tasks/sodium`）收到的外部反馈里有一条是
 * 「**有些动画元素相互遮挡害得我搞不清楚到底要看哪个主体**」。逐帧对到产物上：
 * 典型一屏 = 眉标 + 右上读数面板（一屏 4–6 个数）+ 左侧标签列 + 图示主体 + 说明条 + 出处脚注。
 * 而引擎**没有任何判据**管这件事 —— `check` 管的是亮度 / 背景守门 / 非有限值 / 依赖令牌，
 * `src/kit/bands.js` 只管「别压到字幕保留带上」。这一层就是那条缺失的判据。
 *
 * ## 两件事，两句话
 *
 * · **① 每屏的信息块数量**（`blocks`）：这一帧到底画了几块文字（含读数）。
 *   钠的解法不是"把读数删掉"，而是**一次只揭一个** —— 所以判据盯的是"同一帧里有几块"。
 * · **② 主体声明**（`focus`）：场景可以声明「这一段看哪里」（场景对象上的 `scene.focus`，
 *   或时间线段上的 `focus`；`'center'` 是一个现成的中心区）。声明之后：主体区**里面**还有别的
 *   信息块 ⇒ 抢视线；主体区**外面**的信息块超过上限 ⇒ 一屏多头。
 *   没声明不是"通过"，是**没判**（`noFocus`）—— 与 `under` / `world` 的既有哲学一致
 *   （「空 ≠ 干净」，见 `docs/DIAGNOSIS.md` §3）。
 *
 * ## 为什么"块"要按间距合并（而不是数调用次数）
 *
 * 一次 `type.writeLine` 就是一次文字绘制，但观众看到的**不是 14 个元素**：
 * 右上那个读数面板是 6 个数（6 次调用、位置 26px 一道），看见的是**一块**。
 * 实测 sodium 的 glass 段一帧 15+ 次文字调用，其中 16 个队列编号挤在一条 26px 的带子里。
 * 所以判据先把挨得近的合成"块"（`gap`，默认 = 排版的字号量级），再数块。
 * 原始调用次数照样报出来（`draws`）—— 它是"这块字有多碎"的读数，不进判据。
 *
 * ## 边界（诚实清单）
 *
 * · 只看得见**场景自己那层文字**（`ctx.text`）。引擎画的字幕层 / HUD 层不计入；
 * · 位置与尺寸是**绘制时给的**（`write` / `writeLine` / `karaoke` 的 x/y/size + 实测宽度），
 *   不读像素 —— 所以"一块字被别的元素盖住"这件事这一层**看不出来**；它能判的是
 *   **同一帧里有几块、哪块在主体区里**；
 * · `alpha` 低于 `minAlpha` 的绘制不算（还没揭晓的字不算"占了一屏"）；
 * · **只数文字**：判据的量全部来自"文字块"。所以"主体区 0 块字"本身**分不清**两种画面 ——
 *   主体是图形（方波 / 格阵 / 波形，文字只是标注）vs 这一段什么都没画，块数都是 0。
 *   `layoutVerdict()` 另给一条**读数**（不是判据）：`nonTextDraws` / `focusNote`，
 *   数据取自同一本绘制账（`gl.paint`，见 `countNonTextDraws()`）。
 *
 * 判据的**接线**：`src/app.js` 的 `layoutAudit()` 负责渲染并取回真实的绘制记录，
 * CLI 的 `anim check` 负责打印 / 进 errs / 进 skipped。判断逻辑一个字都不在浏览器里 ——
 * 与 `src/timeline.js` 的 `worldAuditVerdict()` / `auditUnderRequires()` 同一个套路，
 * 离线单测见 `tools/test-layout.mjs`。
 */

/**
 * @typedef {{ maxBlocks: number, maxOffSubject: number, maxInFocus: number, gap: number, minAlpha: number }} LayoutLimits
 */

/**
 * 默认阈值。**刻意宽松**：这一层是"先报不改退出码"（默认 warn，`--strict` 才进 errs），
 * 所以阈值既要动得动、又要能把 sodium 那种一屏 8+ 块的点出来。
 * 任务可以用 `layout: { maxBlocks: 8 }` 覆盖（见 `docs/LAYOUT.md`）。
 * @type {LayoutLimits}
 */
export const LAYOUT_LIMITS = {
  /** 一屏最多几块文字（含读数）。没有主体声明时，这是唯一的数量判据 */
  maxBlocks: 6,
  /** 主体区**之外**最多几块 ——「主体之外 ≤2 个」（交接单 §4 方案 1 的原始措辞） */
  maxOffSubject: 2,
  /** 主体区**里面**最多几块：1 块是"这一屏要看的那件事"，2 块（主体 + 一个标注）也常见 */
  maxInFocus: 2,
  /**
   * 挨得比这还近的文字算**同一块**（逻辑像素）：26px 一道的读数面板会合成一块。
   * 校准：读数面板 26px 一道（要合）、两行独立的标签 60px 一到（不许合）——
   * 28 落在两者之间。第一版取 36，正好把 size 24 的两行标签也吃了进去（单测当场抓到）。
   */
  gap: 28,
  /** 不透明度低于这个值的绘制不算"占了一屏"（还没揭晓的字） */
  minAlpha: 0.25,
};

/** 默认板宽 / 板高（逻辑像素）—— 与 `src/style/index.js` 的基准一致 */
const BASE_W = 1920;
const BASE_H = 1080;

/**
 * `focus: 'center'` 的默认形状：左右各留 27%、上下各留 25%，也就是画面中心 46%×50%。
 *
 * 为什么是这个数：钠那一屏的**图示主体**（3D 世界 / 队列）基本落在中心这一块，
 * 而四面八方的标注（眉标 / 读数列 / 说明条 / 脚注）都在它外面 —— 中心区再大就框不住了。
 */
export const CENTER_FOCUS = { insetX: 0.27, insetY: 0.25 };

/**
 * 把 `focus` 声明归一成绝对矩形。
 *
 * 三种写法：
 *   · `'center'`       → 画面中心区（见 CENTER_FOCUS）
 *   · `{ x, y, w, h }` → 直接给逻辑像素（左上角 + 尺寸）
 *   · `{ cx, cy, w, h }` → 给中心点
 *
 * ⚠ 归一化**不抛错**：`focus` 写坏了（给了 x/y 却没给尺寸）是装载期该喊的事，
 *   而这一层是"判据"—— 拿不到有效矩形时只能返回 null（= 没声明），
 *   判据于是说"没判"，**绝不说"通过"**。
 *
 * @param {any} focus
 * @param {number} [W] @param {number} [H]
 * @returns {{ x: number, y: number, w: number, h: number, source: string }|null}
 */
export function resolveFocus(focus, W = BASE_W, H = BASE_H) {
  if (!focus) return null;
  if (focus === 'center') {
    const w = W * (1 - 2 * CENTER_FOCUS.insetX);
    const h = H * (1 - 2 * CENTER_FOCUS.insetY);
    return { x: (W - w) / 2, y: (H - h) / 2, w, h, source: 'center' };
  }
  if (typeof focus !== 'object') return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const w = num(focus.w), h = num(focus.h);
  if (!(w > 0) || !(h > 0)) return null;
  let x = num(focus.x);
  let y = num(focus.y);
  const cx = num(focus.cx), cy = num(focus.cy);
  if (x === null && cx !== null) x = cx - w / 2;
  if (y === null && cy !== null) y = cy - h / 2;
  if (x === null || y === null) return null;
  return { x, y, w, h, source: focus.source ? String(focus.source) : 'declared' };
}

/** 两条区间是否重叠（区间都是 [a0,a1) 的形状） */
function overlapsY(a0, a1, b0, b1) { return a0 < b1 && b0 < a1; }

/** 一个文字块的 y 区间（基线 y、字号 size ⇒ 视觉高度；与 kit/bands 的估法同口径） */
function bandOf(b) {
  const size = Number.isFinite(b.size) ? b.size : 0;
  return { top: b.y - size * 0.8, bot: b.y + size * 0.25 };
}

/**
 * **版面母题保留区**（页眉 / 说明条 / 脚注）：这些位置上的字是"这一支片子的版式"，
 * 不是"又多了一个看的地方"。
 *
 * 为什么必须有这张表（2026-10-16 实测）：钠那 12 段里每一段都有页眉（左上「钠 5/6」）、
 * 说明条（左下）、脚注 —— 不豁免的话**每一段都必然超限**，判据立刻变成噪声，
 * 而它真正想抓的是"图示旁边还挤着四块标注"（"不知道要看哪个主体"）。
 *
 * 三个带与 `src/kit/bands.js` 的带宽同源（1920×1080 基准，按 H 缩放）——
 * 那三个带本来就是 kit 元件的落位（页眉 y≈92 / 说明条 y≈964 / 脚注 y≈1018）。
 */
export const RESERVED_BANDS = { top: 0.115, caption: 0.90, footer: 0.975 };

/**
 * 这一块字是不是落在版面母题保留区里（页眉 / 说明条 + 脚注）。
 *
 * 判据按**这一块自己的 y 范围**：
 *   · 页眉：整块都在 `RESERVED_BANDS.top` 以上 ⇒ 母题；
 *   · 说明条 + 脚注：**底边**过了 `RESERVED_BANDS.caption` 就算母题 ——
 *     这两行挨得近，常常被合成**一块**（钠那期就是这样），按"整块都在带里"判会漏掉它；
 *     而底边过线的"大字横跨半屏"没有这个问题（那种块的顶远在那条线以上）。
 */
function inReservedBand(g, H) {
  if (g.y1 <= H * RESERVED_BANDS.top) return true;
  return g.y1 >= H * RESERVED_BANDS.caption;
}

/**
 * 把一帧里的文字绘制记录合成**信息块**（单链聚类，只看 y 方向）。
 *
 * 为什么单链：一列读数（26px 一道）要合成一块，而它下面隔了 60px 的那行标题必须是另一块。
 * 链式合并恰好表达"连续的一列"这件事 —— 固定分格（把 y 切成几档）会把跨档的一列劈开。
 *
 * @param {any[]} blocks 绘制记录（`gl.paint.blocks`）
 * @param {{ gap?: number }} [o]
 * @returns {{ x0:number, y0:number, x1:number, y1:number, n:number, y:number, size:number, sample:string }[]}
 */
export function textGroups(blocks, o = {}) {
  const gap = Number.isFinite(o.gap) ? o.gap : LAYOUT_LIMITS.gap;
  const minAlpha = Number.isFinite(o.minAlpha) ? o.minAlpha : LAYOUT_LIMITS.minAlpha;
  const items = (Array.isArray(blocks) ? blocks : [])
    .filter((b) => b && Number.isFinite(b.x) && Number.isFinite(b.y))
    // 还没揭晓的字不算"占了一屏"（钠的读数/编号是一句一句揭的，全算进来人会以为一屏真有 16 块）
    .filter((b) => !(typeof b.alpha === 'number') || b.alpha >= minAlpha)
    .map((b) => {
      const size = Number.isFinite(b.size) ? b.size : 0;
      const w = Number.isFinite(b.w) ? Math.max(0, b.w) : 0;
      const { top, bot } = bandOf(b);
      return { b, top, bot, x0: b.x, x1: b.x + w, size };
    });
  items.sort((p, q) => p.top - q.top || p.x0 - q.x0);
  /** @type {any[]} */
  const out = [];
  let cur = null;
  for (const it of items) {
    // 合并判据 = 「行距」而不是「一个固定的像素数」：小字号（读数/编号）行距十几像素，
    // 大字号（96px 标题）行距几十像素。用一个固定阈值一定会在某一头出错 ——
    // 2026-10-16 两版都是这么栽的：36 把两行 size 24 的标签并了，28 又把 size 18 的读数
    // 并进了 y 差 34px 的 96px 大字里。现在按**两块里较小的那个字号**缩放，
    // 并留 12px 的地板（两行贴着的短标签仍然算一块）。
    const mergeGap = cur
      ? Math.max(12, Math.min(gap, Math.min(cur.size, it.size) * 0.8))
      : 0;
    const near = cur && (overlapsY(cur.top, cur.bot, it.top, it.bot) || it.top - cur.bot <= mergeGap);
    if (!near) {
      if (cur) out.push(cur);
      cur = {
        top: it.top, bot: it.bot, x0: it.x0, x1: it.x1, n: 0,
        y: it.b.y, size: it.size, first: it.b,
      };
    }
    cur.top = Math.min(cur.top, it.top);
    cur.bot = Math.max(cur.bot, it.bot);
    cur.x0 = Math.min(cur.x0, it.x0);
    cur.x1 = Math.max(cur.x1, it.x1);
    cur.n++;
    if (it.size > cur.size) { cur.size = it.size; cur.y = it.b.y; cur.first = it.b; }
  }
  if (cur) out.push(cur);
  return out.map((g) => ({
    x0: g.x0, x1: g.x1, y0: g.top, y1: g.bot,
    y: g.y, size: g.size, n: g.n,
    /** 这块字的代表文本（报告里点名用；多半是最大/最先画的那一行） */
    sample: String(g.first?.sample ?? g.first?.text ?? ''),
  }));
}

/**
 * **这一帧画了几笔"不是字"的东西**（读数，不进判据）—— 2026-10-25 加。
 *
 * ## 为什么需要它
 *
 * 版面守门的读数里有一项「主体区 N 块」。当一段的主体是**图形**（方波 / 格阵 / 波形，
 * 文字只是标注）时 N 天然是 0 —— 而"主体是图形"和"这一段什么都没画"在读数上**长得一模一样**
 * （见交接单 F：《把信号拆开》每一段都是这个形状）。判据本身没错（判据 ② 数的是文字块），
 * 错的是读数没有区分这两件事。
 *
 * ## 用哪个量（读 `src/core/gl.js` 的 `_notePaint / beginPaint`，不是猜的）
 *
 * `beginPaint()` 给每段开一本账，之后**每一次真的提交绘制**都记一笔：
 *   · `paint.any`   —— 所有绘制（Pass.render / blit / LineBatch.flush）都 +1；
 *   · `paint.full`  —— 其中 `blend:false` 的全屏 Pass（判据在 `_notePaint` 里）；
 *   · `paint.lines` —— 其中 `LineBatch.flush()` 的次数（矢量图形，`offset === 0` 时提前 return，不记）；
 *   · `paint.other` —— 画到了**别的渲染目标**上的次数（引擎内部搬运：xform / 快照）；
 *   · `paint.blocks`—— **文字**的记录（`src/core/text.js` 的 `noteText` 压进来的），一条 = 一次画字。
 * ⚠ `paint.text` 这个字段**从来没有人写过**（beginPaint 里初始化为 0 就再没动过）——
 *   它不是"文字绘制次数"，别拿它当文字读数；文字只有 `blocks` 这一份。
 *
 * 所以：**非文字绘制 = 总绘制 − 内部搬运 − 文字层的合成那一次**。
 * 文字层自己也是一次绘制（`comp.draw(gl, text, …)` 走的是 Compositor 的全屏 Pass，
 * `noFull: true`、`blend` 按模式），所以场景画了字就要减掉 1 —— 否则"只写了几行字"的段
 * 会被算成"画了图形"。
 *
 * ## 边界（诚实清单）
 *
 * · **没有坐标**：`paint` 只记次数，不记画在哪。所以这是**整帧**的读数，不是"主体区里面"的
 *   （接口名与打印措辞都按整帧写，别把它读成"主体区里有 N 笔"）；
 * · 场景若在一帧里 `comp.draw` 了**不止一层**（文字层 + 自己的渐变层），`textLayerDrawn`
 *   只减得掉 1 次 —— 多出来的那几次会被算成"非文字绘制"。这是已知的近似，读数会偏高；
 * · 场景 `render` 抛错时画的是**错帧卡片**（引擎画的，不是这一段的主体）⇒ `known: false`，
 *   整条读数按"没判"处理，不冒充 0。
 *
 * @param {any} paint `gl.paint`（引擎在每段 render 前 `beginPaint()` 开的那本账）
 * @param {{ textLayerDrawn?: boolean }} [o] 这一帧场景有没有提交自己的 2D 图层（= `layer._uploaded`）
 * @returns {{ known: boolean, total: number, lines: number, full: number, passes: number, error?: boolean }}
 *   `lines` / `full` 是 `total` 的子集（矢量批次 / 整帧不透明 Pass），只用来把读数说清楚
 */
export function countNonTextDraws(paint, o = {}) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  if (!paint || typeof paint !== 'object') return { known: false, total: 0, lines: 0, full: 0, passes: 0 };
  // 错帧卡片不是"这一段的主体"：读数按没判处理（说 0 就等于说"这一屏是空的"，那是假话）
  if (paint.markError) return { known: false, total: 0, lines: 0, full: 0, passes: 0, error: true };
  const any = num(paint.any);
  const other = num(paint.other);
  const lines = num(paint.lines);
  const full = num(paint.full);
  const composite = o.textLayerDrawn ? 1 : 0;
  const total = Math.max(0, any - other - composite);
  return { known: true, total, lines, full, passes: Math.max(0, total - lines) };
}

/**
 * 一块字在 `focus` 区里重叠了多少（**按重叠面积比它自己的面积**算）。
 *
 * ⚠ 为什么不用"块的中心在不在里面"：主体区边缘那半块字算不算主体，靠中心判定会一刀切；
 *   按面积比（≥ `inRatio` 才算"在里面"）更贴近"这块字压在主体上"的观感。
 *
 * @param {{x0:number,y0:number,x1:number,y1:number}} g
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @param {number} [inRatio]
 */
export function focusOverlap(g, rect, inRatio = 0.5) {
  const iw = Math.min(g.x1, rect.x + rect.w) - Math.max(g.x0, rect.x);
  const ih = Math.min(g.y1, rect.y + rect.h) - Math.max(g.y0, rect.y);
  if (!(iw > 0) || !(ih > 0)) {
    // 兜底：文字宽度量不到（w = 0）时用中心点判一次，别让"零宽"永远判成不在主体里
    const cx = (g.x0 + g.x1) / 2, cy = (g.y0 + g.y1) / 2;
    const inside = cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;
    return { ratio: inside ? 1 : 0, inside, iw: 0, ih: 0 };
  }
  const area = Math.max(1e-6, (g.x1 - g.x0) * (g.y1 - g.y0));
  const ratio = (iw * ih) / area;
  return { ratio, inside: ratio >= inRatio, iw, ih };
}

/** 块的面积（判"哪一块最大"用；宽量不到时退回"高度 × 1"，免得零宽永远选不中） */
function groupArea(g) {
  const w = Math.max(1, g.x1 - g.x0);
  const h = Math.max(1, g.y1 - g.y0);
  return w * h;
}

/** 两块字的矩形是否相交（主体连通性用；只判相交、不判远近 —— 远近已经在合成块时用过了） */
function groupsIntersect(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/**
 * 「主体区 0 块字」到底是哪一种（**纯读数**，见 `layoutVerdict()` 的 `focusNote`）。
 *
 * 为什么单独一个函数：这句话的**判断**必须能被离线单测钉住 —— 它是"读数不许被读成
 * 没画东西"的唯一落点，而 CLI 只负责按它换一种措辞打印。
 *
 * @param {number} inFocusCount 主体区里的块数
 * @param {{ known: boolean, total: number }|null} nonText `countNonTextDraws()` 的结果
 * @returns {'text'|'graphics'|'empty'|'unjudged'}
 */
export function focusNoteOf(inFocusCount, nonText) {
  if (inFocusCount > 0) return 'text';
  if (!nonText?.known) return 'unjudged';
  return nonText.total > 0 ? 'graphics' : 'empty';
}

/** 报告里点一块字的名字：截断 + 去掉换行 */
function shortOf(g) {
  const s = String(g?.sample ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return `(y=${Math.round(g?.y0 ?? 0)})`;
  const cut = [...s].slice(0, 12).join('');
  return [...s].length > [...cut].length ? `${cut}…` : cut;
}

/**
 * 一帧的版面判定。
 *
 * 判据两条（都是"人一眼能看出来、引擎却不报"的那类）：
 *   ① `blocks > maxBlocks` ⇒ **一屏的东西太多**（没有主体声明时唯一的数量判据）；
 *   ② 声明了 `focus` 之后：主体区里 `inFocus > maxInFocus` ⇒ **主体区里挤了别的东西**；
 *      主体区外 `offSubject > maxOffSubject` ⇒ **一屏多头**（"不知道要看哪个主体"）。
 *
 * 没声明 `focus` ⇒ `noFocus: true`：只有 ① 成立，② **没判**，绝不算通过。
 *
 * ## 一条读数（不是判据）：`focusNote`
 *
 * 声明了 `focus`、主体区里**一个字块都没有**、但这一帧**画了图形** ⇒ `focusNote: 'graphics'`。
 * 这是"主体是图形"那类段的正常形状（《把信号拆开》每一段都是），CLI 按它换个说法打印，
 * 免得「主体区 0 块」被读成"这一段什么都没画"。**它不改变任何判据**：
 * 判据 ②（`in-focus`）在"主体区 0 块"时本来就**不可能**触发（0 ≤ maxInFocus 恒成立）。
 *
 * @param {{ id?: string, t?: number, blocks?: any[], focus?: any, W?: number, H?: number,
 *   limits?: Partial<LayoutLimits>, paint?: any, textLayerDrawn?: boolean }} o
 *   `paint` / `textLayerDrawn` 是可选的：给了才有 `nonTextDraws` 那条读数（见 `countNonTextDraws`）
 */
/**
 * C1 版面守门 v2 的**几何判据**（纯函数）：字压字 / 出画 / 撞字幕。
 * 数据 = textGroups 聚类后的块 bbox（x0/x1/y0/y1）。与数量判据同一本绘制账。
 *
 * · overlap   任意两块交叠面积 > 较小块的 15% ⇒ warn（保留区里的版式字不参与）；
 * · off-frame bbox 越出画幅 0..W/0..H ⇒ error；off-safe 越出安全边距 pad ⇒ warn（保留区豁免）；
 * · caption-hit 块与**此刻正在渲染的字幕**矩形相交 ⇒ warn（captionRect 为空 = 没字幕，不判）。
 *
 * 受控豁免：allowOverlap 是一组字符串，块的 sample 文本含其中任一 ⇒ 该块不参与 overlap 判
 * （段级/任务级 layout.allowOverlap 声明，需显式说明关掉了什么）。
 * @param {any[]} groups textGroups 的产物
 * @param {{ W?:number, H?:number, pad?:number, captionRect?:any, allowOverlap?:string[] }} [o]
 * @returns {any[]} violations（kind/level/detail）
 */
export function geometryViolations(groups, o = {}) {
  const W = Number.isFinite(o.W) ? o.W : BASE_W;
  const H = Number.isFinite(o.H) ? o.H : BASE_H;
  const pad = Number.isFinite(o.pad) ? o.pad : 0;
  const captionRect = o.captionRect ?? null;
  const allowOverlap = Array.isArray(o.allowOverlap) ? o.allowOverlap : [];
  const gs = Array.isArray(groups) ? groups : [];
  const area = (g) => Math.max(0, g.x1 - g.x0) * Math.max(0, g.y1 - g.y0);
  const short = (g) => String(g.sample ?? '').slice(0, 12) || '(字块)';
  const exempt = (g) => allowOverlap.some((s) => s && String(g.sample ?? '').includes(s));
  const inter = (a, b) => {
    const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
    const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    return ix * iy;
  };
  /** @type {any[]} */ const v = [];
  // 字压字（保留区里的页眉/脚注是版式，不算）
  for (let i = 0; i < gs.length; i++) {
    for (let j = i + 1; j < gs.length; j++) {
      const a = gs[i], b = gs[j];
      if (inReservedBand(a, H) || inReservedBand(b, H)) continue;
      if (exempt(a) || exempt(b)) continue;
      const smaller = Math.min(area(a), area(b));
      const ov = inter(a, b);
      if (smaller > 0 && ov > 0.15 * smaller) {
        v.push({ kind: 'overlap', level: 'warn', got: ov / smaller, limit: 0.15,
          detail: `字压字：「${short(a)}」与「${short(b)}」交叠 ${Math.round(100 * ov / smaller)}%（>15%）` });
      }
    }
  }
  // 出画 / 越安全边距
  for (const g of gs) {
    // 出画只判**锚点越界**（x0/y0 是绘制锚点）：右/下边缘 x1/y1 依赖实测宽度，而右对齐/居中字的
    // 锚点不是左上角、宽度量的是 sans 近似 —— 拿 x1>W 判会在 beat 的 LOW/MID/HIGH 上刷假阳性（C1 校验后收紧）。
    if (g.x0 < 0 || g.y0 < 0 || g.x0 > W || g.y0 > H) {
      v.push({ kind: 'off-frame', level: 'error', detail: `出画：「${short(g)}」锚点越出画幅 ${W}×${H}` });
    } else if (pad > 0 && !inReservedBand(g, H) && (g.size ?? 0) >= 32 && (g.x0 < pad || g.y0 < pad || g.x1 > W - pad || g.y1 > H - pad)) {
      // 只判**成块的内容字**（size≥32）：贴边的计数器/角标/小标签（kinetic 的 079、beat 的 EQ 注记）
      // 是版式装饰，不是「内容压边」—— 全判会在 demo/beat 上刷一片假阳性（C1 假阳性校验后收紧）。
      v.push({ kind: 'off-safe', level: 'warn', detail: `越出安全边距 ${pad}px：「${short(g)}」` });
    }
  }
  // 撞字幕（只有此刻真的在画字幕才判）
  if (captionRect) {
    for (const g of gs) {
      // 字幕本身在顶部保留带里，但「内容块撞字幕」正是要抓的事 —— 不按保留区豁免；
      // 字幕 x 范围居中，左右页眉天然不交，不会误伤。
      if (inter(g, captionRect) > 0) {
        v.push({ kind: 'caption-hit', level: 'warn', detail: `撞字幕：「${short(g)}」压进此刻的字幕` });
      }
    }
  }
  return v;
}
export function layoutVerdict(o = {}) {
  const limits = { ...LAYOUT_LIMITS, ...(o.limits ?? {}) };
  const W = Number.isFinite(o.W) ? o.W : BASE_W;
  const H = Number.isFinite(o.H) ? o.H : BASE_H;
  const rect = resolveFocus(o.focus, W, H);
  const blocks = Array.isArray(o.blocks) ? o.blocks : [];
  /** 这一帧的非文字绘制读数（整帧，不含文字层的合成那一笔） */
  const nonText = o.paint ? countNonTextDraws(o.paint, { textLayerDrawn: !!o.textLayerDrawn }) : null;
  const groups = textGroups(blocks, { gap: limits.gap, minAlpha: limits.minAlpha });
  /** @type {any[]} */
  const violations = [];
  if (groups.length > limits.maxBlocks) {
    violations.push({
      kind: 'blocks',
      got: groups.length,
      limit: limits.maxBlocks,
      detail: `一屏 ${groups.length} 块文字（上限 ${limits.maxBlocks}）`,
    });
  }
  // 「主体」= 落在 focus 区里的块 ∪ **最大的一块**（没声明 focus 时的唯一主体）。
  // 图连通合并：一块读数组里的 6 个数在空间上连着，它们**是一件事**，不该互相算成"抢视线"；
  // 而它旁边隔开的另一块字才是一次真正的"多了一个东西"。
  const root = new Map();
  const find = (i) => { while (root.get(i) !== i) i = root.get(i); return i; };
  for (let i = 0; i < groups.length; i++) root.set(i, i);
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (groupsIntersect(groups[i], groups[j]) && find(i) !== find(j)) root.set(find(i), find(j));
    }
  }
  /** @type {Map<number, number[]>} */
  const members = new Map();
  for (let i = 0; i < groups.length; i++) {
    const r = find(i);
    if (!members.has(r)) members.set(r, []);
    members.get(r).push(i);
  }
  /** 每个连通块（= 一个"看的地方"）的包围盒与成员数 */
  const comps = [...members.values()].map((ix) => {
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, n: 0 };
    for (const i of ix) {
      const g = groups[i];
      box.x0 = Math.min(box.x0, g.x0); box.x1 = Math.max(box.x1, g.x1);
      box.y0 = Math.min(box.y0, g.y0); box.y1 = Math.max(box.y1, g.y1);
      box.n++;
    }
    return { ix, box };
  });
  // 每一块自己的重叠面积比（判定"主体区里的哪几块"要用它）
  const ovOf = groups.map((g) => (rect ? focusOverlap(g, rect, 0.5) : null));
  /** 主体 = focus 区里那些块所在的连通块 ∪ 最大的那块所在的连通块 */
  const subjectRoots = new Set();
  for (let i = 0; i < groups.length; i++) if (ovOf[i]?.inside) subjectRoots.add(find(i));
  if (groups.length) {
    let big = 0;
    for (let i = 1; i < groups.length; i++) if (groupArea(groups[i]) > groupArea(groups[big])) big = i;
    subjectRoots.add(find(big));
  }
  const subjectComps = comps.filter((c) => subjectRoots.has(find(c.ix[0])));
  const otherComps = comps.filter((c) => !subjectRoots.has(find(c.ix[0])));
  /**
   * 判据 ②（必须声明 focus 才跑）：**主体区里压了几块** —— 这就是"元素互相遮挡、
   * 不知道看哪个"的直接计数（`Rect3` 那种坐在图示上的标签会走这条）。
   */
  /** 主体区里的块数（声明了 focus 才有意义；没声明时保持 -1 = "没判"） */
  let inFocusCount = -1;
  if (rect) {
    // 保留区里的字不参与"抢视线"（页眉/说明条/脚注是版式，不是第二个主体）
    const inFocusIdx = groups.map((g, i) => i)
      .filter((i) => ovOf[i]?.inside && !inReservedBand(groups[i], H));
    inFocusCount = inFocusIdx.length;
    if (inFocusIdx.length > limits.maxInFocus) {
      violations.push({
        kind: 'in-focus',
        got: inFocusIdx.length,
        limit: limits.maxInFocus,
        detail: `主体区里压着 ${inFocusIdx.length} 块（上限 ${limits.maxInFocus}）：${inFocusIdx.map((i) => shortOf(groups[i])).join(' / ')}`,
      });
    }
  }
  /**
   * 判据 ③（**不要求 focus**）：**主体之外还有几个"看的地方"**。
   * 主体 = 最大的一块 ∪ 与 focus 区相交的块（图连通之后按"看的地方"计数）——
   * 「元素相互遮挡害得我搞不清楚到底要看哪个主体」正是这一条的读数。
   */
  // 保留区（页眉 / 说明条 / 脚注）里的块**既不算判据、也不算读数** —— 它是这一支片子的版式，
  // 不是「又多了一个看的地方」（见 RESERVED_BANDS 的注释）。判据与读数用同一个集合，
  // 免得出现「报告说 0 个、判据却超限」这种自相矛盾的数字。
  const subjectOutside = otherComps.filter((c) => !c.ix.every((i) => inReservedBand(groups[i], H)));
  if (subjectOutside.length > limits.maxOffSubject) {
        violations.push({
          kind: 'off-subject',
          got: subjectOutside.length,
          limit: limits.maxOffSubject,
          detail: `主体之外还有 ${subjectOutside.length} 个"看的地方"（上限 ${limits.maxOffSubject}）：`
            + subjectOutside.map((c) => shortOf(groups[c.ix[0]])).join(' / '),
        });
  }
  // C1 几何判据：字压字 / 出画 / 撞字幕（与数量判据同一本绘制账；默认 warn，off-frame 是 error 级）
  violations.push(...geometryViolations(groups, {
    W, H, pad: o.pad ?? 0, captionRect: o.captionRect ?? null, allowOverlap: o.allowOverlap ?? [],
  }));
  return {
    id: o.id ?? '',
    t: Number.isFinite(o.t) ? o.t : 0,
    /** 这一帧一共画了几次字（读数：这块字有多碎） */
    draws: blocks.length,
    /** 合并之后的信息块数（判据 ① 用的就是它） */
    blocks: groups.length,
    groups,
    focus: rect,
    focusSource: rect?.source ?? null,
    /** 主体区里压着的块数（声明了 focus 才有意义；没声明时是 -1 = "没判"） */
    inFocus: inFocusCount,
    /**
     * **这一帧画了几笔"不是字"的东西**（整帧；读数，不进判据）。
     * `known: false` = 拿不到账（没传 `paint`）或那一帧是错帧卡片 —— 这两种都是"没判"，
     * 不许当成 0（0 的意思是"这一屏真的什么都没有"）。
     */
    nonTextDraws: nonText ? nonText.total : 0,
    nonTextKnown: !!nonText?.known,
    /** 其中矢量批次 / 整帧不透明 Pass 各几笔（只是把读数说清楚，判据不看） */
    nonTextLines: nonText ? nonText.lines : 0,
    nonTextPasses: nonText ? nonText.passes : 0,
    /**
     * 「主体区 0 块字」到底是哪一种（见文件头的边界清单）：
     *   · `'graphics'`     —— 主体区没有字，但这一帧**画了图形**（主体是图形，正常形状）；
     *   · `'empty'`        —— 主体区没有字，而且**一笔非文字绘制都没有**（真的像没画东西）；
     *   · `'text'`         —— 主体区里有字块（读数照常）；
     *   · `'undeclared'`   —— 没声明 focus，这一条谈不上；
     *   · `'unjudged'`     —— 拿不到绘制账（没传 paint / 错帧卡片）⇒ 没判。
     */
    focusNote: rect ? focusNoteOf(inFocusCount, nonText) : 'undeclared',
    /**
     * 主体之外还有几个「看的地方」（判据 ③ 的读数）。
     * ⚠ 它**不依赖 focus**：没声明时主体 = 最大的一块，这条照样算得出来 ——
     *   钠那期 12 段全都没声明 focus，而「不知道看哪个主体」正是这一条的读数。
     */
    offSubject: subjectOutside.length,
    /** 没声明 focus ⇒ 判据 ② 这一半**没跑** */
    noFocus: !rect,
    violations,
    ok: violations.length === 0,
  };
}

/**
 * 把每一段的采样（`{ t, verdict }[]`）汇成"这一段最糟的那一帧"。
 *
 * 为什么取**最糟**而不是平均：观众的记忆是峰值 —— 「这一屏 12 个元素」比"平均 4.6 个"值得报。
 * 同时把"有几帧超限"给出来（`over`），免得把偶发的一帧说成整段都这样。
 *
 * @param {{ id: string, samples: { t: number, verdict: any }[] }[]} rows
 */
export function layoutReport(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const samples = (Array.isArray(r.samples) ? r.samples : []).filter((s) => s && s.verdict);
    if (!samples.length) {
      return { id: r.id, judged: false, samples: 0, noFocus: true, violations: [], over: 0, worst: null };
    }
    let pick = samples[0];
    for (const s of samples) {
      const better = s.verdict.blocks > pick.verdict.blocks
        || (s.verdict.blocks === pick.verdict.blocks
            && s.verdict.violations.length > pick.verdict.violations.length);
      if (better) pick = s;
    }
    /** 这一帧的判定本身（**展开成一层**）：调用方只读一层字段 */
    const worst = pick.verdict;
    const over = samples.filter((s) => s.verdict.violations.length).length;
    return {
      id: r.id,
      judged: true,
      samples: samples.length,
      /**
       * 整段最挤的那一帧 —— 判据看的就是它（观众记住的是峰值，不是平均）。
       * ⚠ 这里**平铺展开**而不是留一个 `worst` 对象：CLI 打印与 errs 都只读一层字段，
       *   嵌套一层的结果就是 2026-10-16 那版"报告里全 undefined"（判据对了、接线断了）。
       */
      worst,
      t: worst.t,
      blocks: worst.blocks,
      draws: worst.draws,
      groups: worst.groups,
      focus: worst.focus,
      inFocus: worst.inFocus,
      /** 「主体区 0 块字」的那一条读数的判读（见 `layoutVerdict()` 的 `focusNote`） */
      focusNote: worst.focusNote,
      nonTextDraws: worst.nonTextDraws,
      nonTextKnown: worst.nonTextKnown,
      nonTextLines: worst.nonTextLines,
      nonTextPasses: worst.nonTextPasses,
      offSubject: worst.offSubject,
      /** 有几帧超限（免得把偶发的一帧说成整段都这样） */
      over,
      /** 整段每一帧都没有主体声明 ⇒ 判据 ② 这一半没跑 */
      noFocus: samples.every((s) => s.verdict.noFocus),
      violations: worst.violations,
    };
  });
}

/**
 * 整片汇总 —— CLI 的打印 / errs / skipped 三档都读它（**纯函数**，离线单测钉住）。
 *
 * 三档含义（与 `check` 既有哲学一致）：
 *   · `noFocus`  —— 判据 ② 没跑（场景没声明主体）⇒ CLI 必须进 `skipped`，不许说成通过；
 *   · `violates` —— 有段超限 ⇒ **默认只 warn**，`--strict` 才进 errs（"先只报不改退出码"）；
 *   · `unjudged` —— 一次采样都没有（`--only` 选到没文字的段 / 渲染失败）⇒ 也是"没判"。
 *
 * @param {any[]} rows `layoutReport()` 的输出
 */
export function layoutSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const unjudged = list.filter((r) => !r.judged);
  const judged = list.filter((r) => r.judged);
  const violates = judged.filter((r) => (r.violations ?? []).length);
  const noFocus = judged.filter((r) => r.noFocus);
  const has = (r, kind) => (r.violations ?? []).some((v) => v.kind === kind);
  return {
    segments: list.length,
    judged: judged.length,
    unjudged: unjudged.map((r) => r.id),
    violates,
    noFocus: noFocus.map((r) => r.id),
    /** 峰值读数（报告头一行用）：整片最挤的那一帧 */
    peak: judged.reduce((m, r) => Math.max(m, r.blocks ?? 0), 0),
    /** 「不知道看哪个主体」的直接计数：主体区外超限的段 */
    offSubject: judged.filter((r) => has(r, 'off-subject')).map((r) => r.id),
    /** 主体区里挤了别的东西的段 */
    inFocus: judged.filter((r) => has(r, 'in-focus')).map((r) => r.id),
  };
}
