// @ts-check
/** 04 · data —— 【答案峰②】造假vs真实对照+偏差连接带+数值弹出（重构填充+亮度层级）。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { BENFORD, UNIFORM } from './_data.js';
import { sat, smoothstep, css, spring } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
import { burstIntensity, drawBurst } from '../../_shared/burst.js';
export default makeShot('data',{
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const baseY=H*0.78, maxH=420, bw=30, gap=42;
    const lx=W*0.26, rx=W*0.74; // 左右中心
    const zt=sat((lt-4.0)/0.6); const zoom=1+0.35*smoothstep(0,1,zt);
    ctx.setXform({scale:zoom,anchor:[W*0.5,baseY-maxH*0.4]});
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    // 基线
    lines.seg(lx-4.5*gap,baseY,lx+4.5*gap,baseY,1.5,withAlpha(P.graphite,0.5));
    lines.seg(rx-4.5*gap,baseY,rx+4.5*gap,baseY,1.5,withAlpha(P.graphite,0.5));
    // 柱弹入生长（release 驱动，spring 回弹 → 集中+剧变显著性）
    const grow=spring(Math.max(0,lt-0.3), 1, 120, 14); // 0→1 弹入过冲
    const gcl=Math.min(1.15,Math.max(0,grow));
    for(let i=0;i<9;i++){
      const stag=sat(gcl - i*0.04); // 逐柱错峰
      const hu=UNIFORM[i]*maxH*2.2*stag, hb=BENFORD[i]*maxH*2.2*stag;
      const xu=lx-4*gap+i*gap, xb=rx-4*gap+i*gap;
      lines.fillRect(xu-bw/2,baseY-hu,bw,hu,i===0?withAlpha(P.signal,0.7):withAlpha(P.bone,0.6));
      lines.fillRect(xb-bw/2,baseY-hb,bw,hb,i===0?withAlpha(P.signal,0.95):withAlpha(P.bone,0.92));
      // 1号真实柱顶发光脉冲（release 峰）
      if(i===0&&stag>0.8){ const pu=0.5+0.5*Math.sin(f.t*8); lines.circle(xb,baseY-hb,10+6*pu,2.5,withAlpha(P.signal,0.8*pu)); }
      const ca=i===0?withAlpha(P.signal,0.8):withAlpha(P.graphite,0.3);
      lines.seg(xu,baseY-hu,xb,baseY-hb,i===0?3:1,ca);
    }
    drawBurst(ctx, burstIntensity(f), W*0.5, H*0.5);
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('造假', lx, baseY+50, {anchor:'center',size:30,color:css(P.ash,0.9)});
    type.writeLine('真实', rx, baseY+50, {anchor:'center',size:30,color:css(P.ash,0.9)});
    // 数值弹出（1号柱偏差）
    if(lt>3.5){ const na=smoothstep(3.5,4.5,lt);
      type.writeLine('11%', lx-4*gap, baseY-UNIFORM[0]*maxH*2.2-30, {anchor:'center',size:32,color:css(P.ash,na)});
      type.writeLine('30%', rx-4*gap, baseY-BENFORD[0]*maxH*2.2-30, {anchor:'center',size:40,color:css(P.signal,na)});
    }
    if(lt>4) type.writeLine('造假露馅', W*0.5, H*0.16, {anchor:'center',size:42,color:css(P.signal,smoothstep(4,5,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:typeof zt!=='undefined'?zt:0,bloomBase:0.1});
  },
});