#!/usr/bin/env node
/**
 * **事件密度**：观众每一秒到底有没有新东西可看。
 *
 *   node tools/lint-event-density.mjs <任务> [--file x.mp4] [--json] [--strict]
 *
 * 为什么要有这条：片子可以完全不报错、qa 也全绿，但观众在第 8 秒就走人。
 * 实测 nekohome-intro-ja（82 秒）：8–15s 连续 7 秒帧间差 < 0.3（糯米卡一次淡入后再没动），
 * 全片 41% 的 2 秒窗口低于平均值一半 —— 这些数字 check 原来一条都看不见。
 *
 * 量法：解码成 4fps / 480×270 灰度，逐帧算平均绝对差（帧间变化量），按 2 秒聚合。
 * 判据（两条，都是观众会走神的经验阈值）：
 *   · 静止跨度：连续帧差 < 0.30 的最长时间 > 3.5s 就警
 *   · 稀薄占比：低于「平均变化量 × 0.5」的 2 秒窗口 > 25% 就警
 * --strict 时任一超标退出码 1。
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { decodeDiffSeries, DIFF_FPS } from './lib/diff-series.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const task = argv.find((a) => !a.startsWith('-'));

const STATIC_DIFF = 0.30;
const STATIC_SPAN = 3.5;
const THIN_SHARE = 0.25;
const FPS = DIFF_FPS;   // 采样口径在 diff-series 里统一（C4），这里只沿用

function findMp4() {
  const explicit = opt('file', '');
  if (explicit) return path.resolve(explicit);
  if (!task) return null;
  const dir = path.join(ROOT, 'out', task);
  if (!existsSync(dir)) return null;
  const cands = readdirSync(dir).filter((f) => f.endsWith('.mp4') && !/^part_|_stitched/.test(f));
  if (!cands.length) return null;
  return path.join(dir, cands.sort((a, b) => statSync(path.join(dir, b)).size - statSync(path.join(dir, a)).size)[0]);
}

const file = findMp4();
if (!file) { console.error('找不到成片（先跑 anim video <任务>，或用 --file 指定 mp4）'); process.exit(2); }

// 解码 + 帧间差走共享的 diff-series（C4：与 anti-ppt C7 同一份，口径一致）
const series = decodeDiffSeries(file);
if (!series) { console.error('ffmpeg 解码失败或帧数太少（<8）'); process.exit(2); }
const { diff, frames: n } = series;

let run = 0, worst = 0, worstAt = 0;
for (let i = 1; i < n; i++) {
  if (diff[i] < STATIC_DIFF) { run++; if (run > worst) { worst = run; worstAt = (i - run) / FPS; } } else run = 0;
}
const staticSpan = worst / FPS;

const win = 2 * FPS;
const agg = [];
for (let i = 1; i + win <= n; i += win) {
  let s = 0;
  for (let j = i; j < i + win; j++) s += diff[j];
  agg.push({ t: +(i / FPS).toFixed(1), v: +(s / win).toFixed(2) });
}
const mean = agg.reduce((s, a) => s + a.v, 0) / Math.max(1, agg.length);
const thin = agg.filter((a) => a.v < mean * 0.5);
const thinShare = agg.length ? thin.length / agg.length : 0;
const worstWins = agg.slice().sort((a, b) => a.v - b.v).slice(0, 4);

const problems = [];
if (staticSpan > STATIC_SPAN) problems.push(`静止跨度 ${staticSpan.toFixed(1)}s（上限 ${STATIC_SPAN}s，从 ${worstAt.toFixed(1)}s 起）`);
if (thinShare > THIN_SHARE) problems.push(`稀薄窗口 ${(thinShare * 100).toFixed(0)}%（上限 ${THIN_SHARE * 100}%）`);

if (flag('json')) {
  console.log(JSON.stringify({
    file: path.relative(ROOT, file), duration: +(n / FPS).toFixed(2), mean: +mean.toFixed(2),
    staticSpan: +staticSpan.toFixed(2), staticAt: +worstAt.toFixed(2),
    thinShare: +thinShare.toFixed(3), windows: agg.length,
    worst: worstWins.map((w) => ({ t: w.t, v: w.v })), problems,
  }, null, 2));
} else {
  console.log('事件密度 —— ' + path.relative(ROOT, file));
  console.log(`  时长 ${(n / FPS).toFixed(1)}s · 平均帧间差 ${mean.toFixed(2)} · 2 秒窗口 ${agg.length} 个`);
  console.log(`  最长静止 ${staticSpan.toFixed(1)}s（从 ${worstAt.toFixed(1)}s 起，判据 ≤ ${STATIC_SPAN}s）`);
  console.log(`  稀薄窗口 ${thin.length}/${agg.length} = ${(thinShare * 100).toFixed(0)}%（判据 ≤ ${THIN_SHARE * 100}%）`);
  console.log('  最静的 4 个窗口: ' + worstWins.map((w) => `${w.t}s(${w.v})`).join('  '));
  console.log('');
  console.log(problems.length ? '⚠ ' + problems.join('；') : '✓ 观众每一段都有东西可看');
}

if (flag('strict') && problems.length) process.exitCode = 1;
