// @ts-check
/** 01 · hook —— 均匀柱被真实数据砸歪（重构：填充+隐喻+zoom居中）。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { BENFORD, UNIFORM, barLayout, MAX_BAR_H, BAR_SCALE } from './_data.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { shakeSmooth } from '../../../src/core/cam.js';
import { safeZoom } from '../../_shared/zoom.js';
export default makeShot('hook',{
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const k=smoothstep(1.5,2.3,lt);
    const bars=barLayout(W,H);
    const zt=sat((lt-2.3)/0.6);
    const b0=bars[0], b8=bars[8];
    const topY=b0.baseY-MAX_BAR_H*BENFORD[0]*BAR_SCALE;
    const bbox=[b0.x-b0.bw/2, topY, (b8.x+b8.bw/2)-(b0.x-b0.bw/2), b0.baseY-topY];
    const {zoom,anchor}=safeZoom(W,H,bbox,1+1.0*smoothstep(0,1,zt));
    ctx.setXform({scale:zoom,anchor});
    lines.begin();
    // 柱间淡竖纹（填充背景降空格）
    for(let x=160;x<W-160;x+=48) lines.seg(x,180,x,H-160,0.5,withAlpha(P.graphite,0.08));
    // 均匀虚线基线（直觉参考，真实柱穿过它）
    const uniY=b0.baseY-UNIFORM[0]*MAX_BAR_H*BAR_SCALE;
    for(let x=140;x<W-140;x+=20) lines.seg(x,uniY,x+10,uniY,1,withAlpha(P.graphite,0.4*(1-k*0.5)));
    // 基线
    lines.seg(140,b0.baseY,W-140,b0.baseY,1.5,withAlpha(P.graphite,0.6));
    for(let i=0;i<9;i++){
      const v=UNIFORM[i]+(BENFORD[i]-UNIFORM[i])*k;
      const h=v*MAX_BAR_H*BAR_SCALE;
      const b=bars[i];
      const col=i===0?withAlpha(P.signal,0.95):withAlpha(P.bone,0.88);
      lines.fillRect(b.x-b.bw/2,b.baseY-h,b.bw,h,col);
    }
    lines.flush(ctx.out);
    text.clear();
    // 数字标签（zoom 时淡出避免出框）
    const labelA=1-smoothstep(0,0.5,zt);
    if(labelA>0.05) for(let i=0;i<9;i++){const b=bars[i];type.writeLine(String(b.d),b.x,b.baseY+34,{anchor:'center',size:26,color:css(P.ash,0.85*labelA)});}
    if(zt>0.5){ const [shx,shy]=shakeSmooth(f.t,3); type.writeLine('？', b0.x+100, b0.baseY-MAX_BAR_H*BENFORD[0]*BAR_SCALE-50, {anchor:'center',size:88,color:css(P.signal,smoothstep(0.5,1,zt))}); }
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    const [shx,shy]=shakeSmooth(f.t,zt>0.5?3:0.8);
    return{grain:0.012,vignette:0.3,shake:[shx,shy]};
  },
});