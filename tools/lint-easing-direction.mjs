#!/usr/bin/env node
/**
 * tools/lint-easing-direction.mjs —— **缓动方向**判据：进 ease-out、出 ease-in、位移别用线性。
 *
 *   node tools/lint-easing-direction.mjs <任务> [--strict] [--json]
 *
 * 只报**同一行能看出来的矛盾**（不猜意图、不做数据流分析）：
 *   D1 空间位移配线性：`prog(...)` 没给缓动名（缺省 linear），而同一条语句里有 x / y / dx / dy / translate / px；
 *   D2 入场用 ease-in：`'in*'` 与 `tin` / `enter` / `from:` 同行；
 *   D3 出场用 ease-out：`'out*'` 与 `tout` / `exit` / `leave` 同行。
 *
 * 三条都**默认只报不拦**（`--strict` 才当门），因为：
 *   · 等距尺 / 匀速滚动屏 / 机械感，用线性是**对的**；
 *   · 我们不知道这一行画的是位移还是别的（只做行内共现，不做语义分析）。
 * 豁免：`motion.exempt` 含 `easing`，或该行写 `// motion:allow easing`。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMotion } from '../src/kit/motion-persona.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const strict = flag('strict');

const SPATIAL = /\b(dx|dy|px|x|y|translate|offset|pos)\b/;
const IN_TOKENS = /\b(tin|enter|entering|from:)\b/;
const OUT_TOKENS = /\b(tout|exit|exit\w*|leave)\b/;

/**
 * 纯扫描：给 [{ file, src }]，返回问题清单。
 * @param {Array<{file:string, src:string}>} files
 * @param {{ exempt?: string[] }} [opts]
 */
export function scanDirection(files, opts = {}) {
  const exempt = new Set(opts.exempt ?? []);
  const skipAll = exempt.has('easing');
  const issues = [];
  let progCount = 0;
  for (const { file, src } of files) {
    const lines = src.split('\n');
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('//') || line.startsWith('*')) return;
      if (/\/\/\s*motion:allow\s+[^\n]*\beasing\b/.test(raw)) return;
      const prog = line.match(/prog\(([^)]*)\)/);
      if (!prog) return;
      progCount++;
      if (skipAll) return;
      const args = prog[1];
      const easeMatch = args.match(/^[^,]*,[^,]*,[^,]*,\s*'([A-Za-z]+)'/);
      const ease = easeMatch ? easeMatch[1] : 'linear';
      const where = file + ':' + (i + 1);
      if (ease === 'linear' && SPATIAL.test(line)) {
        issues.push({ rule: 'D1', where, line, why: '空间位移用了线性（等距/机械感是有意的就写 // motion:allow easing）' });
        return;
      }
      if (/^in/i.test(ease) && !/^inout/i.test(ease) && IN_TOKENS.test(line)) {
        issues.push({ rule: 'D2', where, line, why: '入场用了 ease-in（入场该减速：out*）' });
        return;
      }
      if (/^out/i.test(ease) && OUT_TOKENS.test(line)) {
        issues.push({ rule: 'D3', where, line, why: '出场用了 ease-out（出场该加速：in*）' });
      }
    });
  }
  return { issues, progCount };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
const task = argv.find((a) => !a.startsWith('--') && !/^[\d.]+$/.test(a));
if (!task) { console.error('用法：node tools/lint-easing-direction.mjs <任务> [--strict] [--json]'); process.exit(2); }
const dir = path.join(ROOT, 'tasks', task);
const cfg = (await import(new URL('../tasks/' + task + '/task.config.mjs', import.meta.url).href)).default;
let exempt = [];
try { exempt = resolveMotion(cfg)?.exempt ?? []; } catch { exempt = []; }

const files = [];
const walk = (d) => {
  if (!existsSync(d)) return;
  for (const f of readdirSync(d)) {
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.js')) files.push({ file: path.relative(ROOT, p).replace(/\\/g, '/'), src: readFileSync(p, 'utf8') });
  }
};
walk(dir);

const { issues, progCount } = scanDirection(files, { exempt });
if (flag('json')) {
  console.log(JSON.stringify({ task, files: files.length, progCount, exempt, issues }, null, 2));
} else {
  console.log('缓动方向：' + task + '（' + files.length + ' 个文件 / ' + progCount + ' 处 prog' + (exempt.length ? ' · 豁免 ' + exempt.join(',') : '') + '）');
  if (!issues.length) console.log('  ✓ 没发现方向矛盾（进 out* / 出 in* / 位移不用线性）');
  for (const it of issues.slice(0, 12)) {
    console.log('  ⚠ ' + it.rule + ' ' + it.where + ' —— ' + it.why);
    console.log('     ' + it.line.slice(0, 110));
  }
  if (issues.length > 12) console.log('  … 还有 ' + (issues.length - 12) + ' 处');
  if (issues.length) console.log(strict ? '\n✗ --strict：' + issues.length + ' 处方向矛盾' : '\n⚠ ' + issues.length + ' 处方向矛盾 —— 默认只报不拦（要当门加 --strict）');
}
if (issues.length && strict) process.exitCode = 1;
}
