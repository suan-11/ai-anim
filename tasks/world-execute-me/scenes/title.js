// 一段最简单的场景：标题 + 逐字入场 + 生长的矢量线。
// 场景 = { id, setup(ctx), render(ctx) }，render 必须把整帧画进 ctx.out。
// 想要现成的整镜头（标题 / 图表 / 大字 / 甩镜 / 片尾 / 波形 / 网格）就先别写这些：
//   node scripts/anim.mjs shots            ← 列出模板与参数
//   import { shot } from '../../../src/shots/index.js';
//   export default shot('title', { title: '我的片子', sub: '副标题' });
// 下面这份手写场景留着当“从零写一个镜头”的样板，两者可以混在同一条时间线里。
import { css } from '../../../src/core/util.js';

export default {
  id: 'title',

  setup(ctx) {
    // 只调用一次：着色器、几何、预计算都放这里
  },

  render(ctx) {
    const { f, gl, P, text, type, comp, lines } = ctx;
    const { W, H } = gl;

    // 1) 背景：清一层底色（要更复杂的底就上 shader Pass，见 docs/COOKBOOK.md）
    gl.clear(ctx.out, [P.ink[0] * 0.6, P.ink[1] * 0.6, P.ink[2] * 0.6]);

    // 2) 一条从左到右生长的细线，带刻度
    lines.begin();
    const y = H * 0.58;
    const grow = Math.min(1, f.lt / 1.6);
    const x0 = W * 0.18, x1 = W * 0.82;
    lines.seg(x0, y, x0 + (x1 - x0) * grow, y, 3, P.signal);
    for (let i = 0; i < 16; i++) {
      const x = x0 + ((x1 - x0) * i) / 15;
      const on = i / 15 <= grow;
      lines.seg(x, y - (on ? 16 : 8), x, y + (on ? 16 : 8), on ? 2 : 1.2, on ? P.bone : P.graphite);
    }
    lines.flush(ctx.out);

    // 3) 文字：逐字入场
    text.clear();
    type.write('动画，是代码', W * 0.18, H * 0.42, {
      size: 132, weight: 800, family: 'sans', color: css(P.bone),
      stagger: 0.07, from: 'up', dist: 60, t: f.lt,
    });
    // 按锚点写整行：writeLine 会先量宽度再偏移（type.write 的 align 是逐字生效的，
    // 直接写 align:'center' 会让每个字各自居中，整行反而跑偏）
    type.writeLine('ANIMATION IS CODE', W * 0.82, H * 0.42 + 62, {
      anchor: 'right', size: 30, weight: 400, family: 'mono', tracking: 8,
      color: css(P.signal, 0.9), stagger: 0.02, t: f.lt,
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.3, grain: 0.03 };
  },
};
