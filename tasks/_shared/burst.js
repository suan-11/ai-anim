// @ts-check
/** 节奏爆发特效：release 光扫+冲击环+闪光炸开（高显著性），pressure 暗场收束（低显著性）。
 * 在场景 lines.flush 前调用 drawBurst(ctx, intensity)，intensity 由节奏 role 驱动。 */
import { withAlpha } from '../../src/kit/index.js';
import { sat, smoothstep } from '../../src/core/util.js';

// 由 f.rhythm 算爆发强度：release 冲峰，pressure 负（收束），其余 0
export function burstIntensity(f) {
  const r = f.rhythm; if (!r) return 0;
  const u = r.progress ?? 0;
  if (r.beat_role === 'release') return Math.min(1, u*1.8); // 猛升
  if (r.beat_role === 'pressure') return -0.5*u; // 收束（负值=暗场）
  if (r.beat_role === 'residue') return 0.3*(1-u); // 余晖
  return 0;
}

// 画爆发：主体周围脉冲光环（辅助，不盖主体不压暗）；pressure 轻微暗角收束
export function drawBurst(ctx, bi, cx, cy) {
  const { lines, W, H, P, f } = ctx;
  if (bi > 0.02) {
    const t = f.t;
    const pulse = 0.5 + 0.5*Math.sin(t*7);
    // 主体外围扩散光环（不覆盖主体中心，环形）
    const R = 150 + bi*200 + pulse*60;
    lines.circle(cx, cy, R, 3+bi*5, withAlpha(P.signal, 0.8*bi));
    lines.circle(cx, cy, R+40, 2+bi*3, withAlpha(P.signal, 0.5*bi*pulse));
    // 四角短闪光（边缘，提帧间变化）
    for (const [px,py] of [[80,80],[W-80,80],[80,H-80],[W-80,H-80]]) {
      const L = 30+bi*80*pulse;
      lines.seg(px-L,py,px+L,py,2+bi*3,withAlpha(P.signal,0.7*bi*pulse));
      lines.seg(px,py-L,px,py+L,2+bi*3,withAlpha(P.signal,0.7*bi*pulse));
    }
  } else if (bi < -0.02) {
    const d = -bi;
    lines.fillRect(0,0,W,H*0.12*d, withAlpha(P.ink, 0.25*d));
    lines.fillRect(0,H*(1-0.12*d),W,H*0.12*d, withAlpha(P.ink, 0.25*d));
  }
}
