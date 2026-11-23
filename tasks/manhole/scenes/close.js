// @ts-check
/** 05 · close —— zoom out 圆+勒洛并置，圆最易加工胜出。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
export default makeShot('close',{
  setup(){ this.cam=makeCinematic(); },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const zoom=1.5-0.5*smoothstep(0,1,sat(lt/1.0));
    ctx.setXform({scale:zoom,anchor:[W/2,H/2]});
    lines.begin();
    lines.circle(W*0.38,H*0.45,150,3,withAlpha(P.signal,0.95)); // 圆高亮
    // 勒洛（简化三角弧）
    const cx=W*0.64,cy=H*0.45,r=110;
    const v=[0,1,2].map(i=>{const a=i*2.094-Math.PI/2;return[cx+Math.cos(a)*r,cy+Math.sin(a)*r];});
    for(let i=0;i<3;i++){const a=v[i],b=v[(i+1)%3];lines.seg(a[0],a[1],b[0],b[1],2,withAlpha(P.bone,0.5));}
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('圆最好造', W*0.38, H*0.45+200, {anchor:'center',size:36,color:css(P.signal,smoothstep(2,3.5,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:typeof zt!=='undefined'?zt:0,bloomBase:0.1});
  },
});