// @ts-check
/** 02 · bridge —— zoom out 回全景，再 punch 到郊区被拉长的稀疏段（困惑加深仍不答）。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { STATIONS, LINES, LINE_COLORS, byId, pos } from './_net.js';
import { sat, smoothstep, css, hexToLinear } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
const LC = LINE_COLORS.map(hexToLinear);
export default makeShot('bridge', {
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const lt=f.lt/(ctx.params?.stretch??1);
    // 0-1s 从放大态 zoom out 回全景；1.5s 起 punch 到东郊 e1/e2
    let zoom, anchor;
    const e1 = pos(byId('e1'), 0, W, H), e2 = pos(byId('e2'), 0, W, H);
    const ex = (e1[0]+e2[0])/2, ey = (e1[1]+e2[1])/2;
    if (lt < 1.0) { zoom = 3 - 2*smoothstep(0,1,lt/1.0); anchor = [W/2,H/2]; }
    else { const zt = sat((lt-1.5)/0.6); zoom = 1 + 1.5*smoothstep(0,1,zt); anchor = [ex,ey]; }
    ctx.setXform({ scale: zoom, anchor });
    lines.begin();
    for (let li=0; li<LINES.length; li++) { const ids=LINES[li];
      for (let i=1;i<ids.length;i++){ const a=pos(byId(ids[i-1]),0,W,H), b=pos(byId(ids[i]),0,W,H); lines.seg(a[0],a[1],b[0],b[1],3,withAlpha(LC[li],0.85)); } }
    for (const st of STATIONS){ const p=pos(st,0,W,H); if(st.hub){lines.circle(p[0],p[1],9,3,withAlpha(P.bone,0.95));lines.circle(p[0],p[1],4,2,withAlpha(P.ink,1));} else lines.circle(p[0],p[1],5,2,withAlpha(P.bone,0.9)); }
    // 框出郊区 e1/e2 长段
    if (lt>1.8){ const ba=smoothstep(1.8,2.4,lt); lines.rect(Math.min(e1[0],e2[0])-30,Math.min(e1[1],e2[1])-30,Math.abs(e2[0]-e1[0])+60,Math.abs(e2[1]-e1[1])+60,2.5,withAlpha(P.signal,ba)); }
    lines.flush(ctx.out);
    text.clear();
    if(lt>2.0) type.writeLine('这里却这么空', W*0.5, H-100, {anchor:'center',size:40,color:css(P.ash,smoothstep(2.0,2.6,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:typeof zt!=='undefined'?zt:0,bloomBase:0.1});
  },
});