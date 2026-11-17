#!/usr/bin/env node
// @ts-check
import assert from 'node:assert/strict';
import { validateWaiver, reusedReasons, houseStyle, WAIVER_JUDGES, WAIVER_MIN_REASON } from '../scripts/lib/waivers.mjs';
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
console.log('\n✓ 豁免纪律：' + passed + ' 项通过');
