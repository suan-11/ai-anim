// @ts-check
/**
 * carry-sheet —— carry 动作图册的「六帧 + 速度曲线」接片图（BACKLOG 1-37 收尾）。
 *
 * 每个动作一行：左边六张关键帧（段的动作区间等距采样，已由 `anim still` 渲好），
 * 右边一条**速度曲线**——对 {@link src/kit/carry.js} 的同名纯函数在关键帧区间内
 * 数值微分（我方实测，不是对方的速度谱抄写），单位 = 画面逻辑像素 / 秒。
 *
 * 用法：
 *   node scripts/anim.mjs still _carry-lab -t <六时刻> --only <段> -o out/_staging/carry-sheet/<段>
 *   node tools/carry-sheet.mjs            # 读上面那批 PNG，拼出 out/_carry-lab/carry-sheet.png
 *
 * 实现：ffmpeg 解 PNG 成裸 RGBA（仓库惯例，不引图片解码依赖，见 tools/png-rows.mjs）；
 * 曲线直接写进像素缓冲（Bresenham 直线 + 3x5 点阵数字标注，字模取自 src/kit/pixel.js 的 FONT5x7）。
 * 拼图不进版本控制，产物只进 out/——它是看图验收的物料，不是测试。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glyphOf, GLYPH_W, GLYPH_H, GLYPH_TRACKING } from '../src/kit/pixel.js';
import { morphRect, iris, zoomThrough, hop, gather } from '../src/kit/carry.js';
import { makeCam } from '../src/core/cam.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = path.join(ROOT, 'out', '_staging', 'carry-sheet');
const OUT = path.join(ROOT, 'out', '_carry-lab', 'carry-sheet.png');
const FFE = process.env.ANIM_FFMPEG || 'ffmpeg';

/** 每个动作的配置：源目录 / 标题 / 速度函数（返回瞬时位移速率 px/s） */
const ACTIONS = [
  {
    id: 'morph', label: 'morphRect',
    speed: (lt) => {
      const e = 0.02;
      const a = morphRect(lt - e, 0.3, 0.9, [300, 620, 340, 90], [560, 200, 800, 620]);
      const b = morphRect(lt + e, 0.3, 0.9, [300, 620, 340, 90], [560, 200, 800, 620]);
      return Math.hypot(b.x - a.x, b.y - a.y);
    },
    span: [0.3, 1.2],
  },
  {
    id: 'iris', label: 'iris',
    speed: (lt) => {
      const e = 0.02;
      const a = iris(lt - e, 0.25, 0.9).k, b = iris(lt + e, 0.25, 0.9).k;
      return Math.abs(b - a) * 1400; // 半径增速 px/s
    },
    span: [0.25, 1.15],
  },
  {
    id: 'zoom', label: 'zoomThrough',
    speed: (lt) => {
      const e = 0.02;
      const a = zoomThrough(lt - e, 0.5, 0.8, [420, 360, 480, 270], 1920, 1080).s;
      const b = zoomThrough(lt + e, 0.5, 0.8, [420, 360, 480, 270], 1920, 1080).s;
      // 画面被推近的等效位移：中心不动，边缘动 —— 用画面对角线的一半乘 scale 增速近似
      return Math.abs(b - a) * 1101; // hypot(1920,1080)/2
    },
    span: [0.5, 1.3],
  },
  {
    id: 'hop', label: 'hop',
    speed: (lt) => {
      const e = 0.02;
      const a = hop(lt - e, 0.4, 0.8, [420, 640], [1120, 640], { height: 220 });
      const b = hop(lt + e, 0.4, 0.8, [420, 640], [1120, 640], { height: 220 });
      return Math.hypot(b.x - a.x, b.y - a.y);
    },
    span: [0.4, 1.2],
  },
  {
    id: 'gather', label: 'gather',
    speed: (lt) => {
      // 簇心元素的速率（第 0 个 stagger 最早出发）：代表性行程
      const e = 0.02;
      const from = [960 + Math.cos(0) * 560, 540 + Math.sin(0) * 560 * 0.7];
      const a = gather(lt - e, 0.3, 1.4, 0, 12, from, [960, 540], { spread: 46, stagger: 0.05, seed: 7 });
      const b = gather(lt + e, 0.3, 1.4, 0, 12, from, [960, 540], { spread: 46, stagger: 0.05, seed: 7 });
      return Math.hypot(b.x - a.x, b.y - a.y);
    },
    span: [0.3, 2.5],
  },
  {
    id: 'opcam', label: 'operatorCam',
    speed: (lt) => {
      // 主体方块 x 速率（0→1.4s 380px/s；rest 0；落地由 hit 脉冲给出 —— 曲线里也能看出来）
      const v = lt < 1.4 ? 380 : 0;
      return v;
    },
    span: [0.2, 2.6],
  },
];

/** ffmpeg 解 PNG → RGBA 裸缓冲 */
function pngToRgba(file) {
  const probe = execFileSync(process.env.ANIM_FFPROBE || 'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
    { encoding: 'utf8' }).trim().split(',').map(Number);
  const w = probe[0], h = probe[1];
  const raw = execFileSync(FFE, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { maxBuffer: 1 << 30 });
  return { w, h, data: raw };
}

/* ---------- 极简光栅：像素缓冲上的直线与点阵字 ---------- */

/** 一张 RGB 画布 */
class Canvas {
  constructor(w, h, bg) {
    this.w = w; this.h = h;
    this.data = Buffer.alloc(w * h * 3);
    if (bg) { for (let i = 0; i < w * h; i++) { this.data[i*3] = bg[0]; this.data[i*3+1] = bg[1]; this.data[i*3+2] = bg[2]; } }
  }
  px(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.data[i] = c[0]; this.data[i+1] = c[1]; this.data[i+2] = c[2];
  }
  /** Bresenham 直线 */
  line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  /** 5x7 点阵字（复用 src/kit/pixel.js 的导出字模：完整 A-Z / 0-9 / 标点） */
  microText(s, x, y, c, scale = 1) {
    let cx = x;
    for (const ch of String(s).toLowerCase()) {
      const rows = glyphOf(ch);
      for (let r = 0; r < GLYPH_H; r++) for (let col = 0; col < GLYPH_W; col++) {
        if (rows[r][col] === '#') {
          for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++)
            this.px(cx + col * scale + sx, y + r * scale + sy, c);
        }
      }
      cx += (GLYPH_W + GLYPH_TRACKING) * scale;
    }
    return cx - x;
  }

}

/** 把 RGBA 帧缩放拷进画布（简单盒式采样：取 2x2 平均，足够看） */
function blit(cv, rgba, dx, dy, dw, dh) {
  const sx = rgba.w / dw, sy = rgba.h / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(rgba.h - 1, Math.floor((y + 0.5) * sy));
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(rgba.w - 1, Math.floor((x + 0.5) * sx));
      const si = (fy * rgba.w + fx) * 4;
      cv.px(dx + x, dy + y, [rgba.data[si], rgba.data[si+1], rgba.data[si+2]]);
    }
  }
}

/* ---------- 速度曲线 ---------- */

/**
 * 一条动作的速度谱：span 内等距 N 点数值微分，返回归一化曲线 + 峰值。
 * @param {{ speed: (lt: number) => number, span: [number, number] }} a
 * @param {number} n 采样数
 */
function speedProfile(a, n = 160) {
  const [t0, t1] = a.span;
  const vals = [];
  let max = 0;
  for (let i = 0; i < n; i++) {
    const lt = t0 + (t1 - t0) * i / (n - 1);
    const v = a.speed(lt);
    if (Number.isFinite(v)) vals.push(v); else vals.push(0);
    if (vals[i] > max) max = vals[i];
  }
  return { vals, max, n };
}

/** 把速度曲线画进画布（右侧面板），关键帧时刻打竖线刻度 */
function drawProfile(cv, prof, times, x, y, w, h, c, cAxis) {
  // 轴
  cv.line(x, y + h, x + w, y + h, cAxis);
  cv.line(x, y, x, y + h, cAxis);
  // 曲线
  const n = prof.vals.length;
  let prev = null;
  for (let i = 0; i < n; i++) {
    const px = x + w * i / (n - 1);
    const py = y + h - (prof.max > 0 ? prof.vals[i] / prof.max : 0) * (h - 8) - 2;
    if (prev) cv.line(prev[0], prev[1], px, py, c);
    prev = [px, py];
  }
  // 关键帧时刻的竖线刻度（与左边六帧对位）
  const [t0, t1] = arguments[8] ?? [0, 1];
  for (const t of times) {
    const f = (t - t0) / (t1 - t0);
    if (f < 0 || f > 1) continue;
    const px = Math.round(x + w * f);
    for (let yy = y; yy <= y + h; yy += 3) cv.px(px, yy, cAxis);
  }
}

/* ---------- 主流程 ---------- */

const CELL_W = 480, CELL_H = 270;   // 六帧缩略（1920x1080 的 1/4）
const PAD = 8, LABEL_H = 18;
const PROF_W = 520, PROF_H = CELL_H;
const ROW_W = PAD + 6 * (CELL_W + PAD) + PROF_W + PAD;
const ROW_H = LABEL_H + CELL_H + PAD;

const filesOf = (dir) => readdirSync(dir).filter(f => f.endsWith('.png')).sort();

const rows = [];
for (const a of ACTIONS) {
  const dir = path.join(STAGE, a.id);
  if (!existsSync(dir)) { console.error(`缺目录 ${dir} —— 先跑 anim still\n`); process.exit(2); }
  const files = filesOf(dir);
  if (files.length !== 6) { console.error(`${a.id}: 需要 6 帧，实有 ${files.length}\n`); process.exit(2); }
  const times = files.map(f => Number(/f_(\d+)\.(\d+)\.png$/.exec(f)[0].slice(2, -4).replace('_', '.')));
  rows.push({ a, files: files.map(f => path.join(dir, f)), times });
}

const cv = new Canvas(ROW_W, rows.length * ROW_H + PAD, [24, 24, 26]);
const INK = [221, 221, 221], DIM = [110, 110, 116], SIG = [255, 122, 40], AX = [70, 70, 76];

rows.forEach((row, r) => {
  const y0 = PAD + r * ROW_H;
  cv.microText(row.a.label, PAD, y0 + 4, INK, 2);
  cv.microText(`v px/s`, PAD + 8 * 2 * (row.a.label.length + 1) + 40, y0 + 4, DIM, 2);
  const prof = speedProfile(row.a);
  cv.microText(`peak ${Math.round(prof.max)}/s`, ROW_W - 120, y0 + 4, DIM, 2);

  row.files.forEach((f, i) => {
    const rgba = pngToRgba(f);
    const x = PAD + i * (CELL_W + PAD);
    blit(cv, rgba, x, y0 + LABEL_H, CELL_W, CELL_H);
    cv.microText(row.times[i].toFixed(2) + 's', x + 2, y0 + LABEL_H + 2, [20, 20, 20], 2);
  });

  // 速度面板
  const pxx = PAD + 6 * (CELL_W + PAD), pyy = y0 + LABEL_H;
  const [t0, t1] = row.a.span;
  // —— 重画带关键帧刻度的版本（把 span 传进去）
  drawProfile(cv, prof, row.times, pxx, pyy, PROF_W, PROF_H, SIG, AX, [t0, t1]);
  cv.microText('0', pxx, pyy + PROF_H + 4, DIM, 1);
  cv.microText('t0', pxx - 4, pyy + PROF_H + 4, DIM, 1);
  cv.microText('t1', pxx + PROF_W - 8, pyy + PROF_H + 4, DIM, 1);
});

mkdirSync(path.dirname(OUT), { recursive: true });
// 写 PNG：借 ffmpeg 从 rawvideo 编码
const raw = cv.data;
execFileSync(FFE, ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${cv.w}x${cv.h}`,
  '-i', '-', '-frames:v', '1', '-pix_fmt', 'rgb24', OUT], { input: raw, maxBuffer: 1 << 30 });
console.log(`carry-sheet -> ${path.relative(ROOT, OUT)}  (${cv.w}x${cv.h})`);
