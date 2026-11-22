// @ts-check
/** 01 · hook —— 大尺子量海岸线得一个数，zoom punch 露出漏掉的小弯（只问不答）。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { coastline, pathLen } from './_geo.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
export default makeShot('hook',{
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const fine=coastline(W,H,3); // 真实细海岸
    const coarse=coastline(W,H,0); // 大尺子粗量
    const zt=sat((lt-1.5)/0.6); const zoom=1+2*smoothstep(0,1,zt);
    const anchor=[W*0.55,H*0.6];
    ctx.setXform({scale:zoom,anchor});
    lines.begin();
    // 细海岸（淡）
    for(let i=1;i<fine.length;i++) lines.seg(fine[i-1][0],fine[i-1][1],fine[i][0],fine[i][1],1.5,withAlpha(P.ash,0.4));
    // 大尺子粗量（亮）
    for(let i=1;i<coarse.length;i++) lines.seg(coarse[i-1][0],coarse[i-1][1],coarse[i][0],coarse[i][1],3,withAlpha(P.bone,0.95));
    // zoom 后高亮漏掉的弯（细线与粗线之间）
    if(zt>0.3){ const ba=smoothstep(0.3,0.8,zt); lines.circle(anchor[0],anchor[1],50,2,withAlpha(P.signal,ba)); }
    lines.flush(ctx.out);
    text.clear();
    const L1=Math.round(pathLen(coarse));
    type.writeLine('长度 '+L1, W*0.5, 130, {anchor:'center',size:36,color:css(P.bone,0.85)});
    if(zt>0.5) type.writeLine('量准了？', anchor[0]+90, anchor[1]-70, {anchor:'center',size:40,color:css(P.signal,smoothstep(0.5,1,zt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return{grain:0.014,vignette:0.4};
  },
});