#!/usr/bin/env node
// @ts-check
/**
 * `tools/lib/harness-checks.mjs` 与 `tools/scene-harness.mjs` 双离线预检单测。
 * 纯函数 + 离线假 ctx 端到端冒烟，不需要 Chrome / GPU。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYOUT_LIMITS } from '../src/layout.js';
import {
  resolveLayoutLimits,
  evaluateOfflineLayout,
  mergeEffectivePost,
  evaluateCutZoomContinuity,
} from './lib/harness-checks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
  console.log(`  ✓ ${msg}`);
}

console.log('test-harness-checks:');

// 1. resolveLayoutLimits
{
  const def = resolveLayoutLimits();
  assert.deepEqual(def, LAYOUT_LIMITS);
  ok(def !== LAYOUT_LIMITS, 'resolveLayoutLimits 返回副本而非原常量');

  const ov = resolveLayoutLimits({ maxBlocks: 8, maxOffSubject: 3, unknownKey: 99, minAlpha: -1, gap: NaN });
  ok(ov.maxBlocks === 8 && ov.maxOffSubject === 3, 'resolveLayoutLimits 允许合法非负数字覆盖');
  ok(!('unknownKey' in ov), 'resolveLayoutLimits 忽略未知键');
  ok(ov.minAlpha === LAYOUT_LIMITS.minAlpha && ov.gap === LAYOUT_LIMITS.gap, 'resolveLayoutLimits 忽略负数与 NaN 覆盖');
}

// 2. evaluateOfflineLayout
{
  // 正常：1 个主体 + 2 个外界块 + 页眉/页脚保留区各 1 块 → 0 违规
  const cleanBlocks = [
    { x: 160, y: 80, size: 28, w: 200, alpha: 1, sample: '01 · 标题页眉' },        // reserved top (y<=124.2)
    { x: 600, y: 500, size: 72, w: 300, alpha: 1, sample: '21.4%' },               // inside center focus
    { x: 200, y: 400, size: 20, w: 120, alpha: 1, sample: 'sRGB 柱' },             // off-subject 1
    { x: 1600, y: 400, size: 20, w: 120, alpha: 1, sample: 'Linear 柱' },          // off-subject 2
    { x: 1600, y: 1018, size: 20, w: 150, alpha: 1, sample: 'rightLabel 页脚' },   // reserved bottom
  ];
  const rClean = evaluateOfflineLayout([{ t: 5, lt: 5, blocks: cleanBlocks, paint: { any: 3, full: 1, lines: 1, other: 0 }, textLayerDrawn: true }], {
    id: 'clean', focus: 'center', W: 1920, H: 1080,
  });
  ok(rClean !== null && rClean.violations.length === 0 && rClean.noFocus === false, '正常版面（含保留区页眉页脚）0 违规且已判 focus');

  // 超 6 块 → blocks
  const sevenBlocks = Array.from({ length: 7 }, (_, i) => ({
    x: 200 + (i % 3) * 520,
    y: 220 + i * 95,
    size: 20,
    w: 160,
    alpha: 1,
    sample: `块_${i}`,
  }));
  const rSeven = evaluateOfflineLayout([{ t: 3, lt: 3, blocks: sevenBlocks, paint: null, textLayerDrawn: true }], {
    id: 'seven', focus: 'center',
  });
  ok(rSeven.violations.some((v) => v.kind === 'blocks' && v.got === 7), '7 块文字命中 blocks 违规');

  // in-focus > 2
  const crowdedFocus = [
    { x: 800, y: 400, size: 20, w: 180, alpha: 1, sample: 'F1' },
    { x: 800, y: 500, size: 20, w: 180, alpha: 1, sample: 'F2' },
    { x: 800, y: 600, size: 20, w: 180, alpha: 1, sample: 'F3' },
  ];
  const rInFocus = evaluateOfflineLayout([{ t: 4, lt: 4, blocks: crowdedFocus }], { id: 'infocus', focus: 'center' });
  ok(rInFocus.violations.some((v) => v.kind === 'in-focus' && v.got === 3), '主体区 3 块命中 in-focus 违规');

  // off-subject > 2
  const manyOutside = [
    { x: 800, y: 500, size: 72, w: 260, alpha: 1, sample: 'Hero' },
    { x: 180, y: 240, size: 20, w: 120, alpha: 1, sample: 'Out1' },
    { x: 180, y: 420, size: 20, w: 120, alpha: 1, sample: 'Out2' },
    { x: 180, y: 600, size: 20, w: 120, alpha: 1, sample: 'Out3' },
  ];
  const rOut = evaluateOfflineLayout([{ t: 4, lt: 4, blocks: manyOutside }], { id: 'outside', focus: 'center' });
  ok(rOut.violations.some((v) => v.kind === 'off-subject' && v.got === 3), '主体之外 3 块命中 off-subject 违规');

  // 未声明 focus → noFocus: true
  const rNoFocus = evaluateOfflineLayout([{ t: 1, lt: 1, blocks: manyOutside }], { id: 'nofocus', focus: null });
  ok(rNoFocus.noFocus === true && rNoFocus.inFocus === -1, '未声明 focus 时如实记 noFocus: true');
}

// 3. mergeEffectivePost
{
  const pDefault = mergeEffectivePost(null, null, [{ ov: null, itemPost: null }]);
  ok(pDefault.zoom === 1, 'mergeEffectivePost 缺省 zoom 为 1');

  const pMerged = mergeEffectivePost(
    { zoom: 1, bloom: 0.2 },
    { bloom: 0.06, grain: 0.01 },
    [
      { ov: { zoom: 1.028, grain: 0.03 }, itemPost: null },
      { ov: { zoom: 1.006 }, itemPost: { bloom: 0.12, zoom: 1.010 } },
    ],
  );
  ok(pMerged.zoom === 1.010 && pMerged.bloom === 0.12 && pMerged.grain === 0.01,
    'mergeEffectivePost 严格遵循 后段覆盖前段 且 itemPost > stylePost > ov 优先级');
}

// 4. evaluateCutZoomContinuity
{
  const hits = evaluateCutZoomContinuity([
    { prevId: 'hook', nextId: 'gamma_trap', prevStart: 0, cutStart: 20.55, tBefore: 20.533, tAt: 20.55, zoomBefore: 1.028, zoomAt: 1.006, kind: 'cut-start' },
    { prevId: 'gamma_trap', nextId: 'linear_limit', prevStart: 20.55, cutStart: 35.31, tBefore: 35.293, tAt: 35.31, zoomBefore: 1.0061, zoomAt: 1.0059, kind: 'cut-start' },
    { prevId: 'b1', nextId: 'b2', prevStart: 0, cutStart: 10, tBefore: 9.983, tAt: 10, zoomBefore: 1.0, zoomAt: 1.005, kind: 'cut-start' },
    { prevId: 'b2', nextId: 'b3', prevStart: 10, cutStart: 20, tBefore: 19.983, tAt: 20, zoomBefore: 1.0, zoomAt: 1.0051, kind: 'cut-start' },
    { prevId: 'nan1', nextId: 'nan2', prevStart: 20, cutStart: 30, tBefore: 29.983, tAt: 30, zoomBefore: NaN, zoomAt: 1.0, kind: 'cut-start' },
  ], { W: 1920, threshold: 0.005 });

  ok(hits.length === 2, `切点缩放跳变准确命中 2 条（|Δ|=0.022 与 0.0051；实得 ${hits.length}）`);
  ok(hits[0].pxJump === 21 && hits[0].message.includes('zoomRelease') && hits[0].message.includes('hook'),
    'Δzoom=0.022 准确算出边缘跳变 ~21px 并给出 zoomRelease 修复提示');
  ok(hits[1].prevId === 'b2' && hits[1].nextId === 'b3', '精确 0.005 边界放行、0.0051 命中，NaN 不崩');
}

// 5. 端到端 oklab 零误报
{
  const res = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'scene-harness.mjs'), 'oklab', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  });
  ok(res.status === 0, `scene-harness oklab --json 退出码为 0（实得 ${res.status}）`);
  const j = JSON.parse(res.stdout || '{}');
  ok(j.cuts?.checked >= 5 && Array.isArray(j.cuts?.jumps) && j.cuts.jumps.length === 0,
    `oklab 全部 ${j.cuts?.checked} 处切点 zoom 连续（0 跳变）`);
  ok(Array.isArray(j.scenes) && j.scenes.length === 6
    && j.scenes.every((s) => s.layout && Array.isArray(s.layout.violations) && s.layout.violations.length === 0),
    'oklab 全部 6 段离线版面预检均通过且 0 违规');
}

console.log(`\n✓ test-harness-checks 全部通过（${passed} 项）`);
