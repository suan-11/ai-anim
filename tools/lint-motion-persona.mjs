#!/usr/bin/env node
/**
 * tools/lint-motion-persona.mjs —— **运动人格**判据（可选声明，默认只报不拦）。
 *
 *   node tools/lint-motion-persona.mjs <任务> [--strict] [--json]
 *
 * 前置：`task.config.mjs` 里写了 `motion: { personality: 'premium' }`（见 src/kit/motion-persona.js）。
 * **没写就退出码 2**（这一项没得判 —— 不是通过，也不是失败）。
 *
 * 四条判据（全部是**区间**，且都可豁免；默认 warn，`--strict` 才拦）：
 *   P1 时长档：扫场景源码里 `prog(t, a, b)` 的字面量跨度，落在 quick 以下（太快）/ slow 以上（太慢）的比例；
 *   P2 缓动族：用到的缓动名是否属于这一人格的四个族；陌生名字（拼错）单独点名；
 *   P3 回弹：`spring(stiffness, damping)` 的预估 overshoot 是否超过人格上限；
 *      `outBack` / `outElastic` 视为回弹族（premium / corporate 不该用）；
 *   P4 豁免：`motion.exempt: ['duration'|'easing'|'overshoot']` 或行内 `// motion:allow <项>`。
 *
 * 为什么默认不拦：这是**审美参考**，不是物理规格。写片子的人有权力越界，只要他知道自己越了。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/timeline.js';
import { resolveMotion, overshootOf, easingRole, easingAllowed } from '../src/kit/motion-persona.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const strict = flag('strict');

/* ---------------------------------------------------------------- 纯扫描器（可单测） */

/** 收集源码里所有 `prog(` 调用的**字面量跨度**（a、b 都是数字时） */
export function scanProgSpans(src) {
  const out = [];
  const re = /prog\(\s*[^,()]+,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const a = Number(m[1]), b = Number(m[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) out.push(Number((b - a).toFixed(3)));
  }
  return out;
}

/** 收集缓动名：`prog(..., 'name')` 的第三参 + `keys([...])` 里每项的第三元素 + `easing: 'name'` */
export function scanEaseNames(src) {
  const names = [];
  for (const m of src.matchAll(/prog\([^)]*?,\s*'([A-Za-z]+)'\s*\)/g)) names.push(m[1]);
  for (const m of src.matchAll(/easing:\s*'([A-Za-z]+)'/g)) names.push(m[1]);
  for (const m of src.matchAll(/\[\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*'([A-Za-z]+)'\s*\]/g)) names.push(m[1]);
  return names;
}

/** 收集 `spring(...)` 的 (stiffness, damping) 字面量（第一个参是 elapsed，所以看第 2、3 个数字） */
export function scanSprings(src) {
  const out = [];
  const re = /spring\(\s*[^,()]+(?:,\s*(-?[\d.]+))?(?:,\s*(-?[\d.]+))?/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1] == null && m[2] == null) continue;
    const stiffness = m[1] != null ? Number(m[1]) : 90;
    const damping = m[2] != null ? Number(m[2]) : 18;
    if (Number.isFinite(stiffness) && Number.isFinite(damping)) out.push({ stiffness, damping });
  }
  return out;
}

/** 行内豁免：`// motion:allow duration easing` */
export function inlineAllows(src) {
  const set = new Set();
  for (const m of src.matchAll(/\/\/\s*motion:allow\s+([^\n]+)/g)) {
    for (const w of m[1].trim().split(/[\s,]+/)) if (w) set.add(w);
  }
  return [...set];
}

/* ---------------------------------------------------------------- CLI */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
const task = argv.find((a) => !a.startsWith('--') && !/^[\d.]+$/.test(a));
if (!task) { console.error('用法：node tools/lint-motion-persona.mjs <任务> [--strict] [--json]'); process.exit(2); }

const dir = path.join(ROOT, 'tasks', task);
const cfg = (await import(new URL('../tasks/' + task + '/task.config.mjs', import.meta.url).href)).default;
let motion = null;
try { motion = resolveMotion(cfg); } catch (e) { console.error('✗ ' + e.message); process.exit(1); }
if (!motion) {
  console.log('· 这条片子没有声明 motion（' + task + '）：这一项没得判。');
  console.log('  想判就写：motion: { personality: \'premium\', emotion: \'calm\' }（premium / playful / corporate / energetic）');
  process.exit(2);
}

const files = [];
const scenesDir = path.join(dir, 'scenes');
if (existsSync(scenesDir)) {
  for (const f of readdirSync(scenesDir)) {
    const p = path.join(scenesDir, f);
    if (statSync(p).isFile() && f.endsWith('.js')) files.push(p);
  }
}
if (!files.length) files.push(path.join(dir, 'task.config.mjs'));
const src = files.map((f) => readFileSync(f, 'utf8')).join('\n');

const exempt = new Set([...motion.exempt, ...inlineAllows(src)]);
const segs = build(cfg.timeline, { bpm: 120, duration: cfg.duration ?? 0 });
const problems = [];
const info = [];
const B = motion.budgets;

info.push('人格：' + motion.label + '（' + motion.persona + '）' + (motion.emotion ? ' · 情绪 ' + motion.emotion : '')
  + ' · 时长档 ' + B.durations.quick.join('–') + ' / ' + B.durations.standard.join('–') + ' / ' + B.durations.slow.join('–') + 's'
  + ' · 回弹上限 ' + (B.overshoot[1] * 100).toFixed(0) + '%');

// P1 时长档
if (!exempt.has('duration')) {
  const spans = scanProgSpans(src);
  if (spans.length >= 4) {
    spans.sort((a, b) => a - b);
    const med = spans[Math.floor(spans.length / 2)];
    const tooFast = spans.filter((s) => s < B.durations.quick[0]).length;
    const tooSlow = spans.filter((s) => s > B.durations.slow[1]).length;
    info.push('时长：' + spans.length + ' 处 prog 跨度，中位 ' + med + 's，太快 ' + tooFast + ' / 太慢 ' + tooSlow);
    if (tooFast / spans.length > 0.35) problems.push('有 ' + tooFast + '/' + spans.length + ' 处元素动作短于 ' + B.durations.quick[0] + 's（这一档的「快」下限）—— 观众会看成抖动而不是动作');
    if (tooSlow / spans.length > 0.35) problems.push('有 ' + tooSlow + '/' + spans.length + ' 处长于 ' + B.durations.slow[1] + 's（这一档的「慢」上限）—— 会显得卡住');
  } else {
    info.push('时长：可判的 prog 跨度只有 ' + spans.length + ' 处（<4，跳过）');
  }
} else info.push('时长：已豁免');

// P2 缓动族
if (!exempt.has('easing')) {
  const names = scanEaseNames(src);
  const unknown = [...new Set(names.filter((n) => easingRole(n) === 'unknown'))];
  const notAllowed = [...new Set(names.filter((n) => !easingAllowed(B, n) && easingRole(n) !== 'unknown'))];
  if (names.length) info.push('缓动：' + names.length + ' 处 · ' + [...new Set(names)].slice(0, 6).join(' / '));
  if (unknown.length) problems.push('陌生缓动名：' + unknown.join(' / ') + '（多半是拼错；写错会静默退化成 linear）');
  if (notAllowed.length) problems.push('不属于「' + motion.persona + '」这一档的缓动名：' + notAllowed.join(' / ') + '（这一档允许 ' + Object.values(B.easing).flat().join(' / ') + '）');
} else info.push('缓动：已豁免');

// P3 回弹
if (!exempt.has('overshoot')) {
  const springs = scanSprings(src);
  const over = springs.map((s) => ({ ...s, os: overshootOf(s.stiffness, s.damping) }))
    .filter((s) => s.os > B.overshoot[1] + 1e-6);
  const backish = [...new Set(scanEaseNames(src).filter((n) => n === 'outBack' || n === 'outElastic'))];
  if (springs.length) info.push('回弹：' + springs.length + ' 处 spring，最大 ' + (Math.max(...springs.map((s) => overshootOf(s.stiffness, s.damping))) * 100).toFixed(0) + '%');
  if (over.length) {
    const worst = over.sort((a, b) => b.os - a.os)[0];
    problems.push(over.length + ' 处 spring 的回弹超过上限 ' + (B.overshoot[1] * 100).toFixed(0) + '%（最高 ' + (worst.os * 100).toFixed(0) + '%，stiffness ' + worst.stiffness + ' / damping ' + worst.damping + '）');
  }
  if (backish.length && B.overshoot[1] <= 0.04) problems.push('用了 ' + backish.join(' / ') + ' —— 这一档不该有回弹（上限 ' + (B.overshoot[1] * 100).toFixed(0) + '%）');
} else info.push('回弹：已豁免');

if (flag('json')) {
  console.log(JSON.stringify({ task, motion: { persona: motion.persona, emotion: motion.emotion, exempt: [...exempt] }, budgets: B, problems, info, segments: segs.length }, null, 2));
} else {
  console.log('运动人格体检：' + task + '（' + segs.length + ' 段）');
  for (const line of info) console.log('  · ' + line);
  if (problems.length) {
    console.log('');
    for (const p of problems) console.log('  ⚠ ' + p);
    console.log('');
    console.log(strict ? '✗ --strict：' + problems.length + ' 条超预算（要留就写 motion.exempt 或行内 // motion:allow）'
      : '⚠ ' + problems.length + ' 条超预算 —— 默认只报不拦（要当门加 --strict）');
  } else {
    console.log('\n✓ 都在「' + motion.label + '」这一档的参考区间内');
  }
}
if (problems.length && strict) process.exitCode = 1;
}
