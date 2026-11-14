import { css } from '../../../src/core/util.js';
import { shatterIn } from '../../../src/kit/shatter.js';

export default {
  id: 'shatter',
  render(ctx) {
    const { f, gl, P, lines, text, type, comp } = ctx;
    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);
    lines.begin();
    for (let i = 0; i < 24; i++) {
      const y = 90 + i * 38;
      lines.seg(120, y, 1800, y, 1.5, [P.bone[0] * 0.5, P.bone[1] * 0.5, P.bone[2] * 0.5]);
    }
    lines.seg(120, 540, 1800, 540, 4, P.signal);
    lines.flush(ctx.out);
    text.clear();
    type.write('SHATTER', 160, 340, { size: 190, weight: 900, family: 'sans', color: css(P.bone) });
    type.write('镜头级镜碎：碎着出现，逐片吸合', 160, 470, { size: 46, color: css(P.ash) });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    // 画面画完之后再碎 —— 这就是「镜头级」与「转场级」的区别
    shatterIn(ctx, { t: f.lt, dur: 1.2, seed: 7, shards: 7, power: 0.8 });
    return { grain: 0.02 };
  },
};
