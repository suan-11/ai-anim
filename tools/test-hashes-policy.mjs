#!/usr/bin/env node
// @ts-check
/**
 * 1-39 之后的**基线策略**（2026-10-24 拍板：基线是变更探测器，不是"画面永远不许变"）的离线守门。
 *
 * 跑法：
 *   node tools/test-hashes-policy.mjs
 *
 * 为什么要守它：这条策略的全部价值在"**有意改画面必须被看见、被说明**"。
 * 只要有人把 `--accept` 的 `--note` 检查删掉、或把 `--save` 的"拒绝覆盖"去掉，
 * 基线就退化成"改完顺手刷绿"的橡皮图章 —— 而那时**没有任何测试会红**（它不渲染、不进 GPU 路径）。
 * 所以这里做静态接线自检，外加**判据不许放松**的红线（`negligible()` 的阈值）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readCliSource } from './lib/cli-source.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const AGENTS = path.join(ROOT, 'AGENTS.md');
const ENGINE = path.join(ROOT, 'docs', 'ENGINE.md');
const DIAGNOSIS = path.join(ROOT, 'docs', 'DIAGNOSIS.md');
const REGRESS = path.join(ROOT, 'tools', 'regress-all.mjs');

const anim = readCliSource();
const agents = readFileSync(AGENTS, 'utf8');
const engine = readFileSync(ENGINE, 'utf8');
const diagnosis = readFileSync(DIAGNOSIS, 'utf8');
const regress = readFileSync(REGRESS, 'utf8');

let passed = 0;
const lines = [];
/** @param {string} name @param {() => void} fn */
function t(name, fn) {
  try { fn(); passed++; lines.push(`  ✓ ${name}`); }
  catch (err) { lines.push(`  ✗ ${name}\n      ${String(err.message).split('\n').join('\n      ')}`); throw Object.assign(new Error(name), { cause: err }); }
}

/** `cmdHashes` + `writeHashesDiffSheet` 的源码（到「画面算不算变了」那条注释为止）。 */
const hashesSrc = (() => {
  const start = anim.indexOf('async function cmdHashes()');
  assert.ok(start >= 0, '找不到 cmdHashes');
  const end = anim.indexOf('「画面算不算变了」的判据', start);
  return end > start ? anim.slice(start, end) : anim.slice(start);
})();

/* ---------------------------------------------------------------- 1. 工具行为 */

t('--accept 必须带 --note：`if (!note)` 的拒绝分支还在', () => {
  assert.ok(hashesSrc.includes('const accept = flag(\'accept\')'), '没有解析 --accept');
  assert.ok(/if \(!note\)\s*\{/.test(hashesSrc), '找不到 `if (!note)` 拒绝分支 —— --accept 会退化成橡皮图章');
  assert.ok(hashesSrc.includes('--accept 必须带 --note'), '拒绝时的报错文案不见了');
});

t('--save 在基线已存在时拒绝覆盖（堵住"改完顺手重存"）', () => {
  assert.ok(hashesSrc.includes('基线已经存在'), '找不到拒绝覆盖的文案');
  assert.ok(/else if \(!useBaseline && baseExists && !force\)/.test(hashesSrc), '拒绝条件不在了（可能被 --force 之外的路径绕过）');
  assert.ok(hashesSrc.includes('--force'), '没有 --force 逃生口（或文案丢了）');
});

t('★ --accept 沿用基线原有的采样密度（不许把 11 帧悄悄缩成 4 帧）', () => {
  // 为什么守这条：修前 `--accept` 与 `--save` 共用同一套 times 推算，没写 `--every` 就回落到
  // "默认 4 帧"。基线通常是 `--every 2` 的 11 帧 ⇒ 一次 accept 就把它砍掉 64% 的检查点，
  // 而日志只说"已确认这次变化"。**它不报错、不违反判据，只是以后更查不出东西** ——
  // 实测发生过两次（0-3 与补字体两次 accept 后 demo 基线只剩 4 帧）。
  assert.ok(/const baselineTimes = accept && Array\.isArray\(baseJson\?\.frames\)/.test(hashesSrc),
    '找不到"沿用基线采样时刻"的逻辑');
  assert.ok(/\? baselineTimes\s*\n?\s*:\s*\[0, dur \* 0\.25/.test(hashesSrc),
    'times 的兜底顺序里没有 baselineTimes（--accept 仍会回落到默认 4 帧）');
  assert.ok(hashesSrc.includes('--accept 不该改变检查密度'), '没有把"沿用了原有采样"印出来');
});

t('--accept 会先把"变化"写进 notes（审计轨迹），而不是静默刷绿', () => {
  assert.ok(/snap\.notes\.push\(\{\s*\n?\s*at: snap\.savedAt, note/.test(hashesSrc), 'notes.push 不见了');
  assert.ok(hashesSrc.includes('frames: changed.map'), '没记录哪几帧变了');
  assert.ok(hashesSrc.includes('上一次接受'), '比对时不打印上一次接受的原因');
});

t('比对失败会落前后对比图（左=基线、右=现在），且 --accept 复用同一张', () => {
  assert.ok(hashesSrc.includes('writeHashesDiffSheet(task, changed'), '失败分支没有生成对比图');
  assert.ok(hashesSrc.includes('hashes-diff.png'), '对比图的文件名不在（文档/诊断对不上）');
  assert.ok(hashesSrc.includes('item.b64') || hashesSrc.includes('b64: c.buf.toString'), '对比图没有用基线里的像素');
});

t('判据没有放松：negligible() 仍是 over16 === 0 且 mean < 0.002', () => {
  assert.ok(/function negligible\(r\) \{\s*return r\.over16 === 0 && r\.mean < 0\.002;/.test(anim),
    'negligible() 的阈值变了 —— 基线策略放松流程，但判据必须保持原样');
});

t('基线格式带上 format / notes / savedAt（旧基线仍可读）', () => {
  assert.ok(hashesSrc.includes('format: 2'), '没有 format 字段');
  assert.ok(/notes: Array\.isArray\(baseJson\?\.notes\)/.test(hashesSrc), '旧基线没有 notes 时的兜底不见了');
  assert.ok(hashesSrc.includes('savedAt'), '没有 savedAt');
});

/* ---------------------------------------------------------------- 2. 帮助与文档 */

t('`anim.mjs` 的帮助块写了 --accept --note 与"两种改动"', () => {
  assert.ok(anim.includes('hashes <task> --accept --note'), '帮助块没有 --accept 用法');
  assert.ok(anim.includes('变更探测器'), '帮助块没说清它只是探测器');
});

t('AGENTS.md §7 写了两种改动档（保画面 / 改画面）', () => {
  assert.ok(agents.includes('变更探测器'), 'AGENTS 没写"变更探测器"');
  assert.ok(agents.includes('保画面（bug fix / 重构 / 性能）'), '没有"保画面"这一档');
  assert.ok(agents.includes('改画面（有意的视觉改进）'), '没有"改画面"这一档');
});

t('ENGINE §14.7 与 DIAGNOSIS §1.6 都指向同一条规则', () => {
  assert.ok(engine.includes('--accept --note'), 'ENGINE 没写接受方式');
  assert.ok(diagnosis.includes('hashes-diff.png'), 'DIAGNOSIS 没写对比图');
  assert.ok(diagnosis.includes('--accept 必须带 --note'), 'DIAGNOSIS 没登记这条输出词');
});

t('回归清单仍用 --baseline 当门（没有偷换成 --accept）', () => {
  // 这两条要 out/<任务>/hashes.json 这份**本地**基线（没进仓库）：新机器上必然红，
  // 所以 2026-11-02 把它们从回归清单里去掉了。判据改成「要么没有，要么带 --baseline」——
  // 只要写了这条，就必须是真的比对模式，不能悄悄退回 --save。
  for (const name of ['hashes:fidus', 'hashes:promo']) {
    const m = regress.match(new RegExp("'" + name + "'" + '[\\s\\S]{0,200}'));
    if (m) assert.ok(/--baseline/.test(m[0]), name + ' 写了但没带 --baseline（比对模式才对）');
  }
});

/* ---------------------------------------------------------------- 汇总 */

console.log(`\n画面基线策略（变更探测器 / accept / 对比图） —— ${passed} 项\n`);
for (const line of lines) console.log(line);
console.log('');
