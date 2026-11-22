// @ts-check
/** benford 共享：本福特概率 + 柱布局（重构：主体占画面50%+）。 */
export const BENFORD = [1,2,3,4,5,6,7,8,9].map(d => Math.log10(1+1/d));
export const UNIFORM = Array(9).fill(1/9);
// 柱布局：九根，画面中下，柱高占画面 55%
export function barLayout(W, H, pad=160) {
  const bw = (W - 2*pad) / 9 * 0.72; // 更宽
  const gap = (W - 2*pad) / 9;
  const baseY = H - 140; // 更低
  return BENFORD.map((_,i) => ({ x: pad + i*gap + gap/2, baseY, bw, d:i+1 }));
}
export const MAX_BAR_H = 620; // 柱最大高（1号 0.301×620×3.0≈560）
export const BAR_SCALE = 3.0;
