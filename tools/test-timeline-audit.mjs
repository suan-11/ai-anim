// @ts-check
/**
 * **段级审计**（BACKLOG 头部 ①②⑦ 的收口）—— 离线单测。
 *
 *   node tools/test-timeline-audit.mjs
 *
 * 不需要 GPU / 不需要浏览器 / 不起 Vite：这里测的全是纯函数
 * （`src/timeline.js` 的 `auditUnderRequires()` 与 `planWorldAudit()`），输入是**已展开的段**。
 * 页面侧只负责"照计划渲染一帧、把 `gl.paint` 与亮度读回来"（`src/app.js` 的 `worldAudit()`
 * / `underAudit()`）—— 判断逻辑一个字都不在浏览器里。
 *
 * ── 为什么这两条值得钉住 ─────────────────────────────────────────────────────
 *
 * **`under`**：`whip` 这类转场模板读 `ctx.under`（上一段的成帧），而 `ctx.under` **只在两段交叠的
 * 那一小段里**有值。没有交叠时模板退回"没有 under"那条分支，画面几乎是黑的 ——
 * **而且不报任何错**。1-21 当初把这条记成"只声明、没接线"，理由是"交叠是时间线层的事，
 * 文本扫描判不准，假报比不报贵"；现在段对象自己带着模板的 `requires`
 * （`src/shots/index.js` 的 `shot()` 搬运），于是它**判得准**了。
 *
 * **背景守门的采样计划**：以前每个交叠段只采**一个**时刻（交叠窗中点），
 * 于是"交叠窗之外那一秒"没有任何守卫；现在采两个（+ 窗后中点），
 * 而且 `world: false`（"整帧底我自己负责"）的段单独一类：**不判铺底、但照样给读数**。
 *
 * ⚠ "**空 ≠ 干净**"（`docs/DIAGNOSIS.md` §3）：这个文件断的是"判据算得对"，
 *   真正的接线（页面侧 → CLI 打印 / 进 errs / 进 skipped）由第 4 节那几条静态自检钉住 ——
 *   判据对了但没接线，功能等于没做。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, cut, seq, auditUnderRequires, planWorldAudit, worldAuditVerdict } from '../src/timeline.js';
import { shot } from '../src/shots/index.js';

import { readCliSource } from './lib/cli-source.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
// 源码视图：anim.mjs +（拆分后）scripts/cmd/*.mjs + scripts/lib/cli/*.mjs
const ANIM = readCliSource();
const APP = readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');

let passed = 0;
const failed = [];
/** @param {string} name @param {() => void} fn */
function t(name, fn) {
  try { fn(); passed++; }
  catch (err) { failed.push(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).split('\n').join('\n      ')}`); }
}
/** 只取某一段的结果（段名写错要当场发现，别静默拿到 undefined）。 */
function one(rows, id) {
  const r = rows.find((x) => x.id === id);
  assert.ok(r, `结果里没有段 "${id}"（拿到的是 ${rows.map((x) => x.id).join(' / ') || '(空)'}）`);
  return r;
}

/* ═══════════════════════════ 1. under：该响的响、该静的静 */

t('两段、第二段是与上一段交叠的 whip ⇒ 不报（这是"对"的样子）', () => {
  const tl = build(seq([
    cut({ id: 'a', render() {} }, { dur: 4 }),
    cut(shot('whip', { id: 'w' }), { dur: 1, overlap: 0.5 }),
  ]));
  const rows = auditUnderRequires(tl);
  assert.equal(rows.length, 1, '只有 whip 声明了 under，结果里应当只有它一行');
  const w = one(rows, 'w');
  assert.equal(w.missing, false);
  assert.equal(w.overlaps, true);
  assert.equal(w.noPrev, false);
  assert.equal(w.handlesTransition, true, 'whip 的场景对象自带 handlesTransition: true');
  assert.equal(w.doubleTransition, false);
});

t('第二段要 under 却**没有** overlap ⇒ missing（画面几乎是黑的，且不报错）', () => {
  const tl = build(seq([
    cut({ id: 'a', render() {} }, { dur: 4 }),
    cut(shot('whip', { id: 'w' }), { dur: 1 }),          // ← 忘了 overlap
  ]));
  const w = one(auditUnderRequires(tl), 'w');
  assert.equal(w.missing, true, '没有交叠 ⇒ ctx.under 恒为 null ⇒ 必须报');
  assert.equal(w.overlaps, false);
});

t('它**就是第一段** ⇒ 不判（noPrev），但绝不能算成"通过"', () => {
  const tl = build(seq([cut(shot('whip', { id: 'w' }), { dur: 1 })]));
  const w = one(auditUnderRequires(tl), 'w');
  assert.equal(w.noPrev, true);
  assert.equal(w.missing, false, '第一段没有"上一段"可比，判不准就不许报（--only 会把选中的段平移到开头）');
  assert.equal(w.overlaps, false);
});

t('交叠了但**没声明** handlesTransition ⇒ doubleTransition（引擎会再叠一次交叉溶解），但不是 missing', () => {
  const bare = { id: 'b', requires: ['under'], render() {} };   // 自己声明要 under、却不声明自己处理转场
  const tl = build(seq([
    cut({ id: 'a', render() {} }, { dur: 4 }),
    cut(bare, { dur: 1, overlap: 0.5 }),
  ]));
  const b = one(auditUnderRequires(tl), 'b');
  assert.equal(b.missing, false);
  assert.equal(b.overlaps, true);
  assert.equal(b.handlesTransition, false);
  assert.equal(b.doubleTransition, true);
});

t('不声明 under 的段一个都不进结果（这条判据不误伤普通镜头）', () => {
  const tl = build(seq([
    cut(shot('title', { id: 't1', title: 'x' }), { dur: 4 }),
    cut(shot('outro', { id: 'o' }), { dur: 3, overlap: 0.3 }),
  ]));
  assert.deepEqual(auditUnderRequires(tl), []);
});

t('输入不是数组 / 是空数组 ⇒ 空数组（不抛）', () => {
  assert.deepEqual(auditUnderRequires(null), []);
  assert.deepEqual(auditUnderRequires([]), []);
});

/* ═══════════════════ 2. 口径：段上没有时读**场景**那份（与引擎逐字一致） */

t('配置档节点（{ type: \'whip\', overlap }）—— 段上是 undefined，场景上是 true ⇒ 认场景那份', () => {
  const tl = build([{ type: 'whip', id: 'w', dur: 1, overlap: 0.5 }, { type: 'title', dur: 2 }], {});
  const w = one(auditUnderRequires(tl), 'w');
  assert.equal(w.handlesTransition, true, '必须回落到场景那份 handlesTransition —— 引擎就是这么读的');
  assert.equal(w.requires.includes('under'), true);
});

t('引擎那条路：只有 _scene.requires 时也认（app.js 把 engine.timeline 直接喂进来）', () => {
  const items = [
    { id: 'a', start: 0, end: 4 },
    { id: 'w', start: 3.5, end: 4.5, _scene: { requires: ['under'], handlesTransition: true } },
  ];
  const w = one(auditUnderRequires(items), 'w');
  assert.equal(w.overlaps, true);
  assert.equal(w.missing, false);
  assert.equal(w.handlesTransition, true);
});

t('判据比的是 start 与上一段 end（结束时刻被 overlap 推走过，用它判会漏）', () => {
  // prev.end 被 overlap 推后了 2 秒：start(5) < prev.end(6) ⇒ 有交叠，不许报 missing
  const items = [
    { id: 'a', start: 0, end: 6, _scene: {} },
    { id: 'w', start: 5, end: 7, _scene: { requires: ['under'], handlesTransition: true } },
  ];
  assert.equal(one(auditUnderRequires(items), 'w').missing, false);
});

/* ═══════════════════════ 3. 背景守门的采样计划（planWorldAudit） */

const seg = (o) => ({ start: 0, end: 4, ...o });

t('有窗后部分 ⇒ **两个**采样时刻：交叠窗中点 + 窗后中点（各点都落在段内）', () => {
  const items = [
    seg({ id: 'a', start: 0, end: 6 }),
    seg({ id: 'b', start: 5, end: 8, handlesTransition: true, _scene: {} }),
  ];
  const p = one(planWorldAudit(items), 'b');
  assert.equal(p.times.length, 2, '只采一个点就是 BACKLOG 头部 ⑦ 那个"窗后没人看着"的老问题');
  assert.deepEqual(p.times.map((x) => Number(x.toFixed(3))), [5.5, 7]);
  assert.ok(p.times[0] > 5 && p.times[0] < 6, '第一个点（交叠窗中点）必须落在交叠窗内');
  assert.ok(p.times[1] > 6 && p.times[1] < 8, '第二个点（窗后中点）必须落在交叠窗之后');
  assert.equal(p.judged, true);
  assert.equal(p.selfBase, false);
});

t('段在交叠窗内就结束了 ⇒ 只采一个点（没有窗后部分可采）', () => {
  const items = [
    seg({ id: 'a', start: 0, end: 6 }),
    seg({ id: 'b', start: 5, end: 5.9, _scene: {} }),
  ];
  assert.equal(one(planWorldAudit(items), 'b').times.length, 1);
});

t('没有交叠的段根本不进计划（"只查有转场语义的段"）', () => {
  const items = [
    seg({ id: 'a', start: 0, end: 4 }),
    seg({ id: 'b', start: 4.5, end: 8, handlesTransition: true, _scene: {} }),
  ];
  assert.deepEqual(planWorldAudit(items), []);
});

t('world: false ⇒ judged=false（不判铺底）**但仍给采样时刻**（"声明 ≠ 没人看着"）', () => {
  const items = [
    seg({ id: 'a', start: 0, end: 6 }),
    seg({ id: 'w', start: 5, end: 8, world: false, _scene: { handlesTransition: true } }),
  ];
  const p = one(planWorldAudit(items), 'w');
  assert.equal(p.selfBase, true);
  assert.equal(p.judged, false);
  assert.equal(p.declaredWorld, 'self');
  assert.equal(p.times.length, 2, 'world: false 的段照样采两个点了 —— 这正是 ⑦ 要的');
  assert.equal(p.risky, true, '它自带 handlesTransition ⇒ 仍然属于"风险类"，黑帧要报');
});

t('handlesTransition 与 declaredWorld 的三种取值（none / auto / custom）', () => {
  const mk = (o) => planWorldAudit([
    seg({ id: 'a', start: 0, end: 6 }),
    seg({ id: 'b', start: 5, end: 8, _scene: {}, ...o }),
  ])[0];
  assert.equal(mk({}).declaredWorld, 'none');
  assert.equal(mk({}).risky, false, '既没有 handlesTransition 也没声明 world ⇒ 不是风险类，不判');
  assert.equal(mk({ world: 'auto' }).declaredWorld, 'auto');
  assert.equal(mk({ world: 'auto' }).risky, true);
  assert.equal(mk({ world: {} }).declaredWorld, 'custom');
  assert.equal(mk({ handlesTransition: true }).handlesTransition, true, '段上显式写的优先');
});

t('场景那份 handlesTransition 兜底（段上没有时）—— 与引擎同口径', () => {
  const items = [
    seg({ id: 'a', start: 0, end: 6 }),
    seg({ id: 'b', start: 5, end: 8, _scene: { handlesTransition: true } }),
  ];
  assert.equal(one(planWorldAudit(items), 'b').handlesTransition, true);
});

/* ══════════ 3b. 判定：判据只落在交叠窗中点，窗后点只做读数（**踩过假报**） ══════════ */

t('交叠窗中点 full=1 ⇒ 不报；窗后中点 full=0 也**不许**报（甩镜尾巴是设计）', () => {
  const plan = { judged: true, risky: true };
  // 这就是 `tasks/demo` 的甩镜实测形状：中点 1 次整帧覆盖（有 under），窗后 0 次 + 亮度 0.037
  const v = worldAuditVerdict(plan, [{ full: 1, mean: 0.945 }, { full: 0, mean: 0.037 }]);
  assert.equal(v.missing, false, '窗后点不参与判据 —— 第一版把同一条判据压上去，check demo 当场假报');
  assert.equal(v.blackTail, false, '0.037 不是"一片黑"（阈值 0.004）');
  assert.equal(v.tail.full, 0, '但读数要留着（看得到"窗后那一段整帧覆盖 0 次"）');
});

t('交叠窗中点 full=0 且是风险类 ⇒ missing（原来的判据一个字没松）', () => {
  assert.equal(worldAuditVerdict({ judged: true, risky: true }, [{ full: 0, mean: 0.05 }]).missing, true);
});

t('非风险类 / world:false 的段：就算中点 full=0 也不报（那是它的声明）', () => {
  assert.equal(worldAuditVerdict({ judged: true, risky: false }, [{ full: 0, mean: 0.05 }]).missing, false);
  assert.equal(worldAuditVerdict({ judged: false, risky: true }, [{ full: 0, mean: 0.05 }]).missing, false);
});

t('窗后中点真的黑到 < 0.004 ⇒ blackTail 是**读数**（它只报给人看，不是判据）', () => {
  const v = worldAuditVerdict({ judged: true, risky: true }, [{ full: 1, mean: 0.9 }, { full: 0, mean: 0.002 }]);
  assert.equal(v.blackTail, true);
  assert.equal(v.missing, false);
});

t('采样点只有一条（段在交叠窗内就结束了）⇒ 没有尾部读数，也不报', () => {
  const v = worldAuditVerdict({ judged: true, risky: true }, [{ full: 1, mean: 0.5 }]);
  assert.equal(v.tail, null);
  assert.equal(v.blackTail, false);
});

t('渲染出错的那一条不进判据（error 优先，别把"没渲出来"当成"没铺底"）', () => {
  assert.equal(worldAuditVerdict({ judged: true, risky: true }, [{ full: 0, error: 'boom' }]).missing, false);
  assert.equal(worldAuditVerdict({ judged: true, risky: true }, [{ full: 1, mean: 0.5 }, { error: 'boom' }]).blackTail, false);
});

t('接线：app.js 用的是这个纯函数（判据不许再写回页面侧）', () => {
  assert.ok(/worldAuditVerdict/.test(APP), 'src/app.js 必须调用 worldAuditVerdict');
});

/* ═══════════════════════════ 4. shot() 把 requires 搬到场景对象上 */

t('shot(\'whip\') 的场景对象带 requires，且是**副本**（改它不会污染模板的 spec）', () => {
  const a = shot('whip', { id: 'x' });
  const b = shot('whip', { id: 'y' });
  assert.deepEqual(a.requires, ['under']);
  assert.notEqual(a.requires, b.requires, '两次调用不能共用同一个数组');
  a.requires.push('music');
  assert.deepEqual(shot('whip', { id: 'z' }).requires, ['under'], '模板自己的 spec 一个字都不许被改');
});

t('没有 spec.requires 的模板，场景对象上**根本不出现** requires 键（缺字段 ≠ 不需要）', () => {
  assert.equal('requires' in shot('outro', { id: 'o' }), false);
});

/* ═══════════════════════════ 5. 静态接线自检（判据对了，还要真的接上） */

t('接线：app.js 暴露 underAudit()/worldAudit()，CLI 真的调用、并把 missing 变成 errs', () => {
  assert.ok(/underAudit\(\)\s*{/.test(APP), 'src/app.js 里必须有 underAudit()');
  assert.ok(/auditUnderRequires/.test(APP) && /planWorldAudit/.test(APP),
    'app.js 必须调用这两个纯函数（判断逻辑不许留在页面侧）');
  assert.ok(/__anim\.underAudit\(\)/.test(ANIM), 'CLI 必须真的问页面要这份审计');
  assert.ok(/\[under\]/.test(ANIM), 'missing 必须进 errs（有可定位的前缀）');
});

t('接线：worldAudit 采两个时刻、world: false 单独一栏、黑帧要报', () => {
  assert.ok(/selfBaseRows/.test(APP), 'world: false 的段必须单独收（BACKLOG 头部 ⑦）');
  assert.ok(/world\.selfBase|selfRows/.test(ANIM), 'CLI 必须把那一栏打印出来（以前连一行都没有）');
});

/* ────────────────────────────────────────────────────────────────── 汇总 */

console.log(`test-timeline-audit: ${passed} 项通过${failed.length ? `，${failed.length} 项失败` : ''}`);
for (const f of failed) console.log(f);
process.exit(failed.length ? 1 : 0);
