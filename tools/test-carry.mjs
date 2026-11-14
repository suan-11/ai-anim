#!/usr/bin/env node
// @ts-check
/**
 * `tools/test-carry.mjs` —— carry 词表（`src/kit/carry.js`）与 carry 审计
 * （`src/timeline.js` 的 `planCarryBoundaries` / `classifyCarry` / `summarizeCarry` / `rhythmStats`）
 * 的离线单测。纯 JS，不需要 GPU / 浏览器 / Vite。
 *
 * ## 为什么值得钉住（每个判据都有一次真实的退回在背后）
 *
 * · **carry 分类**：onetake 的同一条片子 v1 0.00 / v2 0.40 被否、v3 0.75 通过，
 *   而节奏腿四版全过 —— 连贯是节奏看不见的维度。判据抄的是它 probe 的口径
 *   （位移 ≥2% 对角线 / 缩放 ≥10% / anchored ≥3% 画面，全部【外部经验值】）。
 * · **morphRect / operatorCam** 是纯数学，端点 / 单调 / hold 归零这类性质可以精确断言。
 * · **rhythmStats**：CoV ≥ 0.25 否则节拍器 —— motion-web 匀速两版被否的教训。
 *
 * 接线自检（判据对了、接线没接上 = 白测，test-layout 踩过的坑）：
 * index.js 再导出、regress-all 登记、carry 字段在 TIMELINE_KEYS / cut() / build() 三处接线。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

import { readCliSource } from './lib/cli-source.mjs';

import {
  morphRect, iris, zoomThrough, hop, gather, operatorCam,
  CARRY_MOVE_FRAC, CARRY_SCALE_FRAC, CARRY_ANCHOR_FRAC,
} from '../src/kit/carry.js';
import {
  planCarryBoundaries, classifyCarry, summarizeCarry, rhythmStats, rhythmSegments,
} from '../src/timeline.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(HERE, '../src/kit/carry.js'), 'utf8');
const TL_SRC = readFileSync(path.join(HERE, '../src/timeline.js'), 'utf8');
const KIT_INDEX = readFileSync(path.join(HERE, '../src/kit/index.js'), 'utf8');
const REGRESS = readFileSync(path.join(HERE, 'regress-all.mjs'), 'utf8');
// CLI 的源码视图：anim.mjs + （拆分后）scripts/cmd/*.mjs + scripts/lib/cli/*.mjs —— 见 tools/lib/cli-source.mjs
const CLI = readCliSource();

let passed = 0;
const failed = [];
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed.push(name); console.error(`  ✗ ${name}\n    ${err?.stack ?? err}`); }
}

const TOL = 1e-9;

/* ═══════════════════════ 1. morphRect —— 容器形变 */

await t('morphRect：端点取值 —— t≤t0 是 A，t≥t0+dur 是 B（两种缓动都成立）', () => {
  const A = [100, 400, 320, 72], B = [660, 140, 600, 800];
  for (const e of ['inOutCubic', 'inQuart', 'linear']) {
    const r0 = morphRect(0, 0.6, 0.5, A, B, { ease: e });
    const r1 = morphRect(1.2, 0.6, 0.5, A, B, { ease: e });
    assert.deepEqual([r0.x, r0.y, r0.w, r0.h], A);
    assert.deepEqual([r1.x, r1.y, r1.w, r1.h], B);
  }
});

await t('morphRect：t0 之后单调向 B（400 点扫描，不许回头）', () => {
  const A = [0, 0, 10, 10], B = [500, 300, 600, 800];
  let px = -Infinity;
  for (let i = 0; i <= 400; i++) {
    const r = morphRect(0.6 + (i / 400) * 0.5, 0.6, 0.5, A, B);
    assert.ok(r.x >= px - TOL, `x 在 ${r.x} 回头了`);
    assert.ok(r.w >= 0 && r.h >= 0, '宽高不许为负');
    px = r.x;
  }
});

await t('morphRect：dur ≤ 0 = 一到 t0 直接跳 B，不出 NaN', () => {
  const A = [0, 0, 1, 1], B = [2, 2, 3, 3];
  const before = morphRect(0.5, 0.6, 0, A, B);
  const after = morphRect(0.7, 0.6, 0, A, B);
  assert.deepEqual([before.x, before.y, before.w, before.h], A);
  assert.deepEqual([after.x, after.y, after.w, after.h], B);
});

await t('morphRect：NaN / 坏矩形当场抛（不静默返回 NaN —— 那是整屏白）', () => {
  assert.throws(() => morphRect(NaN, 0, 1, [0, 0, 1, 1], [1, 1, 1, 1]), /有限数/);
  assert.throws(() => morphRect(0, 0, 1, [0, 0, 1], [1, 1, 1, 1]), /\[x, y, w, h\]/);
  assert.throws(() => morphRect(0, 0, 1, [0, 0, 1, Infinity], [1, 1, 1, 1]), /有限数/);
});

/* ═══════════════════════ 2. iris / zoomThrough */

await t('iris：k 端点是 0 与 1；正反相加为 1；dur≤0 直接落定', () => {
  assert.ok(Math.abs(iris(0, 1, 1).k - 0) < TOL);
  assert.ok(Math.abs(iris(2, 1, 1).k - 1) < TOL);
  // reverse 是 1-k：任意时刻正反两个方向的 k 相加必须是 1
  for (const tt of [1.2, 1.5, 1.9]) {
    const kf = iris(tt, 1, 1).k, kr = iris(tt, 1, 1, { reverse: true }).k;
    assert.ok(Math.abs(kf + kr - 1) < TOL, `t=${tt}: ${kf} + ${kr} ≠ 1`);
  }
  assert.ok(Math.abs(iris(0, 1, 0).k) < TOL);
  assert.ok(Math.abs(iris(2, 1, 0).k - 1) < TOL);
});

await t('iris：k 单调 0→1（reveal 不许先开后合）', () => {
  let prev = -1;
  for (let i = 0; i <= 200; i++) {
    const k = iris(1 + (i / 200), 1, 1).k;
    assert.ok(k >= prev - TOL);
    prev = k;
  }
});

await t('zoomThrough：k=1 时目标充满画面（tx/ty 把目标中心推到画面中心）', () => {
  const W = 1920, H = 1080;
  const target = [720, 300, 480, 300];
  const z = zoomThrough(10, 0.4, 0.8, target, W, H);
  assert.ok(Math.abs(z.k - 1) < TOL);
  // s=1 ⇒ 全景；s 满画面 ⇒ min(W/tw, H/th)。对数插值端点必须精确。
  const sEnd = Math.min(W / target[2], H / target[3]);
  assert.ok(Math.abs(z.s - sEnd) < 1e-6, `s 端点 ${(z.s)} ≠ ${sEnd}`);
  // 满画面时目标中心 = 画面中心：tx/ty 按我们文档的公式 setXform({x: tx, y: ty, scale: s}) 验证
  const cx = target[0] + target[2] / 2, cy = target[1] + target[3] / 2;
  const sx = cx * z.s + z.tx * z.s, sy = cy * z.s + z.ty * z.s;
  assert.ok(Math.abs(sx - W / 2) < 1e-6, `目标中心在画面 x=${sx}，该是 ${W / 2}`);
  assert.ok(Math.abs(sy - H / 2) < 1e-6, `目标中心在画面 y=${sy}，该是 ${H / 2}`);
});

await t('zoomThrough：k=0 时 s=1（全景，没推）', () => {
  const z = zoomThrough(0, 0.4, 0.8, [720, 300, 480, 300], 1920, 1080);
  assert.ok(Math.abs(z.s - 1) < TOL);
});

/* ═══════════════════════ 3. hop / gather */

await t('hop：端点是 from/to；弧高中点最高、端点为零（sin(πk)）', () => {
  const from = [200, 620], to = [960, 620];
  const h0 = hop(1.2, 1.2, 0.9, from, to, { height: 220 });
  const h1 = hop(2.2, 1.2, 0.9, from, to, { height: 220 });
  const mid = hop(1.65, 1.2, 0.9, from, to, { height: 220 });
  assert.ok(Math.abs(h0.x - from[0]) < TOL && Math.abs(h0.y - from[1]) < TOL);
  assert.ok(Math.abs(h1.x - to[0]) < TOL && Math.abs(h1.y - to[1]) < TOL);
  assert.ok(Math.abs(mid.y - (620 - 220)) < 1e-6, `中点弧高 ${620 - mid.y}，该是 220`);
});

await t('gather：起点各归各位；同 seed 两次调用逐位相等（确定性）；默认收拢到裸簇心', () => {
  const from = [100, 800], to = [960, 540];
  const g0 = gather(3.0, 3.0, 1.6, 0, 5, from, to);
  assert.ok(Math.abs(g0.x - from[0]) < TOL && Math.abs(g0.y - from[1]) < TOL);
  // spread=0（默认）：终点就是裸簇心
  const g4 = gather(5.0, 3.0, 1.6, 4, 5, from, to);
  assert.ok(Math.abs(g4.x - to[0]) < TOL && Math.abs(g4.y - to[1]) < TOL, 'spread=0 时端点 = 簇心');
  const a = gather(4.0, 3.0, 1.6, 2, 5, from, to, { seed: 7 });
  const b = gather(4.0, 3.0, 1.6, 2, 5, from, to, { seed: 7 });
  assert.deepEqual(a, b, '同 seed 必须逐位相等（铁律：确定性）');
});

await t('gather：spread 的散布有界且确定性（端点在簇心 ± spread 内，抖动在端点归零）', () => {
  const from = [100, 800], to = [960, 540];
  for (let i = 0; i < 8; i++) {
    const g = gather(20, 3.0, 1.0, i, 8, from, to, { spread: 60 });
    assert.ok(Math.abs(g.x - to[0]) <= 60 + TOL, `i=${i} 的散布越界：${g.x}`);
    assert.ok(Math.abs(g.y - to[1]) <= 60 + TOL, `i=${i} 的散布越界：${g.y}`);
  }
});

await t('gather：错峰 —— i 越大出发越晚；最终都到 to', () => {
  const from = [100, 800], to = [960, 540];
  const kAt = (i, tNow) => gather(tNow, 3.0, 1.0, i, 5, from, to).k;
  assert.ok(kAt(0, 3.1) > 0, 'i=0 在 3.1s 已在动');
  assert.equal(kAt(4, 3.1), 0, 'i=4（stagger 0.05×4=0.2s 后才出发）在 3.1s 还没动');
  // spread=0：所有元素最终都精确落在簇心
  for (let i = 0; i < 5; i++) {
    const g = gather(10, 3.0, 1.0, i, 5, from, to);
    assert.ok(Math.abs(g.x - to[0]) < TOL && Math.abs(g.y - to[1]) < TOL, `i=${i} 没到簇心`);
  }
});

/* ═══════════════════════ 4. operatorCam —— 操作员手感 */

/** makeCam 形状的假相机（离线：不 import cam.js，避免拖进 GPU 世界） */
const fakeCam = { at: (t) => ({ x: 100 + t, y: 50, zoom: 1.5, rot: 0 }) };

await t('operatorCam：lead 提前量 —— at(t) 读的是 cam.at(t+lead)', () => {
  const op = operatorCam(fakeCam, { lead: 0.1, drift: 0, hits: [] });
  assert.ok(Math.abs(op.at(2).x - (100 + 2.1)) < TOL, '没有 drift/hits 时 x 就是 cam.at(t+lead)');
});

await t('operatorCam：rests 里浮动归零（hold 必须真空静 —— clearing 的假红教训）', () => {
  const op = operatorCam(fakeCam, { lead: 0, drift: 3, hits: [], rests: [[5, 8]], seed: 1 });
  const inside = op.at(6.5);
  assert.equal(inside.driftX, 0, 'rest 区间内 driftX 必须是 0');
  assert.equal(inside.driftY, 0, 'rest 区间内 driftY 必须是 0');
  const outside = op.at(2);
  assert.ok(Math.abs(outside.driftX) > 0 || Math.abs(outside.driftY) > 0, 'rest 之外浮动应该在动');
});

await t('operatorCam：落地 shake —— hit 前为零、hit 后衰减、久后归零', () => {
  const op = operatorCam(fakeCam, { lead: 0, drift: 0, hits: [[4, 12, 0.3]], seed: 1 });
  assert.equal(op.at(3.9).shakeX, 0, 'hit 之前 shake 必须是 0（不许提前抖）');
  const soon = Math.abs(op.at(4.05).shakeX) + Math.abs(op.at(4.05).shakeY);
  const later = Math.abs(op.at(5.5).shakeX) + Math.abs(op.at(5.5).shakeY);
  assert.ok(soon > later, `衰减：4.05s 的 ${soon} 应该大于 5.5s 的 ${later}`);
  assert.ok(later < 0.5, `0.3s decay 半衰期之后 1.5s，shake 该接近 0（实测 ${later}）`);
});

await t('operatorCam：确定性 —— 同 t 两次调用逐位相等', () => {
  const op = operatorCam(fakeCam, { hits: [[4, 10, 0.5]], rests: [[8, 9]], seed: 3 });
  assert.deepEqual(op.at(6.42), op.at(6.42));
});

await t('operatorCam：NaN 当场抛', () => {
  assert.throws(() => operatorCam(fakeCam, { lead: NaN }), /有限数/);
  assert.throws(() => operatorCam(fakeCam, { hits: [[1, NaN, 0.2]] }).at(2), /有限数/);
  assert.throws(() => operatorCam(fakeCam, {}).at(NaN), /有限数/);
});

/* ═══════════════════════ 5. carry 审计（timeline.js） */

/** 造段：与 build() 产物同形状（只给 planCarryBoundaries 读的字段） */
const seg = (id, start, end, extra = {}) => ({ id, start, end, ...extra });

await t('planCarryBoundaries：交叠边界取交叠中点，硬切取切点', () => {
  const items = [seg('a', 0, 4), seg('b', 4, 6, { carry: undefined }), seg('c', 5.5, 9)];
  // b 结束在 6，c 从 5.5 开始 ⇒ 交叠 0.5，中点 5.75；a→b 是硬切，at=4
  const plan = planCarryBoundaries(items);
  assert.equal(plan.length, 2);
  assert.ok(Math.abs(plan[0].at - 4) < TOL, '硬切边界在切点');
  assert.equal(plan[0].prevId, 'a'); assert.equal(plan[0].id, 'b');
  assert.ok(Math.abs(plan[1].at - 5.75) < TOL, '交叠边界在交叠中点');
  assert.ok(Math.abs(plan[1].overlap - 0.5) < TOL);
});

await t('planCarryBoundaries：carry 声明从段对象与场景对象两处都能读到', () => {
  const items = [seg('a', 0, 4), seg('b', 4, 8, { carry: 'morph' }),
    seg('c', 8, 12), seg('d', 12, 16, { _scene: { carry: 'anchor' } })];
  const plan = planCarryBoundaries(items);
  assert.equal(plan.find((p) => p.id === 'b').registered, 'morph');
  assert.equal(plan.find((p) => p.id === 'd').registered, 'anchor');
  assert.equal(plan.find((p) => p.id === 'c').registered, null);
});

await t('planCarryBoundaries：片尾 1.2s 豁免标记正确', () => {
  const items = [seg('a', 0, 4), seg('b', 4, 20)];
  const plan = planCarryBoundaries(items);
  // 全片 20s，尾豁免从 18.8 起；b 的边界在 4s ⇒ 不豁免
  assert.equal(plan[0].exemptTail, false);
  const items2 = [seg('a', 0, 4), seg('b', 4, 10), seg('c', 10, 10.5)];
  // 全片 10.5，尾豁免从 9.3 起；b→c 边界在 10 ⇒ 豁免；a→b 在 4 ⇒ 不豁免
  const plan2 = planCarryBoundaries(items2);
  assert.equal(plan2[0].exemptTail, false);
  assert.equal(plan2[1].exemptTail, true);
});

await t('classifyCarry：三档分类的边界 —— 位移 / 缩放 / 锚', () => {
  // 位移 ≥2% 对角线 ⇒ carried
  assert.equal(classifyCarry({ matched: 10, total: 196, avgShiftFrac: 0.03, avgScale: 1 }).verdict, 'carried');
  // 匹配够多但位移 <2% 且覆盖 ≥3% ⇒ anchored
  assert.equal(classifyCarry({ matched: 10, total: 196, avgShiftFrac: 0.01, avgScale: 1 }).verdict, 'anchored');
  // 少量匹配 + 位移小 ⇒ bare
  assert.equal(classifyCarry({ matched: 2, total: 196, avgShiftFrac: 0.01, avgScale: 1 }).verdict, 'bare');
  // 缩放 ≥10% ⇒ carried
  assert.equal(classifyCarry({ matched: 10, total: 196, avgShiftFrac: 0, avgScale: 1.2 }).verdict, 'carried');
});

await t('classifyCarry：minBlocks 之下不许 carried（几个块的巧合不是衔接）', () => {
  assert.equal(classifyCarry({ matched: 3, total: 196, avgShiftFrac: 0.5, avgScale: 1 }).verdict, 'bare');
});

await t('summarizeCarry：score 口径 = (carried + anchored/2) / judged；阈值分档', () => {
  const row = (verdict, at) => ({ verdict, at, registered: null, exemptTail: false });
  const s1 = summarizeCarry([row('carried', 4), row('anchored', 9)]);
  assert.ok(Math.abs(s1.score - (1 + 0.5) / 2) < TOL);
  const s2 = summarizeCarry([row('carried', 4), row('bare', 9), row('bare', 14)]);
  assert.ok(Math.abs(s2.score - 1 / 3) < TOL);
  assert.equal(s2.tier, 'fail');
  const s3 = summarizeCarry([row('carried', 4), row('carried', 9)]);
  assert.equal(s3.tier, 'pass');
});

await t('summarizeCarry：burst（1.5s 内 ≥3 边界）整组豁免 —— staccato 是合法的 bare', () => {
  const row = (verdict, at) => ({ verdict, at, registered: null, exemptTail: false });
  const s = summarizeCarry([
    row('bare', 10.0), row('bare', 10.4), row('bare', 10.8),
    row('bare', 14.0),
  ]);
  assert.equal(s.exempt, 3, '前三条成 burst，整组豁免');
  assert.equal(s.judged, 1, '只判孤立的第 4 条');
});

await t('summarizeCarry：显式登记 morph 计 carried、anchor 计 anchored；空表 = noBoundaries', () => {
  const s = summarizeCarry([
    { verdict: 'bare', at: 4, registered: 'morph', exemptTail: false },
    { verdict: 'bare', at: 8, registered: 'anchor', exemptTail: false },
  ]);
  assert.equal(s.carried, 1); assert.equal(s.anchored, 1); assert.equal(s.bare, 0);
  assert.ok(Math.abs(s.score - 0.75) < TOL);
  const empty = summarizeCarry([]);
  assert.equal(empty.noBoundaries, true, '0 边界必须报 noBoundaries（1.00 over 0 boundaries 不是证据）');
});

await t('rhythmStats：CoV ≥0.25 判节拍器；等长 = 节拍器；单段 = noRhythm', () => {
  const even = rhythmStats([seg('a', 0, 4), seg('b', 4, 8), seg('c', 8, 12)]);
  assert.equal(even.metronome, true, '三段等长 4s 是节拍器');
  const varied = rhythmStats([seg('a', 0, 1), seg('b', 1, 5), seg('c', 5, 7)]);
  assert.equal(varied.metronome, false);
  assert.ok(varied.cov > 0.25);
  const one = rhythmStats([seg('a', 0, 4)]);
  assert.equal(one.noRhythm, true, '单段没有分布，必须报没判');
});

await t('rhythmStats：CoV 数值验算（样本标准差 n-1）', () => {
  const r = rhythmStats([seg('a', 0, 1), seg('b', 1, 3), seg('c', 3, 4)]);
  // durs = [1, 2, 1]，mean=4/3，样本方差 = ((1/3)²+(2/3)²+(1/3)²)/2 = 1/3，std=0.5774，cov=0.433
  assert.ok(Math.abs(r.cov - Math.sqrt(1 / 3) / (4 / 3)) < 1e-9, `cov=${r.cov}`);
});

/* ═══════════════════════ 5b. rhythmSegments —— 静/动分段（1-38） */

await t('rhythmSegments：静 0.5 → burst 1.0 → 静 1.2 的标定形状（_carry-lab 夹具）', () => {
  // 模拟夹具的 rhythm 段（0.5s 步长）：0-0.5 静（首步被首帧规则强制算动，不成段——0.5s < minHold
  // 也本来不该成段）、0.5-1.5 动、1.5-2.7 静（成段，1.5s ≥ minHold）
  const steps = [];
  for (let i = 0; i <= 5; i++) {
    const t = i * 0.5;
    const still = t < 0.4 || t >= 1.5;
    steps.push({ t, movedFrac: still ? 0.001 : 0.9 });
  }
  const seg1 = rhythmSegments(steps, { step: 0.5 });
  assert.equal(seg1.holds.length, 1, `应量出 1 个静段（量出 ${JSON.stringify(seg1.holds)}）`);
  assert.ok(Math.abs(seg1.longest - 1.5) < TOL, `最长静段 ${seg1.longest} 应为 1.5s（1.5→3.0）`);
  assert.ok(seg1.stillRatio > 0.4, `静步占比 ${(seg1.stillRatio * 100).toFixed(0)}% 应 ≥40%`);
});

await t('rhythmSegments：孤立单步静不成段（镜头间的呼吸不算 hold）', () => {
  // 一长串动帧中间夹一步静 —— 不许长出 ≥1s 的段
  const steps = Array.from({ length: 10 }, (_, i) => ({ t: i * 0.5, movedFrac: i === 5 ? 0.001 : 0.9 }));
  const r = rhythmSegments(steps, { step: 0.5 });
  assert.equal(r.holds.length, 0, '单步静（0.5s < minHold）不该成段');
  // stillRatio 照样统计（那一步确实是静的）；分母含首帧（首步是时间轴的一部分）
  assert.ok(Math.abs(r.stillRatio - 1 / 10) < TOL, `占比口径 = 静步/全部步（含强制算动的首步），量出 ${r.stillRatio}`);
});

await t('rhythmSegments：慢推不是静（movedFrac 高于阈值的步不算静）', () => {
  // 1→1.05 的慢推：每步 movedFrac 0.02（>0.005）⇒ 没有静段（clearing 假红教训的判据面）
  const steps = Array.from({ length: 10 }, (_, i) => ({ t: i * 0.5, movedFrac: 0.02 }));
  const r = rhythmSegments(steps, { step: 0.5 });
  assert.equal(r.holds.length, 0);
  assert.equal(r.stillRatio, 0);
});

await t('rhythmSegments：空表 / 单步 —— 没判（「空 ≠ 干净」）', () => {
  assert.equal(rhythmSegments([]).total, 0);
  assert.equal(rhythmSegments([{ t: 0, movedFrac: 1 }]).holds.length, 0);
  assert.equal(rhythmSegments(null).stillRatio, 0, 'null 输入不许崩');
});

/* ═══════════════════════ 6. 静态扫描与接线自检（判据对了、接线没接上 = 白测） */

await t('静态扫描：carry.js 无 Math.random / Date.now / performance.now；import 白名单只有 core/util.js', () => {
  assert.ok(!/Math\s*\.\s*random/.test(SRC));
  assert.ok(!/Date\s*\.\s*now/.test(SRC));
  assert.ok(!/performance\s*\.\s*now/.test(SRC));
  // 只认真实 ESM 形状（剥注释后）：`} from '...'` / `import x from '...'` / `import '...'`。
  // ⚠ 别用裸 /\bfrom\s*['"]/ —— `'hop.from'` 这种字符串里 from 后面也跟着引号（第一次就踩的）。
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const specs = [
    ...code.matchAll(/}\s*from\s*['"]([^'"]+)['"]/g),
    ...code.matchAll(/^\s*import\s+(?:[\w*{},\s]+\s+)?from\s*['"]([^'"]+)['"]/gm),
    ...code.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
  ].map((m) => m[1]);
  assert.ok(specs.length > 0, '至少该匹配到 ../core/util.js（正则坏了也是失败）');
  for (const s of specs) assert.ok(s === '../core/util.js', 'carry.js 不该 import ' + s);
});

await t('接线：src/kit/index.js 再导出了六个函数与三个常量', () => {
  for (const n of ['morphRect', 'iris', 'zoomThrough', 'hop', 'gather', 'operatorCam',
    'CARRY_MOVE_FRAC', 'CARRY_SCALE_FRAC', 'CARRY_ANCHOR_FRAC']) {
    assert.ok(new RegExp('\\b' + n + '\\b').test(KIT_INDEX), 'src/kit/index.js 里没有 ' + n);
  }
  assert.ok(/from '\.\/carry\.js'/.test(KIT_INDEX));
});

await t('接线：regress-all 有 unit:carry 且指向本文件', () => {
  assert.ok(/name: 'unit:carry'/.test(REGRESS), '回归清单里没有 unit:carry');
  assert.ok(/cmd: \['tools\/test-carry\.mjs'\]/.test(REGRESS));
});

await t('接线：carry 字段三处都在 —— TIMELINE_KEYS / cut() / build() 搬运', () => {
  assert.ok(/'carry'/.test(TL_SRC), 'TIMELINE_KEYS 里没有 carry（配置档节点写 carry 会被当模板参数抛错）');
  assert.ok(/carry: opts\.carry/.test(TL_SRC), 'cut() 没有白名单化 carry');
  assert.ok(/carry: c\.carry/.test(TL_SRC), 'build() 没把 carry 搬到段上');
});

await t('接线：CLI 有 carry 子命令，帮助文本写了用法', () => {
  assert.ok(/carry: cmdCarry/.test(CLI), 'commands 表里没有 carry');
  assert.ok(/anim\.mjs carry <task>/.test(CLI), '帮助文本里没有 carry 的用法');
});

await t('出处：carry.js 与 timeline.js 的注释都点了 REFERENCE-onetake.md（数值与出处要能对回去）', () => {
  assert.ok(/REFERENCE-onetake\.md/.test(SRC));
  assert.ok(/REFERENCE-onetake\.md/.test(TL_SRC));
});

/* ────────────────────────────────────────────────────────────────── 汇总 */

console.log('test-carry: ' + passed + ' 项通过' + (failed.length ? '，' + failed.length + ' 项失败' : ''));
if (failed.length) {
  for (const f of failed) console.error('  失败：' + f);
  process.exit(1);
}
process.exit(0);
