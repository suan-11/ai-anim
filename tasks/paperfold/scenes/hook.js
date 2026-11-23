// @ts-check
/** 01 · hook —— 纸对折几次厚度还很小，zoom punch 读数（铺垫不答）。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
export default makeShot('hook',{
  setup(){ this.cam=makeCinematic(); },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    // 对折次数 0→3
    const n=Math.min(3,Math.floor(smoothstep(0.2,1.5,lt)*3.99));
    const thickMM=0.1*Math.pow(2,n); // 毫米
    // 纸层堆叠（左侧）+ 厚度柱（右侧放大显示）
    const zt=sat((lt-1.5)/0.6); const zoom=1+1.8*smoothstep(0,1,zt);
    const barX=W*0.62, barBase=H*0.75;
    ctx.setXform({scale:zoom,anchor:[barX,barBase]});
    lines.begin();
    // 纸层堆叠（左）
    const layers=Math.pow(2,n); const lx=W*0.3, ly=H*0.6;
    for(let i=0;i<Math.min(layers,16);i++){ lines.seg(lx-120,ly-i*3,lx+120,ly-i*3,2,withAlpha(P.bone,0.85)); }
    // 厚度柱（右，放大比例显示）
    const barH=Math.max(4, thickMM*40); // 0.1mm→4px, 0.8mm→32px
    lines.fillRect(barX-40,barBase-barH,80,barH,withAlpha(P.signal,0.9));
    lines.seg(barX-120,barBase,barX+120,barBase,1.5,withAlpha(P.graphite,0.6));
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('对折 '+n+' 次', W*0.3, H*0.35, {anchor:'center',size:36,color:css(P.bone,0.9)});
    type.writeLine(thickMM.toFixed(1)+' mm', barX, barBase-barH-40, {anchor:'center',size:40,color:css(P.signal,0.95)});
    if(zt>0.5) type.writeLine('才几毫米', W*0.5, H-90, {anchor:'center',size:36,color:css(P.ash,smoothstep(0.5,1,zt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:typeof zt!=='undefined'?zt:0,bloomBase:0.1});
  },
});