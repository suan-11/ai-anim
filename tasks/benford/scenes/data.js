// @ts-check
/** 04 · data —— 【答案峰②】造假vs真实对照+偏差连接带+数值弹出（重构填充+亮度层级）。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { BENFORD, UNIFORM } from './_data.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
export default makeShot('data',{
  setup(){ this.cam=makeCinematic(); },
  draw(ctx){
    const{f,lines,text,type,comp,gl,W,H,P}=ctx; const lt=f.lt/(ctx.params?.stretch??1);
    const baseY=H*0.78, maxH=420, bw=30, gap=42;
    const lx=W*0.26, rx=W*0.74; // 左右中心
    const zt=sat((lt-4.0)/0.6); const zoom=1+0.35*smoothstep(0,1,zt);
    ctx.setXform({scale:zoom,anchor:[W*0.5,baseY-maxH*0.4]});
    lines.begin();
    // 基线
    lines.seg(lx-4.5*gap,baseY,lx+4.5*gap,baseY,1.5,withAlpha(P.graphite,0.5));
    lines.seg(rx-4.5*gap,baseY,rx+4.5*gap,baseY,1.5,withAlpha(P.graphite,0.5));
    // 左造假（均匀，亮度0.6）右真实（本福特，亮度0.95）
    for(let i=0;i<9;i++){
      const hu=UNIFORM[i]*maxH*2.2, hb=BENFORD[i]*maxH*2.2;
      const xu=lx-4*gap+i*gap, xb=rx-4*gap+i*gap;
      lines.fillRect(xu-bw/2,baseY-hu,bw,hu,i===0?withAlpha(P.signal,0.7):withAlpha(P.bone,0.6));
      lines.fillRect(xb-bw/2,baseY-hb,bw,hb,i===0?withAlpha(P.signal,0.95):withAlpha(P.bone,0.92));
      // 偏差连接带（左柱顶→右柱顶，1号最粗信号橙）
      const ca=i===0?withAlpha(P.signal,0.8):withAlpha(P.graphite,0.3);
      lines.seg(xu,baseY-hu,xb,baseY-hb,i===0?3:1,ca);
    }
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