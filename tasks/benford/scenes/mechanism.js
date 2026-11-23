// @ts-check
/** 03 · mechanism —— 【答案峰①】对数刻度揭示 P(d)=log10(1+1/d)，zoom 1-2 最宽区间。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { BENFORD, barLayout } from './_data.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
import { burstIntensity, drawBurst } from '../../_shared/burst.js';
export default makeShot('mechanism',{
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const bars=barLayout(W,H); const maxH=H-380;
    // 对数轴演示：上方画一条数轴 1..10，线性→对数变形
    const k=smoothstep(0.5,4.0,lt);
    const axY=240, axL=200, axR=W-200;
    const zt=sat((lt-5.0)/0.6); const zoom=1+1.4*smoothstep(0,1,zt);
    // 1-2 区间中点（对数）
    const x1=axL, x2=axL+(axR-axL)*(Math.log10(2)*k+(1-k)*0.1);
    ctx.setXform({scale:zoom,anchor:[(x1+x2)/2,axY]});
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    // 数轴
    lines.seg(axL,axY,axR,axY,2,withAlpha(P.bone,0.8));
    for(let d=1;d<=10;d++){
      const lin=(d-1)/9; const log=Math.log10(d);
      const x=axL+(axR-axL)*(lin+(log-lin)*k);
      lines.seg(x,axY-12,x,axY+12,2,withAlpha(P.bone,0.8));
    }
    // 1-2 区间高亮（最宽）
    if(k>0.5){ const ba=smoothstep(0.5,1,k); lines.fillRect(x1,axY-30,x2-x1,60,withAlpha(P.signal,0.25*ba)); lines.rect(x1,axY-30,x2-x1,60,2,withAlpha(P.signal,ba)); }
    // 下方九柱（本福特）
    lines.seg(140,bars[0].baseY,W-140,bars[0].baseY,1.5,withAlpha(P.graphite,0.6));
    for(let i=0;i<9;i++){ const h=BENFORD[i]*maxH*2.6; const b=bars[i]; lines.fillRect(b.x-b.bw/2,b.baseY-h,b.bw,h,i===0?withAlpha(P.signal,0.9):withAlpha(P.bone,0.92)); }
    drawBurst(ctx, burstIntensity(f), W*0.5, H*0.5);
    lines.flush(ctx.out);
    text.clear();
    for(let i=0;i<9;i++){const b=bars[i];type.writeLine(String(b.d),b.x,b.baseY+30,{anchor:'center',size:28,color:css(P.ash,0.8)});}
    if(k>0.7) type.writeLine('log₁₀(1+1/d)', W*0.5, 210, {anchor:'center',size:44,color:css(P.signal,smoothstep(0.7,1,k))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:typeof zt!=='undefined'?zt:0,bloomBase:0.1});
  },
});