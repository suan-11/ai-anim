// @ts-check
/** 02 · bridge —— 继续对折厚度加速（10次10cm/20次100m）。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
export default makeShot('bridge',{
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const n=Math.floor(smoothstep(0.3,4.0,lt)*20); // 0→20次
    const thickMM=0.1*Math.pow(2,n);
    const barH=Math.min(H*0.6, Math.log10(thickMM+1)*100);
    const barX=W*0.5, barBase=H*0.8;
    const zt=sat((lt-3.0)/0.6);
    ctx.setXform(this.cam.xform(ctx,W,H,zt));
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    lines.seg(barX-200,barBase,barX+200,barBase,1.5,withAlpha(P.graphite,0.6));
    lines.fillRect(barX-50,barBase-barH,100,barH,withAlpha(P.signal,0.9));
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('对折 '+n+' 次', W*0.22, H*0.2, {anchor:'center',size:34,color:css(P.bone,0.9)});
    const label=thickMM>1000?(thickMM/1000).toFixed(1)+' m':thickMM.toFixed(1)+' mm';
    type.writeLine(label, W*0.78, H*0.2, {anchor:'center',size:42,color:css(P.signal,0.95)});
    if(lt>3) type.writeLine('开始快了', W*0.5, H*0.92, {anchor:'center',size:34,color:css(P.ash,smoothstep(3,3.8,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:zt,bloomBase:0.1});
  },
});