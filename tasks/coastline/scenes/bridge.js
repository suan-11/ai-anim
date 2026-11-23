// @ts-check
/** 02 · bridge —— 换小尺子量出更长的数。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { coastline, pathLen } from './_geo.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
export default makeShot('bridge',{
  setup(){ this.cam=makeCinematic(); },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const depth=Math.min(2,Math.floor(smoothstep(0.3,3.5,lt)*2.99));
    const pts=coastline(W,H,depth);
    const coarse=coastline(W,H,0);
    const zoom=1.3-0.3*smoothstep(0,1,sat(lt/1.0));
    ctx.setXform({scale:zoom,anchor:[W/2,H/2]});
    lines.begin();
    for(let i=1;i<coarse.length;i++) lines.seg(coarse[i-1][0],coarse[i-1][1],coarse[i][0],coarse[i][1],1.5,withAlpha(P.graphite,0.3));
    for(let i=1;i<pts.length;i++) lines.seg(pts[i-1][0],pts[i-1][1],pts[i][0],pts[i][1],2.5,withAlpha(P.bone,0.92));
    lines.flush(ctx.out);
    text.clear();
    const L=Math.round(pathLen(pts));
    type.writeLine('长度 '+L, W*0.5, 130, {anchor:'center',size:38,color:css(P.signal,0.9)});
    if(lt>3) type.writeLine('更长了', W*0.5, H-90, {anchor:'center',size:36,color:css(P.bone,smoothstep(3,3.8,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:typeof zt!=='undefined'?zt:0,bloomBase:0.1});
  },
});