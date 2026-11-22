// @ts-check
// collapse —— 占位（待手写真实场景，见 SCENE-BRIEF.md）
import { makeShot } from '../../../src/kit/index.js';
import { css } from '../../../src/core/util.js';
export default makeShot('collapse', {
  draw(ctx, { enter }) {
    const { f, text, type, P, comp, gl, W, H } = ctx;
    text.clear();
    type.writeLine('collapse', W * 0.5, H * 0.5, { anchor: 'center', size: 72, color: css(P.bone), ...enter(0.2) });
    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    return { grain: 0.012 };
  },
});
