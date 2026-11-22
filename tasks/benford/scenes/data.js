// @ts-check
/** 04 · data —— 【答案峰②】造假(均匀) vs 真实(本福特) 对照 + zoom 1号偏差。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { BENFORD, UNIFORM } from './_data.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
export default makeShot('data',{
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const zt=sat((lt-4.0)/0.6); const zoom=1+0.5*smoothstep(0,1,zt);
    const lx=W*0.28, rx=W*0.72;
    ctx.setXform({scale:zoom,anchor:[W*0.5,H*0.5]});
    lines.begin();
    const maxH=300, bw=22, gap=34;
    // 左：均匀（造假）
    for(let i=0;i<9;i++){ const h=UNIFORM[i]*maxH*2.6; const x=lx-4*gap+i*gap;
      lines.fillRect(x-bw/2,H*0.62-h,bw,h,i===0?withAlpha(P.signal,0.9):withAlpha(P.bone,0.85)); }
    // 右：本福特（真实）
    for(let i=0;i<9;i++){ const h=BENFORD[i]*maxH*2.6; const x=rx-4*gap+i*gap;
      lines.fillRect(x-bw/2,H*0.62-h,bw,h,i===0?withAlpha(P.signal,0.95):withAlpha(P.bone,0.92)); }
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('造假', lx, H*0.62+50, {anchor:'center',size:32,color:css(P.ash,0.9)});
    type.writeLine('真实', rx, H*0.62+50, {anchor:'center',size:32,color:css(P.ash,0.9)});
    if(lt>4) type.writeLine('造假露馅', W*0.5, 130, {anchor:'center',size:42,color:css(P.signal,smoothstep(4,5,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return{grain:0.012,vignette:0.3};
  },
});