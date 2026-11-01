// @ts-check
/**
 * relay2d-b（B 侧）：**手写 camera3 场景**，高机位远景看塔 B。
 *
 * 与 relay2d-a 是同一个世界的另一台机位；时间线上与上段 overlap 1.2 +
 * transition: 'relay' + transitionOpts: { move: 'glide' } ——
 * 验"接力飞过去、内容换手"（换手窗 HANDOVER_GLIDE = [.35, .65]）。
 *
 * B 侧同样声明 relayPose（t 的纯函数）—— relay 的前提是**两侧**都能被探。
 */
import { camera3 } from '../../../src/core/cam.js';
import { relayPose3 } from '../../../src/kit/index.js';
import { css } from '../../../src/core/util.js';
import { makeWorldKit } from '../../../src/kit/world.js';
import { fade } from '../../../src/kit/layout.js';
import { HOME_B_SRC, driftPose, TOWER_B } from './_homes.js';
import { drawTowerField, markerPoint } from './_towerfield.js';

export default {
  id: 'relay2d-b',
  handlesTransition: true,
  focus: 'center',

  setup(ctx) {
    this.wk = makeWorldKit(ctx);
  },

  relayPose(ctx) {
    return poseNow(ctx.f.t);
  },

  render(ctx) {
    const { f, lines, text, type, comp, gl, P, W, H } = ctx;
    const k = this.wk.openFrame(ctx);   // 不传 bg = 用 ctx.world 自己铺 —— 引擎 world:'auto' 的铺底在记账之前，守门看不见；场景自己铺的这笔才可测
    void k;

    const cam = camera3({ ...relayPose3(ctx, poseNow(f.t)), H });

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
    type.writeLine('relay2d-b · B 侧机位', 96, 118, {
      anchor: 'left', size: 52, weight: 800, family: 'sans', color: css(P.bone), ...a,
    });
    type.writeLine('高机位远景看塔 B — 与上段 overlap 1.2 + transition: relay + move: glide', 96, 166, {
      anchor: 'left', size: 24, family: 'mono', color: css(P.ash), ...fade(f.lt, 0.55, 1, 0.6),
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.22, grain: 0.02 };
  },
};

function poseNow(t) {
  return driftPose(HOME_B_SRC, t);
}
