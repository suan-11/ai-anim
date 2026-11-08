#!/usr/bin/env node
// @ts-check
/**
 * tools/test-motion-assert.mjs —— 画面语义断言（BACKLOG 1-18）的离线单测。
 * 纯 JS，不需要 GPU / 浏览器 / Vite。判据函数在 src/timeline.js 的
 * planMotionAsserts / edgeSafeHits / motionVerdict；接线自检钉住 app.js 与
 * scripts/anim.mjs（判据对了、接线没接上 = 白测，test-layout 踩过的坑）。
 *
 * 钉住的设计（docs/REFERENCE-hyperframes.md §4.2）：
 *   · before 正反两例：纯静态判，不渲染；
 *   · 段名找不到（--only 之后段表会变）→ 单列 missing → error，绝不当通过；
 *   · 持久性感知：单点超限、下一采样点恢复 → info，永不 gate；跨采样点保持 → error；
 *   · 空 ≠ 干净：没有断言 / 有段没被覆盖 / 采样没跑成 → skipped；
 *   · 阈值覆盖：thresholds 只认认识的键，写错键名不许静默生效。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

import { readCliSource } from './lib/cli-source.mjs';

import {
  planMotionAsserts, motionVerdict, edgeSafeHits,
  MOTION_ASSERT_KINDS, MOTION_ASSERT_DEFAULTS, MOTION_STEP,
} from '../src/timeline.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TL_SRC = readFileSync(path.join(HERE, '../src/timeline.js'), 'utf8');
const APP_SRC = readFileSync(path.join(HERE, '../src/app.js'), 'utf8');
// 源码视图：anim.mjs +（拆分后）scripts/cmd/*.mjs + scripts/lib/cli/*.mjs
const CLI_SRC = readCliSource();
const REGRESS = readFileSync(path.join(HERE, 'regress-all.mjs'), 'utf8');

let passed = 0;
const failed = [];
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed.push(name); console.error(`  ✗ ${name}\n    ${err?.stack ?? err}`); }
}

/** 造段：与 build() 产物同形状（只给 planMotionAsserts 读的字段） */
const seg = (id, start, end, extra = {}) => ({ id, start, end, ...extra });

/* ═══════════════════════ 1. planMotionAsserts：计划形状与静态 before */

await t('before：B 的 start ≥ A 的 end 判 ok（正例）', () => {
  const plan = planMotionAsserts(
    [seg('a', 0, 4), seg('b', 4, 9)],
    { assert: [{ before: ['a', 'b'] }] },
  );
  assert.equal(plan.static.length, 1);
  assert.equal(plan.static[0].ok, true);
  assert.equal(plan.totals.static, 1);
  assert.equal(plan.totals.render, 0);
});

await t('before：B 先于 A 结束判 !ok（反例——顺序反了）', () => {
  const plan = planMotionAsserts(
    [seg('a', 4, 9), seg('b', 0, 3)],
    { assert: [{ before: ['a', 'b'] }] },
  );
  assert.equal(plan.static[0].ok, false);
  assert.ok(plan.static[0].gap < 0);
});

await t('before：交叠也算反（B.start < A.end）', () => {
  const plan = planMotionAsserts(
    [seg('a', 0, 5), seg('b', 4.5, 9)],
    { assert: [{ before: ['a', 'b'] }] },
  );
  assert.equal(plan.static[0].ok, false);
});

await t('采样计划形状：appearsBy 两时刻 / keepsMoving 每 0.5s 一对 / noEdgeContent 三点', () => {
  const plan = planMotionAsserts(
    [seg('a', 10, 14)],
    { assert: [
      { appearsBy: ['a', 2.0] },
      { keepsMoving: ['a', 1.5] },
      { noEdgeContent: ['a'] },
    ] },
  );
  assert.equal(plan.render.length, 3);
  const ab = plan.render.find((r) => r.kind === 'appearsBy');
  assert.deepEqual(ab.times, [10.05, 12]);            // 段头+0.05 与 段头+2.0
  const km = plan.render.find((r) => r.kind === 'keepsMoving');
  // 10.05 → 13.55 每 0.5s：8 个时刻、7 对相邻帧
  assert.equal(km.times.length, Math.ceil((14 - 10 - 0.05) / MOTION_STEP));
  assert.ok(km.times[0] >= 10.05 && km.times[km.times.length - 1] < 14);
  const ne = plan.render.find((r) => r.kind === 'noEdgeContent');
  assert.deepEqual(ne.times, [10.6, 12, 13.4]);       // 15% / 50% / 85%
  // 成本口径：appearsBy 2 帧 + keepsMoving 时刻数×2 + noEdgeContent 3 帧
  assert.equal(plan.totals.frames, 2 + km.times.length * 2 + 3);
});

await t('段名不在时间线（--only 之后）：单列 missing，不进 static/render，绝不当通过', () => {
  const plan = planMotionAsserts(
    [seg('a', 0, 4)],
    { assert: [{ before: ['a', '不存在'] }, { appearsBy: ['拼错了', 2] }] },
  );
  assert.equal(plan.totals.missing, 2);
  assert.equal(plan.static.length, 0);
  assert.equal(plan.render.length, 0);
  const v = motionVerdict(plan, null);
  assert.equal(v.errors.length, 2);
  assert.ok(v.errors.every((e) => /找不到/.test(e.message)));
});

await t('阈值覆盖：thresholds 只认认识的键，坏值不静默生效', () => {
  const plan = planMotionAsserts(
    [seg('a', 0, 4)],
    { assert: [{ noEdgeContent: ['a'] }], thresholds: { changed: 0.01, edgeSafe: 0.05, 不认识的键: 9, edgeSafe2: 'x' } },
  );
  assert.equal(plan.thresholds.changed, 0.01);
  assert.equal(plan.thresholds.edgeSafe, 0.05);
  assert.equal(plan.thresholds.不认识的键, undefined);
  // 缺省 = MOTION_ASSERT_DEFAULTS
  const plan2 = planMotionAsserts([seg('a', 0, 4)], { assert: [] });
  assert.deepEqual(plan2.thresholds, MOTION_ASSERT_DEFAULTS);
});

await t('不认识的断言形状 → ignored（写了但没生效 ≠ 通过）', () => {
  const plan = planMotionAsserts(
    [seg('a', 0, 4)],
    { assert: [{ typo: ['a'] }, { appearsBy: ['a'] }, '字符串断言', { appearsBy: ['a', -1] }] },
  );
  assert.equal(plan.totals.ignored, 4);
  const v = motionVerdict(plan, null);
  assert.ok(v.skipped.some((s) => /没生效/.test(s.why)));
});

await t('covered / uncovered：没声明的段 = 「没判」不是「通过」', () => {
  const plan = planMotionAsserts(
    [seg('a', 0, 4), seg('b', 4, 8)],
    { assert: [{ noEdgeContent: ['a'] }] },
  );
  assert.deepEqual(plan.covered, ['a']);
  assert.deepEqual(plan.uncovered, ['b']);
  const v = motionVerdict(plan, null);
  assert.ok(v.skipped.some((s) => /1 段没被任何断言覆盖：b/.test(s.why)));
});

/* ═══════════════════════ 2. edgeSafeHits：bbox 压边判定（假 blocks 数据） */

const W = 1920, H = 1080, SAFE = MOTION_ASSERT_DEFAULTS.edgeSafe; // 3%：左右 57.6px / 上下 32.4px

await t('noEdgeContent：压左边的块命中（bbox 过 3% 线）', () => {
  const hits = edgeSafeHits([{ x0: 10, x1: 300, y0: 500, y1: 540, sample: '眉标' }], W, H);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].edge, 'left');
});

await t('noEdgeContent：四边各命中一次 + 角落块出两条 + 中间块不命中', () => {
  const groups = [
    { x0: 0, x1: 100, y0: 0, y1: 20, sample: '左上' },        // left + top
    { x0: 1900, x1: 1920, y0: 1060, y1: 1080, sample: '右下' }, // right + bottom
    { x0: 900, x1: 1000, y0: 500, y1: 520, sample: '中间' },   // 安全
  ];
  const hits = edgeSafeHits(groups, W, H);
  assert.deepEqual(hits.map((h) => h.edge).sort(), ['bottom', 'left', 'right', 'top']);
  assert.equal(hits.filter((h) => h.block === hits[0].block).length, 2, '角落块的两条记录共享同一个 block');
});

await t('noEdgeContent：贴线不算（x1 == 带内沿是合法的）；坏数据不抛、返回空', () => {
  // 左带宽 57.6：x0 = 57.6（正好贴线）不算压边
  assert.equal(edgeSafeHits([{ x0: SAFE * W, x1: 300, y0: 500, y1: 520 }], W, H).length, 0);
  assert.equal(edgeSafeHits([{ x0: SAFE * W - 0.01, x1: 300, y0: 500, y1: 520 }], W, H).length, 1);
  // 坏数据：缺坐标的块跳过、W/H 非正返回空
  assert.equal(edgeSafeHits([{ x0: 0, y0: 0 }, null, undefined], W, H).length, 0); // 缺 x1/y1 的块被 isFinite 过滤跳过，不抛
  assert.deepEqual(edgeSafeHits([{ x0: 0, x1: 1, y0: 0, y1: 1 }], 0, H), []);
});

/* ═══════════════════════ 3. motionVerdict：判读与持久性感知 */

await t('motionVerdict：无断言 → skipped（空 ≠ 干净）', () => {
  const plan = planMotionAsserts([seg('a', 0, 4)], { assert: [] });
  const v = motionVerdict(plan, null);
  assert.equal(v.errors.length, 0);
  assert.equal(v.passed, 0);
  assert.ok(v.skipped.some((s) => /没有任何断言/.test(s.why)));
});

await t('appearsBy：changedRatio ≥ 阈值通过；< 阈值命中 error', () => {
  const plan = planMotionAsserts([seg('a', 10, 14)], { assert: [{ appearsBy: ['a', 2] }], thresholds: { changed: 0.0015 } });
  const rows = [{ key: 'appearsBy:a', samples: [{ t: 12, changedRatio: 0.02 }] }];
  assert.equal(motionVerdict(plan, rows).passed, 1);
  const rows2 = [{ key: 'appearsBy:a', samples: [{ t: 12, changedRatio: 0.0001 }] }];
  const v2 = motionVerdict(plan, rows2);
  assert.equal(v2.errors.length, 1);
  assert.ok(v2.errors[0].message.includes('该出现的没出现'));
});

await t('keepsMoving：单对静止 → info（持久性感知，不 gate）；连续两对以上 → error', () => {
  const plan = planMotionAsserts([seg('a', 10, 14)], { assert: [{ keepsMoving: ['a', 0.3] }] });
  // 7 对帧，只第 3 对静 → 单点瞬态
  const mk = (stillIdxs) => ({
    key: 'keepsMoving:a',
    samples: Array.from({ length: 7 }, (_, i) => ({ t: 10.55 + i * MOTION_STEP, changedRatio: stillIdxs.includes(i) ? 0 : 0.02 })),
  });
  const v1 = motionVerdict(plan, [mk([2])]);
  assert.equal(v1.errors.length, 0, '单对静止必须降级 info');
  assert.equal(v1.infos.length, 1);
  // 第 2、3 对连续静 → 2×0.5 = 1.0s > 0.5s → error
  const v2 = motionVerdict(plan, [mk([1, 2])]);
  assert.equal(v2.errors.length, 1);
  assert.ok(v2.errors[0].message.includes('连续静止 1.00s'));
  // 恰好 maxStaticSec（1 对静、阈值 0.5）不命中（"> maxStaticSec 才算"）
  const v3 = motionVerdict(plan, [mk([3])], );
  assert.equal(v3.errors.length, 0);
});

await t('keepsMoving：静止没超 maxStaticSec → 通过；采样缺行 → skipped', () => {
  const plan = planMotionAsserts([seg('a', 10, 14)], { assert: [{ keepsMoving: ['a', 2] }] });
  const ok = { key: 'keepsMoving:a', samples: Array.from({ length: 7 }, (_, i) => ({ t: 10.55 + i * MOTION_STEP, changedRatio: i % 3 === 0 ? 0 : 0.02 })) };
  assert.equal(motionVerdict(plan, [ok]).passed, 1);
  const v = motionVerdict(plan, null);
  assert.equal(v.skipped.length, 1);
  assert.ok(/没判/.test(v.skipped[0].why));
});

await t('页面侧报错的行 → skipped（没判），不冒充通过也不崩', () => {
  const plan = planMotionAsserts([seg('a', 10, 14)], { assert: [{ appearsBy: ['a', 2] }] });
  const v = motionVerdict(plan, [{ key: 'appearsBy:a', error: '渲染失败' }]);
  assert.equal(v.errors.length, 0);
  assert.equal(v.skipped.length, 1);
  assert.ok(/页面侧报错/.test(v.skipped[0].why));
});

await t('noEdgeContent：全程压边 → error；单点压边 → info（瞬态）', () => {
  const plan = planMotionAsserts([seg('a', 10, 14)], { assert: [{ noEdgeContent: ['a'] }] });
  const rows = (hitAt) => ({
    key: 'noEdgeContent:a',
    samples: [10.6, 12, 13.4].map((t, i) => ({
      t, W, H,
      groups: hitAt.includes(i) ? [{ x0: 0, x1: 100, y0: 500, y1: 520, sample: '压边字' }] : [],
    })),
  });
  const vAll = motionVerdict(plan, [rows([0, 1, 2])]);
  assert.equal(vAll.errors.length, 1);
  const vOne = motionVerdict(plan, [rows([1])]);
  assert.equal(vOne.errors.length, 0, '单点压边必须降级 info');
  assert.equal(vOne.infos.length, 1);
});

/* ═══════════════════════ 4. 接线自检（判据对了、接线没接上 = 白测） */

await t('接线：TIMELINE_KEYS 等既有导出一个字没动（planMotionAsserts 是追加不是改写）', () => {
  assert.ok(/export function describe\(timeline\)/.test(TL_SRC));
  assert.ok(TL_SRC.indexOf('planMotionAsserts') < TL_SRC.indexOf('export function describe'));
  // 既有导出还在
  for (const name of ['isConfigNode', 'cut', 'seq', 'par', 'at', 'build', 'assertNode', 'auditUnderRequires', 'planWorldAudit', 'worldAuditVerdict', 'planCarryBoundaries', 'classifyCarry', 'summarizeCarry', 'rhythmStats', 'rhythmSegments']) {
    assert.ok(new RegExp(`export function ${name}\\b`).test(TL_SRC), `${name} 丢了`);
  }
});

await t('接线：app.js 有 __anim.motionAudit（api 内、照 worldAudit 的 try/catch 模式）', () => {
  assert.ok(/async motionAudit\(rows\)/.test(APP_SRC));
  assert.ok(/window\).__anim = api/.test(APP_SRC));
  // 渲染异常不中断：samples.push({ t, error…}) 与 readPixels 副本都要在
  assert.ok(/samples\.push\(\{ t, error: String\(err/.test(APP_SRC));
  assert.ok(/new Uint8Array\(engine\.readPixels\(\)\)/.test(APP_SRC));
});

await t('接线：anim.mjs cmdCheck 已接 motion.json（读文件 / skipped / evaluateSafe / --quick 分档 / 秒数报告）', () => {
  assert.ok(/motion\.json/.test(CLI_SRC));
  assert.ok(/任务没有声明任何断言——没判 ≠ 通过/.test(CLI_SRC));
  assert.ok(/__anim\.motionAudit/.test(CLI_SRC));
  assert.ok(/planMotionAsserts/.test(CLI_SRC) && /motionVerdict/.test(CLI_SRC));
  assert.ok(/keepsMoving \/ noEdgeContent 这次没跑/.test(CLI_SRC));
  assert.ok(/画面语义断言用了/.test(CLI_SRC) && /多渲/.test(CLI_SRC));
});

await t('接线：regress-all 已登记 unit:motion-assert', () => {
  assert.ok(/unit:motion-assert/.test(REGRESS));
});

console.log(`\n${passed} 通过 / ${passed + failed.length} 项`);
if (failed.length) {
  console.error(`✗ 失败 ${failed.length} 项：\
  - ${failed.join('\n  - ')}`);
  process.exit(1);
}
