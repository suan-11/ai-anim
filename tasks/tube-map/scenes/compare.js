// @ts-check
/** 04 · compare —— 【答案峰①】同一组站点地理坐标连续变形到 45° 拓扑网格 + zoom 枢纽确认连接不变。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { STATIONS, LINES, LINE_COLORS, byId, pos } from './_net.js';
import { sat, smoothstep, css, hexToLinear } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
const LC = LINE_COLORS.map(hexToLinear);
export default makeShot('compare', {
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const lt=f.lt/(ctx.params?.stretch??1);
    // k 0→1 变形（0-4s），4s 后 zoom punch 枢纽
    const k = smoothstep(0.3, 4.0, lt);
    const hub = pos(byId('hub'), k, W, H);
    const zt = sat((lt-4.0)/0.6);
    const zoom = 1 + 1.2*smoothstep(0,1,zt);
    ctx.setXform({ scale: zoom, anchor: [hub[0],hub[1]] });
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    // 拓扑网格淡入
    const ga = 0.10*k;
    for(let gx=160;gx<=W-160;gx+=80) lines.seg(gx,160,gx,H-160,0.5,withAlpha(P.graphite,ga));
    for(let gy=160;gy<=H-160;gy+=80) lines.seg(160,gy,W-160,gy,0.5,withAlpha(P.graphite,ga));
    for (let li=0; li<LINES.length; li++) { const ids=LINES[li];
      for (let i=1;i<ids.length;i++){ const a=pos(byId(ids[i-1]),k,W,H), b=pos(byId(ids[i]),k,W,H); lines.seg(a[0],a[1],b[0],b[1],3.5,withAlpha(LC[li],0.9)); } }
    for (const st of STATIONS){ const p=pos(st,k,W,H); if(st.hub){lines.circle(p[0],p[1],10,3.5,withAlpha(P.bone,1));lines.circle(p[0],p[1],4,2,withAlpha(P.ink,1));} else lines.circle(p[0],p[1],5,2,withAlpha(P.bone,0.9)); }
    lines.flush(ctx.out);
    text.clear();
    if(k>0.8) type.writeLine('只留 横 · 竖 · 45°', W*0.5, H-90, {anchor:'center',size:38,color:css(P.signal,smoothstep(0.8,1,k))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:typeof zt!=='undefined'?zt:0,bloomBase:0.1});
  },
});