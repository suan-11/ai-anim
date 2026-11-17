#!/usr/bin/env node
// @ts-check
import assert from 'node:assert/strict';
import { TIERS, TIER_ORDER, ANTI_PPT_TIERS, bucketByTier, tierSummary } from '../tools/lib/judge-tiers.mjs';
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓ ' + m); };
ok(TIER_ORDER.length === 3 && TIERS.floor && TIERS.reflex && TIERS.finish, '三层词表齐全');
ok(ANTI_PPT_TIERS.C3 === 'floor', 'C3 转场静默回落 = floor');
ok(ANTI_PPT_TIERS.C6 === 'finish', 'C6 声音层 = finish');
ok(ANTI_PPT_TIERS.C1 === 'reflex' && ANTI_PPT_TIERS.C7 === 'reflex', 'C1/C7 = reflex');
{ const c = bucketByTier(['C1','C3','C3','C6','C7'], ANTI_PPT_TIERS);
  ok(c.floor === 2 && c.reflex === 2 && c.finish === 1, '按 tier 计数正确'); }
{ const c = bucketByTier(['XX'], ANTI_PPT_TIERS);
  ok(c.reflex === 1, '未知代码默认 reflex'); }
ok(tierSummary({ floorFail: 0, reflexFail: 2, reflexWaived: 1, finishNotes: 3 }) === 'Floor 0 FAIL · Reflex 2 (1 waived) · Finish 3', '汇总格式');
ok(tierSummary({}) === 'Floor 0 FAIL · Reflex 0 · Finish 0', '空汇总');
ok(tierSummary({ reflexFail: 1 }).includes('(0 waived)') === false, '无豁免不打 waived');
console.log('\n✓ 判据分层：' + passed + ' 项通过');
