// @ts-check
/** 05 · close —— zoom out 回全景九柱 + 1881 查账用标注。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { BENFORD, barLayout } from './_data.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
export default makeShot('close',{
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const zoom=1.5-0.5*smoothstep(0,1,sat(lt/1.0));
    ctx.setXform({scale:zoom,anchor:[W/2,H/2]});
    const bars=barLayout(W,H); const maxH=H-380;
    lines.begin();
    lines.seg(140,bars[0].baseY,W-140,bars[0].baseY,1.5,withAlpha(P.graphite,0.6));
    for(let i=0;i<9;i++){const h=BENFORD[i]*maxH*2.6;const b=bars[i];lines.fillRect(b.x-b.bw/2,b.baseY-h,b.bw,h,i===0?withAlpha(P.signal,0.85):withAlpha(P.bone,0.92));}
    lines.flush(ctx.out);
    text.clear();
    for(let i=0;i<9;i++){const b=bars[i];type.writeLine(String(b.d),b.x,b.baseY+30,{anchor:'center',size:28,color:css(P.ash,0.8)});}
    type.writeLine('1881 · 查账用', W*0.5, 130, {anchor:'center',size:40,color:css(P.bone,smoothstep(2,3.5,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return{grain:0.012,vignette:0.3};
  },
});