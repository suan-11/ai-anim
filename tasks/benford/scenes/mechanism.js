// @ts-check
/** 03 · mechanism —— 【答案峰①】对数刻度揭示 P(d)=log10(1+1/d)。
 * 复杂度来自真实内容：数轴上每个刻度配概率值标注，release 期逐刻度揭示
 * 「线性→对数」变形过程中数字位置的真实移动，不是装饰刷分。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { BENFORD, barLayout } from './_data.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
import { burstIntensity, drawBurst } from '../../_shared/burst.js';
import { rhythmDrive } from '../../_shared/rhythm-drive.js';
import { mathBenfordFull } from '../../_shared/math.js';

export default makeShot('mechanism',{
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const rd=rhythmDrive(f);
    const isRel=rd.role==='release';
    const preK=isRel?1:sat(0.15+0.55*(f.t-9.5)/7.8);
    const slamK=isRel?Math.min(1.12,preK+0.42*rd.slam):preK;
    const k=Math.min(1,slamK);
    const over=isRel?Math.max(0,slamK-1):0;
    const bars=barLayout(W,H); const maxH=H-380;
    const axY=240, axL=200, axR=W-200;
    const zt=isRel?rd.slam:0;
    const zoomPulse=isRel?1:0;
    const zoom=1+1.4*smoothstep(0,1,zt)*zoomPulse;
    const dim=isRel?1:(rd.role==='hold'?0.5:0.65-0.2*rd.u);
    const x1=axL, x2=axL+(axR-axL)*(Math.log10(2)*k+(1-k)*0.1);
    const boxW=x2-x1, boxCx=(x1+x2)/2;
    const bboxW=boxW+160;
    const maxZ=Math.min(zoom, W*0.85/bboxW, 2.2);
    ctx.setXform({scale:maxZ, x:maxZ*(W/2-boxCx), y:maxZ*(H*0.52-axY)});
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    // 数轴 + 刻度线（矢量层）
    lines.seg(axL,axY,axR,axY,2,withAlpha(P.bone,0.8*dim));
    const relU=isRel?rd.u:0;
    const tickX=[];                                  // 记录每个刻度的x，供文字层用
    for(let d=1;d<=10;d++){
      const lin=(d-1)/9; const log=Math.log10(d);
      const x=axL+(axR-axL)*(lin+(log-lin)*k);
      tickX.push(x);
      lines.seg(x,axY-12,x,axY+12,2,withAlpha(P.bone,0.8*dim));
      // 概率值引线（矢量层，release 逐刻度揭示）
      if(d<=9&&isRel){
        const rev=sat((relU-(d-1)*0.06)/0.2);
        if(rev>0.05) lines.seg(x,axY-14,x,axY-18,1,withAlpha(P.signal,0.4*rev*dim));
      }
    }
    // 1-2 区间高亮框
    if(k>0.5&&isRel){ const ba=smoothstep(0.5,1,k)*dim; const ex=1+over*3;
      const bh=60*ex, by=axY-bh/2;
      lines.fillRect(x1,by,x2-x1,bh,withAlpha(P.signal,0.3*ba)); lines.rect(x1,by,x2-x1,bh,2+over*12,withAlpha(P.signal,ba)); }
    // 下方九柱：release 块首 1 号柱冲高过冲
    const barKick=isRel?Math.exp(-Math.pow((rd.u-0.15)*7,2))*0.15:0;
    const relPulse=isRel?(0.5+0.5*Math.sin(f.t*7)):0;
    lines.seg(140,bars[0].baseY,W-140,bars[0].baseY,1.5,withAlpha(P.graphite,0.6*dim));
    for(let i=0;i<9;i++){ const h=BENFORD[i]*maxH*2.6*(i===0?1+barKick+0.03*relPulse:1); const b=bars[i];
      lines.fillRect(b.x-b.bw/2,b.baseY-h,b.bw,h,i===0?withAlpha(P.signal,(0.9+0.1*relPulse)*dim):withAlpha(P.bone,0.92*dim)); }
    // 1号柱顶发光环
    if(isRel){ const b0=bars[0]; const h0=BENFORD[0]*maxH*2.6*(1+barKick);
      lines.circle(b0.x,b0.baseY-h0,12+8*relPulse,3,withAlpha(P.signal,0.7*relPulse*dim)); }
    // 高亮框上沿扫描光点（带指向线，对象性明确）
    if(k>0.5&&isRel){ const scanX=x1+(x2-x1)*((f.t*0.7)%1); const topEdge=axY-30*(1+over*3);
      lines.circle(scanX,topEdge,5+3*relPulse,2,withAlpha(P.signal,0.9*dim));
      lines.seg(scanX,topEdge,scanX,topEdge+14,1.5,withAlpha(P.signal,0.6*dim)); }
    drawBurst(ctx, burstIntensity(f), boxCx, axY);
    lines.flush(ctx.out);
    text.clear();
    for(let i=0;i<9;i++){const b=bars[i];type.writeLine(String(b.d),b.x,b.baseY+30,{anchor:'center',size:28,color:css(P.ash,0.8*dim)});}
    // 概率值标注（文字层，release 逐刻度揭示）——在 text.clear 之后写才不会被清掉
    if(isRel){
      for(let d=1;d<=9;d++){
        const rev=sat((relU-(d-1)*0.06)/0.2);
        if(rev>0.05){
          const pct=(BENFORD[d-1]*100).toFixed(1);
          type.writeLine(pct+'%', tickX[d-1], axY-24, {anchor:'center',size:17,color:css(P.signal,0.8*rev*dim)});
        }
      }
    }
    if(k>0.9&&isRel){ const la=smoothstep(0.9,1,k)*dim;
      type.writeLine('1', x1, axY+52, {anchor:'center',size:30,color:css(P.signal,la)});
      type.writeLine('2', x2, axY+52, {anchor:'center',size:30,color:css(P.signal,la)}); }
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    // 公式 overlay（屏幕坐标，字幕带下方 y≈170）——概率值标注在变换层内数轴上方，
    // zoom 后数轴在屏幕 ~210px，概率值 ~185px 与公式重叠。
    // 解法：公式移到画面底部（柱阵下方空白区），不与数轴标注抢位置。
    ctx.setXform({scale:1,x:0,y:0});
    text.clear();
    if(k>0.7&&isRel) mathBenfordFull(ctx, W*0.5, H-60, {size:40,color:css(P.signal,smoothstep(0.7,1,k)*dim),anchor:'center'});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:zt*zoomPulse,bloomBase:0.1});
  },
});