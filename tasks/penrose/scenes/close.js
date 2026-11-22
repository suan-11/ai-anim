// @ts-check
/** 05 · close —— zoom out 回全景，不可能图形并置 + 1958 Penrose 标注。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { TRI, mapPt } from './_geo.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
export default makeShot('close', {
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const lt = f.lt;
    const zoom = 1.6 - 0.6*smoothstep(0,1,sat(lt/1.0));
    ctx.setXform({ scale: zoom, anchor: [W/2,H/2] });
    lines.begin();
    // 左侧三角
    const O = TRI.outer.map(p=>mapPt([p[0]*0.5+0.05,p[1]],W,H)), I = TRI.inner.map(p=>mapPt([p[0]*0.5+0.05,p[1]],W,H));
    for(let i=0;i<3;i++){ const a=O[i],b=O[(i+1)%3],c=I[(i+1)%3],d=I[i];
      lines.seg(a[0],a[1],b[0],b[1],2.5,withAlpha(P.bone,0.9)); lines.seg(d[0],d[1],c[0],c[1],2,withAlpha(P.bone,0.7)); lines.seg(a[0],a[1],d[0],d[1],2,withAlpha(P.bone,0.7)); lines.seg(c[0],c[1],b[0],b[1],1.5,withAlpha(P.ash,0.5)); }
    // 右侧不可能阶梯（简化：四段上升闭环）
    const sx=W*0.62, sy=H*0.35, step=44;
    const stairs=[[0,0],[1,0],[1,1],[2,1],[2,2],[3,2],[3,3],[0,3]];
    for(let i=1;i<stairs.length;i++){ const a=[sx+stairs[i-1][0]*step,sy+stairs[i-1][1]*step],b=[sx+stairs[i][0]*step,sy+stairs[i][1]*step]; lines.seg(a[0],a[1],b[0],b[1],2.5,withAlpha(P.bone,0.9)); }
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('1958 · Penrose', W*0.5, H-90, {anchor:'center',size:40,color:css(P.bone,smoothstep(2,3.5,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return { grain:0.014, vignette:0.4 };
  },
});
