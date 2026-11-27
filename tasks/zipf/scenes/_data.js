// @ts-check
/** zipf 共享：1/r 排名频率 + 柱布局。 */
export const ZIPF = Array.from({length:9},(_,i)=>1/(i+1)); // 1, 0.5, 0.33...
export function rankLayout(W,H,pad=160){
  const bw=(W-2*pad)/9*0.82, gap=(W-2*pad)/9, baseY=H-140;
  return ZIPF.map((_,i)=>({x:pad+i*gap+gap/2,baseY,bw,r:i+1}));
}
export const MAX_H=560, SCALE=1.0;
