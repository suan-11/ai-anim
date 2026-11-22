// @ts-check
/**
 * 引擎级**字幕层**（`task.captions` 打开后，引擎每帧自动画当前那句旁白）。
 *
 * ## 为什么这一层必须进引擎
 *
 * 在这之前，"语音字幕"根本不在引擎里 —— 它是**出锅之后**用
 * `ffmpeg -vf ass=…` 烧上去的（生成脚本还躺在 `out/_staging/make-srt.mjs`，
 * 而 `out/` 会被 `anim clean` 清掉）。于是：
 *
 *   · 换一支片子就要再抄一份生成脚本；
 *   · 位置靠人工判断（两支交付片都选了"顶部居中"，理由写在脚本注释里：
 *     "底部已经有说明条+出处行"）；
 *   · 画面代码**不知道字幕在哪**，也就无从避让 —— 结果观众看到的是
 *     **同一句话在顶部字幕和底部说明条上各出现一遍**（sodium 43 句里 12 句如此）。
 *
 * 现在字幕是引擎的一等公民：位置来自风格包的**字幕保留带**（`style.grid.captionBand`），
 * 场景一行都不用写，而且 `ctx.captions.band` 让场景能主动避让。
 *
 * ## 与画面文字的分工（`docs/CAPTIONS.md`）
 *
 * **旁白负责"说句子"，字幕负责"显示这句话"，画面只负责"标注"**。
 * 画面文字不许复述旁白 —— 这不是审美问题：Netflix 的 timed-text 规范把
 * "与画面文字相同、或已被对白覆盖的 forced narrative"列为**必须删除**
 * （`Chinese (Simplified) Timed Text Style Guide` §7，我们核过原文）；
 * 而字幕**本身**并没有被证明有害 —— 有一项对照实验研究的是"**偶尔出现的关键词**"这种增强，
 * 方向是关键词突显对学习不利（Cojean & Martin 2021，*L'Année psychologique* 121(4):417-442，
 * DOI 10.3917/anpsy1.214.0417），所以本层默认 **不做** 逐词高亮。
 *
 * ## 几个刻意的取舍
 *
 * | 取舍 | 为什么 |
 * |---|---|
 * | 画在**后处理之后** | 字幕是信息层。让它吃泛光/颗粒会把字糊掉（"骨白正文永远不要 bloom"），而字幕的可读性优先于质感统一 |
 * | 折行按**每行 16 个中文字**（Netflix 简体中文规范） | 宽度换算成像素就是 `16 × size`，一行太长会让观众来回扫 |
 * | 底边对齐（不是顶边） | 两句变一句时字幕不会"上下跳"（规范要求连续多条字幕位置稳定） |
 * | 说完之后再留 `hold` 秒 | 话音落下就消失的话观众读不完（`narration.recent` 的窗口就是这个语义） |
 */

import { css } from './util.js';
import { breakCaption } from './cjk.js';

/** 超长句的提醒只报一次（按句子文本去重） */
const warnedOverflow = new Set();

/** 字幕默认样式（风格包的 `captions` 字段覆盖它）。 */
export const DEFAULT_CAPTION_STYLE = {
  /**
   * `'top'` | `'bottom'`：贴着**字幕保留带**的哪一边排。
   *
   * 默认 `'top'` 是被引擎现状逼出来的选择：镜头模板的 readout/签名/footer 都在 y≈990、
   * kit 的页脚在 H-62、说明条在 964 —— 底部没有空位了。字幕带本身由风格包给
   * （`style.grid.captionBand`，默认 `[40, 104]`，见 `src/style/index.js` 的注释）。
   */
  position: 'top',
  size: 44,
  weight: 600,
  /** 每行最多几个**中文字**（Netflix 简体中文规范：16 字/行、最多 2 行） */
  maxCharsPerLine: 16,
  maxLines: 2,
  /** 底衬不透明度（0 = 不铺底衬） */
  bg: 0.5,
  padX: 26,
  padY: 14,
  lineHeight: 1.3,
  /** 说完之后字幕再停留多久（秒）—— 观众还在读 */
  hold: 1.06,
  /** 入场/出场的淡变时长（秒） */
  fade: 0.16,
  /**
   * 词级时间戳可用时是否做"唱到哪亮哪"。
   *
   * ⚠ **默认关**：有一项对照实验研究的正是"偶尔出现的关键词"这类字幕增强，
   * 方向是**关键词突显对学习不利**（Cojean & Martin 2021，
   * *L'Année psychologique* 121(4):417-442，DOI 10.3917/anpsy1.214.0417；
   * 我们只核到书目信息与标题，**样本量与效应量没有逐条核对** —— 引用请以原文为准）。
   * 想要就显式打开，并知道它可能分心（`docs/CAPTIONS.md` 有出处与证据强度）。
   */
  karaoke: false,
  /** 未唱到部分的压暗程度（`karaoke: true` 时才有意义） */
  dim: 0.42,
  /** 字幕颜色的调色板键（`bone` = 正文色） */
  color: 'bone',
  /** 卡拉OK已唱部分的颜色键 */
  sungColor: 'signal',
};

/**
 * 归一字幕样式：风格包的 `captions` + 任务里的 `captions: {…}`。
 * @param {any} style resolveStyle() 的结果（可能为 null）
 * @param {any} taskCaptions `task.captions`（`true` / 对象 / 假值）
 * @returns {any|false} 完整样式；`false` = 不画字幕
 */
export function resolveCaptionStyle(style, taskCaptions) {
  // 任务显式关 → 关（哪怕风格包默认开）
  if (taskCaptions === false) return false;
  const base = { ...DEFAULT_CAPTION_STYLE, ...((style && style.captions) || {}) };
  if (taskCaptions === true) return base;
  if (taskCaptions && typeof taskCaptions === 'object') return { ...base, ...taskCaptions };
  // 任务一个字都没写：**风格包写了 captions（对象）= 这套风格默认开字幕**；
  // 默认风格 `print` 的 captions 是 `false`，所以老任务不会凭空多出字幕。
  return (style && style.captions) ? base : false;
}

/** 按"每行 N 个中文字"换算折行宽度（拉丁字符按 0.55 个中文字宽算）。 */
function widthFor(text, size, maxChars) {
  let units = 0;
  for (const ch of String(text)) units += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55;
  return Math.min(size * maxChars, Math.max(size * 4, units * size));
}

/**
 * 建一个字幕层（引擎在 `load()` 里建一次，每帧 `draw()`）。
 *
 * @param {{
 *   narration: any,          // makeNarrationReader 的结果（没配旁白时是个空实现）
 *   style: any,              // 上面归一出来的字幕样式（非 false）
 *   P: any,                  // 调色板（取颜色）
 *   W: number, H: number,    // 逻辑分辨率
 *   grid: any,               // 风格包的栅格（用 `captionBand`）
 * }} o
 */
export function makeCaptionLayer({ narration, style, P, W, H, grid }) {
  const band = (() => {
    // 默认 [40, 104]：顶部居中那一带（见 src/style/index.js 的 GRID_BASE.captionBand）
    const cb = grid?.captionBand ?? [40, 104];
    // x 范围取"字幕实际会占的那一块"（每行最多 16 字、居中）—— 与 kit/bands.js 的 sub 带同口径
    const halfW = Math.round(W * 0.19);
    return { x0: Math.round(W / 2 - halfW), x1: Math.round(W / 2 + halfW), y0: cb[0], y1: cb[1] };
  })();

  /** 此刻该显示的句子 + 它的不透明度（含入场淡入 / 说完之后的停留与淡出）。 */
  function active(t) {
    if (!narration || !narration.at) return null;
    const l = narration.at(t) ?? narration.recent(t, style.hold);
    if (!l) return null;
    const inK = sat01((t - l.start) / Math.max(1e-3, style.fade));
    // 出场的淡出只发生在"停留窗口的最后一小段"里 —— 话音刚落下时字幕必须还亮着
    const outStart = l.end + style.hold - style.fade;
    const outK = t > outStart ? 1 - sat01((t - outStart) / Math.max(1e-3, style.fade)) : 1;
    return { line: l, alpha: Math.min(inK, outK) };
  }

  /**
   * 把当前这句画进 Canvas2D 图层。
   * @param {any} layer Layer2D（有 `.ctx`）
   * @param {number} t 整片时间
   */
  function draw(layer, t) {
    const cur = active(t);
    if (!cur || cur.alpha <= 0.01) return null;
    const c = layer.ctx;
    const { line, alpha } = cur;
    const st = { size: style.size, weight: style.weight, family: style.family ?? 'sans' };
    /**
     * 断行交给 `src/core/cjk.js`（2026-10-26）：
     *   · **禁则**：`，。」` 不许在行首（挂到上一行末尾）、`「（` 不许在行尾；
     *   · **不拆词**：`24fps` / `v0.9.0` 这类拉丁数字串算一个整体；
     *   · **两行平衡**：不再出现 15 + 1 的孤儿行；
     *   · **绝不截断**：放不下就多给行（`overflow`），由这里决定"缩字号"还是"接受多一行"。
     *     旧实现在这里 `rows.slice(0, maxLines)` —— 长句的后半句会被**吃掉**，字幕少半句话。
     */
    let brk = breakCaption(line.text, { maxChars: style.maxCharsPerLine, maxLines: style.maxLines });
    // 太长就整体缩一号重排（字幕不省略号 —— 省略等于丢信息）；缩字号后每行能多放约 16% 的字
    if (brk.overflow) {
      const smaller = { ...st, size: Math.round(style.size * 0.86) };
      const b2 = breakCaption(line.text, {
        maxChars: Math.round(style.maxCharsPerLine * 1.16),
        maxLines: style.maxLines,
      });
      if (!b2.overflow) { brk = b2; st.size = smaller.size; }
    }
    const rows = brk.rows.length ? brk.rows : [String(line.text ?? '')];
    if (brk.overflow && !warnedOverflow.has(line.text)) {
      warnedOverflow.add(line.text);
      // 每句只提醒一次（与 util.js 的 `prog()` 警告同一个套路：这里没有 ctx.warnings）
      console.warn(`[字幕] 这句太长，${rows.length} 行（maxLines=${style.maxLines}）：${line.text}`);
    }
    const lh = st.size * style.lineHeight;
    const widest = Math.max(...rows.map((r) => layer.type.measure(r, st)), 1);
    const boxW = widest + style.padX * 2;
    const boxH = rows.length * lh + style.padY * 2;
    const cx = (band.x0 + band.x1) / 2;
    // 底边对齐：字幕条数变化时整块往上长，底边不动（规范：连续多条不得上下跳）
    const bottom = style.position === 'top' ? band.y0 + boxH : band.y1;
    const bx = cx - boxW / 2;
    const by = bottom - boxH;

    c.save();
    c.globalAlpha = alpha;
    if (style.bg > 0) {
      const inkL = 0.2126 * P.ink[0] + 0.7152 * P.ink[1] + 0.0722 * P.ink[2];
      c.fillStyle = inkL > 0.25 ? css(P.ink, Math.min(0.88, style.bg)) : `rgba(6,7,9,${style.bg})`;
      if (c.roundRect) {
        c.beginPath();
        c.roundRect(bx, by, boxW, boxH, 10);
        c.fill();
      } else {
        c.fillRect(bx, by, boxW, boxH);
      }
    }
    const baseCol = css(P[style.color] ?? P.bone);
    const sungCol = css(P[style.sungColor] ?? P.signal);
    rows.forEach((r, i) => {
      // 基线落在每一行盒子的中下部
      const y = by + style.padY + i * lh + st.size * 0.86;
      if (style.karaoke && line.words && rows.length === 1) {
        layer.type.karaoke(line.text, line.words, cx - widest / 2, y, t, {
          ...st, base: baseCol, sung: sungCol, dim: style.dim, anchor: undefined,
        });
      } else {
        layer.type.writeLine(r, cx, y, { ...st, anchor: 'center', color: baseCol });
      }
    });
    c.restore();
    return cur.line;
  }

  return { style, band, active, draw, lines: narration?.lines ?? [] };
}

function sat01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
