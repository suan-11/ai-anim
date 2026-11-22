// @ts-check
/** 04 · data —— 【答案峰②】勒洛三角也定宽（非圆反转）+ zoom。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css, TAU } from '../../../src/core/util.js';
const CX=960,CY=520,R=200;
// 勒洛三角：三个顶点（等边三角），三段圆弧（圆心为对顶点，半径=边长）
function reuleaux(cx,cy,r,rot,n=60){
  const verts=[0,1,2].map(i=>{const a=rot+i*TAU/3-Math.PI/2;return [cx+Math.cos(a)*r,cy+Math.sin(a)*r];});
  const side=Math.sqrt(3)*r; const pts=[];
  for(let e=0;e<3;e++){
    const center=verts[(e+2)%3]; // 对顶点
    const a0=Math.atan2(verts[e][1]-center[1],verts[e][0]-center[0]);
    const a1=Math.atan2(verts[(e+1)%3][1]-center[1],verts[(e+1)%3][0]-center[0]);
    let da=a1-a0; while(da<0)da+=TAU; while(da>TAU)da-=TAU;
    for(let i=0;i<=n/3;i++){const a=a0+da*(i/(n/3));pts.push([center[0]+Math.cos(a)*side,center[1]+Math.sin(a)*side]);}
  }
  return pts;
}
export default makeShot('data',{
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const rot=lt*0.6;
    const zt=sat((lt-3.0)/0.6); const zoom=1+1.4*smoothstep(0,1,zt);
    ctx.setXform({scale:zoom,anchor:[CX,CY]});
    lines.begin();
    const pts=reuleaux(CX,CY,R*0.7,rot);
    for(let i=1;i<pts.length;i++) lines.seg(pts[i-1][0],pts[i-1][1],pts[i][0],pts[i][1],3,withAlpha(P.signal,0.95));
    // 卡尺（水平固定，测竖直宽度恒定）
    lines.seg(CX-300,CY-R*0.9,CX+300,CY-R*0.9,2,withAlpha(P.bone,0.6));
    lines.seg(CX-300,CY+R*0.9,CX+300,CY+R*0.9,2,withAlpha(P.bone,0.6));
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('它也行', CX, H-90, {anchor:'center',size:42,color:css(P.signal,smoothstep(2.5,3.5,lt))});
    type.writeLine('勒洛三角 · 也定宽', CX, 130, {anchor:'center',size:34,color:css(P.bone,0.85)});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return{grain:0.014,vignette:0.4};
  },
});