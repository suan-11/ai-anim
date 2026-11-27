// @ts-check
/** 01 · hook —— 均匀柱被真实数据砸歪 + 数据流粒子 + 冲击闪光（提复杂度/注意力）。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { BENFORD, UNIFORM, barLayout, MAX_BAR_H, BAR_SCALE } from './_data.js';
import { sat, smoothstep, css, rng } from '../../../src/core/util.js';
import { safeZoom } from '../../_shared/zoom.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
import { rhythmDrive } from '../../_shared/rhythm-drive.js';
import { mathPercent } from '../../_shared/math.js';
export default makeShot('hook',{
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45);
    // 预计算数据流粒子（确定性）：每柱若干粒子从顶落入
    const r=rng(7); this.parts=[];
    for(let i=0;i<9;i++) for(let j=0;j<5;j++) this.parts.push({bar:i, phase:r(), speed:0.6+r()*0.8, xoff:(r()-0.5)*0.6});
  },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    // 方案2·bit深谷档：砸下时刻由节奏块驱动（hook 跨 pressure[0,3)+hold[3,9.5)，
    // hold 块首 slam=砸下瞬间，峰谷天然对齐块边界 3s）。
    // pressure[0,3) 同时是钩子窗：粒子流+柱体保持中位可见（hook目标0.45→0.60），
    // 砸下后 hold 余段降对比静置（谷深）。
    const rd=rhythmDrive(f);
    const inHold=rd.role==='hold';
    // 砸下形变：hold 块首 0.6s 内完成（slam 包络 hold 恒 0，这里用块内时间自算）
    const k=inHold?smoothstep(0,0.09,rd.u):0;      // 均匀→真实 形变进度（u≈0.09≈0.6s）
    const settled=inHold?smoothstep(0.35,0.7,rd.u):0; // 砸下后进入静置
    const dim=1-0.30*settled;                      // hold 余段降对比（0.7底，不能压太狠否则字幕抢焦点）
    // 钩子窗[0,3)内部要有起伏（hook change≥0.08）：0-1s 柱体从暗处升起（低→高），
    // 1-2s 粒子流最密（峰），2-3s 稍收（谷）——砸下前留一个呼吸
    const hookU=inHold?1:sat(f.t/3);
    const hookRise=inHold?1:smoothstep(0,0.35,hookU);          // 0→1s 升起
    const hookDip=inHold?0:0.25*smoothstep(0.65,0.95,hookU);   // 2→3s 微收
    const hookDim=(0.55+0.45*hookRise)*(1-hookDip);
    const bars=barLayout(W,H);
    const zt=inHold?sat(rd.u/0.35):0;              // hold 前 35% 推近
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
    // 数据流粒子（钩子窗内 1-2s 最密=峰，pressure 末微收；hold 砸下后淡出）
    const partA=inHold?(1-smoothstep(0,0.3,rd.u)):smoothstep(0.15,0.5,hookU)*(1-0.5*smoothstep(0.7,1,hookU));
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
      const col=i===0?withAlpha(P.signal,0.95*dim*hookDim):withAlpha(P.bone,0.88*dim*hookDim);
      lines.fillRect(b.x-b.bw/2,b.baseY-h,b.bw,h,col);
      // 1号柱顶发光脉冲（砸下后短暂，静置期熄灭）
      if(i===0&&k>0.5){ const pulse=(0.5+0.5*Math.sin(f.t*6))*(1-settled); lines.circle(b.x,b.baseY-h,8+4*pulse,2,withAlpha(P.signal,0.6*k*pulse)); }
    }
    // 砸下冲击闪光环（hold 块首形变瞬间 → 显著性峰对齐 3s 边界）
    const impact=inHold?smoothstep(0,0.09,rd.u)*(1-smoothstep(0.15,0.45,rd.u)):0;
    if(impact>0.02){ const R=60+impact*200; lines.circle(b0.x,b0.baseY-MAX_BAR_H*BENFORD[0]*BAR_SCALE*0.5,R,3,withAlpha(P.signal,impact*0.8)); }
    lines.flush(ctx.out);
    text.clear();
    const labelA=1-smoothstep(0,0.5,zt);
    if(labelA>0.05) for(let i=0;i<9;i++){const b=bars[i];type.writeLine(String(b.d),b.x,b.baseY+34,{anchor:'center',size:26,color:css(P.ash,0.85*labelA)});}
    // 1号柱百分比数值弹出（静置期降淡）——真排版 % 小一号贴右上
    // y=topY-10：zoom=2 时屏幕 y≈120 > 字幕带下沿 104，不被挡
    if(k>0.6) mathPercent(ctx, 30, b0.x, topY-10, {size:40,color:css(P.signal,smoothstep(0.6,1,k)*dim),anchor:'center'});
    if(zt>0.5) type.writeLine('？', b0.x+120, topY+20, {anchor:'center',size:88,color:css(P.signal,smoothstep(0.5,1,zt)*(1-0.6*settled))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:Math.max(zt*0.6,impact),bloomBase:0.12});
  },
});