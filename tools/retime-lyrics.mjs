#!/usr/bin/env node
// @ts-check
/**
 * tools/retime-lyrics.mjs —— 把歌词片的**句首**挪到人声起音上（纯 JS，不起浏览器）。
 *
 *   node tools/retime-lyrics.mjs pv-kattachi            # 只报预测（dry-run，不改文件）
 *   node tools/retime-lyrics.mjs pv-kattachi --apply    # 写回 task.config.mjs
 *
 * 为什么需要它：`lint-lyric-sync` 量的是「句首离人声起音多远」，红了要人一句句调；
 * 这里把「读起音 → 算位移 → 改写 dur」机械化，改完再跑 lint 验收。
 *
 * ⚠ **自动吸附只在「整片统一偏移」时可靠**。逐句吸附到「最近的起音」会把句首拉到**别的字**的起音上：
 *   实测 pv-kattachi 从 中位 103 / p90 525 变成 中位 92 / p90 602 —— 更差。
 *   所以默认 dry-run，`--apply` 只在你确认「这一支是整体偏移」时才用；改完必须人工核听最后几句。
 *
 * 做法（只动 `const T = [ [dur, 'mode', "jp", "zh"], … ]` 这一个数组）：
 *   1. 用与 `lint-lyric-sync` **完全相同**的算法从 `audio/<轨>.analysis.json` 的 vocal 通道取起音；
 *   2. 每行当前起点 = 前缀和；目标起点 = 最近的起音；
 *   3. 位移从**上一行的 dur** 里借、还给本行（总时长不变），单次位移有上限；
 *   4. 只处理 |位移| > 阈值的行，其余原样 —— 已是准的行不要被搅动。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const task = argv.find((a) => !a.startsWith('--') && !/^[\d.]+$/.test(a));
const apply = argv.includes('--apply');
const minShift = Number(opt('min-shift', '250')) / 1000;
const maxShift = Number(opt('max-shift', '1.2'));
const minDur = Number(opt('min-dur', '0.6'));
if (!task) { console.error('用法：node tools/retime-lyrics.mjs <任务> [--apply] [--min-shift 250] [--max-shift 1.2]'); process.exit(2); }

const dir = path.join(ROOT, 'tasks', task);
const cfgPath = path.join(dir, 'task.config.mjs');
if (!existsSync(cfgPath)) { console.error('✗ 没有 ' + cfgPath); process.exit(2); }
const src = readFileSync(cfgPath, 'utf8');

/* ── 1. 起音：与 lint-lyric-sync 同一套 ─────────────────────────────── */
const adir = path.join(dir, 'audio');
const analyses = existsSync(adir) ? readdirSync(adir).filter((f) => f.endsWith('.analysis.json')) : [];
if (!analyses.length) { console.error('✗ tasks/' + task + '/audio 里没有 *.analysis.json —— 先跑 anim analyze'); process.exit(2); }
const A = JSON.parse(readFileSync(path.join(adir, analyses[0]), 'utf8'));
const v = A.vocal, fps = A.fps;
if (!v || !fps) { console.error('✗ ' + analyses[0] + ' 里没有 vocal / fps'); process.exit(2); }
const sm = v.map((_, i) => { let s = 0, c = 0; for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < v.length) { s += v[j]; c++; } } return s / c; });
const on = sm.map((x, i) => (i ? Math.max(0, x - sm[i - 1]) : 0));
const mx = Math.max(...on) || 1;
const onsets = [];
for (let i = 1; i < on.length - 1; i++) {
  if (on[i] / mx > 0.18 && on[i] >= on[i - 1] && on[i] >= on[i + 1]) {
    const t = i / fps;
    if (!onsets.length || t - onsets[onsets.length - 1] > 0.5) onsets.push(t);
  }
}

/* ── 2. 读出 T 数组里每一行的 dur 与文本 ─────────────────────────── */
const blockRe = /const T = \[[\s\S]*?\n\];/;
const block = src.match(blockRe);
if (!block) { console.error('✗ 找不到 `const T = [ … ];` 这一段'); process.exit(2); }
const rowRe = /^(\s*)\[([\d.]+), '(\w+)', "((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)"\],?\s*$/;
const rows = [];
for (const line of block[0].split(/\r?\n/)) {
  const m = line.match(rowRe);
  if (m) rows.push({ indent: m[1], dur: Number(m[2]), mode: m[3], jp: m[4], zh: m[5], raw: line });
}
if (!rows.length) { console.error('✗ T 里没有解析到行（格式变了？）'); process.exit(2); }

/* ── 3. 计算目标起点 ─────────────────────────────────────────────── */
const nearest = (t) => onsets.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), onsets[0]);
let start = 0;
const plan = rows.map((r, i) => {
  const p = { i, start };
  start += r.dur;
  const nb = nearest(p.start);
  p.want = nb;
  p.dMs = Math.round((p.start - nb) * 1000);
  return p;
});
const shifts = plan.map((p) => {
  if (Math.abs(p.want - p.start) <= minShift) return 0;
  return Math.max(-maxShift, Math.min(maxShift, p.want - p.start));
});
for (let i = 1; i < rows.length; i++) {
  if (!shifts[i]) continue;
  const s = shifts[i];
  const borrow = Math.min(Math.abs(s), Math.max(0, rows[i - 1].dur - minDur));
  const eff = Math.sign(s) * Math.min(Math.abs(s), borrow);
  rows[i - 1].dur = +(rows[i - 1].dur - eff).toFixed(3);
  rows[i].dur = +(rows[i].dur + eff).toFixed(3);
}

/* ── 4. 预测 + 写回 ──────────────────────────────────────────────── */
let cur = 0;
const after = rows.map((r) => {
  const p0 = cur; cur += r.dur;
  const nb = nearest(p0);
  return { start: p0, dMs: Math.round((p0 - nb) * 1000) };
});
const abs = after.map((r) => Math.abs(r.dMs)).sort((a, b) => a - b);
const med = abs[Math.floor(abs.length / 2)];
const p90 = abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.9))];
console.log('行数 ' + rows.length + ' · 起音 ' + onsets.length + ' 个');
console.log('预测：中位 ' + med + 'ms · p90 ' + p90 + 'ms（判据 150 / 400）');
if (!apply) {
  const worst = after.map((r, i) => ({ ...r, text: rows[i].jp })).sort((a, b) => Math.abs(b.dMs) - Math.abs(a.dMs)).slice(0, 5);
  for (const w of worst) console.log('  ' + w.start.toFixed(2) + 's  ' + (w.dMs >= 0 ? '+' : '') + w.dMs + 'ms  ' + w.text);
  console.log('（dry-run；加 --apply 写回）');
  process.exit(p90 <= 400 && med <= 150 ? 0 : 1);
}
const out = block[0].split(/\r?\n/).map((line) => {
  const m = line.match(rowRe);
  if (!m) return line;
  const r = rows.find((x) => x.raw === line);
  const q = String.fromCharCode(34);   // 双引号
  return r.indent + '[' + r.dur + ", '" + r.mode + "', " + q + r.jp + q + ', ' + q + r.zh + q + '],';
});
fs.writeFileSync(cfgPath, src.replace(block[0], out.join('\n')), 'utf8');
console.log('已写回 ' + cfgPath);
