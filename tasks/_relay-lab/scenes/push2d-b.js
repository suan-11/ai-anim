// @ts-check
/**
 * push2d-b（B 侧，对照组）：高机位远景看塔 B —— 与 relay2d-b 同机位，
 * 但时间线上不写 transition（默认 push 甩镜）。
 */
import { camera3 } from '../../../src/core/cam.js';
import { relayPose3 } from '../../../src/kit/index.js';
import { css } from '../../../src/core/util.js';
import { makeWorldKit } from '../../../src/kit/world.js';
import { fade } from '../../../src/kit/layout.js';
import { HOME_B_SRC, driftPose, TOWER_B } from './_homes.js';
import { drawTowerField, markerPoint } from './_towerfield.js';

export default {
  id: 'push2d-b',
  handlesTransition: true,
  focus: 'center',

  setup(ctx) {
    this.wk = makeWorldKit(ctx);
  },

  render(ctx) {
    const { f, lines, text, type, comp, gl, P, W, H } = ctx;
    const k = this.wk.openFrame(ctx);   // 不传 bg = 用 ctx.world 自己铺 —— 引擎 world:'auto' 的铺底在记账之前，守门看不见；场景自己铺的这笔才可测
    void k;

    const cam = camera3({ ...relayPose3(ctx, driftPose(HOME_B_SRC, f.t)), H });

    lines.begin();
    drawTowerField(lines, cam, P, f.t, W, H, { focus: 'B' });
    const mk = markerPoint(cam, W, H, TOWER_B, f.t);
    if (mk.visible) {
      lines.seg(mk.x + 16, mk.y - 14, mk.x + 96, mk.y - 44, 1.4, ctx.P.signal);
      lines.circle(mk.x + 96, mk.y - 44, 3, 2, ctx.P.signal);
    }
    lines.flush(ctx.out);

    text.clear();
    const a = fade(f.lt, 0.3, 1, 0.6);
    type.writeLine('push2d-b · 对照组 B 侧', 96, 118, {
      anchor: 'left', size: 52, weight: 800, family: 'sans', color: css(P.bone), ...a,
    });
    type.writeLine('同样的机位，默认 push — 对比上方的接力缝', 96, 166, {
      anchor: 'left', size: 24, family: 'mono', color: css(P.ash), ...fade(f.lt, 0.55, 1, 0.6),
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.22, grain: 0.02 };
  },
};
