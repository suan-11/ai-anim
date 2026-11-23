// @ts-check
/** 03 · mechanism —— 把站点摆回真实地理坐标，线网歪扭（铺垫「需要新画法」但不揭示拓扑）。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { STATIONS, LINES, LINE_COLORS, byId, pos } from './_net.js';
import { sat, smoothstep, css, hexToLinear } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
const LC = LINE_COLORS.map(hexToLinear);
export default makeShot('mechanism', {
  setup(){ this.cam=makeCinematic(); },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const lt=f.lt/(ctx.params?.stretch??1);
    // k 从 1(规整拓扑) → 0(地理真实)，暴露问题
    const k = 1 - smoothstep(0.5, 4.0, lt);
    lines.begin();
    // 淡坐标网格
    for(let gx=160;gx<=W-160;gx+=80) lines.seg(gx,160,gx,H-160,0.5,withAlpha(P.graphite,0.12));
    for(let gy=160;gy<=H-160;gy+=80) lines.seg(160,gy,W-160,gy,0.5,withAlpha(P.graphite,0.12));
    for (let li=0; li<LINES.length; li++) { const ids=LINES[li];
      for (let i=1;i<ids.length;i++){ const a=pos(byId(ids[i-1]),k,W,H), b=pos(byId(ids[i]),k,W,H); lines.seg(a[0],a[1],b[0],b[1],3,withAlpha(LC[li],0.85)); } }
    for (const st of STATIONS){ const p=pos(st,k,W,H); if(st.hub){lines.circle(p[0],p[1],9,3,withAlpha(P.bone,0.95));lines.circle(p[0],p[1],4,2,withAlpha(P.ink,1));} else lines.circle(p[0],p[1],5,2,withAlpha(P.bone,0.9)); }
    // 点亮红线顺序闪烁
    const pulse = 0.5+0.5*Math.sin(lt*3);
    const ids=LINES[0]; for(let i=1;i<ids.length;i++){ const a=pos(byId(ids[i-1]),k,W,H),b=pos(byId(ids[i]),k,W,H); lines.seg(a[0],a[1],b[0],b[1],1.5,withAlpha(P.signal,0.3*pulse)); }
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('按真实距离画', W-160, H-90, {anchor:'right',size:32,color:css(P.ash,0.7)});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:typeof zt!=='undefined'?zt:0,bloomBase:0.1});
  },
});