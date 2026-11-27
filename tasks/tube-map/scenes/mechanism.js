// @ts-check
/** 03 · mechanism —— 把站点摆回真实地理坐标，线网歪扭（铺垫「需要新画法」但不揭示拓扑）。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { STATIONS, LINES, LINE_COLORS, byId, pos } from './_net.js';
import { sat, smoothstep, css, hexToLinear } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
import { rhythmDrive } from '../../_shared/rhythm-drive.js';
const LC = LINE_COLORS.map(hexToLinear);
export default makeShot('mechanism', {
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const lt=f.lt/(ctx.params?.stretch??1);
    // 方案2接线：段横跨 release[17.5,23)+hold[23,28)。
    // release 块首 slam=变形启动（峰对齐 17.5s 边界），k 在 release 窗内完成；
    // hold 段歪扭线网静置展示（下蹲）。
    const rd=rhythmDrive(f);
    const isRel=rd.role==='release';
    const k=isRel?smoothstep(0,0.55,rd.u):1;         // 拓扑→地理 连续变形（release 前 55%）
    const dim=isRel?(0.7+0.3*rd.slam):(0.62-0.15*rd.u); // release 满亮，hold 缓收
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    // 淡坐标网格
    for(let gx=160;gx<=W-160;gx+=80) lines.seg(gx,160,gx,H-160,0.5,withAlpha(P.graphite,0.12*dim));
    for(let gy=160;gy<=H-160;gy+=80) lines.seg(160,gy,W-160,gy,0.5,withAlpha(P.graphite,0.12*dim));
    for (let li=0; li<LINES.length; li++) { const ids=LINES[li];
      for (let i=1;i<ids.length;i++){ const a=pos(byId(ids[i-1]),k,W,H), b=pos(byId(ids[i]),k,W,H); lines.seg(a[0],a[1],b[0],b[1],3,withAlpha(LC[li],0.85*dim)); } }
    for (const st of STATIONS){ const p=pos(st,k,W,H); if(st.hub){lines.circle(p[0],p[1],9,3,withAlpha(P.bone,0.95*dim));lines.circle(p[0],p[1],4,2,withAlpha(P.ink,1));} else lines.circle(p[0],p[1],5,2,withAlpha(P.bone,0.9*dim)); }
    // 点亮红线顺序闪烁（release 期峰值脉冲）——集中市中心密团（hotspot 锁 hub，与全片主体一致）
    const pulse = 0.5+0.5*Math.sin(lt*3);
    const hubP=pos(byId('hub'),k,W,H);
    const ids=LINES[0]; for(let i=1;i<ids.length;i++){ const a=pos(byId(ids[i-1]),k,W,H),b=pos(byId(ids[i]),k,W,H);
      if (Math.hypot((a[0]+b[0])/2-hubP[0],(a[1]+b[1])/2-hubP[1]) < 260) lines.seg(a[0],a[1],b[0],b[1],2,withAlpha(P.signal,0.4*pulse*dim)); }
    // release 峰：市中心密团高亮框（视线锚定到挤成一团的地理坐标）
    if(isRel&&rd.slam>0.4){ const ca=smoothstep(0.4,0.7,rd.slam)*dim;
      const c1=pos(byId('c1'),k,W,H),c2=pos(byId('c2'),k,W,H);
      lines.rect(Math.min(c1[0],c2[0])-40,Math.min(c1[1],c2[1])-40,Math.abs(c2[0]-c1[0])+80,Math.abs(c2[1]-c1[1])+80,2.5,withAlpha(P.signal,ca)); }
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('按真实距离画', W-160, H-90, {anchor:'right',size:32,color:css(P.ash,0.7*dim)});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return this.cam.post(ctx,{impact:isRel?rd.slam:0,bloomBase:0.1});
  },
});