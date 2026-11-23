// @ts-check
/** 05 · close —— zoom out 排名柱 + 1949 Zipf。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { ZIPF, rankLayout, MAX_H, SCALE } from './_data.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
export default makeShot('close',{
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const zoom=1.4-0.4*smoothstep(0,1,sat(lt/1.0));
    ctx.setXform({scale:zoom,anchor:[W/2,H/2]});
    const bars=rankLayout(W,H);
    lines.begin();
    lines.seg(140,bars[0].baseY,W-140,bars[0].baseY,1.5,withAlpha(P.graphite,0.6));
    for(let i=0;i<9;i++){const h=ZIPF[i]*MAX_H*SCALE;const b=bars[i];lines.fillRect(b.x-b.bw/2,b.baseY-h,b.bw,h,i===0?withAlpha(P.signal,0.85):withAlpha(P.bone,0.85));}
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('1949 · Zipf', W*0.5, H*0.16, {anchor:'center',size:40,color:css(P.bone,smoothstep(2,3.5,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return{grain:0.012,vignette:0.3};
  },
});
