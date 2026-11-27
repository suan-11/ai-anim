// @ts-check
/** 01 · hook —— 词频排名柱 the/of/and，第2名恰是第1名一半 + safeZoom。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { ZIPF, rankLayout, MAX_H, SCALE } from './_data.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { safeZoom } from '../../_shared/zoom.js';
const WORDS=['the','of','and','to','a','in','for','is','on'];
export default makeShot('hook',{
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const bars=rankLayout(W,H);
    const grow=smoothstep(0.2,1.2,lt);
    const zt=sat((lt-1.5)/0.6);
    const b0=bars[0],b1=bars[1];
    const topY=b0.baseY-MAX_H*ZIPF[0]*SCALE;
    const bbox=[b0.x-b0.bw/2,topY,(b1.x+b1.bw/2)-(b0.x-b0.bw/2),b0.baseY-topY];
    const {zoom,anchor}=safeZoom(W,H,bbox,1+1.2*smoothstep(0,1,zt));
    ctx.setXform({scale:zoom,anchor});
    lines.begin();
    lines.seg(140,bars[0].baseY,W-140,bars[0].baseY,1.5,withAlpha(P.graphite,0.6));
    for(let i=0;i<9;i++){ const h=ZIPF[i]*MAX_H*SCALE*grow; const b=bars[i];
      lines.fillRect(b.x-b.bw/2,b.baseY-h,b.bw,h,i<2?withAlpha(P.signal,0.9):withAlpha(P.bone,0.85)); }
    // 1/2 比例线（第2名顶=第1名一半高）
    if(zt>0.3){ const halfY=b0.baseY-MAX_H*ZIPF[0]*SCALE*0.5; lines.seg(b0.x-b0.bw/2,halfY,b1.x+b1.bw/2,halfY,2,withAlpha(P.signal,smoothstep(0.3,0.8,zt))); }
    lines.flush(ctx.out);
    text.clear();
    const la=1-smoothstep(0,0.5,zt);
    if(la>0.05) for(let i=0;i<9;i++){const b=bars[i];type.writeLine(WORDS[i],b.x,b.baseY+34,{anchor:'center',size:24,color:css(P.ash,0.85*la)});}
    if(zt>0.5) type.writeLine('一半？', b1.x+60, topY+40, {anchor:'center',size:48,color:css(P.signal,smoothstep(0.5,1,zt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return{grain:0.012,vignette:0.3};
  },
});
