#!/usr/bin/env node
/**
 * tools/lint-cut-beats.mjs —— **切点是否踩在拍上**（纯 JS，不起浏览器）。
 *
 *   node tools/lint-cut-beats.mjs pv-kattachi            # 默认容差 ±30ms
 *   node tools/lint-cut-beats.mjs pv-kattachi --bar      # 要求踩在**小节**上（4 拍）
 *   node tools/lint-cut-beats.mjs pv-kattachi --json     # 机器可读
 *
 * 为什么需要它：`check` 的「卡点」那行只在**旁白/节拍解出段长**时才跑
 * （它读 `audio/timing.json`）。纯音乐片子没有那张表 —— 于是段长随手写的也不会有人报，
 * 观众一句话就能听出来：「没有卡点啊喂」（2026-10-31 用户原话，PV 第一版 39 段全凭字数分配）。
 *
 * 判据：把段表 `build()` 出来，取每个内部切点，量它到**最近的拍**的距离。
 * 拍表用 `audio/<轨>.analysis.json` 的 `beats`（引擎测出来的实测拍，不是 bpm 均匀网格）；
 * 同时给出到小节线（downbeats）的距离，方便判断「踩拍」还是「踩小节」。
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
if (!task) {
  console.error('用法：node tools/lint-cut-beats.mjs <任务> [--tol 30] [--bar] [--json]');
  process.exit(2);
}
const tolMs = Number(opt('tol', '30'));
const wantBar = flag('bar');

const dir = path.join(ROOT, 'tasks', task);
if (!existsSync(dir)) {
  console.error('✗ 没有任务 ' + task);
  process.exit(2);
}

const mod = await import(new URL('../tasks/' + task + '/task.config.mjs', import.meta.url).href);
const cfg = mod.default ?? mod.config;
if (!cfg?.timeline) {
  console.error('✗ 这条任务没有导出 timeline');
  process.exit(2);
}

// —— 拍表：优先 music 轨，其次旁白轨，最后任何一个 analysis.json
const audioDir = path.join(dir, 'audio');
const analyses = existsSync(audioDir)
  ? readdirSync(audioDir).filter((f) => f.endsWith('.analysis.json'))
  : [];
if (!analyses.length) {
  console.error('✗ tasks/' + task + '/audio 里没有 *.analysis.json —— 先跑 `node scripts/anim.mjs analyze ' + task + '`');
  process.exit(2);
}
const wanted = [];
if (typeof cfg.audio === 'string') wanted.push(cfg.audio);
else if (cfg.audio?.music) wanted.push(cfg.audio.music);
if (cfg.audio?.vo) wanted.push(cfg.audio.vo);
const pick = analyses.find((f) => wanted.some((w) => path.basename(String(w), '.mp3') === path.basename(f, '.analysis.json')))
  ?? analyses[0];
const A = JSON.parse(readFileSync(path.join(audioDir, pick), 'utf8'));
const beats = (A.beats ?? []).map((b) => (typeof b === 'number' ? b : b.t)).sort((a, b) => a - b);
const bars = (A.downbeats ?? []).map((b) => (typeof b === 'number' ? b : b.t)).sort((a, b) => a - b);
if (!beats.length) {
  console.error('✗ ' + pick + ' 里没有 beats');
  process.exit(2);
}

// —— 段表：build() 在 Node 里也能跑（不需要 GPU/浏览器）
const built = build(cfg.timeline, { bpm: A.bpm, duration: A.duration });
const segs = Array.isArray(built) ? built : (built.segments ?? []);
const cuts = [...new Set(segs.map((s) => Number(s.start)).filter((t) => t > 0.001).map((t) => Math.round(t * 1000) / 1000))]
  .sort((a, b) => a - b);
if (!cuts.length) {
  console.log('· 这条时间线只有一个镜头（没有内部切点）—— 这一项没有可查的对象。');
  process.exit(0);
}

const nearest = (arr, t) => arr.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), arr[0]);
const rows = cuts.map((t) => {
  const nb = nearest(beats, t);
  const nbar = bars.length ? nearest(bars, t) : null;
  return { t, beat: nb, dMs: Math.round((t - nb) * 1000), bar: nbar, dBarMs: nbar == null ? null : Math.round((t - nbar) * 1000) };
});
const ref = wantBar && bars.length ? 'bar' : 'beat';
const value = (r) => (ref === 'bar' ? r.dBarMs : r.dMs);
const bad = rows.filter((r) => Math.abs(value(r)) > tolMs);
const worst = [...rows].sort((a, b) => Math.abs(value(b)) - Math.abs(value(a))).slice(0, 5);
const mean = rows.reduce((a, r) => a + Math.abs(value(r)), 0) / rows.length;

if (flag('json')) {
  console.log(JSON.stringify({
    task, audio: pick, bpm: A.bpm, ref, tolMs,
    cuts: rows.length, bad: bad.length, meanAbsMs: Math.round(mean * 10) / 10,
    rows,
  }, null, 2));
} else {
  console.log('拍表 ' + pick + ' · bpm ' + A.bpm + ' · ' + beats.length + ' 拍 / ' + bars.length + ' 小节 · 切点 ' + rows.length + ' 个');
  if (bad.length) {
    console.log('✗ ' + bad.length + '/' + rows.length + ' 个切点偏离' + (ref === 'bar' ? '小节' : '拍') + '超过 ±' + tolMs + 'ms（最差 ' + Math.abs(value(worst[0])) + 'ms）：');
    for (const r of worst) {
      console.log('   ' + r.t.toFixed(2) + 's  离拍 ' + r.dMs + 'ms' + (r.dBarMs == null ? '' : '  离小节 ' + r.dBarMs + 'ms'));
    }
  } else {
    console.log('✓ ' + rows.length + '/' + rows.length + ' 个切点都在 ±' + tolMs + 'ms 内（平均 |偏差| ' + mean.toFixed(1) + 'ms）');
  }
}
if (bad.length) process.exitCode = 1;
