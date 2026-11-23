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
  for(const p of field.pts){
    // 确定性位置（t 的纯函数，循环边界）
    const x=((p.x + p.vx*t)%1+1)%1 * W;
    const y=((p.y + p.vy*t)%1+1)%1 * H;
    const tw=0.5+0.5*Math.sin(t*1.5+p.ph); // 闪烁
    lines.circle(x,y,p.sz,1,withAlpha(P.graphite,alpha*tw));
  }
}
