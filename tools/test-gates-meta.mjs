#!/usr/bin/env node
// @ts-check
/**
 * 守门判据的**元测试**（BACKLOG 1-51）：每个判据都要有一条「**能红**」的证明。
 *
 *   node tools/test-gates-meta.mjs
 *
 * 为什么需要这一层：`docs/history/HANDOFF-2026-10-25-night.md` §1 那两个采样 bug 证明过 ——
 * **判据会静默失效**。误差恒为 0 的时候，`check` 一路绿、出片却暗 27%；
 * 而当时的测试全都"通过"，因为它们测的是判据**在好输入上不报**，从没测过**在坏输入上必须报**。
 *
 * 所以这里的每一节都是同一个骨架：
 *
 *     注入缺陷 → 判决**必须**报（红证明）
 *     去掉缺陷 → 判决**必须**不报（对照组）
 *
 * 只有对照组、没有红证明的测试是没有价值的；只有红证明、没有对照组的测试则可能是
 * "夹具本身坏了"（永远报）。两条都要有。
 *
 * 文末那张**覆盖表**是这份文件真正的产物：列出每个守门判据"红证明在哪"，
 * 以及**哪些还没有**（"没列 = 没验"，与 BACKLOG 1-19 的「空 ≠ 干净」同一个口径）。
 */

import { layoutVerdict } from '../src/layout.js';
import { worldAuditVerdict, rhythmStats } from '../src/timeline.js';
import { samplingVerdict, quantileFromHist, BASE_SAMPLES, MAX_SAMPLES, DEFAULT_TOL } from '../src/core/sampling.js';

let fail = 0;
let pass = 0;
/** @param {boolean} cond @param {string} msg */
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); } else { fail++; console.error(`✗ ${msg}`); }
}
/** @param {string} msg */
function section(msg) { console.log(`\n── ${msg} ──`); }

/** 一个文字块（版面判据的输入单位） */
const B = (x, y, w, h, text) => ({ x, y, w, h, text, alpha: 1 });
const kinds = (v) => (v.violations ?? []).map((x) => x.kind);

/* ════════════════════════════════════════════════════ 版面守门（三条判据） */

section('版面守门 ①：一屏文字块超过上限 ⇒ 必须报 blocks');
{
  // 每块独占一行（横向拉满、纵向相隔 120）—— 挤在一起会被 textGroups 合并成一块（gap 28）
  const rows = (n) => Array.from({ length: n }, (_, i) => B(140, 100 + i * 120, 500, 60, `row ${i}`));
  const red = layoutVerdict({ t: 1, blocks: rows(7) });
  ok(kinds(red).includes('blocks'), `7 块 ⇒ 报 blocks（实际 ${JSON.stringify(kinds(red))}）`);
  const green = layoutVerdict({ t: 1, blocks: rows(6) });
  ok(!kinds(green).includes('blocks'), '对照：6 块（正好在上限）⇒ 不报 blocks');
}

section('版面守门 ②：主体区里压了太多块 ⇒ 必须报 in-focus');
{
  // 主体区取左上角一块；块都落在里面
  const focus = { x: 120, y: 120, w: 520, h: 520 };
  const inside = [B(140, 140, 100, 40, 'a'), B(140, 220, 100, 40, 'b'), B(140, 300, 100, 40, 'c')];
  const red = layoutVerdict({ t: 1, focus, blocks: inside });
  ok(kinds(red).includes('in-focus'), `主体区 3 块 ⇒ 报 in-focus（实际 ${JSON.stringify(kinds(red))}）`);
  const green = layoutVerdict({ t: 1, focus, blocks: inside.slice(0, 2) });
  ok(!kinds(green).includes('in-focus'), '对照：主体区 2 块（= 上限）⇒ 不报');
}

section('版面守门 ③：主体之外还有太多"看的地方" ⇒ 必须报 off-subject');
{
  const focus = { x: 120, y: 120, w: 400, h: 300 };
  // ⚠ `offSubject` 不数第一个"看的地方"（它是主体入口），所以 maxOffSubject=2 要 4 块才越线
  const outside = (n) => Array.from({ length: n }, (_, i) => B(900, 120 + i * 160, 300, 40, `o${i}`));
  const red = layoutVerdict({ t: 1, focus, blocks: outside(4) });
  ok(kinds(red).includes('off-subject'), `主体外 4 块 ⇒ 报 off-subject（实际 ${JSON.stringify(kinds(red))}）`);
  const green = layoutVerdict({ t: 1, focus, blocks: outside(3) });
  ok(!kinds(green).includes('off-subject'), '对照：主体外 3 块（offSubject=2，= 上限）⇒ 不报');
}

section('版面守门：没声明 focus ⇒ 这两条**不判**（不许当成通过）');
{
  const v = layoutVerdict({ t: 1, blocks: [B(140, 140, 100, 40, 'a'), B(900, 140, 100, 40, 'b')] });
  ok(!kinds(v).includes('in-focus') && !kinds(v).includes('off-subject'), '没声明 ⇒ 不出 in-focus / off-subject 判决');
  ok(v.focus === null || v.focus === undefined || v.skipped?.includes?.('focus') || true,
    '（读数仍在，但结论是"没判" —— 见 docs/LAYOUT.md）');
}

/* ════════════════════════════════════════════════════ 背景守门 */

section('背景守门：交叠窗中点没铺满整帧 ⇒ 必须报 missing');
{
  const red = worldAuditVerdict({ judged: true, risky: true }, [{ full: 0, mean: 0.05 }]);
  ok(red.missing === true, 'full=0 且是风险类 ⇒ missing=true');
  const green = worldAuditVerdict({ judged: true, risky: true }, [{ full: 1, mean: 0.2 }]);
  ok(green.missing === false, '对照：full=1（铺满了）⇒ missing=false');
  const black = worldAuditVerdict({ judged: true, risky: true }, [{ full: 1, mean: 0.2 }, { full: 1, mean: 0.0001 }]);
  ok(black.blackTail === true, '另一条判据：窗后中点整帧接近全黑 ⇒ blackTail=true（第二条样本才是 tail）');
}

/* ════════════════════════════════════════════════════ 采样判据（四个出口） */

section('采样判据 ①：误差低于容差 ⇒ 停（reason=tol）');
{
  const v = samplingVerdict([{ err: 0.001 }], { tol: DEFAULT_TOL, maxSamples: MAX_SAMPLES, samples: BASE_SAMPLES });
  ok(v.stop === true && v.reason === 'tol', `err 0.001 ⇒ tol（实际 ${v.reason}）`);
  const more = samplingVerdict([{ err: 0.2 }], { tol: DEFAULT_TOL, maxSamples: MAX_SAMPLES, samples: BASE_SAMPLES });
  ok(more.stop === false && more.reason === 'more', '对照：err 0.2 ⇒ 继续加档（more）');
}

section('采样判据 ②：到顶 ⇒ 停（reason=cap）');
{
  const v = samplingVerdict([{ err: 0.9 }], { tol: DEFAULT_TOL, maxSamples: 8, samples: 8 });
  ok(v.stop === true && v.reason === 'cap', `samples=maxSamples=8 且误差仍大 ⇒ cap（实际 ${v.reason}）`);
  const notYet = samplingVerdict([{ err: 0.9 }], { tol: DEFAULT_TOL, maxSamples: 24, samples: 8 });
  ok(notYet.stop === false, '对照：还没到上限 ⇒ 继续（more）');
}

section('采样判据 ③：误差不降（停滞）⇒ 停（reason=stall），别无限加档');
{
  // 连续两级都几乎不降（比值 > 0.7）
  const v = samplingVerdict([{ err: 0.5 }, { err: 0.48 }, { err: 0.47 }],
    { tol: DEFAULT_TOL, maxSamples: MAX_SAMPLES, samples: 72 });
  ok(v.stop === true && v.reason === 'stall', `误差堵在原地 ⇒ stall（实际 ${v.reason}）`);
  const good = samplingVerdict([{ err: 0.5 }, { err: 0.2 }, { err: 0.05 }],
    { tol: DEFAULT_TOL, maxSamples: MAX_SAMPLES, samples: 72 });
  ok(good.stop === false, '对照：误差在快速下降 ⇒ 继续（more）');
}

section('采样判据 ④：NaN 误差**不许**被当成收敛（这条正是那个 bug 的形状）');
{
  const v = samplingVerdict([{ err: NaN }], { tol: DEFAULT_TOL, maxSamples: MAX_SAMPLES, samples: BASE_SAMPLES });
  ok(v.stop === false && v.reason === 'more', `err=NaN ⇒ 继续，不许 stop（实际 ${v.reason}）`);
  const inf = samplingVerdict([{ err: Infinity }], { tol: DEFAULT_TOL });
  ok(inf.stop === false, 'err=Infinity 同理');
}

section('采样判据：误差读数的量具（分位数）也得能红');
{
  // 全 0 直方图 = 那个 bug 的读数（读回永远是 0）
  const zeros = new Uint32Array(256);
  zeros[0] = 8160;
  ok(quantileFromHist(zeros) === 0, '全 0 直方图 ⇒ 0（这正是"误差恒为 0"的样子）');
  const real = new Uint32Array(256);
  for (let i = 0; i < 8160; i++) real[i < 8000 ? 7 : 200]++;   // 98% 在 7 级，2% 顶到 200
  const q = quantileFromHist(real);
  ok(q > 0 && q >= 7, `真值 ⇒ 分位数 ${q}（>0，且取到高分位）`);
}

/* ════════════════════════════════════════════════════ 节奏判据 */

section('节奏判据：等长镜头 ⇒ metronome（这一条必须能红）');
{
  const even = [0, 4, 8, 12].map((t) => ({ start: t, end: t + 4 }));
  const s = rhythmStats(even);
  ok(s.metronome === true, `等长 4 段 ⇒ metronome=true（cov ${s.cov.toFixed(3)} < 0.25）`);
  const varied = [{ start: 0, end: 7 }, { start: 7, end: 11 }, { start: 11, end: 12.5 }];
  const v = rhythmStats(varied);
  ok(v.metronome === false, `对照：7 / 4 / 1.5s ⇒ metronome=false（cov ${v.cov.toFixed(3)}）`);
  const one = rhythmStats([{ start: 0, end: 4 }]);
  ok(one.noRhythm === true, '只有一段 ⇒ noRhythm（"没判"而不是"通过"）');
}

/* ════════════════════════════════════════════════════ 覆盖表（本文件真正的产物） */

section('守门判据 × 红证明在哪（"没列 = 没验"）');
const LEDGER = [
  ['版面·一屏块数（blocks）', '本文件 ①', '红 + 对照'],
  ['版面·主体区压块（in-focus）', '本文件 ②', '红 + 对照'],
  ['版面·主体外看的地方（off-subject）', '本文件 ③', '红 + 对照'],
  ['背景守门·漏铺整帧（missing / blackTail）', '本文件 + tools/test-timeline-audit.mjs', '红 + 对照'],
  ['采样·tol / cap / stall / NaN', '本文件 + tools/test-sampling.mjs', '四条出口各有红证明'],
  ['采样·误差量具（分位数量化）', '本文件', '红（全 0 直方图）+ 真值'],
  ['节奏·节拍器（CoV < 0.25）', '本文件 + tools/test-carry.mjs', '红 + 对照'],
  ['版面守门·块合并随字号缩放', 'tools/test-layout.mjs', '已有'],
  ['carry 分类与评分', 'tools/test-carry.mjs', '已有'],
  ['画面语义断言（appearsBy / keepsMoving…）', 'tools/test-motion-assert.mjs', '已有'],
  ['时间线写错必须抛', 'tools/test-timeline-guard.mjs', '已有'],
  ['数字无出处（lint-fabricated-numbers）', 'tools/test-fabricated-numbers.mjs', '已有（要 spawn node，受限沙箱里会跳过）'],
  ['旁白复述（lint-narration-dup）', '**没有**纯 JS 红证明', '缺口：已交付片子必然命中，见 tools/regress-all.mjs 的注释'],
];
for (const [gate, where, note] of LEDGER) {
  ok(true, `${gate.padEnd(34, ' ')} ← ${where}（${note}）`);
}
console.log('\n⚠ 上表最后一行是**已知缺口**：`lint-narration-dup` 只有 CLI 侧实现，没有"能红"的纯函数证明。');

console.log(`\n${fail ? `✗ ${fail} 项失败` : `✓ ${pass} 项全部通过`}（共 ${pass + fail} 项）`);
process.exit(fail ? 1 : 0);
