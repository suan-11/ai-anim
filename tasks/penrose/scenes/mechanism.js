// @ts-check
/** 03 · mechanism —— 【答案峰①】旋转到侧视，三梁断口暴露 + zoom punch。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { TRI, JOINTS, mapPt } from './_geo.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
export default makeShot('mechanism', {
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const lt = f.lt;
    // 旋转：用水平缩放 cos(angle) 模拟绕竖轴转，angle 0→70°
    const ang = smoothstep(0.3, 4.5, lt) * 1.2;
    const sx = Math.cos(ang); // 水平压缩
    // 断口拉开度（旋转后首尾错开）
    const gap = smoothstep(2.0, 4.5, lt) * 60;
    const cx = W/2, cy = H/2;
    const zt = sat((lt-5.0)/0.6); const zoom = 1+1.3*smoothstep(0,1,zt);
    const j = mapPt(JOINTS[0], W, H);
    ctx.setXform({ scale: zoom, anchor: [j[0], j[1]] });
    lines.begin();
    const O = TRI.outer.map(p=>mapPt(p,W,H)), I = TRI.inner.map(p=>mapPt(p,W,H));
    // 旋转后的点（绕中心水平压缩）+ 顶部梁断口拉开
    const rot = (p,i)=>{ let x=cx+(p[0]-cx)*sx, y=p[1]; if(i===0){ y-=gap; } return [x,y]; };
    for(let i=0;i<3;i++){
      const a=rot(O[i],i), b=rot(O[(i+1)%3],(i+1)%3), c=rot(I[(i+1)%3],(i+1)%3), d=rot(I[i],i);
      lines.seg(a[0],a[1],b[0],b[1],3,withAlpha(P.bone,0.95));
      lines.seg(d[0],d[1],c[0],c[1],2.5,withAlpha(P.bone,0.8));
      lines.seg(a[0],a[1],d[0],d[1],2.5,withAlpha(P.bone,0.8));
      lines.seg(c[0],c[1],b[0],b[1],2,withAlpha(P.ash,0.6));
    }
    // 断口高亮（顶部梁与右梁之间拉开的间隙）
    if(gap>10){ const ga=smoothstep(2.5,4.5,lt); const top=rot(O[0],0); const right=rot(O[1],1);
      lines.seg(top[0],top[1],right[0],right[1],2,withAlpha(P.signal,ga*0.8));
      lines.circle(top[0],top[1],6,2,withAlpha(P.signal,ga)); lines.circle(right[0],right[1],6,2,withAlpha(P.signal,ga)); }
    lines.flush(ctx.out);
    text.clear();
    if(lt>4.5) type.writeLine('其实没接上', W*0.5, H-90, {anchor:'center',size:38,color:css(P.signal,smoothstep(4.5,5.5,lt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return { grain:0.014, vignette:0.4 };
  },
});
