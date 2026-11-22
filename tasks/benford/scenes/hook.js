// @ts-check
/** 01 · hook —— 九根以为均匀的柱被真实数据砸歪，zoom punch 1 号柱（只问不答）。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { BENFORD, UNIFORM, barLayout } from './_data.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
export default makeShot('hook', {
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const lt = f.lt;
    // 0-1.5s 均匀；1.5s 起砸成本福特
    const k = smoothstep(1.5, 2.3, lt);
    const bars = barLayout(W, H);
    const maxH = H - 380;
    // zoom punch 到 1 号柱
    const zt = sat((lt-2.3)/0.6); const zoom = 1+1.8*smoothstep(0,1,zt);
    const b0 = bars[0];
    ctx.setXform({ scale: zoom, anchor: [b0.x, b0.baseY - maxH*BENFORD[0]] });
    lines.begin();
    // 基线
    lines.seg(140, b0.baseY, W-140, b0.baseY, 1.5, withAlpha(P.graphite, 0.6));
    for (let i=0;i<9;i++){
      const v = UNIFORM[i] + (BENFORD[i]-UNIFORM[i])*k;
      const h = v*maxH*2.6; // 放大显示
      const b = bars[i];
      const col = i===0 ? withAlpha(P.signal, 0.95) : withAlpha(P.bone, 0.75);
      lines.fillRect(b.x-b.bw/2, b.baseY-h, b.bw, h, col);
      // 数字标签
    }
    lines.flush(ctx.out);
    text.clear();
    for(let i=0;i<9;i++){ const b=bars[i]; type.writeLine(String(b.d), b.x, b.baseY+30, {anchor:'center',size:30,color:css(P.ash,0.8)}); }
    if(zt>0.5) type.writeLine('？', b0.x+90, b0.baseY-maxH*BENFORD[0]*2.6-40, {anchor:'center',size:72,color:css(P.signal,smoothstep(0.5,1,zt))});
    text.upload(); comp.draw(gl,text,ctx.out,{premult:false});
    return { grain:0.012, vignette:0.3 };
  },
});
