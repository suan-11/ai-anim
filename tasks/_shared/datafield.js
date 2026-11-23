// @ts-check
/** 背景数据流场：移动散点+淡流线，多锚点动态环境层（提复杂度/降重复度，不抢主体）。 */
import { withAlpha } from '../../src/kit/index.js';
import { rng } from '../../src/core/util.js';
export function makeDataField(seed=11, count=40){
  const r=rng(seed); const pts=[];
  for(let i=0;i<count;i++) pts.push({x:r(),y:r(),vx:(r()-0.5)*0.04,vy:(r()-0.5)*0.03,sz:1+r()*2.5,ph:r()*6.28});
  return { pts };
}
export function drawDataField(ctx, field, t, alpha=0.25){
  const { lines, W, H, P } = ctx;
  // 节奏门控（bit 深谷档，docs/BENCHMARK-WEIGHTED.md）：pressure/hold 压到 15-25%
  // （下蹲期背景近静，显著性谷才够深——bit 标杆 59% 时间 <0.5），
  // release 满强度，residue 缓落。无节奏表时恒为原 alpha。
  const r = ctx.f.rhythm;
  let gate = 1;
  if (r) {
    const u = r.progress ?? 0;
    if (r.beat_role === 'pressure') gate = 0.30 - 0.15 * u;
    else if (r.beat_role === 'hold') gate = 0.15 + 0.08 * Math.sin(u * Math.PI);
    else if (r.beat_role === 'release') gate = 0.6 + 0.4 * Math.min(1, u * 2);
    else if (r.beat_role === 'residue') gate = 0.7 - 0.3 * u;
  }
  const a = alpha * gate;
  for(const p of field.pts){
    // 确定性位置（t 的纯函数，循环边界）
    const x=((p.x + p.vx*t)%1+1)%1 * W;
    const y=((p.y + p.vy*t)%1+1)%1 * H;
    const tw=0.5+0.5*Math.sin(t*1.5+p.ph); // 闪烁
    lines.circle(x,y,p.sz,1,withAlpha(P.graphite,a*tw));
  }
}
