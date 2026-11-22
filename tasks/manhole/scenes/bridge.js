// @ts-check
/** 02 · bridge —— 圆井盖怎么转都不掉（任意方向直径相同）。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css, TAU } from '../../../src/core/util.js';
const CX=960,CY=520,HOLE=300,R=155;
export default makeShot('bridge',{
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const ang=lt*1.2; // 圆旋转
    const zoom=1.3-0.3*smoothstep(0,1,sat(lt/1.0));
    ctx.setXform({scale:zoom,anchor:[CX,CY]});
    lines.begin();
    // 井口方框
    lines.rect(CX-HOLE/2,CY-HOLE/2,HOLE,HOLE,3,withAlpha(P.ash,0.9));
    // 圆盖（旋转但圆对称看不出转，画一条半径标记显示在转）
    lines.circle(CX,CY,R,3,withAlpha(P.bone,0.95));
    lines.seg(CX,CY,CX+Math.cos(ang)*R,CY+Math.sin(ang)*R,2,withAlpha(P.signal,0.8));
    // 多方向直径等长标记
    for(let k=0;k<4;k++){ const a=ang+k*Math.PI/4; lines.seg(CX-Math.cos(a)*R,CY-Math.sin(a)*R,CX+Math.cos(a)*R,CY+Math.sin(a)*R,1,withAlpha(P.graphite,0.3)); }
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('怎么转都不掉', CX, CY-R-70, {anchor:'center',size:40,color:css(P.signal,smoothstep(2,3,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return{grain:0.014,vignette:0.4};
  },
});