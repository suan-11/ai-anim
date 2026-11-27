// @ts-check
/** 05 · close —— zoom out 回全景九柱 + 1881 查账用标注。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { BENFORD, barLayout } from './_data.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
import { rhythmDrive } from '../../_shared/rhythm-drive.js';
import { safeZoom } from '../../_shared/zoom.js';
export default makeShot('close',{
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    // 方案2·bit深谷档：close 从 37.63s 入场（data 的 residue[34,40) 还没走完）。
    // 入场不能抢峰：前 2.4s（到 40s）保持低位静置，40s 后才开始 zoom out 收尾。
    // 柱体对比随收尾窗缓落（0.9→0.55），末段小回扣——结尾不归零不断崖。
    const rd=rhythmDrive(f);
    const resU=sat((f.t-42)/5.7);                  // 收尾窗进度（42s 起，最后一个residue块）
    // 入场全程压低到 42s（fall 判据窗 [41,42] 必须低），42s 后才缓升——
    // data 段 residue 末的谷由 close 入场延续，不被 zoom/亮度回弹填平
    const entryDim=smoothstep(42,43.5,f.t);
    // zoom out 从 1.35 缓落回 1.0（全景九柱完整入画，不裁切左右）
    const zoom=1+0.35*(1-smoothstep(0,1,sat(resU*1.6)))*entryDim;
    const dim=(0.55+0.40*entryDim)*(1-0.25*resU);   // 入场0.55底（不能太暗否则字幕抢焦点），收尾缓降到0.7
    const bars=barLayout(W,H); const maxH=H-380;
    // 全景九柱用 safeZoom 保证不裁切（1号柱最高，包围盒含全部柱+标注余量）
    const b0=bars[0], b8=bars[8];
    const topY=b0.baseY-BENFORD[0]*maxH*2.6;
    const bbox=[b0.x-b0.bw/2-20, topY-40, (b8.x+b8.bw/2)-(b0.x-b0.bw/2)+40, b0.baseY-topY+100];
    const {zoom:sz,anchor}=safeZoom(W,H,bbox,zoom);
    ctx.setXform({scale:sz,anchor});
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    lines.seg(140,bars[0].baseY,W-140,bars[0].baseY,1.5,withAlpha(P.graphite,0.6*dim));
    for(let i=0;i<9;i++){const h=BENFORD[i]*maxH*2.6;const b=bars[i];lines.fillRect(b.x-b.bw/2,b.baseY-h,b.bw,h,i===0?withAlpha(P.signal,0.85*dim):withAlpha(P.bone,0.92*dim));}
    // 末段小回扣：1号柱顶再脉冲一次（收尾窗后 1/3，轻微回升再收束）
    if(resU>0.6){ const cb=Math.sin(sat((resU-0.6)/0.3)*Math.PI); const h0=BENFORD[0]*maxH*2.6;
      lines.circle(b0.x,b0.baseY-h0,10+8*cb,2.5,withAlpha(P.signal,0.7*cb)); }
    lines.flush(ctx.out);
    text.clear();
    for(let i=0;i<9;i++){const b=bars[i];type.writeLine(String(b.d),b.x,b.baseY+30,{anchor:'center',size:28,color:css(P.ash,0.8*dim)});}
    type.writeLine('1881 · 查账用', W*0.5, 200, {anchor:'center',size:40,color:css(P.bone,smoothstep(2,3.5,lt)*dim)});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:0,bloomBase:0.08});
  },
});