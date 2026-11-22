// @ts-check
/** 03 · mechanism —— 【答案峰①】厚度 0.1mm×2^n 指数爆炸冲天 + zoom。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
export default makeShot('mechanism',{
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt;
    const n=Math.floor(smoothstep(0.3,5.0,lt)*30); // 0→30次
    const thickMM=0.1*Math.pow(2,n);
    // 柱高用 log 压缩显示（否则冲出画面），但标注真实值
    const barH=Math.min(H*0.7, Math.log10(thickMM+1)*120);
    const barX=W*0.5, barBase=H*0.8;
    const zt=sat((lt-5.0)/0.6); const zoom=1+0.8*smoothstep(0,1,zt);
    ctx.setXform({scale:zoom,anchor:[barX,barBase-barH]});
    lines.begin();
    lines.seg(barX-200,barBase,barX+200,barBase,1.5,withAlpha(P.graphite,0.6));
    lines.fillRect(barX-60,barBase-barH,120,barH,withAlpha(P.signal,0.9));
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('对折 '+n+' 次', W*0.22, 150, {anchor:'center',size:34,color:css(P.bone,0.9)});
    const km=thickMM/1e6;
    const label=km>1?km.toFixed(0)+' km':thickMM.toFixed(1)+' mm';
    type.writeLine(label, W*0.78, 150, {anchor:'center',size:44,color:css(P.signal,0.95)});
    if(lt>4) type.writeLine('×2 每次', W*0.5, H-70, {anchor:'center',size:38,color:css(P.bone,smoothstep(4,5,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return{grain:0.012,vignette:0.3};
  },
});
