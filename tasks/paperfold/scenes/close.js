// @ts-check
/** 05 · close —— zoom out 理论42次 vs 实际≤8次诚实标注。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
export default makeShot('close',{
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const zoom=1.4-0.4*smoothstep(0,1,sat(lt/1.0));
    ctx.setXform({scale:zoom,anchor:[W/2,H/2]});
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    // 纸层堆叠示意
    for(let i=0;i<8;i++) lines.seg(W*0.3,H*0.6-i*4,W*0.7,H*0.6-i*4,2,withAlpha(P.bone,0.85));
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('理论 42 次', W*0.5, H*0.3, {anchor:'center',size:36,color:css(P.signal,0.9)});
    type.writeLine('实际 ≤ 8 次', W*0.5, H*0.4, {anchor:'center',size:36,color:css(P.bone,smoothstep(2,3.5,lt))});
    type.writeLine('理论≠实际', W*0.5, H-90, {anchor:'center',size:34,color:css(P.ash,smoothstep(3,4,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:typeof zt!=='undefined'?zt:0,bloomBase:0.1});
  },
});