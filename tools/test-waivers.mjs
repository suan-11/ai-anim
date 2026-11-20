#!/usr/bin/env node
// @ts-check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateWaiver, reusedReasons, houseStyle, WAIVER_JUDGES, WAIVER_MIN_REASON,
  waiverCovers, auditWaiverFile, auditExemptions,
} from '../scripts/lib/waivers.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓ ' + m); };
const good = { judge: 'layout.overlap', guard: '标题与底纹刻意叠印', reason: '这支是海报风，字压纹是设计意图不是事故' };
ok(validateWaiver(good).ok, '三字段齐全 + 理由够长 ⇒ 通过');
ok(!validateWaiver({ judge: 'x', guard: 'y' }).ok, '缺 reason ⇒ 拒');
ok(!validateWaiver({ judge: 'x', reason: 'z'.repeat(20) }).ok, '缺 guard ⇒ 拒（不能空口豁免）');
ok(!validateWaiver({ guard: 'y', reason: 'z'.repeat(20) }).ok, '缺 judge ⇒ 拒');
ok(!validateWaiver({ judge: 'x', guard: 'y', reason: '设计需要' }).ok, 'reason 太短 ⇒ 拒');
ok(WAIVER_JUDGES['layout.overlap'] && WAIVER_JUDGES['background.coverage'], '已知豁免点登记');
{ const dup = reusedReasons([good, { ...good }, { judge: 'a', guard: 'b', reason: '另一条不同的理由说明' }]);
  ok(dup.length === 1 && dup[0] === good.reason, '逐字复用 reason 被抓'); }
{ const hs = houseStyle([good, { ...good }, { ...good }]);
  ok(hs.length === 1 && hs[0].judge === 'layout.overlap' && hs[0].count === 3, '同判据豁 3 次 ⇒ house style'); }
{ const hs = houseStyle([good, { ...good }]);
  ok(hs.length === 0, '豁 2 次还不到 house style'); }

/* ── 1-80 第二步：被判据 id 约束 / 段范围 / 整份文件纪律 ── */
ok(!validateWaiver({ judge: 'no.such.judge', guard: 'x', reason: 'z'.repeat(20) }).ok, '未知判据 id ⇒ 拒（防拼错后静默不生效）');
ok(validateWaiver({ ...good, segments: ['a', 'b'] }).ok, 'segments 写段名 ⇒ 通过');
ok(!validateWaiver({ ...good, segments: [] }).ok, 'segments 空数组 ⇒ 拒（会静默变成什么都没覆盖）');
ok(!validateWaiver({ ...good, segments: ['a', ''] }).ok, 'segments 里有空串 ⇒ 拒');
ok(!validateWaiver({ ...good, segments: 'a,b' }).ok, 'segments 写成字符串 ⇒ 拒（要数组）');
ok(waiverCovers(good, 'any') === true, '没有 segments ⇒ 覆盖该判据的全部对象');
ok(waiverCovers({ ...good, segments: ['a'] }, 'a') === true, 'segments 命中 ⇒ 覆盖');
ok(waiverCovers({ ...good, segments: ['a'] }, 'b') === false, 'segments 未命中 ⇒ 不覆盖');
{
  const a = auditWaiverFile([good, { judge: 'layout.overlap', guard: 'g', reason: '设计需要' }, { ...good, segments: [], reason: '第三条理由完全不一样但段范围写错了' }]);
  ok(a.valid.length === 1 && a.invalid.length === 2, 'auditWaiverFile 把不合格的条目挑出来（不静默放过）');
}
{
  const a = auditWaiverFile([good, { ...good }]);
  ok(a.valid.length === 0 && a.reused.length === 1, '逐字复用 reason 的条目**不成立**（不能当证据）');
  ok(a.invalid.every((x) => x.reused), '复用条目在 invalid 里标了 reused');
}
{
  const mk = (i) => ({ judge: 'background.coverage', guard: '段 ' + i + ' 自己铺整帧底', reason: '第 ' + i + ' 段是刻意自铺底的全屏 Pass，audit 读数 0.04' });
  const a = auditWaiverFile([mk(1), mk(2), mk(3)]);
  ok(a.valid.length === 3 && a.houseStyle.length === 1 && a.houseStyle[0].count === 3, 'house style 只数成立的条目');
}

/* ── 两个已接线的判定点：allowOverlap / world:false ── */
{
  const none = auditExemptions({ waivers: [], allowOverlap: [], appliedOverlaps: [], selfSegments: [] });
  ok(none.layout.required === false && none.background.required === false, '没有豁免点 ⇒ 不要求留痕（不制造噪音）');
}
{
  const ex = auditExemptions({ waivers: [], allowOverlap: ['标注'], appliedOverlaps: [{ kind: 'overlap' }] });
  ok(ex.layout.required === true && ex.layout.waived === false, '声明了 allowOverlap 却没留痕 ⇒ required 且未豁免');
  ok(ex.layout.applied === 1, '实际压掉的数量照实记账');
}
{
  const w = { judge: 'layout.overlap', guard: '标题压底纹是海报版式', reason: '这支是海报风：标题与底纹刻意叠印，不是遮挡事故' };
  const ex = auditExemptions({ waivers: [w], allowOverlap: ['标题'], appliedOverlaps: [] });
  ok(ex.layout.waived === true && ex.layout.stale === false, '有留痕 ⇒ 豁免成立');
}
{
  const w = { judge: 'layout.overlap', guard: '标题压底纹是海报版式', reason: '这支是海报风：标题与底纹刻意叠印，不是遮挡事故' };
  const ex = auditExemptions({ waivers: [w], allowOverlap: [], appliedOverlaps: [] });
  ok(ex.layout.stale === true, '记录在、但已经没有任何豁免点 ⇒ stale（可能已不需要）');
}
{
  const w = { judge: 'background.coverage', guard: 'outro 自铺整帧底', reason: '片尾用整屏黑场自己铺底，audit 读数 0.03，是收尾设计' };
  const ex = auditExemptions({ waivers: [w], selfSegments: [{ id: 'outro', coveredByGuard: true }, { id: 'whip', coveredByGuard: true }] });
  ok(ex.background.covered.length === 2 && ex.background.uncovered.length === 0 && ex.background.waived, '没有段范围 ⇒ 覆盖全部 world:false 交叠段');
}
{
  const w = { judge: 'background.coverage', guard: 'outro 自铺整帧底', reason: '片尾用整屏黑场自己铺底，audit 读数 0.03，是收尾设计', segments: ['outro'] };
  const ex = auditExemptions({ waivers: [w], selfSegments: [{ id: 'outro', coveredByGuard: true }, { id: 'whip', coveredByGuard: true }] });
  ok(ex.background.covered.join() === 'outro' && ex.background.uncovered.join() === 'whip', 'segments 只覆盖写到的段');
  ok(ex.background.waived === false, '有段没覆盖 ⇒ 整条不算豁免');
}
{
  const ex = auditExemptions({ waivers: [], selfSegments: [{ id: 'lab', coveredByGuard: false }] });
  ok(ex.background.required === false && ex.background.segments.length === 0, '不交叠段的 world:false 没有豁免掉判据 ⇒ 不要求留痕');
}

/* ── 接线自检：判据对了，还要真的接进 check ── */
{
  const check = readFileSync(path.join(ROOT, 'scripts', 'cmd', 'check.mjs'), 'utf8');
  ok(/auditExemptions/.test(check), '接线：check 必须调用 auditExemptions()');
  ok(/waiverAudit/.test(check) && /auditWaiverFile/.test(check), '接线：check 必须读并审计 waivers.json');
  ok(/waiver\.unrecorded\.layout/.test(check) && /waiver\.unrecorded\.background/.test(check), '接线：两个判定点都必须记「无痕豁免」');
  ok(/bgAudit|declaredSelf/.test(check), '接线：world:false 的豁免核对必须真的跑');
  const cmd = readFileSync(path.join(ROOT, 'scripts', 'cmd', 'waivers.mjs'), 'utf8');
  ok(/--segments|segments/.test(cmd), '记录入口：anim waivers --add 支持 --segments');
}
console.log('\n✓ 豁免纪律：' + passed + ' 项通过');