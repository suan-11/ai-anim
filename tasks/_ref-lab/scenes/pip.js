// pip —— 画中画：整帧自己的内容 + 左下角贴 refa 段在 (t-2s) 的画面。
// 成本注记：renderShot 每次调用 = 一次完整的单段渲染（1 子帧）；
// 本场景每个渲染子帧各调一次 —— 平均后就是正确的"引用画面运动模糊"。
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { css } from '../../../src/core/util.js';

export default makeShot('pip', {
  draw(ctx, { enter }) {
    const { f, lines, text, type, P, comp, gl } = ctx;
    lines.begin();
    lines.fillRect(0, 0, 1920, 1080, [0.03, 0.03, 0.04, 1]);
    // 主体：一个随 t 转动的方块阵列（自己的内容）
    for (let i = 0; i < 5; i++) {
      const a = f.t * 0.6 + i * 0.4;
      const x = 960 + Math.cos(a) * (240 + i * 60);
      const y = 470 + Math.sin(a) * 160;
      lines.rect(x - 40, y - 40, 80, 80, 2.5, withAlpha(i === 2 ? P.signal : P.bone, 0.9));
    }
    lines.flush(ctx.out);

    // 画中画：refa 段在 2 秒前的画面，贴左下角 480×270
    ctx.renderShot('refa', f.t - 2, { x: 80, y: 700, w: 480, h: 270 });
    // 描个边让人知道这是一块"引用"
    lines.begin();
    lines.rect(80, 700, 480, 270, 2, withAlpha(P.signal, 0.8));
    lines.flush(ctx.out);

    text.clear();
    type.writeLine('renderShot(refa, t-2)', 96, 120, { anchor: 'left', size: 30, family: 'mono', color: css(P.ash), ...enter(0) });
    type.writeLine('左下角是 refa 段 2 秒前的画面（画中画）', 96, 156, { anchor: 'left', size: 20, family: 'mono', color: css(P.ash), ...enter(0.1) });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    return { bloom: 0.15, grain: 0.02 };
  },
});
