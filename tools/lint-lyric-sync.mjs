#!/usr/bin/env node
/**
 * tools/lint-lyric-sync.mjs —— **歌词是否跟得上人声**（纯 JS，不起浏览器）。
 *
 *   node tools/lint-lyric-sync.mjs pv-king              # 默认：中位 ≤150ms 且 p90 ≤400ms
 *   node tools/lint-lyric-sync.mjs pv-king --json
 *
 * 为什么需要它：lint-beat-align 量的是「切点离拍多远」，可歌词视频真正被听见的问题是
 * 「这句字先出来 / 后出来」。实测代价：第一版 PV 按字数均摊句长，句首离真人声**中位 366ms、最差 8.7s**
 * （前奏长度猜错），用户一句「没有卡点啊喂」就是这个。
 *
 * 判据：段首到**人声起音**（vocal 包络正差分峰）的距离分布。中位 ≤150ms 且 p90 ≤400ms。
 * 起音只用 audio/<轨>.analysis.json 的 vocal 通道 —— 和画面同一份分析，不额外依赖。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/timeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const task = argv.find((a) => !a.startsWith('--') && !/^[\d.]+$/.test(a));
if (!task) { console.error('用法：node tools/lint-lyric-sync.mjs <任务> [--json] [--median 150] [--p90 400]'); process.exit(2); }
const medianTol = Number(opt('median', '150'));
const p90Tol = Number(opt('p90', '400'));
const minChars = Number(opt('min-chars', '4'));

const dir = path.join(ROOT, 'tasks', task);
if (!existsSync(dir)) { console.error('✗ 没有任务 ' + task); process.exit(2); }
const mod = await import(new URL('../tasks/' + task + '/task.config.mjs', import.meta.url).href);
const cfg = mod.default ?? mod.config;

const adir = path.join(dir, 'audio');
const analyses = existsSync(adir) ? readdirSync(adir).filter((f) => f.endsWith('.analysis.json')) : [];
if (!analyses.length) { console.error('✗ tasks/' + task + '/audio 里没有 *.analysis.json —— 先跑 anim analyze'); process.exit(2); }
const A = JSON.parse(readFileSync(path.join(adir, analyses[0]), 'utf8'));
const v = A.vocal, fps = A.fps;
if (!v || !fps) { console.error('✗ ' + analyses[0] + ' 里没有 vocal / fps'); process.exit(2); }

// 人声起音：5 帧平滑后的正差分峰，间隔 ≥0.5s
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
if (onsets.length < 4) { console.log('· 人声起音只有 ' + onsets.length + ' 个 —— 这条片子没有可比的唱段'); process.exit(2); }

// 段表：挑出「带一句字」的段
const built = build(cfg.timeline, { bpm: A.bpm, duration: A.duration });
const segs = Array.isArray(built) ? built : (built.segments ?? []);
const lyricSegs = segs.filter((s) => {
  const tx = s.params?.text ?? s.text;
  return typeof tx === 'string' && [...tx.replace(/\s/g, '')].length >= minChars;
});
if (lyricSegs.length < 4) { console.log('· 这条片子只有 ' + lyricSegs.length + ' 句带字 —— 不是歌词片，这一项没得查'); process.exit(2); }

const nearest = (arr, t) => arr.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), arr[0]);
const rows = lyricSegs.map((s) => {
  const start = Number(s.start);
  const nb = nearest(onsets, start);
  const tx = String(s.params?.text ?? s.text ?? '').replace(/\s+/g, ' ').slice(0, 18);
  return { start, text: tx, onset: +nb.toFixed(3), dMs: Math.round((start - nb) * 1000) };
}).filter((r) => r.start > 0.001);

const abs = rows.map((r) => Math.abs(r.dMs)).sort((a, b) => a - b);
const med = abs[Math.floor(abs.length / 2)];
const p90 = abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.9))];
const worst = [...rows].sort((a, b) => Math.abs(b.dMs) - Math.abs(a.dMs)).slice(0, 5);
const ok = med <= medianTol && p90 <= p90Tol;

if (flag('json')) {
  console.log(JSON.stringify({ task, audio: analyses[0], lines: rows.length, onsets: onsets.length, medianMs: med, p90Ms: p90, medianTol, p90Tol, ok, worst }, null, 2));
} else {
  console.log('人声起音 ' + onsets.length + ' 个 · 词句 ' + rows.length + ' 句 · 判据 中位 ≤' + medianTol + 'ms / p90 ≤' + p90Tol + 'ms');
  if (ok) {
    console.log('✓ 歌词跟得上人声（中位 ' + med + 'ms · p90 ' + p90 + 'ms）');
  } else {
    console.log('✗ 歌词没跟上人声（中位 ' + med + 'ms · p90 ' + p90 + 'ms）—— 最差的 5 句：');
    for (const w of worst) console.log('   ' + w.start.toFixed(2) + 's  ' + (w.dMs >= 0 ? '+' : '') + w.dMs + 'ms  ' + w.text);
    console.log('   → 句首用官方 LRC / 人声起音，别按字数均摊');
  }
}
if (!ok) process.exitCode = 1;
