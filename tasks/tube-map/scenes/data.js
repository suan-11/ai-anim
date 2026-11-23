// @ts-check
/** 05 · data —— 【答案峰②】拓扑图路径规划 A→B 逐站点亮 + 换乘换色 + zoom 站数计数器。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { STATIONS, LINES, LINE_COLORS, byId, pos } from './_net.js';
import { sat, smoothstep, css, hexToLinear } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
const LC = LINE_COLORS.map(hexToLinear);
// 路径：w1(红) → c1 → hub(换乘蓝) → n1 → n2
const PATH = ['w1','c1','hub','n1','n2'];
export default makeShot('data', {
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const lt=f.lt/(ctx.params?.stretch??1);
    const k = 1; // 拓扑
    // 逐站点亮进度
    const prog = smoothstep(0.3, 3.5, lt) * (PATH.length-1);
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    // 全线网压暗
    for (let li=0; li<LINES.length; li++) { const ids=LINES[li];
      for (let i=1;i<ids.length;i++){ const a=pos(byId(ids[i-1]),k,W,H), b=pos(byId(ids[i]),k,W,H); lines.seg(a[0],a[1],b[0],b[1],2,withAlpha(LC[li],0.2)); } }
    // 路径高亮（逐段）
    for (let i=1;i<PATH.length;i++){
      const segP = sat(prog-(i-1));
      if(segP<=0) continue;
      const a=pos(byId(PATH[i-1]),k,W,H), b=pos(byId(PATH[i]),k,W,H);
      const bx=a[0]+(b[0]-a[0])*segP, by=a[1]+(b[1]-a[1])*segP;
      // 换乘前红，换乘后蓝
      const col = i<=2 ? LC[0] : LC[1];
      lines.seg(a[0],a[1],bx,by,4,withAlpha(col,0.95));
    }
    // 站点
    for (const st of STATIONS){ const p=pos(st,k,W,H); const onPath=PATH.includes(st.id);
      if(st.hub){lines.circle(p[0],p[1],10,3.5,withAlpha(P.bone,1));lines.circle(p[0],p[1],4,2,withAlpha(P.ink,1));}
      else lines.circle(p[0],p[1],onPath?6:4,2,withAlpha(onPath?P.signal:P.bone,onPath?1:0.4)); }
    // 换乘枢纽脉冲
    const hub=pos(byId('hub'),k,W,H); const pulse=0.5+0.5*Math.sin(lt*4);
    if(prog>2) lines.circle(hub[0],hub[1],14+4*pulse,2,withAlpha(P.signal,0.6*pulse));
    lines.flush(ctx.out);
    text.clear();
    // 站数计数器（zoom punch 放大）
    const count = Math.min(PATH.length-1, Math.floor(prog)+1);
    const zt=sat((lt-2.0)/0.5); const cz=1+0.8*smoothstep(0,1,zt);
    type.writeLine('A → B · 换乘 1 次', W*0.5, 130, {anchor:'center',size:36,color:css(P.bone,0.9)});
    type.writeLine(String(count)+' 站', W*0.5, H-110, {anchor:'center',size:Math.round(56*cz),color:css(P.signal,1)});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:typeof zt!=='undefined'?zt:0,bloomBase:0.1});
  },
});