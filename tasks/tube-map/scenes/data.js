// @ts-check
/** 05 · data —— 【答案峰②】拓扑图路径规划 A→B 逐站点亮 + 换乘换色 + zoom 站数计数器。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { STATIONS, LINES, LINE_COLORS, byId, pos } from './_net.js';
import { sat, smoothstep, css, hexToLinear } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
import { rhythmDrive } from '../../_shared/rhythm-drive.js';
const LC = LINE_COLORS.map(hexToLinear);
// 路径：w1(红) → c1 → hub(换乘蓝) → n1 → n2
const PATH = ['w1','c1','hub','n1','n2'];
export default makeShot('data', {
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const lt=f.lt/(ctx.params?.stretch??1);
    // 方案2接线：段横跨 residue[40,46)+residue[46,52)。
    // 入场承接 compare 峰余晖（rd.k≈0.62），路径逐站点亮在首块完成，
    // 次块缓降静置——结尾不归零。
    const rd=rhythmDrive(f);
    const k = 1; // 拓扑
    const dim=Math.max(0.55, 0.7+0.3*rd.k);          // residue 缓降亮度底
    // 逐站点亮进度：首块 u∈[0.05,0.5] 内走完（约 2.7s 起亮、5.2s 全亮）
    const prog = smoothstep(0.05, 0.5, rd.u) * (PATH.length-1);
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    // 全线网压暗
    for (let li=0; li<LINES.length; li++) { const ids=LINES[li];
      for (let i=1;i<ids.length;i++){ const a=pos(byId(ids[i-1]),k,W,H), b=pos(byId(ids[i]),k,W,H); lines.seg(a[0],a[1],b[0],b[1],2,withAlpha(LC[li],0.2*dim)); } }
    // 路径高亮（逐段）
    for (let i=1;i<PATH.length;i++){
      const segP = sat(prog-(i-1));
      if(segP<=0) continue;
      const a=pos(byId(PATH[i-1]),k,W,H), b=pos(byId(PATH[i]),k,W,H);
      const bx=a[0]+(b[0]-a[0])*segP, by=a[1]+(b[1]-a[1])*segP;
      // 换乘前红，换乘后蓝
      const col = i<=2 ? LC[0] : LC[1];
      lines.seg(a[0],a[1],bx,by,4,withAlpha(col,0.95*dim));
    }
    // 站点
    for (const st of STATIONS){ const p=pos(st,k,W,H); const onPath=PATH.includes(st.id);
      if(st.hub){lines.circle(p[0],p[1],10,3.5,withAlpha(P.bone,dim));lines.circle(p[0],p[1],4,2,withAlpha(P.ink,1));}
      else lines.circle(p[0],p[1],onPath?6:4,2,withAlpha(onPath?P.signal:P.bone,onPath?dim:0.4*dim)); }
    // 换乘枢纽脉冲（首块点亮期明显，次块衰减归静）——hub 是焦点锚点，亮环放大保持可见
    const hub=pos(byId('hub'),k,W,H); const pulse=(0.5+0.5*Math.sin(lt*4))*Math.max(0,1-smoothstep(0.55,0.8,rd.u));
    if(prog>2) lines.circle(hub[0],hub[1],16+6*pulse,3,withAlpha(P.signal,(0.5+0.3*pulse)*dim));
    lines.flush(ctx.out);
    text.clear();
    // 站数计数器（首块内递增；文字屏幕坐标不随 zoom）
    const count = Math.min(PATH.length-1, Math.floor(prog)+1);
    const zt=smoothstep(0.1,0.35,rd.u)*(1-smoothstep(0.7,0.95,rd.u)); const cz=1+0.8*zt;
    type.writeLine('A → B · 换乘 1 次', W*0.5, 130, {anchor:'center',size:36,color:css(P.bone,0.9*dim)});
    type.writeLine(String(count)+' 站', W*0.5, H-110, {anchor:'center',size:Math.round(56*cz),color:css(P.signal,dim)});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:zt,bloomBase:0.1});
  },
});