// sparks —— 下落火花：从顶部落到底部回绕，加法混合让它真的"发光"。
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { makeParticles } from '../../../src/kit/index.js';
import { css } from '../../../src/core/util.js';

export default makeShot('sparks', {
  setup(ctx) {
    this.ps = makeParticles(ctx, { count: 900, preset: 'sparks' });
  },
  draw(ctx, { enter }) {
    const { f, lines, text, type, P, comp, gl } = ctx;
    // 背景（makeShot 不铺，夹具自铺）：深底 + 一条地平线
    lines.begin();
    lines.fillRect(0, 0, 1920, 1080, [0.02, 0.02, 0.025, 1]);
    lines.seg(0, 940, 1920, 940, 2, withAlpha(P.ash, 0.35));
    lines.flush(ctx.out);

    // 粒子（t 的纯函数；子帧平均 = 运动模糊）
    this.ps.render(ctx.out, f.t);

    text.clear();
    type.writeLine('sparks · 900', 96, 120, { anchor: 'left', size: 30, family: 'mono', color: css(P.ash), ...enter(0) });
    type.writeLine('mod 回绕 · 速度与横向位置来自 index hash', 96, 156, { anchor: 'left', size: 20, family: 'mono', color: css(P.ash), ...enter(0.1) });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    return { bloom: 0.35, grain: 0.02 };
  },
});
