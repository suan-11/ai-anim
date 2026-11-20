#!/usr/bin/env node
// @ts-check
import assert from 'node:assert/strict';
import { meanAbsDiff, assessLoopSeam, LOOP_SEAM_THRESHOLD } from '../scripts/lib/loop-seam.mjs';
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓ ' + m); };
console.log('meanAbsDiff');
ok(meanAbsDiff(Buffer.from([10, 10, 10, 10]), Buffer.from([10, 10, 10, 10]), 1) === 0, '相同帧差=0');
ok(meanAbsDiff(Buffer.from([0, 0, 0, 0]), Buffer.from([10, 10, 10, 10]), 1) === 10, '全差 10 ⇒ 均值 10');
ok(meanAbsDiff(Buffer.from([0, 100]), Buffer.from([0, 0]), 2) === 0, 'stride 采样只取第 0 个');
console.log('assessLoopSeam');
ok(assessLoopSeam(0).seamless === true, '差 0 无缝');
ok(assessLoopSeam(LOOP_SEAM_THRESHOLD).seamless === true, '差=阈值 算无缝（≤）');
ok(assessLoopSeam(LOOP_SEAM_THRESHOLD + 1).seamless === false, '差>阈值 有缝');
ok(assessLoopSeam(50).text.includes('跳一下'), '有缝文案点明会跳');
ok(assessLoopSeam(NaN).seamless === false, 'NaN 不算无缝');
console.log('\n✓ 循环接缝判据：' + passed + ' 项通过');
