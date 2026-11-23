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

const LC = LINE_COLORS.map(hexToLinear);
export default makeShot('hook', {
  setup(){ this.cam=makeCinematic(); },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const lt=f.lt/(ctx.params?.stretch??1);
    // zoom punch：1.5s 起快速推近市中心（spring 回弹），目标放大 3×
    const zt = sat((lt - 1.5) / 0.6);
    const hub = pos(byId('hub'), 0, W, H);
    const {zoom,anchor}=safeZoom(W,H,[hub[0]-150,hub[1]-120,300,240],1+2*smoothstep(0,1,zt));
    ctx.setXform({ scale: zoom, anchor });
    lines.begin();
    // 连线（地理坐标 k=0）
    for (let li = 0; li < LINES.length; li++) {
      const ids = LINES[li];
      for (let i = 1; i < ids.length; i++) {
        const a = pos(byId(ids[i-1]), 0, W, H), b = pos(byId(ids[i]), 0, W, H);
        lines.seg(a[0], a[1], b[0], b[1], 3, withAlpha(LC[li], 0.85));
      }
    }
    // 站点
    for (const st of STATIONS) {
      const p = pos(st, 0, W, H);
      if (st.hub) { lines.circle(p[0], p[1], 9, 3, withAlpha(P.bone, 0.95)); lines.circle(p[0], p[1], 4, 2, withAlpha(P.ink, 1)); }
      else lines.circle(p[0], p[1], 5, 2, withAlpha(P.bone, 0.9));
    }
    // zoom 后框出市中心重叠两站 c1/c2 + 问号
    if (zt > 0.3) {
      const c1 = pos(byId('c1'), 0, W, H), c2 = pos(byId('c2'), 0, W, H);
      const cx = (c1[0]+c2[0])/2, cy = (c1[1]+c2[1])/2;
      const boxA = smoothstep(0.3, 0.8, zt);
      lines.rect(cx-50, cy-40, 100, 80, 2.5, withAlpha(P.signal, boxA));
    }
    lines.flush(ctx.out);
    text.clear();
    if (zt > 0.5) type.writeLine('？', hub[0]+70, hub[1]-60, { anchor:'center', size:80, color:css(P.signal, smoothstep(0.5,1,zt)) });
    text.upload(); comp.draw(gl, text, ctx.out, { premult:false });
    return this.cam.post(ctx,{impact:typeof zt!=='undefined'?zt:0,bloomBase:0.1});
  },
});