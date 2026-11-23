// @ts-check
/** 03 · mechanism —— 【答案峰①】海岸线递归细分越来越长 + zoom 细分段。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { coastline, pathLen } from './_geo.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
export default makeShot('mechanism',{
  setup(){ this.cam=makeCinematic(); },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    // 细分级别 0→4 随时间
    const depth=Math.min(4,Math.floor(smoothstep(0.3,5.0,lt)*4.99));
    const pts=coastline(W,H,depth);
    const zt=sat((lt-5.0)/0.6); const zoom=1+1.6*smoothstep(0,1,zt);
    ctx.setXform({scale:zoom,anchor:[W*0.55,H*0.5]});
    lines.begin();
    for(let i=1;i<pts.length;i++) lines.seg(pts[i-1][0],pts[i-1][1],pts[i][0],pts[i][1],2,withAlpha(P.bone,0.9));
    lines.flush(ctx.out);
    text.clear();
    const L=Math.round(pathLen(pts));
    type.writeLine('长度 '+L+' · 级 '+depth, W*0.5, 130, {anchor:'center',size:36,color:css(P.signal,0.9)});
    if(lt>4.5) type.writeLine('越量越长', W*0.5, H-90, {anchor:'center',size:38,color:css(P.bone,smoothstep(4.5,5.5,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:typeof zt!=='undefined'?zt:0,bloomBase:0.1});
  },
});