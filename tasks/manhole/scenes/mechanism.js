// @ts-check
/** 03 · mechanism —— 【答案峰①】旋转卡尺测圆各方向宽度恒定 + zoom 读数。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css, TAU } from '../../../src/core/util.js';
const CX=960,CY=520,R=200;
export default makeShot('mechanism',{
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt;
    const ang=lt*0.8; // 卡尺旋转角
    const zt=sat((lt-5.0)/0.6); const zoom=1+1.4*smoothstep(0,1,zt);
    ctx.setXform({scale:zoom,anchor:[CX,CY]});
    lines.begin();
    // 圆
    lines.circle(CX,CY,R,3,withAlpha(P.bone,0.95));
    // 旋转卡尺（两条平行切线，间距=直径）
    const cs=Math.cos(ang),sn=Math.sin(ang);
    const nx=-sn,ny=cs; // 法向
    for(const s of [-1,1]){
      const px=CX+nx*R*s, py=CY+ny*R*s;
      const tx=-ny,ty=nx; // 切向
      lines.seg(px-tx*260,py-ty*260,px+tx*260,py+ty*260,2,withAlpha(P.signal,0.8));
    }
    // 宽度连线（直径）
    lines.seg(CX-nx*R,CY-ny*R,CX+nx*R,CY+ny*R,2,withAlpha(P.signal,0.6));
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('宽度 = 直径 · 恒定', CX, CY-R-60, {anchor:'center',size:36,color:css(P.signal,0.9)});
    if(lt>4.5) type.writeLine('定宽图形', CX, H-90, {anchor:'center',size:38,color:css(P.bone,smoothstep(4.5,5.5,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return{grain:0.014,vignette:0.4};
  },
});
