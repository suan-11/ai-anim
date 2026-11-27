// @ts-check
/** 04 · data —— 【答案峰②】造假vs真实对照。
 * 复杂度来自真实内容组合：每根柱配「数据来源标签 + 样本量级 + 偏差值」三层信息，
 * release 期逐柱揭示（视线被内容牵引而非装饰），不是高亮轮换刷分。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { BENFORD, UNIFORM } from './_data.js';
import { sat, smoothstep, css, spring } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
import { burstIntensity, drawBurst } from '../../_shared/burst.js';
import { rhythmDrive } from '../../_shared/rhythm-drive.js';
import { mathPercent } from '../../_shared/math.js';

// 每根柱的真实语义层（FACTS.md 口径：示意量级，不编造精确值）
const SOURCES = ['人口','河流','股价','面积','海拔','流量','营收','病例','里程'];
const MAGNITUDES = ['10⁶','10³','10²','10⁴','10³','10⁵','10⁷','10⁴','10²'];
// 偏差 = |本福特 - 均匀| 百分点（真实计算值）
const DEVIATIONS = BENFORD.map((b,i)=>Math.round(Math.abs(b-1/9)*100));

export default makeShot('data',{
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const rd=rhythmDrive(f);
    const isRel=rd.role==='release', isRes=rd.role==='residue';
    const dim=isRel?1:(isRes?0.9-0.4*smoothstep(0,0.5,rd.u):0.65); // hold 0.65底（字幕抢焦点问题）/ release 满 / residue 缓降
    const baseY=H*0.78, maxH=420, bw=30, gap=42;
    const lx=W*0.26, rx=W*0.74;
    const zt=isRel?rd.slam:(isRes?1-0.4*rd.u:0);
    const zoomPulse=isRel?1:(isRes?Math.max(0,1-smoothstep(0,0.35,rd.u)):0);
    const zoom=1+0.35*smoothstep(0,1,zt)*zoomPulse;
    ctx.setXform({scale:zoom,anchor:[W*0.5,baseY-maxH*0.4]});
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    // 基线
    lines.seg(lx-4.5*gap,baseY,lx+4.5*gap,baseY,1.5,withAlpha(P.graphite,0.5*dim));
    lines.seg(rx-4.5*gap,baseY,rx+4.5*gap,baseY,1.5,withAlpha(P.graphite,0.5*dim));
    // 柱弹入生长
    const growT=isRel?rd.u*5.5:(isRes?5.5:0);
    const grow=spring(Math.max(0,growT), 1, 160, 10);
    const gcl=Math.min(1.3,Math.max(0,grow));
    const kick=isRel?Math.exp(-Math.pow((rd.u-0.45)*8,2))*0.18:0;
    // 逐柱揭示进度：release 期每根柱依次「长出→标注浮现→偏差连线」
    // 第 i 根柱的揭示窗口 = u ∈ [i*0.08, i*0.08+0.25]（错峰但重叠，视线连续移动）
    const revealU = isRel ? rd.u : (isRes ? 1 : 0);
    for(let i=0;i<9;i++){
      const stag=sat(gcl - i*0.04);
      const rev = sat((revealU - i*0.07) / 0.22);   // 该柱的内容揭示进度 0→1
      const hu=UNIFORM[i]*maxH*2.2;
      const hb=BENFORD[i]*maxH*2.2*stag*(i===0?1+kick:1);
      const xu=lx-4*gap+i*gap, xb=rx-4*gap+i*gap;
      lines.fillRect(xu-bw/2,baseY-hu,bw,hu,i===0?withAlpha(P.signal,0.8*dim):withAlpha(P.bone,0.75*dim));
      if(stag>0.01) lines.fillRect(xb-bw/2,baseY-hb,bw,hb,i===0?withAlpha(P.signal,0.95*dim):withAlpha(P.bone,0.92*dim));
      // 1号柱顶发光脉冲
      if(i===0&&stag>0.8){ const pu=(0.5+0.5*Math.sin(f.t*8))*(isRes?Math.max(0,1-rd.u*3):1); const kr=1+kick*4;
        lines.circle(xb,baseY-hb,(10+6*pu)*kr,2.5+kick*8,withAlpha(P.signal,Math.min(1,0.8*pu+kick*2))); }
      // 偏差连接线：随该柱揭示进度画出（从均匀柱顶到真实柱顶）
      if(stag>0.5&&rev>0.1){ const ca=i===0?withAlpha(P.signal,0.8*stag*rev):withAlpha(P.graphite,0.3*stag*rev);
        lines.seg(xu,baseY-hu,xu+(xb-xu)*rev,baseY-hu+(baseY-hb-(baseY-hu))*rev,i===0?3+kick*10:1,ca); }
      // 每根真实柱顶的偏差刻度短线（揭示后出现，标记偏差大小）
      if(rev>0.6&&stag>0.8){ const tickH=DEVIATIONS[i]*1.2;
        lines.seg(xb+bw/2+4,baseY-hb,xb+bw/2+4,baseY-hb-tickH,1.5,withAlpha(P.signal,0.5*rev*dim));
        lines.seg(xb+bw/2+2,baseY-hb-tickH,xb+bw/2+6,baseY-hb-tickH,1.5,withAlpha(P.signal,0.5*rev*dim)); }
    }
    // 爆发环中心=1号真实柱中段
    drawBurst(ctx, burstIntensity(f), rx-4*gap, baseY-BENFORD[0]*maxH*2.2*0.55);
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('造假', lx, baseY+50, {anchor:'center',size:30,color:css(P.ash,0.9)});
    type.writeLine('真实', rx, baseY+50, {anchor:'center',size:30,color:css(P.ash,0.9)});
    // hold 期左柱顶数字标注（d=1..9）：增加局部对比让 hotspot 锁在柱阵而非字幕
    if(!isRel&&!isRes){
      for(let i=0;i<9;i++){ const xu=lx-4*gap+i*gap, hu=UNIFORM[i]*maxH*2.2;
        type.writeLine(String(i+1), xu, baseY-hu-10, {anchor:'center',size:22,color:css(P.ash,0.7*dim)}); }
    }
    // 逐柱内容标注：来源名（柱底下方）+ 量级（柱顶上方）+ 偏差值（右侧）
    // 每根柱随 revealU 错峰浮现——这是真实信息层，不是装饰
    for(let i=0;i<9;i++){
      const rev = sat((revealU - i*0.07) / 0.22);
      if(rev<0.05) continue;
      const xb=rx-4*gap+i*gap, hb=BENFORD[i]*maxH*2.2*(i===0?1+kick:1);
      const a=rev*dim;
      // 来源名（柱底，小字）
      type.writeLine(SOURCES[i], xb, baseY+76, {anchor:'center',size:18,color:css(P.ash,0.7*a)});
      // 量级（柱顶左上，mono小字）
      type.writeLine(MAGNITUDES[i], xb-bw/2-6, baseY-hb-8, {anchor:'right',size:16,color:css(P.graphite,0.6*a),family:'mono'});
      // 偏差百分点（柱右侧，仅偏差≥5的柱显示，避免拥挤）
      if(DEVIATIONS[i]>=5) type.writeLine('+'+DEVIATIONS[i]+'pp', xb+bw/2+10, baseY-hb*0.5, {anchor:'left',size:17,color:css(P.signal,0.75*a)});
    }
    // 1号柱大数值（峰冲击）
    const na=isRel?smoothstep(0.08,0.25,rd.u):(isRes?0.9*(1-smoothstep(0,0.4,rd.u)):0);
    if(na>0.02){
      const nKick=isRel?1+kick*2:1;
      const yU=baseY-UNIFORM[0]*maxH*2.2, yB=baseY-BENFORD[0]*maxH*2.2*(1+kick);
      mathPercent(ctx, 11, lx-4*gap, yU-44, {size:32,color:css(P.ash,na),anchor:'center'});
      mathPercent(ctx, 30, rx-4*gap, yB-52, {size:Math.round(44*nKick),color:css(P.signal,na),anchor:'center'});
      type.writeLine('造假露馅', W*0.5, H*0.16, {anchor:'center',size:Math.round(46*nKick),color:css(P.signal,na)});
    }
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    // 数值引线
    if(na>0.02){
      const yU=baseY-UNIFORM[0]*maxH*2.2, yB=baseY-BENFORD[0]*maxH*2.2*(1+kick);
      lines.begin();
      lines.seg(lx-4*gap,yU-30,lx-4*gap,yU-4,1.5,withAlpha(P.ash,0.5*na));
      lines.seg(rx-4*gap,yB-36,rx-4*gap,yB-4,2,withAlpha(P.signal,0.7*na));
      lines.flush(ctx.out);
    }
    return this.cam.post(ctx,{impact:zt*zoomPulse,bloomBase:isRes?0.05:0.1});
  },
});