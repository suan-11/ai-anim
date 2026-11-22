// @ts-check
/** 04 · data —— 【答案峰②】彭罗斯阶梯：四边循环每边看似上行却回原点。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
// 等距投影：世界(x,y,z)→屏幕。x右y上z深。
function iso(x,y,z,cx,cy,s){ return [cx+(x-z)*s*0.866, cy+(x+z)*s*0.5-y*s]; }
export default makeShot('data',{
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt;
    const cx=W*0.5, cy=H*0.62, s=30;
    const zt=sat((lt-3.5)/0.6); const zoom=1+0.5*smoothstep(0,1,zt);
    ctx.setXform({scale:zoom,anchor:[cx,cy]});
    lines.begin();
    // 四边阶梯循环：每边 n 阶，每阶上行 h，但第四边接回第一边起点（不可能）
    const n=4, h=5, run=14;
    // 四个角的世界坐标（方形平台四角），阶梯沿边爬升
    const corners=[[0,0],[4,0],[4,4],[0,4]]; // 平面四角
    const prog=smoothstep(0.3,3.5,lt)*4;
    for(let e=0;e<4;e++){
      const a=corners[e], b=corners[(e+1)%4];
      const segP=sat(prog-e);
      const steps=Math.floor(n*segP);
      for(let i=0;i<steps;i++){
        const t0=i/n, t1=(i+1)/n;
        const x0=a[0]+(b[0]-a[0])*t0, z0=a[1]+(b[1]-a[1])*t0;
        const x1=a[0]+(b[0]-a[0])*t1, z1=a[1]+(b[1]-a[1])*t1;
        const y0=e*n*h+i*h, y1=e*n*h+(i+1)*h; // 每边累计上行
        // 踏面（水平）+ 踢面（竖直）
        const p0=iso(x0,y0,z0,cx,cy,s), p1=iso(x1,y0,z1,cx,cy,s), p2=iso(x1,y1,z1,cx,cy,s);
        lines.seg(p0[0],p0[1],p1[0],p1[1],2.5,withAlpha(P.bone,0.9));
        lines.seg(p1[0],p1[1],p2[0],p2[1],2.5,withAlpha(P.bone,0.9));
      }
    }
    // 起点终点重合标记（不可能闭环）
    if(prog>3.8){ const ba=smoothstep(3.8,4,prog); const start=iso(0,0,0,cx,cy,s); const end=iso(0,4*n*h,0,cx,cy,s);
      lines.circle(start[0],start[1],8,2,withAlpha(P.signal,ba)); }
    lines.flush(ctx.out);
    text.clear();
    if(lt>3) type.writeLine('一直上 · 回原点', W*0.5, H-90, {anchor:'center',size:38,color:css(P.signal,smoothstep(3,4,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return{grain:0.014,vignette:0.4};
  },
});
