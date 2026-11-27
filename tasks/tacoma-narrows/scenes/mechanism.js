// @ts-check
/**
 * 03 · mechanism —— 桥面横截面气动反馈（风格帧 #2，全片 9–18s）。
 * 同向来流通过三次摆动逐次增大摆幅；助推相位短亮力矩弧；上一极位细线保留。
 * 2D 剖面：截面绕中心转轴偏转 θ(lt)，气流线绕过边缘，水平参考线静止。
 * ⚠ lines 颜色用 withAlpha 线性数组。
 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, TAU, css } from '../../../src/core/util.js';

const CX = 960, CY = 540;       // 截面转轴中心
const DECK_W = 620, DECK_H = 46; // 桥面板半宽/厚
const GIRDER = 70;               // 实腹板梁高（板下）
// 三次摆动：极位时刻 lt=2.5/4.5/6.5（全片 11.5/13.5/15.5），摆幅递增
const PEAKS = [2.5, 4.5, 6.5];
const AMPS = [0.18, 0.30, 0.46]; // 弧度，递增
// 当前扭转角：在三个极位间平滑摆动（每次过中位仍在转）
function theta(lt) {
  // 用分段正弦：每个半摆从一极到另一极，幅度按所在摆次
  const period = 2.0;            // 半摆时长
  const idx = Math.min(2, Math.floor(lt / period));
  const amp = AMPS[idx];
  const ph = (lt - idx * period) / period; // 0..1
  // 偶数摆向右倾，奇数向左倾；cos 让极位在 ph=0/1
  const dir = idx % 2 === 0 ? 1 : -1;
  return dir * amp * Math.cos(ph * Math.PI);
}
// 当前是否助推相位（过中位且仍在转，|theta| 小但角速度大）
function boost(lt) {
  const period = 2.0;
  const ph = (lt % period) / period;
  return smoothstep(0.35, 0.5, ph) * (1 - smoothstep(0.5, 0.65, ph)); // 中位附近
}
export default makeShot('mechanism', {
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const lt = f.lt;
    const th = theta(lt);
    const bone = P.bone, ash = P.ash, sig = P.signal, graphite = P.graphite, ember = P.ember;
    lines.begin();
    // 水平参考线（静止，贯穿画面）
    lines.seg(120, CY, W - 120, CY, 1.4, withAlpha(graphite, 0.55));
    // 淡网格剖面坐标（背景已有 blueprint，这里加截面局部刻度）
    for (let gx = CX - 300; gx <= CX + 300; gx += 60) lines.seg(gx, CY - 200, gx, CY + 200, 0.6, withAlpha(graphite, 0.18));
    // 上一极位细线保留（前两次摆的极位轮廓）
    const idx = Math.min(2, Math.floor(lt / 2.0));
    for (let p = 0; p < idx; p++) {
      const pa = (p % 2 === 0 ? 1 : -1) * AMPS[p];
      drawDeck(lines, pa, withAlpha(ash, 0.22), 1.0, false);
    }
    // 气流线（从左到右，绕过截面边缘）—— 随截面偏转改变路径
    const flowN = 7;
    for (let i = 0; i < flowN; i++) {
      const fy = CY - 150 + i * 50;
      drawFlow(lines, fy, th, withAlpha(sig, 0.30 + 0.1 * boost(lt)), 1.3, W);
    }
    // 当前截面（实腹板梁 + 桥面板）
    drawDeck(lines, th, withAlpha(bone, 0.95), 2.6, true);
    // 助推相位力矩弧（绕转轴，弧向跟随旋转方向）
    const b = boost(lt);
    if (b > 0.02) {
      const dir = Math.sign(-Math.sin((lt % 2.0) / 2.0 * Math.PI)) || 1;
      drawTorqueArc(lines, dir, withAlpha(ember, 0.7 * b), 2.4);
    }
    // 转轴中心标记
    lines.circle(CX, CY, 5, 1.6, withAlpha(sig, 0.8));
    lines.flush(ctx.out);
    // 标注（画面只放标注，句子交字幕）
    text.clear();
    type.writeLine('气流与扭转示意', W - 160, H - 90, { anchor: 'right', size: 30, color: css(P.ash, 0.7) });
    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    return { grain: 0.014, vignette: 0.38, bloom: 0.16 };
  },
});
// 画桥面截面（绕 CX,CY 转 th）：桥面板 + 两侧实腹板梁
function drawDeck(lines, th, col, w, solid) {
  const cs = Math.cos(th), sn = Math.sin(th);
  const rot = (x, y) => [CX + x * cs - y * sn, CY + x * sn + y * cs];
  const hw = DECK_W / 2, hh = DECK_H / 2;
  // 桥面板四角
  const a = rot(-hw, -hh), b = rot(hw, -hh), c = rot(hw, hh), d = rot(-hw, hh);
  lines.seg(a[0], a[1], b[0], b[1], w, col);
  lines.seg(b[0], b[1], c[0], c[1], w, col);
  lines.seg(c[0], c[1], d[0], d[1], w, col);
  lines.seg(d[0], d[1], a[0], a[1], w, col);
  // 两侧实腹板梁（板下垂直腹板）
  for (const sx of [-hw + 30, hw - 30]) {
    const t1 = rot(sx, hh), t2 = rot(sx, hh + GIRDER);
    lines.seg(t1[0], t1[1], t2[0], t2[1], w * 0.8, col);
  }
  const g1 = rot(-hw + 30, hh + GIRDER), g2 = rot(hw - 30, hh + GIRDER);
  lines.seg(g1[0], g1[1], g2[0], g2[1], w * 0.7, col);
}
// 气流线：水平来流，遇截面偏转绕边缘（简化：在截面 x 范围内按 th 偏移 y）
function drawFlow(lines, fy, th, col, w, W) {
  const pts = [];
  for (let x = 140; x <= W - 140; x += 24) {
    let y = fy;
    const dx = x - CX;
    if (Math.abs(dx) < DECK_W / 2 + 60) {
      // 靠近截面：气流被偏转的板面推开（上表面流线上抬/下压随 th）
      const infl = 1 - Math.abs(dx) / (DECK_W / 2 + 60);
      y += th * 90 * infl * (fy < CY ? 1 : -1);
    }
    pts.push([x, y]);
  }
  for (let i = 1; i < pts.length; i++) lines.seg(pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1], w, col);
}
// 力矩弧：绕转轴的圆弧 + 箭头，dir 决定方向
function drawTorqueArc(lines, dir, col, w) {
  const R = 130, a0 = dir > 0 ? -0.6 : Math.PI - 0.6, a1 = a0 + dir * 1.2;
  let prev = null;
  for (let i = 0; i <= 20; i++) {
    const a = a0 + (a1 - a0) * (i / 20);
    const pt = [CX + Math.cos(a) * R, CY + Math.sin(a) * R];
    if (prev) lines.seg(prev[0], prev[1], pt[0], pt[1], w, col);
    prev = pt;
  }
  // 箭头
  const ae = a1, ax = CX + Math.cos(ae) * R, ay = CY + Math.sin(ae) * R;
  const tang = ae + dir * Math.PI / 2;
  lines.seg(ax, ay, ax - Math.cos(tang - 0.4) * 16, ay - Math.sin(tang - 0.4) * 16, w, col);
  lines.seg(ax, ay, ax - Math.cos(tang + 0.4) * 16, ay - Math.sin(tang + 0.4) * 16, w, col);
}
