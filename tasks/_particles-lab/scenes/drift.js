// drift —— 利萨如漂移场：无整体流向的慢速漂移（背景母题用）。
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { makeParticles } from '../../../src/kit/index.js';
import { css } from '../../../src/core/util.js';

export default makeShot('drift', {
  setup(ctx) {
    this.ps = makeParticles(ctx, { count: 420, preset: 'drift', size: 7 });
  },
  draw(ctx, { enter }) {
    const { f, lines, text, type, P, comp, gl } = ctx;
    lines.begin();
    lines.fillRect(0, 0, 1920, 1080, [0.05, 0.05, 0.055, 1]);
    lines.flush(ctx.out);

    this.ps.render(ctx.out, f.t);

    text.clear();
    type.writeLine('drift · 420', 96, 120, { anchor: 'left', size: 30, family: 'mono', color: css(P.ash), ...enter(0) });
    type.writeLine('锚点 + 利萨如 · 骨白（不进 bloom）', 96, 156, { anchor: 'left', size: 20, family: 'mono', color: css(P.ash), ...enter(0.1) });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    return { bloom: 0.12, grain: 0.02 };
  },
});
