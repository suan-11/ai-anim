// @ts-check
/**
 * push2d（A 侧，**对照组**）：与 relay2d 完全相同的两台机位与同一个世界，
 * 但时间线上**不写 transition** —— 引擎默认 push 甩镜。
 * 出图对比"接力 vs 甩镜"：接力是相机飞过去、内容换手；对照组是旧帧被甩走。
 *
 * 这一对刻意不声明 relayPose（对照组不参与接力；万一时间线误写了 relay，
 * 引擎会点名回落 push 并警告 —— 那本身也是个可验的回路）。
 */
import { camera3 } from '../../../src/core/cam.js';
import { relayPose3 } from '../../../src/kit/index.js';
import { css } from '../../../src/core/util.js';
import { makeWorldKit } from '../../../src/kit/world.js';
import { fade } from '../../../src/kit/layout.js';
import { HOME_A_SRC, driftPose, TOWER_A } from './_homes.js';
import { drawTowerField, markerPoint } from './_towerfield.js';

export default {
  id: 'push2d',
  handlesTransition: true,
  focus: 'center',

  setup(ctx) {
    this.wk = makeWorldKit(ctx);
  },

  render(ctx) {
    const { f, lines, text, type, comp, gl, P, W, H } = ctx;
    // 对照组：交叠期 ctx.under 非空 ⇒ openFrame 照常把上一帧甩走（引擎默认 push）。
    // 背景照铺（不传 bg = 用 ctx.world）—— 甩的是"上一段的帧"，本段自己的底还是要的。
    const k = this.wk.openFrame(ctx);
    void k;

    const cam = camera3({ ...relayPose3(ctx, driftPose(HOME_A_SRC, f.t)), H });

    lines.begin();
    drawTowerField(lines, cam, P, f.t, W, H, { focus: 'A' });
    const mk = markerPoint(cam, W, H, TOWER_A, f.t);
    if (mk.visible) {
      lines.seg(mk.x + 16, mk.y - 14, mk.x + 96, mk.y - 44, 1.4, ctx.P.signal);
      lines.circle(mk.x + 96, mk.y - 44, 3, 2, ctx.P.signal);
    }
    lines.flush(ctx.out);

    text.clear();
    const a = fade(f.lt, 0.3, 1, 0.6);
    type.writeLine('push2d · 对照组', 96, 118, {
      anchor: 'left', size: 52, weight: 800, family: 'sans', color: css(P.bone), ...a,
    });
    type.writeLine('同样的两台机位 — 不写 transition，默认 push 甩镜', 96, 166, {
      anchor: 'left', size: 24, family: 'mono', color: css(P.ash), ...fade(f.lt, 0.55, 1, 0.6),
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.22, grain: 0.02 };
  },
};
