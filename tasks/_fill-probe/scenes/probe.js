import { css } from '../../../src/core/util.js';

/**
 * 填充面的 **alpha 账**夹具（BACKLOG 1-70 的后续，2026-10-31）。
 *
 * 一屏四块 alpha = 0.5 的白圆，扫描行距分别是 2 / 1 / 0.5 / 0.25。
 *
 * **看什么**：四块必须**一样亮**。正确的 alpha 0.5 白叠在黑底上 = 线性 0.5
 * ⇒ sRGB 188。历史读数（胶囊拼法）：194 / 200 / 222 / 236 —— 行距越细越浓，
 * 因为相邻两行的抗锯齿边互相叠加（SPAN_OVERLAP 那 0.5px 补缝余量）。
 *
 * 现在填充走**硬边带**图元，四档都是 188。这条读数是「把行距调小换平滑」能不能成立的
 * 前置条件，所以留成夹具而不是一次性脚本。
 *
 *   node scripts/anim.mjs still _fill-probe -t 1 --samples 1
 */
export default {
  id: 'fill-probe',
  render(ctx) {
    const { gl, lines, text, type, P, comp } = ctx;
    gl.clear(ctx.out, [0, 0, 0]);
    lines.begin();
    const steps = [2, 1, 0.5, 0.25];
    steps.forEach((s, i) => {
      lines.fillCircle(280 + i * 460, 470, 170, [1, 1, 1, 0.5], s);
    });
    lines.flush(ctx.out);
    text.clear();
    steps.forEach((s, i) => {
      type.writeLine('step ' + s, 280 + i * 460, 740, {
        anchor: 'center', size: 40, family: 'mono', color: css(P.ash),
      });
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    // 关掉一切会污染读数的后处理：颗粒 / 抖动 / 暗角 / 泛光都会改变像素值
    return { grain: 0, dither: 'off', bloom: 0, vignette: 0, halation: 0, tonemap: 'off' };
  },
};