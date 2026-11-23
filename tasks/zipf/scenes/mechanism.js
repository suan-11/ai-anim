// @ts-check
/** 03 · mechanism —— 【答案峰①】log-log 排名vs频率直线斜率-1 + safeZoom。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { ZIPF } from './_data.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { safeZoom } from '../../_shared/zoom.js';
export default makeShot('mechanism',{
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const ox=W*0.28,oy=H*0.72,aw=W*0.44,ah=H*0.42;
    const prog=smoothstep(0.3,4.0,lt);
    const zt=sat((lt-5.0)/0.6);
    const {zoom,anchor}=safeZoom(W,H,[ox,oy-ah,aw,ah],1+0.6*smoothstep(0,1,zt));
    ctx.setXform({scale:zoom,anchor});
    lines.begin();
    lines.seg(ox,oy,ox+aw,oy,2,withAlpha(P.bone,0.8));
    lines.seg(ox,oy,ox,oy-ah,2,withAlpha(P.bone,0.8));
    // log-log 点：log(r) vs log(1/r)=-log(r)，斜率-1直线
    const n=Math.floor(prog*8)+1;
    const pts=[]; for(let r=1;r<=9;r++){ const lx=Math.log10(r), ly=Math.log10(1/r);
      const x=ox+(lx/Math.log10(9))*aw, y=oy-(ly+Math.log10(9))/Math.log10(9)*ah; pts.push([x,y]); }
    for(let i=0;i<pts.length;i++) lines.circle(pts[i][0],pts[i][1],5,2,withAlpha(i<n?P.signal:P.graphite,i<n?0.95:0.4));
    for(let i=1;i<n;i++) lines.seg(pts[i-1][0],pts[i-1][1],pts[i][0],pts[i][1],2.5,withAlpha(P.signal,0.9));
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('log(排名)', ox+aw/2, oy+50, {anchor:'center',size:26,color:css(P.ash,0.8)});
    type.writeLine('log(频率)', ox-70, oy-ah/2, {anchor:'center',size:26,color:css(P.ash,0.8)});
    if(lt>4) type.writeLine('f ∝ 1/r', W*0.5, H*0.16, {anchor:'center',size:44,color:css(P.signal,smoothstep(4,5,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return{grain:0.012,vignette:0.3};
  },
});
