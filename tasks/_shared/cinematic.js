// @ts-check
/** 电影运镜 + 节奏显著性塑形：按 f.rhythm 角色剧烈调制曝光/泛光/暗角/zoom，制造明显落差。
 * pressure 下蹲压暗收紧 / hold 期待微动 / release 爆发冲峰 / residue 回落缓降。
 */
import { makeCameraProfile } from '../../src/core/trans.js';
import { sat, smoothstep } from '../../src/core/util.js';

// 节奏角色 → 显著性目标（落差明显）
function rhythmShape(r) {
  if (!r) return { expo:1, bloom:0.12, vig:0.32, zoom:1, shake:1 };
  const u = r.progress ?? 0;
  switch (r.beat_role) {
    case 'pressure': // 主动下蹲：压暗+收紧+暗角加重（蓄力）
      return { expo: 0.78 - 0.18*u, bloom: 0.05, vig: 0.45 + 0.15*u, zoom: 0.96 - 0.04*u, shake: 0.5 };
    case 'hold': // 期待：中低位微起伏
      return { expo: 0.85 + 0.05*Math.sin(u*Math.PI), bloom: 0.08, vig: 0.42, zoom: 0.98, shake: 0.7 };
    case 'release': // 爆发：猛提亮+泛光炸+推近+震屏（冲峰）
      const burst = Math.min(1, u*1.6);
      return { expo: 1.0 + 0.45*burst, bloom: 0.15 + 0.55*burst, vig: 0.25 - 0.1*burst, zoom: 1.0 + 0.12*burst, shake: 1 + 2.5*burst };
    case 'residue': // 回落：回中位缓降
      return { expo: 1.1 - 0.25*u, bloom: 0.4 - 0.3*u, vig: 0.3 + 0.1*u, zoom: 1.05 - 0.07*u, shake: 1.2 - 0.6*u };
    default: return { expo:1, bloom:0.12, vig:0.32, zoom:1, shake:1 };
  }
}

export function makeCinematic(opts={}) {
  const profile = makeCameraProfile({
    zoomBase: opts.zoomBase ?? 1.0,
    zoomAmp: opts.zoomAmp ?? 0.03,
    shake: opts.shake ?? [[20,0.13,0],[9,0.31,0.7],[14,0.11,1.3],[8,0.27,2.1]],
    enterAmount: 120,
  });
  return {
    profile,
    xform(ctx, W, H, impact=0, tilt=0) {
      const t = ctx.f.t;
      const cam = profile.cameraAt(t);
      const rs = rhythmShape(ctx.f.rhythm);
      const sh = rs.shake * (1+impact*1.5);
      const sx = cam.shake[0]*sh, sy = cam.shake[1]*sh;
      const k = tilt * 0.00012 * (0.5+impact);
      // zoom = 呼吸 × 节奏缩放 × 冲击推近（落差明显）
      const scale = cam.zoom * rs.zoom * (1+impact*0.08);
      return { x: sx, y: sy, scale, rot: cam.rot??0, anchor:[W/2,H/2], p:k, q:k*0.6, edge:'clamp' };
    },
    post(ctx, { impact=0, bloomBase=0.12 }={}) {
      const a = ctx.f.a ?? {};
      const rs = rhythmShape(ctx.f.rhythm);
      // 节奏显著性塑形 + 冲击叠加（落差明显）
      const exposure = rs.expo + (a.rms??0)*0.06 + impact*0.2;
      const bloom = Math.max(rs.bloom, bloomBase) + impact*0.4;
      const vignette = rs.vig + impact*0.05;
      return { preset:'filmed', bloom, exposure, vignette, grain:0.018 };
    },
  };
}
