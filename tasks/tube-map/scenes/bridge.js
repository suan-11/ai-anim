// @ts-check
/** 02 · bridge —— zoom out 回全景，再 punch 到郊区被拉长的稀疏段（困惑加深仍不答）。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { STATIONS, LINES, LINE_COLORS, byId, pos } from './_net.js';
import { sat, smoothstep, css, hexToLinear } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
import { rhythmDrive } from '../../_shared/rhythm-drive.js';
const LC = LINE_COLORS.map(hexToLinear);
export default makeShot('bridge', {
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const lt=f.lt/(ctx.params?.stretch??1);
    // 方案2接线：段横跨 pressure[8,13)+hold[13,17.5)。
    // hold 块首（13s）= punch 到东郊瞬间（峰谷对齐块边界）；pressure 段缓收蓄力。
    const rd=rhythmDrive(f);
    const inHold=rd.role==='hold';
    const zt=inHold?smoothstep(0,0.12,rd.u):0;      // hold 块首 0.6s 推近
    const settled=inHold?smoothstep(0.4,0.75,rd.u):0;
    const dim=1-0.28*settled;                        // hold 余段静置降对比
    let zoom, anchor;
    const e1 = pos(byId('e1'), 0, W, H), e2 = pos(byId('e2'), 0, W, H);
    const ex = (e1[0]+e2[0])/2, ey = (e1[1]+e2[1])/2;
    if (!inHold) { zoom = 1 + 0.25*(1-rd.k); anchor = [W/2,H/2]; }   // pressure：从中位缓收（下蹲）
    else { zoom = 1 + 1.5*smoothstep(0,1,zt); anchor = [ex,ey]; }
    ctx.setXform({ scale: zoom, anchor });
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    for (let li=0; li<LINES.length; li++) { const ids=LINES[li];
      for (let i=1;i<ids.length;i++){ const a=pos(byId(ids[i-1]),0,W,H), b=pos(byId(ids[i]),0,W,H); lines.seg(a[0],a[1],b[0],b[1],3,withAlpha(LC[li],0.85*dim)); } }
    for (const st of STATIONS){ const p=pos(st,0,W,H); if(st.hub){lines.circle(p[0],p[1],9,3,withAlpha(P.bone,0.95*dim));lines.circle(p[0],p[1],4,2,withAlpha(P.ink,1));} else lines.circle(p[0],p[1],5,2,withAlpha(P.bone,0.9*dim)); }
    // 框出郊区 e1/e2 长段（hold 块首随推近浮现）+ 圈外压暗（焦点集中到东郊稀疏段）
    if (inHold && rd.u > 0.15){ const ba=smoothstep(0.15,0.35,rd.u);
      lines.rect(Math.min(e1[0],e2[0])-30,Math.min(e1[1],e2[1])-30,Math.abs(e2[0]-e1[0])+60,Math.abs(e2[1]-e1[1])+60,2.5,withAlpha(P.signal,ba));
      for (let li=0; li<LINES.length; li++) { const ids=LINES[li];
        for (let i=1;i<ids.length;i++){ const a=pos(byId(ids[i-1]),0,W,H), b=pos(byId(ids[i]),0,W,H);
          if (Math.hypot((a[0]+b[0])/2-ex,(a[1]+b[1])/2-ey) > 300) lines.seg(a[0],a[1],b[0],b[1],3.5,withAlpha(P.ink,0.5*ba)); } }
      for (const st of STATIONS){ const p=pos(st,0,W,H);
        if (Math.hypot(p[0]-ex,p[1]-ey) > 280) lines.circle(p[0],p[1],5.5,3,withAlpha(P.ink,0.5*ba)); }
    }
    lines.flush(ctx.out);
    text.clear();
    if(inHold&&rd.u>0.2) type.writeLine('这里却这么空', W*0.5, H-100, {anchor:'center',size:40,color:css(P.ash,smoothstep(0.2,0.4,rd.u)*dim)});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:zt,bloomBase:0.1});
  },
});