// @ts-check
/**
 * _relay-lab 共用的世界（中）：塔阵的**绘制层**（第 1 类 3D：解析投影 + 线段批）。
 * 几何与位姿在 _homes.js，这里只有"给一台 camera3 画一个世界"。
 *
 * 坑位对照（ENGINE §3.7 ①）：
 *   · 线段批没有 z-test —— 两个塔群按深度从远到近排（画家算法）；
 *   · 线宽不拿排序深度算 —— 从同一深度上的投影宽度推（近大远小、不会炸成胶囊）；
 *   · 塔有角点在相机身后就整根跳过（塔数多，近处丢一根不显，省掉近平面裁剪的分段）。
 */
import { project3 } from '../../../src/core/cam.js';
import { withAlpha, mul } from '../../../src/kit/layout.js';
import { CLUSTERS } from './_homes.js';

const GND_Z0 = -46;
const GND_STEP = 3.2;
const GND_ROWS = 16;
const GND_X0 = -34;
const GND_X1 = 34;

/** 焦点塔顶的信号色标记：细天线 + 一颗呼吸的圆点（半径从投影宽度推）。 */
function drawMarker(lines, cam, P, t, W, H, cl) {
  const p = cl.cols[cl.top];
  const sway = 0.045 * Math.sin(t * 0.9 + p.phase);
  const base = project3(cam, W, H, p.x, 0, p.z);
  const tip = project3(cam, W, H, p.x + sway, p.h, p.z);
  const ant = project3(cam, W, H, p.x + sway, p.h + 0.55, p.z);
  if (base.w < 0.06 || tip.w < 0.06 || ant.w < 0.06) return;
  const edge = project3(cam, W, H, p.x + p.w / 2, 0, p.z);
  const r = Math.max(3, Math.min(9, Math.abs(base.x - edge.x) * 0.22));
  lines.seg(tip.x, tip.y, ant.x, ant.y, 1.6, withAlpha(P.signal, 0.85));
  const tw = 0.75 + 0.25 * Math.sin(t * 2.1);
  lines.fillCircle(ant.x, ant.y, r, withAlpha(P.signal, 0.9 * tw));
  lines.circle(ant.x, ant.y, r + 3, 1.2, withAlpha(P.signal, 0.5 * tw));
}

/** 一个塔群：填充面 + 轮廓 + 两道横箍（先填充后描边，COOKBOOK §17）。 */
function drawCluster(lines, cam, P, t, W, H, cl, alpha) {
  const face = withAlpha(mul(P.bone, 0.8), alpha * 0.3);
  const edge = withAlpha(P.bone, alpha * 0.9);
  const ring = withAlpha(P.bone, alpha * 0.55);
  for (const p of cl.cols) {
    const sway = 0.045 * Math.sin(t * 0.9 + p.phase);
    const b0 = project3(cam, W, H, p.x - p.w / 2, 0, p.z);
    const b1 = project3(cam, W, H, p.x + p.w / 2, 0, p.z);
    const t0 = project3(cam, W, H, p.x - p.w * 0.32 + sway, p.h, p.z);
    const t1 = project3(cam, W, H, p.x + p.w * 0.32 + sway, p.h, p.z);
    if (Math.min(b0.w, b1.w, t0.w, t1.w) < 0.06) continue;
    lines.fillPoly([[b0.x, b0.y], [b1.x, b1.y], [t1.x, t1.y], [t0.x, t0.y]], face);
    // 线宽从投影宽度推（同一深度上线性），不拿排序深度算粗细
    const wpx = Math.max(1, Math.min(10, Math.abs(b1.x - b0.x) * 0.12));
    lines.seg(b0.x, b0.y, t0.x, t0.y, wpx, edge);
    lines.seg(b1.x, b1.y, t1.x, t1.y, wpx, edge);
    lines.seg(t0.x, t0.y, t1.x, t1.y, wpx * 0.8, edge);
    for (const yf of [0.38, 0.72]) {
      const y = p.h * yf;
      const hw = (p.w / 2) * (1 - 0.25 * yf);
      const l = project3(cam, W, H, p.x - hw + sway * yf, y, p.z);
      const r = project3(cam, W, H, p.x + hw + sway * yf, y, p.z);
      if (l.w > 0.06 && r.w > 0.06) lines.seg(l.x, l.y, r.x, r.y, Math.max(0.8, wpx * 0.5), ring);
    }
  }
}

/**
 * 画整片塔阵（一条 lines 批）。画家算法：远群先画。
 * focus 群全亮 + 带信号色标记，另一群压暗 —— "内容换手"的视觉线索。
 */
export function drawTowerField(lines, cam, P, t, W, H, { focus = 'A' } = {}) {
  // 地面网格：y=0 平面上的横线，端点在相机身后就整条跳过
  for (let i = 0; i < GND_ROWS; i++) {
    const z = GND_Z0 + i * GND_STEP;
    const a = project3(cam, W, H, GND_X0, 0, z);
    const b = project3(cam, W, H, GND_X1, 0, z);
    if (a.w <= 0 || b.w <= 0) continue;
    lines.seg(a.x, a.y, b.x, b.y, 1, withAlpha(P.ash, 0.45));
  }
  const clusters = CLUSTERS.slice().sort((p, q) => q.cz - p.cz); // cz 大（近）的后画
  for (const cl of clusters) drawCluster(lines, cam, P, t, W, H, cl, focus === cl.id ? 1 : 0.45);
  const focusCl = clusters.find((c) => c.id === focus);
  if (focusCl) drawMarker(lines, cam, P, t, W, H, focusCl);
}

/** 焦点群标记点的屏幕坐标（给"贴 3D 点的标签"用）；不可见时 visible = false。 */
export function markerPoint(cam, W, H, cl, t) {
  const p = cl.cols[cl.top];
  const sway = 0.045 * Math.sin(t * 0.9 + p.phase);
  const q = project3(cam, W, H, p.x + sway, p.h + 0.55, p.z);
  return { x: q.x, y: q.y, visible: q.w > 0.06 };
}
