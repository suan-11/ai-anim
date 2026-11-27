// 第二段：网格 + 粒子，演示「一切位置都是时间的函数」的写法。
import { css, rng } from '../../../src/core/util.js';

export default {
  id: 'shapes',

  setup(ctx) {
    // 预计算：确定性随机（永远不要用 Math.random）
    const r = rng(7);
    this.dots = Array.from({ length: 260 }, () => ({ x: r(), y: r(), s: 0.3 + r() * 1.4, ph: r() }));
  },

  render(ctx) {
    const { f, gl, P, text, type, comp, lines, params } = ctx;
    const { W, H } = gl;
    const local = f.lt;

    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);

    lines.begin();
    // 网格：每格一条线，按到中心的距离依次点亮
    const cols = 24, rows = 14;
    const cw = W / cols, ch = H / rows;
    for (let i = 0; i <= cols; i++) {
      const k = i / cols;
      const d = Math.abs(k - 0.5) * 2;
      const lit = Math.max(0, 1 - Math.abs(local * 1.4 - d * 2.2));
      lines.seg(i * cw, 0, i * cw, H, 1, [P.graphite[0] * (0.25 + lit), P.graphite[1] * (0.25 + lit), P.graphite[2] * (0.25 + lit)]);
    }
    for (let j = 0; j <= rows; j++) lines.seg(0, j * ch, W, j * ch, 1, P.graphite.map((c) => c * 0.25));

    // 粒子：每个点有自己的相位，位置是时间的纯函数（可以随便 seek / 多子帧采样）
    for (const d of this.dots) {
      const px = d.x * W + Math.sin(local * (0.6 + d.s) + d.ph * 6.28) * 40;
      const py = d.y * H + Math.cos(local * (0.4 + d.s * 0.7) + d.ph * 6.28) * 30;
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(local * 1.2 + d.ph * 9));
      lines.seg(px, py, px + 0.01, py, 2 + d.s * 3, [P.signal[0] * tw, P.signal[1] * tw, P.signal[2] * tw]);
    }
    lines.flush(ctx.out);

    text.clear();
    type.write(String(params.variant ?? '').toUpperCase(), 60, 90, {
      size: 34, family: 'mono', color: css(P.ash), tracking: 6,
    });
    // 整行淡入：写了 alpha 就会随 t 动画（不需要再塞个极小的 stagger 去骗引擎）
    type.writeLine('每一帧都是 t 的函数', W / 2, H - 110, {
      anchor: 'center', size: 54, weight: 600, family: 'sans', color: css(P.bone),
      alpha: [0, 1], t: local - 0.4, staggerDur: 0.6,
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.4, ca: Math.abs(Math.sin(local)) * 0.3, grain: 0.04 };
  },
};
