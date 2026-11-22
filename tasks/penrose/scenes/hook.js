// @ts-check
/** 01 · hook —— 看似闭合的彭罗斯三角，zoom punch 放大接缝（只问不答）。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { TRI, JOINTS, mapPt } from './_geo.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
export default makeShot('hook', {
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const lt = f.lt;
    const zt = sat((lt-1.5)/0.6); const zoom = 1+2*smoothstep(0,1,zt);
    const j = mapPt(JOINTS[0], W, H); // 顶部接缝
    ctx.setXform({ scale: zoom, anchor: j });
    lines.begin();
    const O = TRI.outer.map(p=>mapPt(p,W,H)), I = TRI.inner.map(p=>mapPt(p,W,H));
    // 三梁：外边 + 内边 + 端部连接（彭罗斯遮挡错觉）
    for(let i=0;i<3;i++){
      const a=O[i], b=O[(i+1)%3], c=I[(i+1)%3], d=I[i];
      // 梁四边形
      lines.seg(a[0],a[1],b[0],b[1],3,withAlpha(P.bone,0.95));
      lines.seg(d[0],d[1],c[0],c[1],2.5,withAlpha(P.bone,0.8));
      lines.seg(a[0],a[1],d[0],d[1],2.5,withAlpha(P.bone,0.8));
      // 角部遮挡线（制造不可能感）：内角连到下一梁外角
      lines.seg(c[0],c[1],b[0],b[1],2,withAlpha(P.ash,0.6));
    }
    // zoom 后框出顶部接缝
    if(zt>0.3){ const ba=smoothstep(0.3,0.8,zt); lines.rect(j[0]-45,j[1]-30,90,70,2.5,withAlpha(P.signal,ba)); }
    lines.flush(ctx.out);
    text.clear();
    if(zt>0.5) type.writeLine('？', j[0]+80, j[1]+20, {anchor:'center',size:80,color:css(P.signal,smoothstep(0.5,1,zt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return { grain:0.014, vignette:0.4 };
  },
});
