// @ts-check
/**
 * 01 · hook —— 看起来正常的地铁图，突然 zoom 进市中心挤成团（只问不答）。
 * 0-1.5s 地理真实线网全景(k=0)；1.5s zoom punch 放大到市中心密团(3×)停住，框出重叠两站打问号。
 * ⚠ lines 颜色用 withAlpha 线性数组；zoom 用 ctx.setXform 整层缩放。
 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { STATIONS, LINES, LINE_COLORS, byId, pos } from './_net.js';
import { sat, smoothstep, css, hexToLinear } from '../../../src/core/util.js';
import { safeZoom } from '../../_shared/zoom.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { makeDataField, drawDataField } from '../../_shared/datafield.js';
import { rhythmDrive } from '../../_shared/rhythm-drive.js';

const LC = LINE_COLORS.map(hexToLinear);
export default makeShot('hook', {
  setup(){ this.cam=makeCinematic(); this.field=makeDataField(11,45); },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const lt=f.lt/(ctx.params?.stretch??1);
    // 方案2接线：段横跨 pressure[0,3.5)+hold[3.5,8)。
    // hold 块首 slam=推近瞬间（峰谷对齐块边界 3.5s）；pressure 钩子窗保持中位可见。
    const rd=rhythmDrive(f);
    const inHold=rd.role==='hold';
    // 推近进度：hold 块首 0.6s 内完成（hold 包络 slam 恒 0，用块内 u 自算）
    const zt=inHold?smoothstep(0,0.1,rd.u):0;
    // 静置期降对比（bit 深谷档：hold 余段压暗，让显著性谷够深；不能压太狠否则字幕抢焦点）
    const settled=inHold?smoothstep(0.35,0.7,rd.u):0;
    const dim=1-0.30*settled;
    // 钩子窗 [0,3.5) 内部起伏：升起→峰值→微收（hook change≥0.08）
    const hookU=inHold?1:sat(f.t/3.5);
    const hookRise=inHold?1:smoothstep(0,0.35,hookU);
    const hookDip=inHold?0:0.25*smoothstep(0.65,0.95,hookU);
    const hookDim=(0.55+0.45*hookRise)*(1-hookDip);
    const hub = pos(byId('hub'), 0, W, H);
    const {zoom,anchor}=safeZoom(W,H,[hub[0]-150,hub[1]-120,300,240],1+2*smoothstep(0,1,zt));
    ctx.setXform({ scale: zoom, anchor });
    lines.begin();
    drawDataField(ctx,this.field,f.t,0.3);
    // 连线（地理坐标 k=0）——亮度随节奏调制（主体集中变化）
    for (let li = 0; li < LINES.length; li++) {
      const ids = LINES[li];
      for (let i = 1; i < ids.length; i++) {
        const a = pos(byId(ids[i-1]), 0, W, H), b = pos(byId(ids[i]), 0, W, H);
        lines.seg(a[0], a[1], b[0], b[1], 3, withAlpha(LC[li], 0.85*dim*hookDim));
      }
    }
    // 站点
    for (const st of STATIONS) {
      const p = pos(st, 0, W, H);
      if (st.hub) { lines.circle(p[0], p[1], 9, 3, withAlpha(P.bone, 0.95*dim*hookDim)); lines.circle(p[0], p[1], 4, 2, withAlpha(P.ink, 1)); }
      else lines.circle(p[0], p[1], 5, 2, withAlpha(P.bone, 0.9*dim*hookDim));
    }
    // zoom 后框出市中心重叠两站 c1/c2 + 问号
    if (zt > 0.3) {
      const c1 = pos(byId('c1'), 0, W, H), c2 = pos(byId('c2'), 0, W, H);
      const cx = (c1[0]+c2[0])/2, cy = (c1[1]+c2[1])/2;
      const boxA = smoothstep(0.3, 0.8, zt);
      lines.rect(cx-50, cy-40, 100, 80, 2.5, withAlpha(P.signal, boxA));
      // 圈外线网压暗（焦点集中到密团，hotspot 锁在 hub）
      for (let li = 0; li < LINES.length; li++) { const ids = LINES[li];
        for (let i = 1; i < ids.length; i++) {
          const a = pos(byId(ids[i-1]), 0, W, H), b = pos(byId(ids[i]), 0, W, H);
          const far = Math.hypot((a[0]+b[0])/2-cx, (a[1]+b[1])/2-cy) > 260;
          if (far) lines.seg(a[0], a[1], b[0], b[1], 3.5, withAlpha(P.ink, 0.5*boxA));
        } }
      for (const st of STATIONS) { const p = pos(st, 0, W, H);
        if (Math.hypot(p[0]-cx, p[1]-cy) > 240) lines.circle(p[0], p[1], 5.5, 3, withAlpha(P.ink, 0.5*boxA)); }
    }
    lines.flush(ctx.out);
    text.clear();
    if (zt > 0.5) type.writeLine('？', hub[0]+70, hub[1]-60, { anchor:'center', size:80, color:css(P.signal, smoothstep(0.5,1,zt)*dim) });
    text.upload(); comp.draw(gl, text, ctx.out, { premult:false });
    return this.cam.post(ctx,{impact:zt,bloomBase:0.1});
  },
});