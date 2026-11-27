// @ts-check
/** 节奏爆发特效：release 光扫+冲击环+闪光炸开（高显著性），pressure 暗场收束（低显著性）。
 * 在场景 lines.flush 前调用 drawBurst(ctx, intensity)，intensity 由节奏 role 驱动。 */
import { withAlpha } from '../../src/kit/index.js';
import { sat, smoothstep } from '../../src/core/util.js';

// 由 f.rhythm 算爆发强度：release 冲峰后平台保持高位（能量源持续），pressure 负（收束）
export function burstIntensity(f) {
  const r = f.rhythm; if (!r) return 0;
  const u = r.progress ?? 0;
  if (r.beat_role === 'release') return Math.min(1, u*1.8)*(1-0.15*u); // 猛升后微落仍高位
  if (r.beat_role === 'pressure') return -0.5*u; // 收束（负值=暗场）
  if (r.beat_role === 'residue') return 0.3*(1-u); // 余晖
  return 0;
}

// 画爆发：主体周围紧凑脉冲光环（半径收在主体附近，能量集中不分散）；pressure 轻微暗角收束
export function drawBurst(ctx, bi, cx, cy) {
  const { lines, W, H, P, f } = ctx;
  if (bi > 0.02) {
    const t = f.t;
    const pulse = 0.5 + 0.5*Math.sin(t*7);
    // 紧凑双环（R 90-170，贴着主体而非铺满全屏——concentration 才不掉）
    const R = 90 + bi*80 + pulse*30;
    lines.circle(cx, cy, R, 4+bi*6, withAlpha(P.signal, 0.9*bi));
    lines.circle(cx, cy, R+26, 3+bi*4, withAlpha(P.signal, 0.6*bi*pulse));
    // 环上 8 个旋转短划（热点持续移动 → strength 能量源，集中在主体邻域）
    for (let k=0;k<8;k++){
      const a = t*1.2 + k*Math.PI/4;
      const px = cx + Math.cos(a)*R, py = cy + Math.sin(a)*R;
      const L = 16+bi*26*pulse;
      lines.seg(px-Math.cos(a)*L, py-Math.sin(a)*L, px+Math.cos(a)*L, py+Math.sin(a)*L, 3+bi*4, withAlpha(P.signal, 0.9*bi));
    }
    // 四角短闪光去掉（分散 concentration，实测无增益）
  } else if (bi < -0.02) {
    const d = -bi;
    lines.fillRect(0,0,W,H*0.12*d, withAlpha(P.ink, 0.25*d));
    lines.fillRect(0,H*(1-0.12*d),W,H*0.12*d, withAlpha(P.ink, 0.25*d));
  }
}
