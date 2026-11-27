// @ts-check
/**
 * 05 · close —— 风洞试验段内的桥面截面模型（风格帧 #3，全片 28–35s）。
 * 同一截面几何变成支架上的小模型；来流带动小幅偏转；固定参考线旁指针读出偏转，随后减速稳定。
 * ⚠ lines 颜色用 withAlpha 线性数组。
 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';

const CX = 900, CY = 520;        // 模型转轴
const MW = 360, MH = 26, MG = 40; // 模型半宽/厚/腹板（比 mechanism 小，缩尺感）
// 模型偏转：气流抵达后起摆，随后阻尼衰减稳定（lt∈[0,7]，气流约 lt=1.5 抵达）
function modelTheta(lt) {
  const t = Math.max(0, lt - 1.5);
  const damp = Math.exp(-t * 0.55);
  return 0.22 * damp * Math.sin(t * 2.2);
}
export default makeShot('close', {
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const lt = f.lt;
    const th = modelTheta(lt);
    const bone = P.bone, ash = P.ash, sig = P.signal, graphite = P.graphite;
    // 横移露出试验段：镜头随 lt 缓慢右移（用整体 x 偏移模拟）
    const pan = smoothstep(0, 2.5, lt) * 60;
    lines.begin();
    // 风洞试验段壁（上下水平边界）
    lines.seg(140, CY - 230, W - 140, CY - 230, 1.6, withAlpha(graphite, 0.6));
    lines.seg(140, CY + 230, W - 140, CY + 230, 1.6, withAlpha(graphite, 0.6));
    // 来流流线（稳定水平，低亮度）
    for (let i = 0; i < 6; i++) {
      const fy = CY - 160 + i * 64;
      const pts = [];
      for (let x = 160; x <= W - 160; x += 28) {
        let y = fy;
        const dx = x - (CX + pan);
        if (Math.abs(dx) < MW / 2 + 40) { const infl = 1 - Math.abs(dx) / (MW / 2 + 40); y += th * 60 * infl * (fy < CY ? 1 : -1); }
        pts.push([x, y]);
      }
      for (let j = 1; j < pts.length; j++) lines.seg(pts[j-1][0], pts[j-1][1], pts[j][0], pts[j][1], 1.2, withAlpha(sig, 0.22));
    }
    // 支架（模型下方的支撑杆 + 底座，可见试验构型）
    const sx = CX + pan;
    lines.seg(sx, CY + MH / 2 + MG, sx, CY + 200, 2.4, withAlpha(ash, 0.7));
    lines.seg(sx - 50, CY + 200, sx + 50, CY + 200, 2.4, withAlpha(ash, 0.7));
    lines.seg(sx - 30, CY + 200, sx - 45, CY + 225, 1.6, withAlpha(ash, 0.5));
    lines.seg(sx + 30, CY + 200, sx + 45, CY + 225, 1.6, withAlpha(ash, 0.5));
    // 模型截面（复用 mechanism 的桥面形状，缩尺）
    drawModel(lines, sx, th, withAlpha(bone, 0.95), 2.2);
    // 固定参考线（竖直，静止）+ 测量指针（跟随模型偏转）
    const refX = sx + MW / 2 + 90;
    lines.seg(refX, CY - 120, refX, CY + 120, 1.4, withAlpha(graphite, 0.6));
    // 指针：从参考线指向模型边缘高度（偏转读数）
    const tipY = CY - Math.sin(th) * (MW / 2) * 0.9;
    lines.seg(refX, CY, refX + 40, tipY, 2.2, withAlpha(sig, 0.85));
    lines.circle(refX + 40, tipY, 4, 1.6, withAlpha(sig, 0.9));
    // 参考刻度
    for (let ky = -100; ky <= 100; ky += 25) lines.seg(refX - 6, CY + ky, refX + 6, CY + ky, 1.0, withAlpha(graphite, 0.5));
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('风洞模型示意', W - 160, H - 90, { anchor: 'right', size: 30, color: css(P.ash, 0.7) });
    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    return { grain: 0.014, vignette: 0.38, bloom: 0.14 };
  },
});
function drawModel(lines, cx, th, col, w) {
  const cs = Math.cos(th), sn = Math.sin(th);
  const rot = (x, y) => [cx + x * cs - y * sn, CY + x * sn + y * cs];
  const hw = MW / 2, hh = MH / 2;
  const a = rot(-hw, -hh), b = rot(hw, -hh), c = rot(hw, hh), d = rot(-hw, hh);
  lines.seg(a[0], a[1], b[0], b[1], w, col);
  lines.seg(b[0], b[1], c[0], c[1], w, col);
  lines.seg(c[0], c[1], d[0], d[1], w, col);
  lines.seg(d[0], d[1], a[0], a[1], w, col);
  for (const sxx of [-hw + 20, hw - 20]) {
    const t1 = rot(sxx, hh), t2 = rot(sxx, hh + MG);
    lines.seg(t1[0], t1[1], t2[0], t2[1], w * 0.8, col);
  }
  const g1 = rot(-hw + 20, hh + MG), g2 = rot(hw - 20, hh + MG);
  lines.seg(g1[0], g1[1], g2[0], g2[1], w * 0.7, col);
}
