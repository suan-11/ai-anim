#!/usr/bin/env node
// @ts-check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TIERS, TIER_ORDER, ANTI_PPT_TIERS, bucketByTier, tierSummary,
  CHECK_TIERS, CHECK_LABELS, TIER_LEGEND, summarizeCheckFindings, formatTriggered,
} from '../tools/lib/judge-tiers.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

/* ── check 侧（1-82 第二步）：词表 / 汇总 / 触发清单 ── */
ok(Object.keys(CHECK_TIERS).length >= 30, 'check 判据表覆盖到主要判据（≥30 条）');
ok(Object.values(CHECK_TIERS).every((t) => TIER_ORDER.includes(t)), '每条都归到 floor/reflex/finish 之一');
ok(Object.keys(CHECK_LABELS).length === Object.keys(CHECK_TIERS).length, '每条判据都有中文标签（报告/文档用）');
ok(CHECK_TIERS['scene.nonfinite'] === 'floor', '非有限值 = floor（现在就会红）');
ok(CHECK_TIERS['background.missing'] === 'floor', '背景守门没铺底 = floor');
ok(CHECK_TIERS['beat.align'] === 'reflex', '卡点 = reflex（--strict 才当门）');
ok(CHECK_TIERS['audio.loudness'] === 'finish', '响度 = finish（只报读数）');
ok(CHECK_TIERS['waiver.unrecorded.background'] === 'reflex', '无痕豁免 = reflex（可豁免，但要有留痕）');
ok(CHECK_TIERS['remotion.render-error'] === 'floor' && CHECK_TIERS['remotion.black'] === 'floor' && CHECK_TIERS['remotion.mismatch'] === 'floor', 'Remotion 渲染/黑帧/不一致 = floor');
ok(CHECK_TIERS['remotion.flat'] === 'reflex', 'Remotion 纯平 = reflex');
ok(TIER_LEGEND.includes('floor') && TIER_LEGEND.includes('--strict') && TIER_LEGEND.includes('finish'), '分层脚注把三层的门说清楚');
{
  const r = summarizeCheckFindings([
    { code: 'scene.nonfinite' }, { code: 'scene.nonfinite' },
    { code: 'beat.align' },
    { code: 'waiver.unrecorded.layout', waived: true },
    { code: 'audio.loudness' },
  ]);
  ok(r.counts.floor === 1 && r.counts.reflex === 2 && r.counts.finish === 1, '按 tier 计数（条目去重到判据代码）');
  ok(r.counts.waived === 1, 'waived 只数 reflex 里整条被豁免的');
  ok(r.line === 'Floor 1 FAIL · Reflex 2 (1 waived) · Finish 1', '汇总行格式与 anti-ppt 一致');
  ok(r.codes.find((c) => c.code === 'scene.nonfinite').count === 2, '同一判据多个实例只算一条（带 ×N）');
}
{
  const r = summarizeCheckFindings([
    { code: 'waiver.unrecorded.background', waived: true },
    { code: 'waiver.unrecorded.background' },
  ]);
  ok(r.counts.waived === 0 && r.codes[0].waived === false, '部分豁免不算豁免（有一条没留痕就整条算没豁免）');
}
{
  const r = summarizeCheckFindings([{ code: 'not.registered' }]);
  ok(r.counts.reflex === 1 && r.codes[0].tier === 'reflex', '未登记的代码默认 reflex（诚实：至少不冒充 floor）');
}
{
  const r = summarizeCheckFindings([{ code: 'beat.align', count: 1 }, { code: 'audio.loudness' }]);
  ok(formatTriggered(r.codes) === 'beat.align · audio.loudness', '触发清单按 tier 排序、不带 ×1');
  ok(formatTriggered([]).includes('0 ≠ 没接线'), '空清单不说「干净」，说「0 ≠ 没接线」');
}
{
  const src = readFileSync(path.join(ROOT, 'scripts', 'cmd', 'check.mjs'), 'utf8');
  ok(/summarizeCheckFindings/.test(src), '接线：check 必须调用 summarizeCheckFindings()');
  ok(/formatTriggered/.test(src) && /TIER_LEGEND/.test(src), '接线：check 必须打印触发清单与分层脚注');
  ok(/finding\(/.test(src), '接线：判据触发点必须记 finding()');
}
console.log('\n✓ 判据分层：' + passed + ' 项通过');