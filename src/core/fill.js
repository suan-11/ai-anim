// @ts-check
/**
 * src/core/fill.js —— **填充面的扫描线数学**（纯函数，不碰 GPU、不碰 DOM）。
 *
 * ## 为什么需要它
 *
 * 引擎的矢量层 LineBatch 只会画**线段**（胶囊），连 fillRect 都是「一行行短线段拼出来的」。
 * 于是凡是「一块面」的画面 —— 山体、纸浪、扇区、水洼、卡片、圆盘 —— 每条片子都要自己
 * 想办法糊（铺密排线、画很多同心圆、或者干脆改用 Canvas2D）。用户提供的风格素材包
 * 26 条参考实现里 **11 条**都是 beginPath + arc + fill，这不是巧合：
 * 缺「面」这件事在**图元层面**就限制了画面能长什么样。
 *
 * 所以这里只做一件事：**把多边形 / 圆 / 扇环变成一组水平跨度**，由 LineBatch 逐条画成线。
 * 这样填充面天然沿用线段批那套（线性 HDR 颜色、抗锯齿、一次 draw call），
 * 不需要新的着色器、不需要三角化、也不会破坏「每帧是 t 的纯函数」。
 *
 * ## 三条约定（写错不报错，只是形状不对）
 *
 * 1. **偶奇规则**：把 rings 里所有环一起数交点，奇数段是里面、偶数段是外面。
 *    于是「外环 + 内环」自然就是**带洞的填充**，不需要额外的绕向约定。
 * 2. **闭合是隐含的**：最后一个点自动连回第一个点，调用方不用重复首点。
 * 3. **跨度的高度就是行距**（SPAN_OVERLAP = 0）：引擎把跨度画成「硬边带」，
 *    相邻带严格分区。曾经的 0.5px 重叠是给「胶囊描边」留的补缝余量，换成带之后
 *    它只会把半透明填充叠浓（见 SPAN_OVERLAP 的注释）。
 *
 * 回归：tools/test-fill.mjs（纯 JS，不需要 GPU）。
 */

/**
 * 跨度的线宽比步进多出来的那一截（逻辑像素）。
 *
 * **2026-10-31 改为 0**：引擎的填充面现在走的是「硬边带」图元（LineBatch.band，
 * shader 里 vW < 0 那一支），带与带严格分区、边界只在 x 方向抗锯齿，所以相邻行
 * **不再需要重叠**。反过来说，多出来的这 0.5px 现在是有害的：每一段重叠都会让
 * 半透明填充被叠两遍（实测 alpha 0.5 的面：step 2 时 194、step 0.5 时 222，
 * 而正确值是 188），行距越细越浓 —— 于是「把行距调小换平滑」这条路走不通。
 *
 * 保留这个常量是为了让 tools/test-fill.mjs 的面积算法继续成立（它按 h - SPAN_OVERLAP
 * 算行高），以及万一有外部代码 import 它。
 */
export const SPAN_OVERLAP = 0;

/**
 * 把一个环（点序列）展开成边列表。闭合是隐含的。
 * @param {number[][]} pts 点序列，至少 3 个点
 * @returns {{ x0: number, y0: number, x1: number, y1: number }[]}
 */
export function ringEdges(pts) {
  const out = [];
  const n = pts.length;
  if (n < 3) return out;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    // 水平边不参与交点计算（它要么整条在扫描线上、要么贡献两个重复交点）
    if (a[1] === b[1]) continue;
    out.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1] });
  }
  return out;
}

/**
 * 求某个 y 上所有交点（偶奇规则用**半开区间**：含下端点、不含上端点，
 * 否则顶点恰好落在扫描线上时会被数两次、把一段里面判成外面）。
 * @param {{ x0: number, y0: number, x1: number, y1: number }[]} edges
 * @param {number} y
 * @returns {number[]} 升序的 x 交点
 */
export function crossingsAt(edges, y) {
  const xs = [];
  for (const e of edges) {
    const lo = Math.min(e.y0, e.y1);
    const hi = Math.max(e.y0, e.y1);
    if (y < lo || y >= hi) continue;
    const t = (y - e.y0) / (e.y1 - e.y0);
    xs.push(e.x0 + (e.x1 - e.x0) * t);
  }
  xs.sort((a, b) => a - b);
  return xs;
}

/**
 * 把一组环变成**水平跨度**（偶奇规则）。
 *
 * @param {number[][] | number[][][]} ringsOrPts 单环 [[x,y],…]，或多环 [[[x,y],…], …]（多环 = 带洞）
 * @param {number} [step] 扫描行距（逻辑像素）
 * @returns {{ x: number, y: number, w: number, h: number }[]} 每条是某一行里的一段
 */
export function polySpans(ringsOrPts, step = 2) {
  const rings = normalizeRings(ringsOrPts);
  if (!rings.length) return [];
  const edges = [];
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const r of rings) {
    for (const p of r) {
      if (p[1] < yMin) yMin = p[1];
      if (p[1] > yMax) yMax = p[1];
    }
    edges.push(...ringEdges(r));
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax <= yMin) return [];

  const s = Math.max(0.25, step);
  const n = Math.max(1, Math.ceil((yMax - yMin) / s));
  const dy = (yMax - yMin) / n;
  const spans = [];
  for (let i = 0; i < n; i++) {
    const y = yMin + i * dy + dy * 0.5;   // 取行中心：顶点落在行边界上也不会退化
    const xs = crossingsAt(edges, y);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const w = xs[k + 1] - xs[k];
      if (w > 1e-6) spans.push({ x: xs[k], y, w, h: dy + SPAN_OVERLAP });
    }
  }
  return spans;
}

/**
 * 圆的水平跨度（比多边形逼近更准、也更便宜：每行一次 sqrt）。
 * @param {number} cx @param {number} cy @param {number} r
 * @param {number} [step] 扫描行距
 * @returns {{ x: number, y: number, w: number, h: number }[]}
 */
export function circleSpans(cx, cy, r, step = 2) {
  if (!(r > 0)) return [];
  const s = Math.max(0.25, step);
  const n = Math.max(1, Math.ceil((2 * r) / s));
  const dy = (2 * r) / n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const y = cy - r + i * dy + dy * 0.5;
    const d = y - cy;
    const half = Math.sqrt(Math.max(0, r * r - d * d));
    if (half > 1e-6) out.push({ x: cx - half, y, w: half * 2, h: dy + SPAN_OVERLAP });
  }
  return out;
}

/**
 * 扇环 / 扇形的水平跨度。
 *
 * 做法：在圆的跨度上再乘一个角度遮罩 —— 每一行仍用 sqrt 求圆弧边界（所以弧是光滑的），
 * 而两条直边按角度精确切出来。内半径 > 0 时把内圈那一整段减掉（扇环）。
 *
 * @param {number} cx @param {number} cy
 * @param {number} r0 内半径（0 = 实心扇形）
 * @param {number} r1 外半径
 * @param {number} a0 起始角（弧度；0 指向 +x，y 向下为正）
 * @param {number} a1 结束角；a1 < a0 时按跨 2π 处理
 * @param {number} [step]
 * @returns {{ x: number, y: number, w: number, h: number }[]}
 */
export function sectorSpans(cx, cy, r0, r1, a0, a1, step = 2) {
  const r = Math.max(0, r1);
  if (!(r > 0)) return [];
  let span = a1 - a0;
  while (span <= 0) span += Math.PI * 2;
  const half = span / 2;
  const mid = a0 + half;
  const s = Math.max(0.25, step);
  const n = Math.max(1, Math.ceil((2 * r) / s));
  const dy = (2 * r) / n;
  const out = [];
  const full = half >= Math.PI - 1e-9;
  for (let i = 0; i < n; i++) {
    const y = cy - r + i * dy + dy * 0.5;
    const d = y - cy;
    const outer = Math.sqrt(Math.max(0, r * r - d * d));
    if (outer <= 1e-6) continue;
    const inner = r0 > 0 ? Math.sqrt(Math.max(0, r0 * r0 - d * d)) : 0;
    if (outer <= inner) continue;
    const cut = full ? [-outer, outer] : clipArc(d, outer, mid, half);
    if (!cut) continue;
    const segs = inner > 0 ? subtractInterval(cut, [-inner, inner]) : [cut];
    for (const seg of segs) {
      if (seg[1] - seg[0] > 1e-6) out.push({ x: cx + seg[0], y, w: seg[1] - seg[0], h: dy + SPAN_OVERLAP });
    }
  }
  return out;
}

/**
 * 把圆的一行按角度区间 [mid-half, mid+half] 裁成 x 区间。
 *
 * ⚠ 这一行上**角度随 x 单调**（x 从 -outer 走到 +outer，角度从 atan2(d,-outer) 走到 atan2(d,outer)），
 *   所以「角度落在区间内」在 x 上一定是**一个连续区间**（也可能是空）。
 *
 * 三个分支都要写对，第一版错在最常见的那一个：
 *   · 两端都在内 → 整行；
 *   · 只有一端在内 → 二分找那一个分界；
 *   · **两端都在外、但中间在内** → 区间严格落在行内部，要**找两个**分界。
 *     第一版这里直接 `return [-outer, outer]`，于是饼图里被裁的那几行整行涂黑 —— 缺口就是这么来的。
 * @returns {[number, number] | null} 相对圆心的 x 区间
 */
function clipArc(d, outer, mid, half) {
  const inside = (x) => angWithin(Math.atan2(d, x), mid, half);
  const loIn = inside(-outer);
  const hiIn = inside(outer);
  if (loIn && hiIn) return [-outer, outer];

  // 采样找第一个 / 最后一个落在区间里的位置（角度单调 ⇒ 中间不会跳出去再回来）
  const N = 32;
  const at = (i) => -outer + (2 * outer) * (i / N);
  let first = -1;
  let last = -1;
  for (let i = 0; i <= N; i++) {
    if (inside(at(i))) { if (first < 0) first = i; last = i; }
  }
  if (first < 0) return null;

  /** 在 [iOut, iIn] 之间二分出「从外到内」的分界 x */
  const edge = (iOut, iIn) => {
    let a = at(iOut);
    let b = at(iIn);
    for (let k = 0; k < 36; k++) {
      const m = (a + b) / 2;
      if (inside(m) === inside(b)) b = m; else a = m;
    }
    return (a + b) / 2;
  };

  const xLo = first === 0 ? -outer : edge(first - 1, first);
  const xHi = last === N ? outer : edge(last + 1, last);
  return xLo <= xHi ? [xLo, xHi] : null;
}


/**
 * 角度 a 是否落在以 mid 为中心、半宽 half 的区间内（跨 2π 也对）。
 * @param {number} a @param {number} mid @param {number} half
 */
export function angWithin(a, mid, half) {
  let d = a - mid;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= half + 1e-9;
}

/**
 * 从区间 A 里减掉区间 B，返回剩下的若干段。
 * @param {[number, number]} a @param {[number, number]} b
 * @returns {[number, number][]}
 */
export function subtractInterval(a, b) {
  const out = [];
  if (b[1] <= a[0] || b[0] >= a[1]) return [a];
  if (b[0] > a[0]) out.push([a[0], Math.min(b[0], a[1])]);
  if (b[1] < a[1]) out.push([Math.max(b[1], a[0]), a[1]]);
  return out;
}

/** 把「单环 / 多环」两种写法归一成「多环」。 */
function normalizeRings(ringsOrPts) {
  if (!Array.isArray(ringsOrPts) || ringsOrPts.length === 0) return [];
  const first = ringsOrPts[0];
  if (!Array.isArray(first)) return [];
  if (typeof first[0] === 'number') return [ringsOrPts];
  return ringsOrPts;
}
