// @ts-check
/** benford 共享：本福特概率 + 柱布局。 */
export const BENFORD = [1,2,3,4,5,6,7,8,9].map(d => Math.log10(1+1/d)); // 0.301..0.046
export const UNIFORM = Array(9).fill(1/9); // 直觉均匀 0.111
// 柱布局：九根，画面下方对齐
export function barLayout(W, H, pad=180) {
  const bw = (W - 2*pad) / 9 * 0.62;
  const gap = (W - 2*pad) / 9;
  const baseY = H - 200;
  return BENFORD.map((_,i) => ({ x: pad + i*gap + gap/2, baseY, bw, d:i+1 }));
}
