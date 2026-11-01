// @ts-check
/**
 * B 段：**过渡镜头，完全由 anim 自己画**（不碰 Three.js）。
 *
 * 为什么这一段是整条链的关键：两侧的像素风格**由同一个渲染器产出**，
 * 所以不存在"对齐两套材质/光照"的问题（`docs/history/HANDOFF-THREEJS.md` §6）。
 * 更硬的一条是：这里的投影用的是 `src/core/cam.js` 的 `project3()`，
 * 它与 Three.js 的 `PerspectiveCamera` 是**同一个公式**、同一台 `camAt(t)`，
 * 所以这个线框盒子能落在 A/C 段实体的**同一个像素位置**上 —— 转场时物体不跳。
 *
 * 画面：12 条棱逐条"长"出来 → 一块扫描面自下而上把可见面填成实体 → 面上浮出 5×4×4 的分格线
 * （分格线正是 C 段晶格的预告）。
 *
 * ⚠ 这一段没有 z-buffer（线段批没有深度测试）：盒子的可见面互不遮挡，
 *   所以按"面"画就等价于画家算法；**不要**在这里画会互相穿插的几何。
 */
import { makeShot } from '../../../src/kit/index.js';
import { css, prog, sat, lerp } from '../../../src/core/util.js';
import { camera3, project3, clipSegment, widthAt } from '../../../src/core/cam.js';
import { CELLS, FOV, camAt, titleScrim, worldPoint } from './_stage.js';

/** 8 个角：位 0/1/2 = u/v/w 的正负 */
const CORNER = [];
for (let i = 0; i < 8; i++) {
  CORNER.push([i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5]);
}
/** 12 条棱（角下标对） */
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
/**
 * 6 个面：`idx` 是**绕面一圈**的角下标，`n`/`m` 是两条边各切几格（= C 段的 CELLS）。
 * 顺序反了不影响填充（扫描线取交集），只影响分格线的方向。
 */
const FACES = [
  { idx: [1, 3, 7, 5], normal: [1, 0, 0], n: CELLS.y, m: CELLS.z },
  { idx: [0, 4, 6, 2], normal: [-1, 0, 0], n: CELLS.y, m: CELLS.z },
  { idx: [2, 3, 7, 6], normal: [0, 1, 0], n: CELLS.x, m: CELLS.z },
  { idx: [0, 1, 5, 4], normal: [0, -1, 0], n: CELLS.x, m: CELLS.z },
  { idx: [4, 5, 7, 6], normal: [0, 0, 1], n: CELLS.x, m: CELLS.y },
  { idx: [0, 2, 3, 1], normal: [0, 0, -1], n: CELLS.x, m: CELLS.y },
];
/** 主光方向（与 A 段那盏 key light 同一个方向，明暗关系才接得上） */
const LIGHT = [-0.42, 0.82, 0.39];

/**
 * 凸多边形扫描线填充（屏幕坐标，y 向下）。`y0..y1` 限制填充的高度范围 —— 扫描面就靠它。
 * 与 `LineBatch.fillRect` 同一个套路：线宽 = 步进，相邻两条胶囊正好拼成实心。
 */
function fillConvex(lines, pts, y0, y1, color, step = 3) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  const a = Math.max(minY, y0), b = Math.min(maxY, y1);
  if (!(b > a)) return;
  for (let y = Math.ceil(a); y <= b; y += step) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      if ((p[1] <= y && q[1] > y) || (q[1] <= y && p[1] > y)) {
        const x = p[0] + ((q[0] - p[0]) * (y - p[1])) / (q[1] - p[1]);
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    if (lo <= hi) lines.seg(lo, y, hi, y, step + 0.7, color);
  }
}

export default makeShot('lab_wire', {
  setup(ctx) {
    // 预计算每个面的世界角点（只跟 _stage 有关，与 t 无关）
    this.faces = FACES.map((fc) => ({
      ...fc,
      world: fc.idx.map((i) => worldPoint(CORNER[i][0], CORNER[i][1], CORNER[i][2])),
    }));
    this.corners = CORNER.map((c) => worldPoint(c[0], c[1], c[2]));
  },

  draw(ctx, { dx, dy, enter }) {
    const { f, lines, text, type, comp, gl, P, W, H } = ctx;
    const lt = f.lt;

    // ── 一台摄影机：与三段共用（同一个 camAt、同一个 fov），投影公式与 three 完全一致
    const c = camAt(f.t);
    const cam = camera3({ pos: c.pos, target: c.target, fov: FOV, H });

    const kEdge = prog(lt, 0.10, 1.30, 'outCubic');
    const kFill = prog(lt, 1.15, 2.45, 'inOutCubic');
    const kGrid = prog(lt, 2.30, 3.10, 'outCubic');

    const proj = (p) => project3(cam, W, H, p[0], p[1], p[2]);
    const P3 = this.corners.map(proj);

    // ── ① 可见面：法线朝相机的那几个（凸盒子上它们互不遮挡，所以不需要排序）
    const visible = this.faces.filter((fc) => {
      const n = fc.normal;
      // 面心 → 相机 的方向与法线同号 ⇒ 看得见
      const cx = fc.world.reduce((s, p) => s + p[0], 0) / 4;
      const cy = fc.world.reduce((s, p) => s + p[1], 0) / 4;
      const cz = fc.world.reduce((s, p) => s + p[2], 0) / 4;
      return (c.pos[0] - cx) * n[0] + (c.pos[1] - cy) * n[1] + (c.pos[2] - cz) * n[2] > 0;
    });

    lines.begin();
    titleScrim(lines, P, W, 230, 0.68);

    // ── ② 实体：一块自下而上的扫描面（先填，棱与格线叠在上面）
    if (kFill > 0.001) {
      for (const fc of visible) {
        const quad = fc.idx.map((i) => P3[i]);
        if (quad.some((q) => q.w < 0.05)) continue;
        const shade = sat(fc.normal[0] * LIGHT[0] + fc.normal[1] * LIGHT[1] + fc.normal[2] * LIGHT[2]);
        // 明暗按面法线给（与 three 那侧的主光同向），k 要够大 —— 太暗就"看不出它变成实体了"
        const k = 0.45 + 0.55 * shade;
        const col = [
          lerp(P.ink2[0], P.graphite[0], k), lerp(P.ink2[1], P.graphite[1], k), lerp(P.ink2[2], P.graphite[2], k),
        ];
        let yTop = Infinity, yBot = -Infinity;
        for (const q of quad) { if (q.y < yTop) yTop = q.y; if (q.y > yBot) yBot = q.y; }
        // 扫描面自下而上推：填的是**扫描线以下**那一段。
        // ⚠ 参数是 (y0, y1) 且 y0 ≤ y1 —— 传反了这个循环一次都不执行（第一版就这么白填了一场，不报错）
        fillConvex(lines, quad.map((q) => [q.x, q.y]), lerp(yBot, yTop, kFill), yBot, col, 3);
      }
    }

    // ── ③ 分格线：面上的 n×m 网格（= C 段晶格的位置预告）。**要淡**，它是预告不是主体
    if (kGrid > 0.001) {
      const ga = kGrid * 0.3;
      for (const fc of visible) {
        const quad = fc.idx.map((i) => P3[i]);
        if (quad.some((q) => q.w < 0.05)) continue;
        const w = fc.world;
        const at = (s, t2) => {
          const p = [
            w[0][0] + s * (w[1][0] - w[0][0]) + t2 * (w[3][0] - w[0][0]),
            w[0][1] + s * (w[1][1] - w[0][1]) + t2 * (w[3][1] - w[0][1]),
            w[0][2] + s * (w[1][2] - w[0][2]) + t2 * (w[3][2] - w[0][2]),
          ];
          const q = proj(p);
          return [q.x, q.y, q.w];
        };
        const col = [P.bone[0], P.bone[1], P.bone[2], ga];
        for (let i = 1; i < fc.n; i++) {
          if (i / fc.n > kGrid) break;
          const a = at(i / fc.n, 0.02), b = at(i / fc.n, 0.98);
          if (a[2] > 0.05 && b[2] > 0.05) lines.seg(a[0], a[1], b[0], b[1], 1.3, col);
        }
        for (let j = 1; j < fc.m; j++) {
          if (j / fc.m > kGrid) break;
          const a = at(0.02, j / fc.m), b = at(0.98, j / fc.m);
          if (a[2] > 0.05 && b[2] > 0.05) lines.seg(a[0], a[1], b[0], b[1], 1.3, col);
        }
      }
    }

    // ── ④ 12 条棱：逐条长出来（棱线永远在实体之上，所以最后画）
    EDGES.forEach((e, i) => {
      const t0 = i / EDGES.length, t1 = (i + 1) / EDGES.length;
      const p = sat((kEdge - t0) / Math.max(1e-6, t1 - t0));
      if (p <= 0.001) return;
      const A = { ...P3[e[0]] }, B = { ...P3[e[1]] };
      // 生长：先出现半条，再补满
      if (p < 1) {
        B.x = lerp(A.x, B.x, p); B.y = lerp(A.y, B.y, p); B.w = lerp(A.w, B.w, p);
      }
      if (!clipSegment(A, B, 0.05)) return;
      // ⚠ 线宽必须用**裁剪之后**的深度：相机身后的东西 w<0 会被 depthScale 放大成上亿像素
      const wMin = Math.min(A.w, B.w);
      lines.seg(A.x, A.y, B.x, B.y, widthAt(cam, wMin, 0.03, { min: 2, max: 9, H }), P.bone);
    });

    lines.flush(ctx.out);

    // ── ⑤ 文字（引擎的图层，和 A/C 段同一套排版）
    text.clear();
    type.writeLine('同一个世界 · 同一台摄影机', 96 + dx, 118 + dy, {
      size: 58, weight: 800, family: 'sans', color: css(P.bone), ...enter(0.15),
    });
    type.writeLine('这一段完全由引擎画：解析投影 + 线段批 + 扫描线填充', 96 + dx, 168 + dy, {
      size: 27, weight: 400, family: 'sans', color: css(P.ash), ...enter(0.45),
    });
    if (lt > 2.2) {
      type.writeLine(`${CELLS.x}×${CELLS.y}×${CELLS.z} = ${CELLS.x * CELLS.y * CELLS.z} 个单元`,
        W - 96 + dx, H - 96 + dy, {
          anchor: 'right', size: 30, weight: 700, family: 'mono',
          color: css(P.signal), ...enter(0.0),
        });
    }
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.26, grain: 0.02 };
  },
});
