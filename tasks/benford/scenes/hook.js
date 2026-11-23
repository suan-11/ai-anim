// @ts-check
/** 01 · hook —— 均匀柱被真实数据砸歪 + 数据流粒子 + 冲击闪光（提复杂度/注意力）。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { BENFORD, UNIFORM, barLayout, MAX_BAR_H, BAR_SCALE } from './_data.js';
import { sat, smoothstep, css, rng } from '../../../src/core/util.js';
import { safeZoom } from '../../_shared/zoom.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
export default makeShot('hook',{
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45);
    // 预计算数据流粒子（确定性）：每柱若干粒子从顶落入
    const r=rng(7); this.parts=[];
    for(let i=0;i<9;i++) for(let j=0;j<5;j++) this.parts.push({bar:i, phase:r(), speed:0.6+r()*0.8, xoff:(r()-0.5)*0.6});
  },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const k=smoothstep(1.5,2.3,lt);
    const bars=barLayout(W,H);
    const zt=sat((lt-2.3)/0.6);
    const b0=bars[0], b8=bars[8];
    const topY=b0.baseY-MAX_BAR_H*BENFORD[0]*BAR_SCALE;
    const bbox=[b0.x-b0.bw/2, topY-60, (b8.x+b8.bw/2)-(b0.x-b0.bw/2), b0.baseY-topY+60];
    const {zoom,anchor}=safeZoom(W,H,bbox,1+1.0*smoothstep(0,1,zt));
    const cx=this.cam.xform(ctx,W,H,zt);
    ctx.setXform({scale:zoom*cx.scale,anchor,rot:cx.rot,p:cx.p,q:cx.q,x:cx.x,y:cx.y});
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    for(let x=160;x<W-160;x+=48) lines.seg(x,180,x,H-160,0.5,withAlpha(P.graphite,0.08));
    const uniY=b0.baseY-UNIFORM[0]*MAX_BAR_H*BAR_SCALE;
    for(let x=140;x<W-140;x+=20) lines.seg(x,uniY,x+10,uniY,1,withAlpha(P.graphite,0.4*(1-k*0.5)));
    lines.seg(140,b0.baseY,W-140,b0.baseY,1.5,withAlpha(P.graphite,0.6));
    // 数据流粒子（从顶落入柱，多锚点+热点移动 → 提复杂度）
    const partA=smoothstep(0.3,1.0,lt)*(1-smoothstep(2.8,3.5,lt));
    if(partA>0.02){
      for(const p of this.parts){
        const b=bars[p.bar];
        const cycle=(lt*p.speed+p.phase)%1;
        const py=180+cycle*(b.baseY-180);
        const px=b.x+p.xoff*b.bw;
        const col=p.bar===0?withAlpha(P.signal,0.7*partA):withAlpha(P.ash,0.5*partA);
        lines.circle(px,py,2.5,1.5,col);
      }
    }
    // 柱体
    for(let i=0;i<9;i++){
      const v=UNIFORM[i]+(BENFORD[i]-UNIFORM[i])*k;
      const h=v*MAX_BAR_H*BAR_SCALE;
      const b=bars[i];
      const col=i===0?withAlpha(P.signal,0.95):withAlpha(P.bone,0.88);
      lines.fillRect(b.x-b.bw/2,b.baseY-h,b.bw,h,col);
      // 1号柱顶发光脉冲（砸下后）
      if(i===0&&k>0.5){ const pulse=0.5+0.5*Math.sin(f.t*6); lines.circle(b.x,b.baseY-h,8+4*pulse,2,withAlpha(P.signal,0.6*k*pulse)); }
    }
    // 砸下冲击闪光环（k 跨越时显著性突变 → 提注意力钩子起伏）
    const impact=smoothstep(1.5,1.7,lt)*(1-smoothstep(1.9,2.4,lt));
    if(impact>0.02){ const R=60+impact*200; lines.circle(b0.x,b0.baseY-MAX_BAR_H*BENFORD[0]*BAR_SCALE*0.5,R,3,withAlpha(P.signal,impact*0.8)); }
    lines.flush(ctx.out);
    text.clear();
    const labelA=1-smoothstep(0,0.5,zt);
    if(labelA>0.05) for(let i=0;i<9;i++){const b=bars[i];type.writeLine(String(b.d),b.x,b.baseY+34,{anchor:'center',size:26,color:css(P.ash,0.85*labelA)});}
    // 1号柱百分比数值弹出
    if(k>0.6) type.writeLine('30%', b0.x, topY-30, {anchor:'center',size:40,color:css(P.signal,smoothstep(0.6,1,k))});
    if(zt>0.5) type.writeLine('？', b0.x+120, topY+20, {anchor:'center',size:88,color:css(P.signal,smoothstep(0.5,1,zt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:Math.max(zt,impact),bloomBase:0.12});
  },
});