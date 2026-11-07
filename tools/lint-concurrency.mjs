#!/usr/bin/env node
/**
 * tools/lint-concurrency.mjs —— **同时运动元素**判据（1/3 规则的可测版）。
 *
 *   node tools/lint-concurrency.mjs <任务> [--file x.mp4] [--fps 8] [--area 0.33] [--cell 8] [--blocks 6] [--strict]
 *
 * 「太吵」在观众那边是可测的：**一帧里有三分之一的画面在动**，眼睛就不知道看哪。
 * 这条判据量两件事（都从成片解帧算，纯 ffmpeg + JS，不需要浏览器）：
 *
 *   · **变化面积占比**：相邻两帧之间，有多少个栅格块真的变了（|Δ| > 阈值）；
 *   · **同时运动的块数**：变化块的**连通分量**个数（一堆碎点算 1 个，两团分开算 2 个）。
 *
 * 判据（默认**只报不拦**，`--strict` 才当门）：
 *   面积占比中位 > --area（默认 1/3）⇒ 报「一屏里同时在动的东西太多」；
 *   同时运动块数中位 > 6 ⇒ 报（信息项：块多不等于错，但值得看一眼）。
 *
 * 为什么默认不拦：打斗/故障风/蒙太奇的短段落**本来就该整屏在动**；这条是提问清单，不是物理规格。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const strict = flag('strict');

const FPS = Number(opt('fps', '8'));
const W = 384, H = 216;
// 栅格块边长（像素）。⚠ 曾宣传过 `--cells 48`，但代码只读 `--cell` —— 传错了是静默无效。
// 现在两个都收（`--cells` 当别名），并且写错名字（--cellz）会报出来，不静默。
const CELL = Number(opt('cells', opt('cell', '8')));
{ // 认不出的 --选项就报出来（这个文件自己的文档写着「写错当场抛，不静默」）
  const known = ['fps', 'cell', 'cells', 'thr', 'area', 'blocks', 'file', 'strict', 'json'];
  const unknown = argv.filter((a) => a.startsWith('--') && !known.includes(a.slice(2)) && !/^--\d/.test(a));
  if (unknown.length) {
    console.error('✗ 认不出这些选项：' + unknown.join(' ') + '\n  可用：--' + known.join(' / --'));
    process.exit(2);
  }
}
const THR = Number(opt('thr', '6'));         // 块内平均 |Δ| 超过这个值算「变了」
const AREA_MAX = Number(opt('area', '0.33'));
const BLOCKS_MAX = Number(opt('blocks', '6'));

/**
 * 把两帧的灰度差压成栅格：返回 { cols, rows, mask: Uint8Array, share }
 * @param {Uint8Array} prev @param {Uint8Array} cur
 */
export function cellMask(prev, cur, w, h, cell = CELL, thr = THR) {
  const cols = Math.floor(w / cell), rows = Math.floor(h / cell);
  const mask = new Uint8Array(cols * rows);
  let changed = 0;
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      let sum = 0, n = 0;
      for (let y = ry * cell; y < (ry + 1) * cell; y++) {
        const base = y * w + rx * cell;
        for (let x = 0; x < cell; x++) { sum += Math.abs(cur[base + x] - prev[base + x]); n++; }
      }
      if (sum / n > thr) { mask[ry * cols + rx] = 1; changed++; }
    }
  }
  return { cols, rows, mask, share: changed / (cols * rows) };
}

/**
 * 4-邻接连通分量（只数面积 ≥ minCells 的块，碎点不算一个「运动主体」）。
 * @returns {{ count: number, sizes: number[] }}
 */
export function components({ cols, rows, mask }, minCells = 2) {
  const seen = new Uint8Array(mask.length);
  const sizes = [];
  const stack = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let size = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % cols, y = (p - x) / cols;
      const nb = [y > 0 ? p - cols : -1, y < rows - 1 ? p + cols : -1, x > 0 ? p - 1 : -1, x < cols - 1 ? p + 1 : -1];
      for (const q of nb) if (q >= 0 && mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
    }
    if (size >= minCells) sizes.push(size);
  }
  return { count: sizes.length, sizes: sizes.sort((a, b) => b - a) };
}

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
const task = argv.find((a) => !a.startsWith('--') && !/^[\d.]+$/.test(a));
const explicit = opt('file', '');
let file = explicit ? path.resolve(explicit) : '';
if (!file && task) {
  const dir = path.join(ROOT, 'out', task);
  if (existsSync(dir)) {
    const cands = readdirSync(dir).filter((f) => f.endsWith('.mp4') && !/^part_|_stitched/.test(f));
    if (cands.length) file = path.join(dir, cands.sort((a, b) => statSync(path.join(dir, b)).size - statSync(path.join(dir, a)).size)[0]);
  }
}
if (!file) { console.error('找不到成片：给 <任务>（读 out/<任务>/*.mp4）或 --file x.mp4'); process.exit(2); }

const r = spawnSync(process.env.ANIM_FFMPEG || 'ffmpeg',
  ['-v', 'error', '-i', file, '-vf', `fps=${FPS},scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
  { maxBuffer: 1 << 30 });
if (r.status !== 0) { console.error('ffmpeg 解码失败：' + String(r.stderr).split('\n')[0]); process.exit(2); }
const raw = r.stdout, FS = W * H, n = Math.floor(raw.length / FS);
if (n < 8) { console.error('帧数太少（' + n + '）'); process.exit(2); }

// 切点处的整屏变化不是「同时运动」—— 那是换镜头。给了任务名就从段表取切点，附近 0.25s 的样本跳过。
let cutTimes = [];
let cutsSkipped = 0;
if (task) {
  try {
    const { build } = await import('../src/timeline.js');
    const cfg = (await import(new URL('../tasks/' + task + '/task.config.mjs', import.meta.url).href)).default;
    const segs = build(cfg.timeline, { bpm: 120, duration: cfg.duration ?? 0 });
    cutTimes = segs.slice(1).map((s) => Number(s.start));
  } catch { cutTimes = []; }
}
const nearCut = (t) => cutTimes.some((c) => Math.abs(t - c) < 0.25);

const shares = [], blocks = [], worst = [];
for (let i = 1; i < n; i++) {
  const tNow = i / FPS;
  if (cutTimes.length && nearCut(tNow)) { cutsSkipped++; continue; }
  const prev = raw.subarray((i - 1) * FS, i * FS);
  const cur = raw.subarray(i * FS, (i + 1) * FS);
  const m = cellMask(prev, cur, W, H, CELL, THR);
  const c = components(m);
  shares.push(m.share);
  blocks.push(c.count);
  worst.push({ t: +(i / FPS).toFixed(1), share: +m.share.toFixed(3), blocks: c.count });
}
const medShare = median(shares), maxShare = Math.max(...shares);
const medBlocks = median(blocks), maxBlocks = Math.max(...blocks);
const hot = worst.filter((x) => x.share > AREA_MAX).sort((a, b) => b.share - a.share).slice(0, 4);

const problems = [];
if (medShare > AREA_MAX) problems.push('变化面积占比中位 ' + (medShare * 100).toFixed(0) + '%（上限 ' + (AREA_MAX * 100).toFixed(0) + '%）—— 一屏里同时在动的东西太多');
if (medBlocks > BLOCKS_MAX) problems.push('同时运动的主体中位 ' + medBlocks + ' 个（参考上限 ' + BLOCKS_MAX + ' 个）—— 眼睛不知道看哪');

if (flag('json')) {
  console.log(JSON.stringify({ task, file: path.relative(ROOT, file).replace(/\\/g, '/'), frames: n, medShare, maxShare, medBlocks, maxBlocks, hot, problems }, null, 2));
} else {
  console.log('同时运动：' + (task || path.basename(file)) + '  ' + n + ' 帧 @' + FPS + 'fps  ' + (W + 'x' + H) + '  块 ' + CELL + 'px');
  console.log('  · 变化面积占比：中位 ' + (medShare * 100).toFixed(0) + '% · 最大 ' + (maxShare * 100).toFixed(0) + '%（判据 ≤' + (AREA_MAX * 100).toFixed(0) + '%）');
  console.log('  · 同时运动主体：中位 ' + medBlocks + ' 个 · 最大 ' + maxBlocks + ' 个（参考 ≤' + BLOCKS_MAX + '）'
    + (cutsSkipped ? '\n  · 已跳过 ' + cutsSkipped + ' 个切点附近的样本（换镜头不是「同时运动」）' : ''));
  if (hot.length) console.log('  · 最挤的时刻：' + hot.map((x) => x.t + 's ' + (x.share * 100).toFixed(0) + '%/' + x.blocks + '块').join(' · '));
  if (problems.length) {
    console.log('');
    for (const p of problems) console.log('  ⚠ ' + p);
    console.log(strict ? '\n✗ --strict：' + problems.length + ' 条超参考（打斗/故障风可以写 --area 1 放行）'
      : '\n⚠ ' + problems.length + ' 条超参考 —— 默认只报不拦（要当门加 --strict）');
  } else {
    console.log('\n✓ 没有「一屏都在动」的段落');
  }
}
if (problems.length && strict) process.exitCode = 1;
}
