// @ts-check
/** 电影运镜特效层：全片一台摄影机呼吸推拉 + filmed质感 + 峰值冲击震屏 + 透视微倾。
 * setup: this.cam = makeCinematic(); 
 * render: const post = this.cam.post(ctx, { impact: zt }); ctx.setXform(this.cam.xform(ctx,W,H));
 */
import { makeCameraProfile } from '../../src/core/trans.js';
import { shakeSmooth } from '../../src/core/cam.js';
import { sat, smoothstep } from '../../src/core/util.js';

export function makeCinematic(opts={}) {
  const profile = makeCameraProfile({
    zoomBase: opts.zoomBase ?? 1.0,
    zoomAmp: opts.zoomAmp ?? 0.035,      // 缓慢呼吸推拉 ±3.5%
    shake: opts.shake ?? [[20,0.13,0],[9,0.31,0.7],[14,0.11,1.3],[8,0.27,2.1]], // 轻微手持(4组)
    enterAmount: 120,
  });
  return {
    profile,
    // 运镜 xform：呼吸 zoom + 手持 shake + 可选透视微倾(k)
    xform(ctx, W, H, impact=0, tilt=0) {
      const t = ctx.f.t;
      const cam = profile.cameraAt(t);
      const sx = cam.shake[0]*(1+impact*2.5), sy = cam.shake[1]*(1+impact*2.5); // 冲击时震屏加强
      // 透视微倾：impact 时轻微 k（画面 3D 倾斜感）
      const k = tilt * 0.00012 * (0.5+impact);
      return { x: sx, y: sy, scale: cam.zoom*(1+impact*0.06), rot: cam.rot??0, anchor:[W/2,H/2], p:k, q:k*0.6, edge:'clamp' };
    },
    // post：filmed 质感 + 呼吸曝光 + 峰值泛光
    post(ctx, { impact=0, bloomBase=0.12 }={}) {
      const t = ctx.f.t;
      const a = ctx.f.a ?? {};
      const exposure = 1 + (a.rms??0)*0.08 + impact*0.1; // 跟音频呼吸+冲击提亮
      return {
        preset: 'filmed',           // 电影颗粒+光晕+暗角+色散
        bloom: bloomBase + impact*0.35, // 峰值泛光爆发
        exposure,
        vignette: 0.32 + impact*0.1,
        grain: 0.018,
      };
    },
  };
}
