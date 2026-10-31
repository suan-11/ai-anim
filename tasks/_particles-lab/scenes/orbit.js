// orbit —— 双环轨道：粒子绕簇心公转，内外环速度不同。
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { makeParticles } from '../../../src/kit/index.js';
import { css } from '../../../src/core/util.js';

export default makeShot('orbit', {
  setup(ctx) {
    this.ps = makeParticles(ctx, { count: 1200, preset: 'orbit' });
  },
  draw(ctx, { enter }) {
    const { f, lines, text, type, P, comp, gl } = ctx;
    lines.begin();
    lines.fillRect(0, 0, 1920, 1080, [0.015, 0.018, 0.03, 1]);
    // 簇心参考环
    lines.circle(960, 540, 240, 1.2, withAlpha(P.ash, 0.25));
    lines.circle(960, 540, 380, 1.2, withAlpha(P.ash, 0.2));
    lines.flush(ctx.out);

    this.ps.render(ctx.out, f.t);

    text.clear();
    type.writeLine('orbit · 1200', 96, 120, { anchor: 'left', size: 30, family: 'mono', color: css(P.ash), ...enter(0) });
    type.writeLine('半径/分层来自 hash · 角速度 0.5 / 0.85 rad/s', 96, 156, { anchor: 'left', size: 20, family: 'mono', color: css(P.ash), ...enter(0.1) });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    return { bloom: 0.3, grain: 0.02 };
  },
});
