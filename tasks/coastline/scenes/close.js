// @ts-check
/** 05 · close —— zoom out 回全景海岸线 + 1967 Mandelbrot。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { coastline } from './_geo.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
export default makeShot('close',{
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const zoom=1.6-0.6*smoothstep(0,1,sat(lt/1.0));
    ctx.setXform({scale:zoom,anchor:[W/2,H/2]});
    const pts=coastline(W,H,3);
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    for(let i=1;i<pts.length;i++) lines.seg(pts[i-1][0],pts[i-1][1],pts[i][0],pts[i][1],2,withAlpha(P.bone,0.85));
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('1967 · Mandelbrot', W*0.5, H-90, {anchor:'center',size:40,color:css(P.bone,smoothstep(2,3.5,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:typeof zt!=='undefined'?zt:0,bloomBase:0.1});
  },
});