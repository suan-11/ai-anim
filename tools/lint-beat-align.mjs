#!/usr/bin/env node
/**
 * **卡点检测**：切点到底有没有落在拍上（BACKLOG 新增）。
 *
 *   node tools/lint-beat-align.mjs <任务> [--tol 30] [--json] [--strict]
 *
 * 为什么不能只信 `audio/<轨>.analysis.json` 的 `beats`：那份网格是**估计**出来的，
 * 实测它对合成床有 4% 的偏差（名义 80bpm，它报 83.3，首拍还偏了 50ms）——
 * 拿它当尺子会把「完美卡点」误判成「全都没对上」。所以这里**从音频自己重建网格**：
 * 起音 → 间隔中位数 = 一拍；相位用圆周平均；再拿切点去对。
 *
 * 判据：切点与最近网格线的偏差 ≤ `--tol`（毫秒，默认 30）。
 *
 * ⚠ **必须做最小二乘精修**：起音按 10ms 帧量出来（±5ms 抖动），周期只靠中位数/格点打分只能定到 ±0.5%；
 *   33 秒的曲子末尾就会漂 200ms —— 会把「其实很齐」判成「全都没对上」（spectrum 就被误判过一次）。
 * 退出码：默认 0（只报读数）；`--strict` 时只要有偏差超限就是 1。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const task = argv.find((a) => !a.startsWith('-'));
if (!task) { console.error('用法：node tools/lint-beat-align.mjs <任务> [--tol 30] [--json] [--strict]'); process.exit(2); }

const taskDir = path.join(ROOT, 'tasks', task);
const gridOnly = existsSync(path.join(taskDir, 'rhythm.json'));
const timingPath = opt('timing', '') || path.join(taskDir, 'audio', 'timing.json');
if (!existsSync(timingPath)) { console.error('没有 audio/timing.json —— 先跑 anim say'); process.exit(2); }

/** 找音轨：优先 task.config.mjs 里 audio.music 指的那个，否则取 audio/ 下最大的音频文件 */
function findTrack() {
  const cfg = path.join(taskDir, 'task.config.mjs');
  if (existsSync(cfg)) {
    const m = /music:\s*'\.\/([^']+)'/.exec(readFileSync(cfg, 'utf8'));
    if (m) { const p = path.join(taskDir, m[1]); if (existsSync(p)) return p; }
  }
  const dir = path.join(taskDir, 'audio');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(wav|mp3|m4a|flac)$/i.test(f)) : [];
  if (!files.length) return null;
  return path.join(dir, files.sort((a, b) => statSync(path.join(dir, b)).size - statSync(path.join(dir, a)).size)[0]);
}

const track = findTrack();
if (!track) { console.error('任务里没有音频文件'); process.exit(2); }

/** 解码成 8k 单声道 f32 并检测起音（低频包络上升沿） */
function onsets(file) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'anim-beat-'));
  const raw = path.join(tmp, 'a.f32');
  const r = spawnSync(process.env.ANIM_FFMPEG || 'ffmpeg', ['-v', 'error', '-y', '-i', file, '-ac', '1', '-ar', '8000', '-f', 'f32le', raw], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('ffmpeg 解码失败：' + (r.stderr || '').split('\n')[0]); process.exit(2); }
  const buf = readFileSync(raw);
  rmSync(tmp, { recursive: true, force: true });
  const n = Math.floor(buf.length / 4);
  const sr = 8000, hop = 80;                       // 10ms 一帧
  const env = [];
  const low = [];
  // 低频包络（底鼓）与全带包络分开：拍长要用底鼓这类"强起音"来量，别被踩镲带偏
  let lp = 0;
  for (let i = 0; i + hop < n; i += hop) {
    let s = 0, sl = 0;
    for (let j = 0; j < hop; j++) {
      const v = buf.readFloatLE((i + j) * 4);
      s += v * v;
      lp += (v - lp) * 0.05;                       // 一阶低通，留低频
      sl += lp * lp;
    }
    env.push(Math.sqrt(s / hop) + Math.sqrt(sl / hop));
    low.push(Math.sqrt(sl / hop));
  }
  const peak = Math.max(...low, 1e-9);
  const out = [];
  for (let i = 2; i < low.length; i++) {
    const rising = low[i] > low[i - 1] * 1.5 && low[i] > low[i - 2] * 1.5 && low[i] > peak * 0.35;
    if (!rising) continue;
    const t = (i * hop) / sr;
    if (!out.length || t - out[out.length - 1] > 0.15) out.push(t);
  }
  return out;
}

const ons = onsets(track);
if (ons.length < 8) { console.error('起音太少（' + ons.length + '），这条轨大概没有明显节拍'); process.exit(2); }

// 一拍 = 间隔中位数；相位 = 各起音对 T 的余数的圆周平均
const d = [];
for (let i = 1; i < ons.length; i++) { const g = ons[i] - ons[i - 1]; if (g > 0.25 && g < 2.6) d.push(g); }
d.sort((a, b) => a - b);
const rawT = d[Math.floor(d.length / 2)];
/**
 * 拍长候选：中位数本身 + 它的 1/2、2 倍。
 * 选谁，看**格点吻合率**：把起音按候选拍长折到网格上，数落在 20ms 内的比例，取最高。
 * （不这么做，踩镲（半拍）会把"一拍"量成半拍 —— 实测 80bpm 的床上量出 97.6bpm 就是这个坑。）
 */
function fitScore(Tc) {
  let sx2 = 0, sy2 = 0;
  for (const t of ons) { const f = (t % Tc) / Tc * 2 * Math.PI; sx2 += Math.cos(f); sy2 += Math.sin(f); }
  let ph = (Math.atan2(sy2, sx2) / (2 * Math.PI)) * Tc;
  if (ph < 0) ph += Tc;
  let hit = 0;
  for (const t of ons) {
    const k = Math.round((t - ph) / Tc);
    if (Math.abs(t - (ph + k * Tc)) <= 0.020) hit++;
  }
  return { T: Tc, phase: ph, score: hit / ons.length };
}
const cands = [rawT, rawT * 2, rawT / 2].filter((v) => v > 0.25 && v < 2.6);
const best = cands.map(fitScore).sort((a, b) => b.score - a.score)[0];

/**
 * **最小二乘精修**：给每个起音分配拍号 k，拟合 t = phase + k·T。
 * 为什么必须有这一步：起音是按 10ms 帧量出来的（±5ms 抖动），而 33 秒的曲子只要 T 差 0.6%
 * 末尾就漂 200ms —— 靠"间隔中位数/格点打分"只能把它定到 ±0.5%，会把「其实很齐」误判成「全都没对上」。
 * 迭代两遍：先用粗 T 定 k，再用回归出的 T 重新定 k。
 */
function refineGrid(times, T0, phase0) {
  let T = T0, phase = phase0;
  for (let iter = 0; iter < 3; iter++) {
    const ks = [], ts = [];
    for (const t of times) {
      const k = Math.round((t - phase) / T);
      if (Math.abs(t - (phase + k * T)) > T * 0.25) continue;   // 只纳近邻，跳过失配的
      ks.push(k); ts.push(t);
    }
    if (ks.length < 6) break;
    const n = ks.length;
    const mk = ks.reduce((a, b) => a + b, 0) / n;
    const mt = ts.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (ks[i] - mk) * (ts[i] - mt); den += (ks[i] - mk) ** 2; }
    if (den <= 0) break;
    T = num / den;
    phase = mt - mk * T;
  }
  return { T, phase };
}
const refined = refineGrid(ons, best.T, best.phase);
const T = refined.T;
let sx = 0, sy = 0;
for (const t of ons) { const f = (t % T) / T * 2 * Math.PI; sx += Math.cos(f); sy += Math.sin(f); }
let phase = refined.phase;
phase = ((phase % T) + T) % T;
const bpm = 60 / T;

const timing = JSON.parse(readFileSync(timingPath, 'utf8'));
const cuts = timing.scenes.map((s) => ({ id: s.id, at: s.start })).filter((c) => c.at > 1e-6);
const tolMs = Number(opt('tol', 30));

const rows = cuts.map((c) => {
  const k = Math.round((c.at - phase) / T);
  const grid = phase + k * T;
  let off = c.at - grid;
  if (off > T / 2) off -= T;
  if (off < -T / 2) off += T;
  return { id: c.id, at: c.at, grid, offMs: off * 1000, beats: off / T, ok: Math.abs(off * 1000) <= tolMs };
});
const ok = rows.filter((r) => r.ok).length;
// 检测器自身有恒定帧偏置（10ms 帧 + 低通群延迟）：把它扣掉再看残差，才是在量"切点准不准"
const offs = rows.map((r) => r.offMs).sort((a, b) => a - b);
const bias = offs.length ? offs[Math.floor(offs.length / 2)] : 0;
const residuals = rows.map((r) => Math.abs(r.offMs - bias));
const maxRes = residuals.length ? Math.max(...residuals) : 0;

// 与 analysis.json 的估计对比（不信任它，但要报出来：它偏了就是偏了）
let est = null;
const ap = track.replace(/\.[^.]+$/, '.analysis.json');
if (existsSync(ap)) { try { const a = JSON.parse(readFileSync(ap, 'utf8')); est = { bpm: a.bpm, first: a.beats?.[0] }; } catch { /* ignore */ } }

if (flag('json')) {
  console.log(JSON.stringify({ track: path.relative(ROOT, track), bpm, beat: T, phase, tolMs, ok, total: rows.length, rows, estimate: est,
    ...(gridOnly ? { gridOnly: true } : {}) }, null, 2));
} else {
  console.log((gridOnly ? 'BPM 参考网格 —— ' : '卡点检测 —— ') + path.relative(ROOT, track));
  console.log('  实测 ' + bpm.toFixed(2) + ' BPM（一拍 ' + T.toFixed(4) + 's，首拍 ' + phase.toFixed(3) + 's，起音 ' + ons.length + ' 个）');
  if (est) {
    const drift = Math.abs(est.bpm - bpm) / bpm * 100;
    const note = drift > 1 ? '  ⚠ 估计值偏 ' + drift.toFixed(1) + '%，别拿它当尺子' : '';
    console.log('  analysis.json 说 ' + Number(est.bpm).toFixed(2) + ' BPM / 首拍 ' + Number(est.first ?? NaN).toFixed(3) + 's' + note);
  }
  console.log('');
  for (const r of rows) {
    console.log('  ' + String(r.id).padEnd(10) + ('切 ' + r.at.toFixed(3) + 's').padEnd(12)
      + ('最近拍 ' + r.grid.toFixed(3)).padEnd(16)
      + (r.offMs >= 0 ? '+' : '') + r.offMs.toFixed(0) + 'ms'.padStart(3)
      + ('  (' + r.beats.toFixed(3) + ' 拍)').padStart(14)
      + '  ' + (r.ok ? 'OK' : '⚠ 超 ' + tolMs + 'ms'));
  }
  console.log('');
  console.log('  贴合 ' + ok + '/' + rows.length + ' 个切点（判据 ±' + tolMs + 'ms）');
  console.log('  检测器恒定偏置 ' + bias.toFixed(0) + 'ms（扣掉后最大残差 ' + maxRes.toFixed(0) + 'ms，'
    + (maxRes <= tolMs ? '切点本身是齐的' : '存在真实错位') + '）');
}

if (flag('strict') && ok !== rows.length && !gridOnly) process.exitCode = 1;
