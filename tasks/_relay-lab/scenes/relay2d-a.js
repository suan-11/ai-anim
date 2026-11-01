// @ts-check
/**
 * relay2d（A 侧）：**手写 camera3 场景**，低机位近景看塔 A。
 *
 * 这一段验三件事：
 *   ① camera3 场景的 relay 接入是一行 —— camera3({ ...relayPose3(ctx, home), H })；
 *   ② relayPose(ctx) 是 t 的纯函数（fov / dist 随 t 微动，探针读到的是动态位姿）；
 *   ③ 段内就是普通 camera3 + lines 绘制 —— relay 不改变段内的画法。
 *
 * relayPose 的契约：只许读 f.t 与 params，返回 camera3 形状 {pos,target,fov,roll}
 * （字段名与 Pose 同形不同义，引擎用 poseFromCamera3 换算 —— ENGINE §3.7.7）。
 */
import { camera3 } from '../../../src/core/cam.js';
import { relayPose3 } from '../../../src/kit/index.js';
import { css } from '../../../src/core/util.js';
import { makeWorldKit } from '../../../src/kit/world.js';
import { fade } from '../../../src/kit/layout.js';
import { HOME_A_SRC, driftPose, TOWER_A } from './_homes.js';
import { drawTowerField, markerPoint } from './_towerfield.js';

export default {
  id: 'relay2d',
  handlesTransition: true,      // 交叠期"接力"由引擎的 relay 分支接管；缺位姿时回落 push 由 openFrame 甩
  focus: 'center',

  setup(ctx) {
    this.wk = makeWorldKit(ctx);
  },

  /**
   * 相机探针（relay 只认这个名字）。f.t = 整片时间 —— 位姿随 t 漂移，
   * 引擎每子帧现探现算；这里绝不读 ctx 里其它的东西。
   */
  relayPose(ctx) {
    return poseNow(ctx.f.t);
  },

  render(ctx) {
    const { f, lines, text, type, comp, gl, P, W, H } = ctx;
    // ① 背景（makeWorldKit：交叠期 ctx.under 为空 ⇒ 只铺背景、不甩 —— relay 分支管换手）
    const k = this.wk.openFrame(ctx);   // 不传 bg = 用 ctx.world 自己铺 —— 引擎 world:'auto' 的铺底在记账之前，守门看不见；场景自己铺的这笔才可测
    void k;

    // ② 相机：一行 relay 接入。非交叠期 = home（带微动），交叠期 = 引擎给的混合位姿
    const cam = camera3({ ...relayPose3(ctx, poseNow(f.t)), H });

    // ③ 段内就是普通绘制：塔阵 + 贴 3D 点的标注
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
    type.writeLine('relay2d · A 侧机位', 96, 118, {
      anchor: 'left', size: 52, weight: 800, family: 'sans', color: css(P.bone), ...a,
    });
    type.writeLine('低机位近景看塔 A — camera3 + relayPose3(ctx, home) 一行接入', 96, 166, {
      anchor: 'left', size: 24, family: 'mono', color: css(P.ash), ...fade(f.lt, 0.55, 1, 0.6),
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.22, grain: 0.02 };
  },
};

/** 本段此刻的 home 位姿（t 的纯函数；_homes.js 的 driftPose 做微动）。 */
function poseNow(t) {
  return driftPose(HOME_A_SRC, t);
}
