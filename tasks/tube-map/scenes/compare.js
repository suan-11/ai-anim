// @ts-check
/** 04 · compare —— 【答案峰①】同一组站点地理坐标连续变形到 45° 拓扑网格 + zoom 枢纽确认连接不变。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { STATIONS, LINES, LINE_COLORS, byId, pos } from './_net.js';
import { sat, smoothstep, css, hexToLinear } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
import { rhythmDrive } from '../../_shared/rhythm-drive.js';
const LC = LINE_COLORS.map(hexToLinear);
export default makeShot('compare', {
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const lt=f.lt/(ctx.params?.stretch??1);
    // 方案2接线：段横跨 release[28,34)+hold[34,40)。
    // release 块首 slam=变形启动（峰对齐 28s），k 在 release 前 60% 完成拓扑化；
    // hold 段规整网格静置展示。
    const rd=rhythmDrive(f);
    const isRel=rd.role==='release';
    const k=isRel?smoothstep(0,0.6,rd.u):1;
    const dim=isRel?(0.7+0.3*rd.slam):(0.6-0.12*rd.u);
    const hub = pos(byId('hub'), k, W, H);
    const zt=isRel?rd.slam:0;
    const zoom = 1 + 1.2*smoothstep(0,1,zt)*smoothstep(0.55,0.85,rd.u||0);
    ctx.setXform({ scale: zoom, anchor: [hub[0],hub[1]] });
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    // 拓扑网格淡入
    const ga = 0.10*k*dim;
    for(let gx=160;gx<=W-160;gx+=80) lines.seg(gx,160,gx,H-160,0.5,withAlpha(P.graphite,ga));
    for(let gy=160;gy<=H-160;gy+=80) lines.seg(160,gy,W-160,gy,0.5,withAlpha(P.graphite,ga));
    for (let li=0; li<LINES.length; li++) { const ids=LINES[li];
      for (let i=1;i<ids.length;i++){ const a=pos(byId(ids[i-1]),k,W,H), b=pos(byId(ids[i]),k,W,H); lines.seg(a[0],a[1],b[0],b[1],3.5,withAlpha(LC[li],0.9*dim)); } }
    for (const st of STATIONS){ const p=pos(st,k,W,H); if(st.hub){lines.circle(p[0],p[1],10,3.5,withAlpha(P.bone,dim));lines.circle(p[0],p[1],4,2,withAlpha(P.ink,1));} else lines.circle(p[0],p[1],5,2,withAlpha(P.bone,0.9*dim)); }
    // release 峰：枢纽换乘高亮（视线锚定 hub，与全片主体一致）
    if(isRel&&rd.slam>0.3){ const ha=smoothstep(0.3,0.6,rd.slam)*dim;
      lines.circle(hub[0],hub[1],18+4*Math.sin(f.t*5),2.5,withAlpha(P.signal,ha)); }
    lines.flush(ctx.out);
    text.clear();
    if(k>0.8) type.writeLine('只留 横 · 竖 · 45°', W*0.5, H-90, {anchor:'center',size:38,color:css(P.signal,smoothstep(0.8,1,k)*dim)});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:zt,bloomBase:0.1});
  },
});