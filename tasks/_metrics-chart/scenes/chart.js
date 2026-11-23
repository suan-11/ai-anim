// @ts-check
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { css } from '../../../src/core/util.js';
const DATA=[
  {name:'benford',c:44,r:60,a:30},
  {name:'manhole',c:26,r:56,a:35},
  {name:'coastline',c:28,r:60,a:36},
  {name:'tube-map',c:33,r:63,a:41},
  {name:'paperfold',c:39,r:59,a:29},
];
export default makeShot('chart',{
  draw(ctx){
    const{lines,text,type,comp,gl,W,H,P}=ctx;
    lines.begin();
    const baseY=H-180, maxH=520, pad=180;
    const groupW=(W-2*pad)/5;
    // 基线+网格
    lines.seg(pad,baseY,W-pad,baseY,2,withAlpha(P.bone,0.7));
    for(let v=0;v<=100;v+=25){ const y=baseY-v/100*maxH; lines.seg(pad,y,W-pad,y,0.8,withAlpha(P.graphite,0.3)); }
    const cols=[P.signal,P.ash,P.bone]; // 复杂度红/重复度灰/注意力白
    const labels=['复杂度','重复度','注意力'];
    for(let i=0;i<5;i++){
      const d=DATA[i]; const gx=pad+i*groupW+groupW*0.15;
      const vals=[d.c,d.r,d.a]; const bw=groupW*0.2;
      for(let j=0;j<3;j++){ const h=vals[j]/100*maxH; const x=gx+j*bw;
        lines.fillRect(x,baseY-h,bw*0.85,h,withAlpha(cols[j],0.9)); }
    }
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('五片 · 复杂度 / 重复度 / 注意力曲线', W*0.5, 90, {anchor:'center',size:44,color:css(P.bone,0.95)});
    for(let i=0;i<5;i++){ const gx=pad+i*groupW+groupW*0.5; type.writeLine(DATA[i].name, gx, baseY+50, {anchor:'center',size:28,color:css(P.ash,0.9)}); }
    // 图例
    for(let j=0;j<3;j++){ const lx=W*0.32+j*200; lines.begin(); lines.fillRect(lx,140,24,24,withAlpha(cols[j],0.9)); lines.flush(ctx.out); type.writeLine(labels[j], lx+34, 152, {anchor:'left',size:26,color:css(P.bone,0.85)}); }
    // Y轴刻度
    for(let v=0;v<=100;v+=25){ const y=baseY-v/100*maxH; type.writeLine(String(v), pad-30, y, {anchor:'right',size:22,color:css(P.ash,0.7)}); }
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return{grain:0.01,vignette:0.25};
  },
});
