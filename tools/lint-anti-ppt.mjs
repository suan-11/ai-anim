#!/usr/bin/env node
/**
 * tools/lint-anti-ppt.mjs —— **反 PPT 味**判据（docs/ANTI-PPT.md）。
 *
 *   node tools/lint-anti-ppt.mjs <任务>
 *   node tools/lint-anti-ppt.mjs <任务> --strict      # 状态差要 100% 声明、钩子 0 漏
 *   node tools/lint-anti-ppt.mjs <任务> --json
 *
 * PPT 味的定义（一句话）：**用页面组织信息**，而不是用连续世界 + 因果运动 + 状态差组织。
 * 极缓慢的全局漂移只是让页面在动，不是解药 —— 它不会让世界变，只会让画面在动。
 *
 * 七条判据（前五条只看段表，第六条看配置，第七条看已有成片的帧间差）：
 *
 *   C1 状态差：每段声明 `state.diff`，且不含只动透明度/缩放的项（opacity/alpha/fade/scale/zoom）；
 *   C2 接力物：连续 ≥3 段没有 `relayTo` ⇒ 失败（没有东西从上一镜活到下一镜）；
 *   C3 转场：`transition: mix|dissolve` 或「有 overlap 却没声明 handlesTransition」⇒ 透明度淡出，失败；
 *   C4 节奏：段长 CoV ≥0.25，且每 30s 至少一段 ≥2.5s（呼吸镜头）；
 *   C5 钩子：每 10s 窗口要有强事件（≤1.2s 的冲击段 / 光照或材质变化 / wipe·iris·glitch·pixel 转场）；
 *   C6 声音层次：报告 music / vo / sfx 各层有没有（信息项，不 gate）；
 *   C7 匀速漂移：成片帧间差的**变异系数** ≥0.30（匀速漂移 = 每帧都在动但方差极小）；
 *      没有成片时这条进「没跑」，不假装通过。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/timeline.js';
import { decodeDiffSeries, motionStats } from './lib/diff-series.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const strict = flag('strict');

/** 只动这些不算状态差（观众感知不到世界变了） */
export const SOFT_TOKENS = new Set(['opacity', 'alpha', 'fade', 'scale', 'zoom', 'blur']);
/** 算得上语义变化的方向 */
export const HARD_TOKENS = new Set(['visibility', 'position', 'space', 'material', 'light', 'state', 'shape', 'text', 'focus', 'topology', 'ownership']);

/** 段类型（配置档节点是 type，手写场景是 id） */
const typeOf = (s) => String(s?.type ?? s?.id ?? '').toLowerCase();
const startOf = (s) => Number(s?.start ?? s?.at ?? 0);
const durOf = (s) => Number(s?.dur ?? (s?.start != null && s?.end != null ? s.end - s.start : 4));

/**
 * 结构判据（纯函数：给段表，返回问题清单）。
 * @param {Array<any>} segs
 * @param {{ coverage?: number, hookMiss?: number }} [opts]
 */
export function analyzeSegments(segs, opts = {}) {
  const minCoverage = opts.coverage ?? (strict ? 1 : 0.7);
  const maxHookMiss = opts.hookMiss ?? (strict ? 0 : 0.25);
  const problems = [];
  const info = [];
  const n = segs.length;
  if (!n) return { problems: ['时间线是空的'], info, stats: {} };
  // 歌词片（过半段带 params.mode）的切点由歌决定，节奏/钩子判据不适用 —— 说明白，别假装通过
  const lyricFilm = segs.filter((s) => s?.params?.mode).length > n * 0.5;

  // ---- C1 状态差
  let declared = 0;
  const weak = [];
  segs.forEach((s, i) => {
    const st = s.state;
    if (!st) return;
    declared++;
    const diff = Array.isArray(st.diff) ? st.diff.map((x) => String(x).toLowerCase()) : [];
    const hard = diff.filter((d) => HARD_TOKENS.has(d));
    if (!diff.length) weak.push(`${i + 1}#${typeOf(s) || '?'} 声明了 state 却没有 diff`);
    else if (!hard.length) weak.push(`${i + 1}#${typeOf(s) || '?'} 的差异只动了 ${diff.join('/')}（透明度/缩放不算状态差）`);
  });
  const coverage = declared / n;
  if (coverage < minCoverage) {
    problems.push(`状态差声明率 ${Math.round(coverage * 100)}%（要求 ≥${Math.round(minCoverage * 100)}%）：${n - declared}/${n} 段没写 state.diff`);
  }
  for (const w of weak.slice(0, 6)) problems.push('状态差不成立：' + w);
  info.push(`状态差：${declared}/${n} 段声明（${Math.round(coverage * 100)}%）`);

  // ---- C2 接力物
  let run = 0, worstRun = 0, worstAt = '';
  segs.forEach((s, i) => {
    if (s.relayTo) { run = 0; return; }
    run++;
    if (run > worstRun) { worstRun = run; worstAt = `${i - run + 2}-${i + 1}`; }
  });
  if (worstRun >= 3) problems.push(`接力物断了：第 ${worstAt} 段连续 ${worstRun} 段没有 relayTo（没有东西从上一镜活到下一镜）`);
  const relayCount = segs.filter((s) => s.relayTo).length;
  info.push(`接力物：${relayCount}/${n} 段声明了 relayTo（最长断链 ${worstRun}）`);

  // ---- C3 转场黑名单
  const alphaTrans = segs.filter((s) => ['mix', 'dissolve'].includes(String(s.transition ?? '')));
  const bareOverlap = segs.filter((s) => Number(s.overlap ?? 0) > 0 && !s.handlesTransition);
  if (alphaTrans.length) problems.push(`用了透明度/阈值淡出转场：${alphaTrans.length} 段（${alphaTrans.slice(0, 4).map((s) => typeOf(s) || '?').join(' / ')}）—— 改方向+速度匹配的运动承接`);
  if (bareOverlap.length) problems.push(`有 ${bareOverlap.length} 段写了 overlap 却没声明 handlesTransition —— 引擎会退回交叉溶解（透明度）`);
  info.push(`转场：${alphaTrans.length} 段淡出 / ${bareOverlap.length} 段裸 overlap`);

  // ---- C4 节奏
  const durs = segs.map(durOf);
  const mean = durs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(durs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const cov = mean > 0 ? sd / mean : 0;
  if (cov < 0.25 && !lyricFilm) problems.push(`镜头时长太均匀：CoV ${cov.toFixed(2)}（要求 ≥0.25）—— 建立/信息/冲击/呼吸要交替`);
  const total = startOf(segs[n - 1]) + durs[n - 1];
  const breatheMissing = [];
  for (let t0 = 0; t0 + 30 <= total + 0.01; t0 += 30) {
    const inWin = segs.some((s) => startOf(s) >= t0 && startOf(s) < t0 + 30 && durOf(s) >= 2.5);
    if (!inWin) breatheMissing.push(`${t0}-${t0 + 30}s`);
  }
  if (breatheMissing.length) problems.push(`缺呼吸镜头（每 30s 至少一段 ≥2.5s）：${breatheMissing.join(' / ')}`);
  info.push(`节奏：CoV ${cov.toFixed(2)} · 平均 ${mean.toFixed(2)}s · 呼吸窗口缺 ${breatheMissing.length} 个` + (lyricFilm ? '（歌词片：节奏由歌决定，这两条不 gate）' : ''));

  // ---- C5 钩子
  const windows = Math.ceil(total / 10);
  const misses = [];
  for (let w = 0; w < windows; w++) {
    const t0 = w * 10, t1 = t0 + 10;
    const hit = segs.some((s) => {
      const st = startOf(s);
      if (!(st >= t0 && st < t1)) return false;
      if (durOf(s) <= 1.2) return true;
      const diff = Array.isArray(s.state?.diff) ? s.state.diff.map((x) => String(x).toLowerCase()) : [];
      if (diff.includes('light') || diff.includes('material')) return true;
      return ['wipe', 'iris', 'glitch', 'pixel'].includes(String(s.transition ?? ''));
    });
    if (!hit) misses.push(`${t0}-${t1}s`);
  }
  const missRate = windows ? misses.length / windows : 0;
  if (missRate > maxHookMiss && !lyricFilm) problems.push(`钩子太少：${misses.length}/${windows} 个 10s 窗口没有强事件（允许 ≤${Math.round(maxHookMiss * 100)}%）：${misses.slice(0, 5).join(' / ')}`);
  info.push(`钩子：${windows - misses.length}/${windows} 个窗口有强事件`);

  return { problems, info, stats: { coverage, cov, missRate, relayCount, worstRun, total } };
}

/** 成片帧间差的变异系数（匀速漂移 = 一直在动但方差极小）。解码与统计走共享的 diff-series（C4）。 */
export function motionVariance(mp4) {
  const s = decodeDiffSeries(mp4);
  if (!s) return null;
  return motionStats(s.diff, s.fps);
}

/* ------------------------------------------------------------------ CLI */
// 只有当它是**被直接执行**时才跑 CLI —— 被 import（test-anti-ppt 就 import 纯函数）时不跑，
// 否则测试一 import 就打出用法然后 exit(2)。
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const task = isMain ? argv.find((a) => !a.startsWith('--') && !/^[\d.]+$/.test(a)) : null;
if (isMain && !task) {
  console.error('用法：node tools/lint-anti-ppt.mjs <任务> [--strict] [--json]');
  process.exit(2);
}
if (isMain) {
const mod = await import(new URL('../tasks/' + task + '/task.config.mjs', import.meta.url).href);
const cfg = mod.default ?? mod.config;
const segs = build(cfg.timeline, { bpm: 120, duration: cfg.duration ?? 0 });
const { problems, info, stats } = analyzeSegments(segs);

// C6 声音层次（信息项）
const audio = cfg.audio && typeof cfg.audio === 'object' ? cfg.audio : {};
const layers = ['music', 'vo', 'mix'].filter((k) => audio[k]);
info.push(`声音层：${layers.length ? layers.join(' / ') : '（只有一条默认轨）'}` + (existsSync(path.join(ROOT, 'tasks', task, 'audio', 'sfx.json')) ? ' + sfx 表' : ''));

// C7 匀速漂移（要成片）
const outDir = path.join(ROOT, 'out', task);
let motion = null;
if (existsSync(outDir)) {
  const cands = readdirSync(outDir).filter((f) => f.endsWith('.mp4') && !/^part_|_stitched/.test(f));
  if (cands.length) motion = motionVariance(path.join(outDir, cands.sort((a, b) => statSync(path.join(outDir, b)).size - statSync(path.join(outDir, a)).size)[0]));
}
if (motion) {
  if (motion.cv < 0.30) problems.push(`成片像匀速漂移：帧间差变异系数 ${motion.cv.toFixed(2)}（要求 ≥0.30）—— 一直动但没有事件`);
  if (motion.staticSpan > 3.5) problems.push(`有 ${motion.staticSpan.toFixed(1)}s 完全静止（上限 3.5s）`);
  info.push(`成片运动：CV ${motion.cv.toFixed(2)} · 平均帧间差 ${motion.mean.toFixed(2)} · 最长静止 ${motion.staticSpan.toFixed(1)}s`);
} else {
  info.push('成片运动：没跑（还没有 mp4 —— 这条不假装通过）');
}

if (flag('json')) {
  console.log(JSON.stringify({ task, problems, info, stats, motion }, null, 2));
} else {
  console.log(`反 PPT 味体检：${task}（${segs.length} 段 / ${(stats.total ?? 0).toFixed(1)}s）`);
  for (const line of info) console.log('  · ' + line);
  if (problems.length) {
    console.log('');
    for (const p of problems) console.log('  ✗ ' + p);
    console.log(`\n✗ ${problems.length} 条不合格（docs/ANTI-PPT.md 有判据与改法）`);
  } else {
    console.log('\n✓ 没有 PPT 味问题');
  }
}
if (problems.length) process.exitCode = 1;
}
