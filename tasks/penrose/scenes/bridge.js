// @ts-check
/** 02 · bridge —— 三角缓慢旋转，接缝开始错位。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { TRI, mapPt } from './_geo.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
export default makeShot('bridge',{
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt;
    const ang=smoothstep(0.3,4.0,lt)*0.4; const sx=Math.cos(ang);
    const cx=W/2,cy=H/2;
    lines.begin();
    const O=TRI.outer.map(p=>mapPt(p,W,H)), I=TRI.inner.map(p=>mapPt(p,W,H));
    const rot=p=>[cx+(p[0]-cx)*sx,p[1]];
    for(let i=0;i<3;i++){ const a=rot(O[i]),b=rot(O[(i+1)%3]),c=rot(I[(i+1)%3]),d=rot(I[i]);
      lines.seg(a[0],a[1],b[0],b[1],3,withAlpha(P.bone,0.95)); lines.seg(d[0],d[1],c[0],c[1],2.5,withAlpha(P.bone,0.8)); lines.seg(a[0],a[1],d[0],d[1],2.5,withAlpha(P.bone,0.8)); lines.seg(c[0],c[1],b[0],b[1],2,withAlpha(P.ash,0.6)); }
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('转一下试试', W*0.5, H-90, {anchor:'center',size:36,color:css(P.signal,smoothstep(2,3,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return{grain:0.014,vignette:0.4};
  },
});
