// @ts-check
/**
 * 转场与「一镜到底」工具。
 *
 * 这一层解决的是一个**剪辑问题**，不是渲染问题：为什么大多数代码动画一眼看去就是
 * 「一段一段的幻灯片」？因为每个场景各建背景、各写 post，一切镜头世界就跳；
 * 切点还配上 flash+zoom，于是每次切换都在"顿"一下。
 *
 * 有效的配方（在 NekoHome 那支 48 秒片子上验证过）是四条，缺一条就会露馅：
 *
 *   ① **全片只有一层背景**：同一个 shader、参数只由**整片时间 `f.t`** 驱动，
 *      所以切点两侧的背景逐像素一致 —— 世界没有变，只有前景在换。
 *   ② **全片一台摄影机**：`cameraAt(t)` 交给 post 的 `zoom`/`shake`，
 *      全帧（背景 + 矢量 + 文字）一起动，切镜头时它不会断。
 *   ③ **一个走完全片的母题**：一条指针/一道扫描线/一颗星，眼睛有得跟，切了也像没切。
 *   ④ **交叠期把上一帧甩走**，不是原地淡出：`transitionPass()` 沿摄影机方向加速推出去
 *      并加方向拖尾；新内容从**反方向**落位（`enterOffset`）。
 *
 * ## ⑤ 受害者的退出时长 = 入侵者的 40–50%（可调用、可断言）
 *
 * 第四条只说了"甩走"，没说**甩多久**。外部项目 hyperframes 的 `reactive-displacement`
 * （`docs/REFERENCE-hyperframes.md` **518 行**）给了那个比例：**受害者的时长是入侵者的
 * 40–50%**，三个并发的 tween 落在同一时间点。
 *
 * ⚠ **那是【外部经验值】，我方还没实测**（证据分级见 `docs/MOTION.md` §0）——
 * 这一层只是把它做成可调用、可断言的东西，不是宣布"40–50% 最好看"：
 *
 *   · `planCollision({ enterDur, ratio })` —— 纯函数（不碰 GPU），算出受害者该占的时长与
 *     比例；越界**夹到 `VICTIM_RATIO_RANGE` 并返回说明**（不静默）；
 *   · `transitionPass(gl, { victimRatio })` —— 交给场景用：比例直接变成 uniform `fadeAt`
 *     （`k` 就是交叠期的归一化进度，所以"受害者时长 ÷ 入侵者时长 = fadeAt"）。
 *     **不传 `victimRatio` = 行为与从前逐像素相同**（已交付片子的硬要求）。
 *
 * 用法（每段场景的骨架）：
 *
 * ```js
 * import { makeTransitionKit, cameraAt, cameraDir, cameraPost, enterOffset } from '../../../src/core/trans.js';
 *
 * export default {
 *   id: 'shot_a',
 *   handlesTransition: true,                  // 转场自己处理，别让引擎做交叉溶解
 *   setup(ctx) { this.tk = makeTransitionKit(ctx); },
 *   render(ctx) {
 *     const { f, gl, lines, text, type } = ctx;
 *     const k = this.tk.openFrame(ctx, this.worldPass);   // 画全片唯一的背景 + 甩走上一帧；返回入场进度
 *     // …画这一段的 foreground（用 enterOffset(f.t, k) 做反向落位）…
 *     return cameraPost(f.t, { bloom: 0.34, grain: 0.02 });
 *   },
 * };
 * ```
 *
 * ⚠ **文字量大的画面不要用交叉溶解**：两屏字叠在一起会糊，必须让旧的「走掉」——
 * 这正是 `transitionPass` 存在的理由。
 */

import { Pass } from './gl.js';
import { sat } from './util.js';
import { TRANSITION_FRAG } from './transition-frag.js';

/* ═════════════ 碰撞式转场：受害者时长 = 入侵者时长 × 40–50%（§4.4） ═════════════ */

/**
 * 「受害者（被顶掉的旧内容）退出时长 ÷ 入侵者（新内容）入场时长」的**合法区间**。
 *
 * 出处：`docs/REFERENCE-hyperframes.md` **518 行**（`reactive-displacement`：
 * "受害者的时长是入侵者的 40-50%"）。
 * ⚠ **【外部经验值】，我方未实测** —— 我们证到的只是"越界会被夹取、夹取会说话"
 * （`tools/test-transition-collision.mjs` 钉着），**不是**"40–50% 在我们这儿最好看"。
 *
 * 0.40 / 0.50 不要散在代码里：要判就用这个常量，要改就改这一处。
 */
export const VICTIM_RATIO_RANGE = [0.40, 0.50];

/**
 * 不给 `ratio` 时用的值 = 区间中点（0.45）。两端都是"边界"，中点才是没有主张时的默认。
 */
export const VICTIM_RATIO_DEFAULT = (VICTIM_RATIO_RANGE[0] + VICTIM_RATIO_RANGE[1]) / 2;

/** 参数必须是有限数：NaN / ±Inf 传下去 = 整屏白或"每一帧都不一样"，而且引擎不报错（AGENTS.md §5.5）。 */
function needFinite(who, name, v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TypeError('trans: ' + who + ' 的 ' + name + ' 必须是有限数，收到 ' + String(v)
      + ' —— NaN / ±Inf 传下去会变成整屏白或每帧不同的转场，而且引擎不会报错（AGENTS.md §5.5）。');
  }
}

/** 短字符串（告警里给人看的，不留 toFixed 的尾零）。 */
function num(x) {
  return String(Math.round(x * 1000) / 1000);
}

/**
 * **碰撞式转场的比例计划**（纯函数：无副作用、不碰 GPU、不读时钟、不认识 `ctx`）。
 *
 * 规则（`docs/MOTION.md` §2 / §3.5，判据出处 `docs/REFERENCE-hyperframes.md` **518 行**，
 * 【外部经验值】，我方未实测）：**受害者退出时长 = 入侵者入场时长 × 0.40–0.50**。
 *
 * ```js
 * const c = planCollision({ enterDur: 0.6 });        // 交叠期 0.6s
 * c.victimDur;   // 0.27s —— 旧内容该在这么久之内退干净（= 0.6 × 0.45）
 * c.ratio;       // 0.45（夹取之后；原值在 c.rawRatio）
 * c.fadeAt;      // 0.45 —— 同一件事的"k 口径"，直接喂 transitionPass
 * if (c.clamped) ctx.warnings.push(c.warning);       // 本函数只判定，不喊
 * ```
 *
 * **三条边界**（都是刻意的，不要"顺手"放宽）：
 *   · `ratio` 越界（< 0.40 或 > 0.50）⇒ **夹回区间**并给 `warning`（说明里带原值、区间、
 *     夹取后的受害者时长）—— 静默夹取等于"画面照样出，只是不是你要的那个"；
 *   · `enterDur ≤ 0`（没有交叠期）⇒ 受害者时长记 **0**（不是负数、不是 NaN），`degenerate: true`，
 *     比例照原样保留 —— 等有了交叠期就能直接用；
 *   · `enterDur` / `ratio` 是 NaN / ±Inf / 非数字 ⇒ **当场抛**（与镜头模板参数写错同一条哲学）。
 *
 * @param {{ enterDur?: number, ratio?: number }} [o]
 *        `enterDur` 入侵者入场时长（秒；**默认 1** = "一整段交叠期"的归一化口径，此时
 *        `victimDur` 与 `fadeAt` 同值）、`ratio` 想要的受害者比例（默认 {@link VICTIM_RATIO_DEFAULT}）
 * @returns {{ enterDur: number, rawEnterDur: number, ratio: number, rawRatio: number,
 *   victimDur: number, minVictimDur: number, maxVictimDur: number, fadeAt: number,
 *   clamped: boolean, degenerate: boolean, ok: boolean, warning: string | null }}
 *   `ratio`/`victimDur` = 夹取后可直接用的值；`rawRatio` = 你原本给的那个数；
 *   `fadeAt` = 同一件事的 k 口径（`transitionPass` 的 uniform）；`warning` 为字符串或 null
 */
export function planCollision(o = {}) {
  const enterDur = o.enterDur ?? 1;
  const rawRatio = o.ratio ?? VICTIM_RATIO_DEFAULT;
  needFinite('planCollision', 'enterDur', enterDur);
  needFinite('planCollision', 'ratio', rawRatio);
  const [lo, hi] = VICTIM_RATIO_RANGE;
  const ratio = Math.min(hi, Math.max(lo, rawRatio));
  const clamped = ratio !== rawRatio;
  /** 没有交叠期就没有"退出时长"可言 —— 记 0，并且**明说**，不糊过去。 */
  const degenerate = !(enterDur > 0);
  const dur = degenerate ? 0 : enterDur;
  const victimDur = dur * ratio;
  const notes = [];
  if (degenerate) {
    notes.push('碰撞式转场没有交叠期：enterDur = ' + num(enterDur) + 's ⇒ 受害者退出时长记 0s'
      + '（比例 ' + num(ratio) + ' 照原样留着，等有了交叠期再生效）。');
  }
  if (clamped) {
    notes.push('受害者时长比例越界：' + num(rawRatio) + ' 不在 ' + num(lo) + '–' + num(hi)
      + '（§4.4 reactive-displacement / REFERENCE-hyperframes.md 518 行：受害者 = 入侵者的 40–50%），'
      + '已夹到 ' + num(ratio) + '——受害者退出 ' + num(victimDur) + 's，入侵者入场 '
      + num(dur) + 's。');
  }
  return {
    enterDur: dur,
    rawEnterDur: enterDur,
    ratio,
    rawRatio,
    victimDur,
    minVictimDur: dur * lo,
    maxVictimDur: dur * hi,
    fadeAt: ratio,
    clamped,
    degenerate,
    ok: !clamped && !degenerate,
    warning: notes.length ? notes.join(' ') : null,
  };
}

/**
 * 只要那个**时长**时的简写：`victimSpan(enterDur, ratio)` → 受害者应占的秒数。
 *
 * 与 `planCollision({ enterDur, ratio }).victimDur` **逐位相同**（同一个实现，不另算一套）；
 * 需要"为什么是这个数 / 夹取说明"时用 `planCollision`。
 *
 * @param {number} [enterDur] 入侵者入场时长（秒；默认 1）
 * @param {number} [ratio] 受害者比例（默认 {@link VICTIM_RATIO_DEFAULT}，越界夹取）
 * @returns {number} 受害者退出时长（秒）；`enterDur ≤ 0` 时为 0
 */
export function victimSpan(enterDur = 1, ratio = VICTIM_RATIO_DEFAULT) {
  return planCollision({ enterDur, ratio }).victimDur;
}

/* ═════════════ 参数化转场：wipe / iris / glitch / pixel / dissolve（BACKLOG 1-13） ═════════════ */

/**
 * **引擎内置的转场模式名**（`transition: '<名字>'` 的合法值）。
 *
 * 为什么要有这一层：以前只有两条路 —— 'push'（甩镜，默认）与 'mix'（交叉溶解），
 * 想要别的（擦除 / 光圈 / 故障 / 像素化）就得整段 `handlesTransition: true` 自己写 shader。
 * 于是**大多数片子的切法只有两种**，而"切法"恰恰是"像不像一支片子"最便宜的杠杆
 * （BACKLOG 1-13；出处 `docs/REFERENCE-world-execute.md` §4 ④：对方 305 个镜头里大量用非溶解转场）。
 *
 * ⚠ **不写 `transition` ⇒ 还是 'push'，逐像素与从前一致**（已交付片子的硬要求）。
 *   这与 `transitionPass` 的 `victimRatio` 是同一条纪律：新能力默认不改变旧画面。
 *
 * | 名字 | 画面 | 什么时候用 |
 * |---|---|---|
 * | 'push' | 旧帧沿摄影机方向加速甩走（默认） | 通用；文字量大的画面 |
 * | 'mix' | 交叉溶解 | 两屏都是图形、没有大段文字 |
 * | 'none' | 硬切 | 要"断"的时候 |
 * | 'wipe' | 一条软边横扫（方向跟摄影机） | 段落推进、"翻页" |
 * | 'iris' | 圆形光圈开合 | 聚焦一件事、开场 / 收尾 |
 * | 'glitch' | 横向切片错位 + RGB 分离 | 冲击、故障、数据感 |
 * | 'pixel' | 像素块溶解 | 数字化、降采样、回忆 |
 * | 'dissolve' | 噪声阈值溶解（不是等比混合） | 梦境、时间流逝 |
 */
export const TRANSITION_MODES = /** @type {const} */ ([
  'push', 'mix', 'none', 'wipe', 'iris', 'glitch', 'pixel', 'dissolve',
]);

const PASS_MODES = new Set(['push', 'wipe', 'iris', 'glitch', 'pixel', 'dissolve']);

/**
 * 校验转场模式名。**写错当场抛**（并列出可用清单）。
 *
 * 为什么抛而不是回落到 'push'：一个打错的 `transition: 'wipee'` 会静默变成甩镜 ——
 * 画面照样出、`check` 照样绿，只把"我要的擦除怎么没出现"留给人。
 * 这与"参数名拼错要抛"是同一条纪律（`src/timeline.js` 的 `configToCut`）。
 *
 * @param {unknown} mode
 * @param {string} [where] 报错里点名的位置（段 id / 字段路径）
 * @returns {string} 校验过的模式名
 */
export function resolveTransitionMode(mode, where = 'transition') {
  if (mode === undefined || mode === null) return 'push';
  if (typeof mode !== 'string') {
    throw new TypeError(where + '：转场模式必须是字符串，收到 ' + typeof mode
      + '（' + JSON.stringify(mode) + '）。可用：' + TRANSITION_MODES.join(' / '));
  }
  if (!TRANSITION_MODES.includes(/** @type {any} */ (mode))) {
    throw new TypeError(where + '：没有转场模式 "' + mode + '"（大概是拼错了）。'
      + '可用：' + TRANSITION_MODES.join(' / '));
  }
  return mode;
}

/** 某个模式是不是走 `transitionPass` 那一支（'mix' / 'none' 各有各的实现，不走）。 */
export function isPassTransition(mode) {
  return PASS_MODES.has(mode);
}

/**
 * 一个模式下"旧帧该在 k 的多少之前退干净"—— 决定**两屏内容会不会叠着**。
 *
 * 溶解类（mix / dissolve / pixel）本来就要叠着（那是它们的画面），其余在交叠期就该退场。
 * ⚠ 'push' 的 0.55 是**历史默认值**，一个字节都不许动（已交付片子逐像素不变）。
 *
 * @param {string} mode
 * @returns {number} 0..1
 */
export function transitionFadeAt(mode) {
  switch (resolveTransitionMode(mode)) {
    case 'wipe': return 0.85;
    case 'iris': return 0.9;
    case 'glitch': return 0.7;
    case 'pixel': return 0.8;
    case 'dissolve': return 1;
    default: return 0.55;
  }
}

/**
 * 把「上一段那一帧」沿摄影机方向甩出去，并加方向拖尾。
 *
 * 与交叉溶解的区别：溶解是「两张图叠在一起」，甩出去是「镜头没停，画面被带走了」。
 * 位移随 k **加速**（k²），拖尾宽度同时变宽 —— 这两个一起给速度感；
 * 透明度在 k=`fadeAt`（默认 0.55）之前就降到 0，避免两屏文字长时间叠着。
 *
 * 返回的 `Pass` 是 `blend: true` 的：它是**叠在本段背景之上**的，不是覆盖。
 *
 * ## `victimRatio`：受害者该在交叠期的哪个进度上退干净（§4.4，518 行）
 *
 * `fadeAt` 的字面意思是"旧的这一帧在 k=多少时完全消失"，而 `k` 就是交叠期的归一化进度
 * （`f.tin`）—— 所以 **受害者时长 ÷ 入侵者时长 = fadeAt**。`victimRatio` 是同一个东西的
 * **比例写法**：传了就按 {@link VICTIM_RATIO_RANGE} 夹取（越界夹回来，说明放在
 * `pass.collision.warning`），免得每个场景各写一个 0.4 / 0.5。
 *
 * ⚠ **不传 `victimRatio` ⇒ `fadeAt` 还是 0.55，逐像素与从前一致**（已交付的片子全走这条路，
 * 改它们一个像素都算事故）。**不传 = 行为不变**，这条是硬要求。
 *
 * ⚠ `fadeAt` 与 `victimRatio` 是**同一个旋钮的两种写法**，两个都给会**抛**——
 * 静默忽略其中一个比抛错贵得多（画面照样出，只是不是你要的那个）。
 *
 * @param {import('./gl.js').GL} gl
 * @param {{
 *   push?: number, blur?: number, fadeAt?: number, samples?: number, key?: string,
 *   victimRatio?: number,
 * }} [opts] `victimRatio` = 受害者退出时长 ÷ 入侵者入场时长（0.40–0.50，越界夹取并说明）；
 *   不传 = 保持 `fadeAt` 0.55 的老行为
 * @returns {Pass & { collision: ReturnType<typeof planCollision> | null }}
 *   转场 Pass；`collision` 是这次的比例计划（没传 `victimRatio` 时为 `null`）
 */
export function transitionPass(gl, opts = {}) {
  const push = opts.push ?? 0.36;
  const blur = opts.blur ?? 0.085;
  const mode = resolveTransitionMode(opts.mode, opts.where);
  const hasRatio = opts.victimRatio !== undefined && opts.victimRatio !== null;
  if (hasRatio && opts.fadeAt !== undefined && opts.fadeAt !== null) {
    throw new TypeError('trans: transitionPass 的 fadeAt 与 victimRatio 是同一个旋钮的两种写法'
      + '（fadeAt = 受害者退出时的 k，victimRatio = 受害者时长 ÷ 入侵者时长），只给一个。');
  }
  /** `enterDur: 1` = 以"一整段交叠期"为单位 ⇒ `collision.fadeAt` 就是 uniform 要的那个 k。 */
  const collision = hasRatio ? planCollision({ enterDur: 1, ratio: opts.victimRatio }) : null;
  /** 没给 fadeAt 也没给 ratio ⇒ 按**模式**取默认（`'push'` 仍是 0.55，逐像素不变）。 */
  const fadeAt = opts.fadeAt ?? (collision ? collision.fadeAt : transitionFadeAt(mode));
  const pass = /** @type {Pass & { collision: ReturnType<typeof planCollision> | null, mode: string }} */ (
    new Pass(gl, TRANSITION_FRAG[mode], { under: { value: null }, k: 1, dir: [1, 0], push, blur, fadeAt },
      { key: opts.key ?? (mode === 'push' ? 'trans_push' : `trans_${mode}`), blend: true, jitter: false }));   // 重采样已有内容：不吃抖动
  /** 这一笔用的是哪一套比例（没传 `victimRatio` 时是 `null` = 老行为） */
  pass.collision = collision;
  /** 这一笔是哪一种转场（`'push'` = 老路径，源码与从前逐字符相同） */
  pass.mode = mode;
  return pass;
}

/**
 * 摄影机曲线的**参数化实现**。
 *
 * `src/core/trans.js`（老配方）与 `src/kit/world.js`（`makeShot` 用的那套）是
 * **同一个纯函数的两组参数**，不是两份实现 —— 以前两处各抄一份，改一处就会漏另一处。
 * 默认值 = `trans.js` 从前的常量（逐像素不变）；`kit/world.js` 传另一组。
 *
 * 返回 `{ cameraAt, cameraDir, cameraPost, enterOffset }`，全部只吃 `t`。
 *
 * @param {{
 *   zoomBase?: number, zoomAmp?: number,
 *   zoomW?: [number, number], zoomPhase?: [number, number],
 *   shake?: [number, number, number][],   // [幅度, 频率, 相位] × 4：x 两路、y 两路
 *   enterAmount?: number, enterY?: number,
 * }} [p]
 */
export function makeCameraProfile(p = {}) {
  const zoomBase = p.zoomBase ?? 1;
  const zoomAmp = p.zoomAmp ?? 0.05;
  const zoomW = p.zoomW ?? [0.105, 0.31];
  const zoomPhase = p.zoomPhase ?? [0, 2.0];
  const shake = p.shake ?? [[38, 0.19, 0], [13, 0.47, 0.7], [22, 0.16, 1.3], [8, 0.41, 0]];
  const enterAmount = p.enterAmount ?? 150;
  const enterY = p.enterY ?? 0.55;

  /**
   * 全片一台摄影机：**只用整片时间 `t`**，所以切镜头时它不会断。
   * 两个不同频率的正弦叠加，避免看出周期。
   */
  function cameraAt(t, opts = {}) {
    const zAmp = opts.zoomAmp ?? zoomAmp;
    const sAmp = opts.shakeAmp ?? 1;
    const zBase = opts.zoomBase ?? zoomBase;
    return {
      zoom: zBase + zAmp * Math.sin(t * zoomW[0] + zoomPhase[0])
        + zAmp * 0.4 * Math.sin(t * zoomW[1] + zoomPhase[1]),
      shake: [
        sAmp * (shake[0][0] * Math.sin(t * shake[0][1] + shake[0][2])
          + shake[1][0] * Math.sin(t * shake[1][1] + shake[1][2])),
        sAmp * (shake[2][0] * Math.sin(t * shake[2][1] + shake[2][2])
          + shake[3][0] * Math.sin(t * shake[3][1] + shake[3][2])),
      ],
    };
  }

  /**
   * 摄影机当前的运动方向（单位向量，屏幕坐标系 y 向下）。
   * 用有限差分从 `cameraAt` 推出来 —— 转场拖尾与前景入场都沿它，动感才接得上。
   */
  function cameraDir(t, dt = 0.05, opts = {}) {
    const a = cameraAt(t - dt, opts), b = cameraAt(t + dt, opts);
    const dx = b.shake[0] - a.shake[0];
    const dy = b.shake[1] - a.shake[1];
    const n = Math.hypot(dx, dy) || 1;
    return [dx / n, dy / n];
  }

  /**
   * 段落收尾用的 post：摄影机 + 这一段的固定观感，合成一个对象直接 return。
   * @param {number} t 整片时间（`f.t`，不是 `f.lt`）
   * @param {Record<string, any>} [extra] 这一段自己的调色/泛光等
   */
  function cameraPost(t, extra = {}) {
    return { ...cameraAt(t), ...extra };
  }

  /**
   * 前景的入场位移：方向与摄影机**相反**（上一镜往这边被甩走，新内容就从反方向落位）。
   * 直接加在文字的 x/y 或矢量的坐标上即可。
   *
   * @param {number} t 整片时间
   * @param {number} k 入场进度（0 = 刚进来，1 = 站稳）
   * @param {number} [amount] 最大位移（逻辑像素）
   * @returns {[number, number]} `[dx, dy]`
   */
  function enterOffset(t, k, amount = enterAmount) {
    const d = cameraDir(t);
    const rem = (1 - sat(k)) ** 2;
    return [-d[0] * amount * rem, -d[1] * amount * enterY * rem];
  }

  return { cameraAt, cameraDir, cameraPost, enterOffset };
}

/** `trans.js` 这一套（老配方）的默认参数 —— 就是从前写死在这里的那组数。 */
const CAM = makeCameraProfile();

export const cameraAt = CAM.cameraAt;
export const cameraDir = CAM.cameraDir;
export const cameraPost = CAM.cameraPost;
export const enterOffset = CAM.enterOffset;

/**
 * 交叠期那一帧：先铺共享背景（如果要），再把上一段沿**这一套摄影机**的方向甩走。
 * `makeTransitionKit` 与 `kit/world.js` 的 `makeWorldKit` 共用这一份。
 *
 * @param {any} c SceneCtx
 * @param {{ pass: any, background?: any, opts?: any,
 *           dir: (t: number, dt?: number, opts?: any) => number[] }} o
 * @returns {number} 入场进度 k
 */
export function openTransitionFrame(c, o) {
  const { f, gl } = c;
  const { pass, background, dir } = o;
  if (background) background.render(gl, c.out, f.t, f.dt);
  // ctx.under 只有「自己声明了 handlesTransition 且真的在交叠」时才非空
  const k = c.under ? sat(f.tin) : 1;
  if (c.under && k < 1) {
    const u = pass.u;
    u.under.value = { tex: /** @type {any} */ (c.under).tex ?? c.under, __tex: true };
    u.k.value = k;
    u.dir.value = dir(f.t, 0.05, o.opts);
    pass.render(gl, c.out, f.t, f.dt);
  }
  return k;
}

/**
 * 场景侧的转场套件。一句 `this.tk = makeTransitionKit(ctx)` 装好，
 * 每帧第一句 `const k = this.tk.openFrame(ctx)` 就没别的事了。
 */
export function makeTransitionKit(ctx, opts = {}) {
  const pass = transitionPass(ctx.gl, opts);
  return {
    pass,
    /**
     * 每帧第一句：画全片唯一的背景（如果要），并在交叠期把上一段甩出去。
     * @param {import('./scene.js').SceneCtx} c
     * @param {{ render: (gl: any, target: any, t: number, dt: number) => any } | null} [background]
     *        全片共用的背景 Pass（**整片同一张**，参数只跟 `f.t` 走）
     * @returns {number} 入场进度 k（1 = 已经站稳，可以按平常那样画）
     */
    openFrame(c, background = null) {
      return openTransitionFrame(c, { pass, background, dir: cameraDir, opts });
    },
  };
}
