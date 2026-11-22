// @ts-check
/** 04 · data —— 【答案峰②】彭罗斯阶梯循环上升回原点。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
export default makeShot('data',{
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt;
    const cx=W*0.5,cy=H*0.45,step=50;
    // 不可能阶梯：四边循环，每边看似上行
    const loop=[[0,0],[3,0],[3,3],[0,3],[0,0]];
    const zt=sat((lt-3.5)/0.6); const zoom=1+0.6*smoothstep(0,1,zt);
    ctx.setXform({scale:zoom,anchor:[cx,cy]});
    lines.begin();
    const prog=smoothstep(0.3,3.5,lt)*4;
    for(let e=0;e<4;e++){
      const a=[cx+loop[e][0]*step-step*1.5,cy+loop[e][1]*step-step*1.5];
      const b=[cx+loop[e+1][0]*step-step*1.5,cy+loop[e+1][1]*step-step*1.5];
      // 每边画阶梯锯齿
      const segP=sat(prog-e);
      const n=6; for(let i=0;i<n*segP;i++){ const t0=i/n,t1=(i+1)/n;
        const x0=a[0]+(b[0]-a[0])*t0,y0=a[1]+(b[1]-a[1])*t0-i*4;
        const x1=a[0]+(b[0]-a[0])*t1,y1=a[1]+(b[1]-a[1])*t1-i*4;
        lines.seg(x0,y0,x1,y0,2,withAlpha(P.bone,0.9)); lines.seg(x1,y0,x1,y1-4,2,withAlpha(P.bone,0.9)); }
    }
    lines.flush(ctx.out);
    text.clear();
    if(lt>3) type.writeLine('一直上 · 回原点', W*0.5, H-90, {anchor:'center',size:38,color:css(P.signal,smoothstep(3,4,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return{grain:0.014,vignette:0.4};
  },
});
