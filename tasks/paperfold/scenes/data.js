// @ts-check
/** 04 · data —— 【答案峰②】42次厚度44万km > 地月38万km + zoom超越点。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
export default makeShot('data',{
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const MOON=384400, FOLD42=439805; // km
    const baseY=H*0.8, maxH=H*0.6;
    const moonH=MOON/FOLD42*maxH, foldH=maxH;
    const grow=smoothstep(0.3,3.5,lt);
    const zt=sat((lt-3.5)/0.6); const zoom=1+0.6*smoothstep(0,1,zt);
    ctx.setXform({scale:zoom,anchor:[W*0.5,baseY]});
    lines.begin();
    lines.seg(W*0.2,baseY,W*0.8,baseY,1.5,withAlpha(P.graphite,0.6));
    // 地月距离柱（左）
    lines.fillRect(W*0.35-50,baseY-moonH,100,moonH,withAlpha(P.bone,0.85));
    // 42次厚度柱（右，增长）
    const fh=foldH*grow;
    lines.fillRect(W*0.65-50,baseY-fh,100,fh,withAlpha(P.signal,0.9));
    // 地月线（水平参考）
    lines.seg(W*0.2,baseY-moonH,W*0.8,baseY-moonH,1.5,withAlpha(P.signal,0.5));
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('地月 38万km', W*0.35, baseY+40, {anchor:'center',size:28,color:css(P.ash,0.9)});
    type.writeLine('42次 44万km', W*0.65, baseY+40, {anchor:'center',size:28,color:css(P.ash,0.9)});
    if(grow>0.9) type.writeLine('够到月球', W*0.5, H*0.2, {anchor:'center',size:44,color:css(P.signal,smoothstep(3,4,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return{grain:0.012,vignette:0.3};
  },
});