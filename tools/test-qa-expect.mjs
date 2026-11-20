#!/usr/bin/env node
// @ts-check
/**
 * tools/test-qa-expect.mjs —— qa 期望值校验 + NOT CHECKED 极性（1-77）的离线回归。
 * 纯函数 assessExpectations / parseSizeSpec，用合成 scan，不起 ffmpeg。
 */
import assert from 'node:assert/strict';
import { assessExpectations, parseSizeSpec, QA_SPEC_LIST } from '../scripts/lib/media.mjs';
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓ ' + m); };
const scan = { width: 1920, height: 1080, fps: 30, duration: 26, hasAudio: true };
const bySpec = (rs, s) => rs.find((r) => r.spec === s);

console.log('parseSizeSpec');
ok(parseSizeSpec('1920x1080').w === 1920 && parseSizeSpec('1920x1080').h === 1080, '1920x1080 解析');
ok(parseSizeSpec('1920×1080').h === 1080, '全角 × 也认');
ok(parseSizeSpec('abc') === null, '写法不对返回 null');

console.log('默认：全 NOT CHECKED，不产生 fail');
{
  const rs = assessExpectations(scan, {});
  ok(rs.length === QA_SPEC_LIST.length, '四项规格都在');
  ok(rs.every((r) => r.status === 'not-checked'), '没传期望 ⇒ 全 not-checked');
  ok(!rs.some((r) => r.status === 'fail'), '默认不产生 fail（仍只报读数）');
}

console.log('显式期望：符合 ⇒ pass');
{
  const rs = assessExpectations(scan, { size: '1920x1080', fps: 30, duration: 26, audio: 'required' });
  ok(rs.every((r) => r.status === 'pass'), '全符合 ⇒ 全 pass');
}

console.log('显式期望：不符 ⇒ fail（翻极性）');
ok(bySpec(assessExpectations(scan, { size: '1280x720' }), 'size').status === 'fail', '尺寸不符 fail');
ok(bySpec(assessExpectations(scan, { duration: 99 }), 'duration').status === 'fail', '时长不符 fail');
ok(bySpec(assessExpectations(scan, { audio: 'none' }), 'audio').status === 'fail', '要求无音轨但有 ⇒ fail');
ok(bySpec(assessExpectations({ ...scan, hasAudio: false }, { audio: 'required' }), 'audio').status === 'fail', '要求有音轨但无 ⇒ fail');

console.log('容差');
ok(bySpec(assessExpectations({ ...scan, fps: 29.97 }, { fps: 30 }), 'fps').status === 'pass', '29.97 vs 30 在容差内 pass');
ok(bySpec(assessExpectations({ ...scan, fps: 24 }, { fps: 30 }), 'fps').status === 'fail', '24 vs 30 超容差 fail');
ok(bySpec(assessExpectations({ ...scan, duration: 26.4 }, { duration: 26 }), 'duration').status === 'pass', '时长 ±0.5s 内 pass');
ok(bySpec(assessExpectations({ ...scan, duration: 27.5 }, { duration: 26 }), 'duration').status === 'fail', '时长超 ±0.5s fail');

console.log('非法期望值 ⇒ fail（不静默）');
ok(bySpec(assessExpectations(scan, { size: 'abc' }), 'size').status === 'fail', '非法 size fail');
ok(bySpec(assessExpectations(scan, { audio: 'maybe' }), 'audio').status === 'fail', '非法 audio 值 fail');
ok(bySpec(assessExpectations(scan, { fps: -5 }), 'fps').status === 'fail', '负 fps fail');

console.log('部分传：其余仍 NOT CHECKED');
{
  const rs = assessExpectations(scan, { size: '1920x1080' });
  ok(bySpec(rs, 'size').status === 'pass', '传了的 size pass');
  ok(bySpec(rs, 'fps').status === 'not-checked', '没传的 fps 仍 not-checked');
  ok(bySpec(rs, 'audio').status === 'not-checked', '没传的 audio 仍 not-checked');
}

console.log('\n✓ qa 期望值判据：' + passed + ' 项通过');
