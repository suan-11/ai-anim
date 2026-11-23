// @ts-check
/** 02 · bridge —— 换三组真实数据柱形都一样（1 始终独高）。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { BENFORD, barLayout } from './_data.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
const SETS=['人口','河流','股价'];
export default makeShot('bridge',{
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const bars=barLayout(W,H); const maxH=H-380;
    const setIdx=Math.min(2,Math.floor(lt/1.7));
    // 微抖（不同数据但分布同）
    const jitter=0.02*Math.sin(lt*5);
    const zoom=1.3-0.3*smoothstep(0,1,sat(lt/1.0));
    ctx.setXform({scale:zoom,anchor:[W/2,H/2]});
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    lines.seg(140,bars[0].baseY,W-140,bars[0].baseY,1.5,withAlpha(P.graphite,0.6));
    for(let i=0;i<9;i++){ const v=BENFORD[i]*(1+jitter*(i%3-1)); const h=v*maxH*2.6; const b=bars[i];
      lines.fillRect(b.x-b.bw/2,b.baseY-h,b.bw,h,i===0?withAlpha(P.signal,0.95):withAlpha(P.bone,0.92)); }
    lines.flush(ctx.out);
    text.clear();
    for(let i=0;i<9;i++){const b=bars[i];type.writeLine(String(b.d),b.x,b.baseY+30,{anchor:'center',size:28,color:css(P.ash,0.85)});}
    type.writeLine(SETS[setIdx], W*0.5, 130, {anchor:'center',size:40,color:css(P.bone,0.9)});
    if(lt>3) type.writeLine('换数据也一样', W*0.5, H-90, {anchor:'center',size:34,color:css(P.signal,smoothstep(3,3.8,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:typeof zt!=='undefined'?zt:0,bloomBase:0.1});
  },
});