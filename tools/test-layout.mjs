// @ts-check
/**
 * **版面守门**（`docs/LAYOUT.md`）—— 离线单测。
 *
 *   node tools/test-layout.mjs
 *
 * 不需要 GPU / 不需要浏览器 / 不起 Vite：这里测的全是纯函数（`src/layout.js`）。
 * 页面侧只负责"照计划渲一帧、把 `gl.paint.blocks` 读回来"（`src/app.js` 的 `layoutRows()`），
 * 判断逻辑一个字都不在浏览器里 —— 与 `worldAuditVerdict()` / `auditUnderRequires()` 同一个套路。
 *
 * ── 为什么值得钉住 ────────────────────────────────────────────────────────────
 *
 * 钠那期视频（`tasks/sodium`）的外部反馈：「有些动画元素相互遮挡害得我搞不清楚到底要看哪个
 * 主体」。这句话在产物上**可复现**（一屏 4–6 个信息块），但引擎以前一条判据都没有 ——
 * 亮度统计看不出"元素太多"。这一层把它变成机器判据，所以每一档都必须钉死：
 *   · 该响的响（块数超限 / 主体之外太多"看的地方" / 主体区里压着别的块）；
 *   · 该静的静（**版面母题**：页眉、说明条、脚注不算"多了一个看的地方"）；
 *   · 没声明的说"没判"（没写 `focus` 不许说成通过）；
 *   · 报告的**形状**（`layoutReport` 平铺一层字段）—— 2026-10-16 断过一次：判据对了、
 *     接线读的是旧字段名，报告里全是 `undefined`。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readCliSource } from './lib/cli-source.mjs';

import {
  LAYOUT_LIMITS, RESERVED_BANDS, resolveFocus, textGroups, focusOverlap,
  layoutVerdict, layoutReport, layoutSummary, countNonTextDraws, focusNoteOf,
  geometryViolations,
} from '../src/layout.js';
import { labelRow } from '../src/kit/layout.js';
import { TextKit } from '../src/core/text.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
// CLI 源码视图（anim.mjs + 拆分后的 scripts/cmd、scripts/lib/cli，见 tools/lib/cli-source.mjs）
const ANIM = readCliSource();
const APP = read('src/app.js');
const TEXT = read('src/core/text.js');
const ENGINE = read('src/core/engine.js');
const GL = read('src/core/gl.js');
const TL = read('src/timeline.js');

let passed = 0;
const failed = [];
/** @param {string} name @param {() => void} fn */
function t(name, fn) {
  try { fn(); passed++; }
  catch (err) { failed.push('  x ' + name + '\n      ' + String(err && err.message ? err.message : err).split('\n').join('\n      ')); }
}

/* ── 造数据的小工具（blocks 就是 gl.paint.blocks 的形状，不碰 GPU） ── */

/** 一块字：基线 (x, y)、字号 size、实测宽度 w、不透明度 alpha */
const B = (x, y, size, w, sample = 'x', alpha = 1) => ({ x, y, size, w, alpha, sample });

/**
 * 一屏「典型钠式」版面：眉标 +（可选）读数面板 + 主体大字 + 说明条 + 脚注。
 * 这是那一期视频里最常见的一屏 —— 判据要能把它与「一屏只有一件事」分开。
 */
function sodiumScreen(o = {}) {
  const out = [B(128, 92, 30, 140, '钠 5/6')];                       // 眉标（保留区）
  if (o.readout) {
    const n = o.readoutN ?? 6;
    for (let i = 0; i < n; i++) out.push(B(1240, 330 + i * 26, 18, 90, 'R' + i));
  }
  for (const s of (o.extra ?? [])) out.push(s);
  if (o.subject !== false) out.push(B(660, 620, 96, 600, '主体'));
  if (o.caption !== false) out.push(B(128, 964, 44, 420, '说明条'));
  if (o.footer !== false) out.push(B(128, 1004, 21, 300, '出处'));
  return out;
}

/* ═══════════════════════ 1. 合成「块」：读数面板算一块，隔开的一列算两块 */

t('26px 一道的 6 个读数合成一块（观众看见的是一块，不是 6 个元素）', () => {
  const g = textGroups([0, 1, 2, 3, 4, 5].map((i) => B(1240, 330 + i * 26, 18, 90, 'R' + i)));
  assert.equal(g.length, 1, '一列挨着的读数必须合成一块');
  assert.equal(g[0].n, 6);
});

t('隔了 60px 的两块字不许合并（那是一次真正的「多了一个东西」）', () => {
  const g = textGroups([B(128, 400, 24, 200, 'A'), B(128, 460, 24, 200, 'B')]);
  assert.equal(g.length, 2);
});

t('挨得比 gap 还近的两行算一块（同一个信息块的两行）', () => {
  const g = textGroups([B(128, 900, 24, 200, 'A'), B(128, 928, 24, 200, 'B')]);
  assert.equal(g.length, 1);
});

t('空数组 / 非数组 / 缺坐标 ⇒ 空结果（不抛）', () => {
  assert.deepEqual(textGroups([]), []);
  assert.deepEqual(textGroups(null), []);
  assert.deepEqual(textGroups([null, {}, { x: 1 }]), []);
});

/* ═══════════════════════ 2. focus 声明的归一化 */

t('focus 写 center ⇒ 中心 46%x50%（1920x1080）', () => {
  const r = resolveFocus('center', 1920, 1080);
  assert.ok(r, 'center 必须解析得出矩形');
  assert.equal(r.source, 'center');
  assert.ok(Math.abs(r.w - 1920 * 0.46) < 1e-6, '宽应为中心 46%，拿到 ' + r.w);
  assert.ok(Math.abs(r.h - 1080 * 0.5) < 1e-6, '高应为中心 50%，拿到 ' + r.h);
  assert.ok(Math.abs(r.x - (1920 - r.w) / 2) < 1e-6);
});

t('focus 给 {x,y,w,h} 原样；给 {cx,cy,w,h} 换算成左上角', () => {
  const a = resolveFocus({ x: 10, y: 20, w: 100, h: 50 }, 1920, 1080);
  assert.equal(a.x, 10);
  assert.equal(a.y, 20);
  const c = resolveFocus({ cx: 960, cy: 540, w: 400, h: 200 }, 1920, 1080);
  assert.equal(c.x, 760);
  assert.equal(c.y, 440);
});

t('focus 写坏了（只有 x/y、没尺寸）⇒ null（= 没声明，判据说「没判」，不许说通过）', () => {
  assert.equal(resolveFocus({ x: 10, y: 20 }, 1920, 1080), null);
  assert.equal(resolveFocus('middle', 1920, 1080), null);
  assert.equal(resolveFocus(null, 1920, 1080), null);
});

t('重叠比按块自己的面积算：一半压在 focus 里 ⇒ 0.5', () => {
  const g = { x0: 0, y0: 0, x1: 100, y1: 100 };
  const ov = focusOverlap(g, { x: 50, y: 0, w: 100, h: 100 });
  assert.ok(Math.abs(ov.ratio - 0.5) < 1e-9);
  assert.equal(ov.inside, true);
  assert.equal(focusOverlap(g, { x: 200, y: 0, w: 10, h: 10 }).inside, false);
});

/* ═══════════════════════ 3. 判据：该响的响 */

t('一屏 7 块（读数面板 + 三块散标注 + 主体 + 说明条）⇒ blocks 超限', () => {
  // 坐标是手工摆的：每一块都跟别的块隔开 > 40px，它们就是 7 块独立的信息
  const v = layoutVerdict({
    id: 'x', t: 1,
    focus: { x: 0, y: 0, w: 900, h: 900 },
    blocks: [
      B(128, 92, 30, 140, '钠 5/6'),
      B(1240, 330, 18, 90, 'R0'),
      B(1240, 356, 18, 90, 'R1'),
      B(1240, 382, 18, 90, 'R2'),
      B(1240, 408, 18, 90, 'R3'),
      B(1240, 434, 18, 90, 'R4'),
      B(1240, 460, 18, 90, 'R5'),
      B(300, 200, 20, 150, 'L1'),
      B(1700, 880, 20, 150, 'L2'),
      B(500, 700, 20, 150, 'L3'),
      B(660, 560, 96, 600, '主体'),
      B(128, 1000, 44, 420, '说明条'),
    ],
  });
  const kinds = v.violations.map((x) => x.kind);
  assert.equal(v.blocks, 7, '夹具要正好 7 块，拿到 ' + v.blocks);
  assert.ok(kinds.includes('blocks'), '必须报 blocks 超限，拿到 ' + JSON.stringify(kinds));
});

t('主体之外 3 个看的地方 ⇒ off-subject 超限，明细里点名', () => {
  const v = layoutVerdict({
    blocks: [
      B(660, 560, 96, 600, '主体'),
      B(300, 200, 20, 150, '左标注'),
      B(1600, 880, 20, 150, '右标注'),
      B(500, 700, 20, 150, '下标注'),
    ],
  });
  const off = v.violations.find((x) => x.kind === 'off-subject');
  assert.ok(off, '必须报 off-subject');
  assert.equal(off.got, 3);
  assert.equal(v.offSubject, 3);
  assert.ok(off.detail.includes('左标注'), '明细要点名是哪几块');
});

t('主体区里压着 3 块 ⇒ in-focus 超限（元素互相遮挡的读数）', () => {
  const v = layoutVerdict({
    focus: 'center',
    blocks: [
      B(500, 480, 26, 300, '队列'),
      B(700, 560, 26, 300, '标签 A'),
      B(560, 700, 26, 300, '标签 B'),
    ],
  });
  const inf = v.violations.find((x) => x.kind === 'in-focus');
  assert.ok(inf, '必须报 in-focus');
  assert.equal(inf.got, 3);
});

/* ═══════════════════════ 4. 判据：该静的静（假报比不报贵） */

t('版面母题（眉标 + 说明条 + 脚注）不算「多了一个看的地方」', () => {
  const v = layoutVerdict({ blocks: sodiumScreen({}) });
  assert.deepEqual(v.violations, [], '只有主体 + 母题的一屏必须干净（钠每一段都是这个形状）');
  assert.equal(v.blocks, 3, '三块都要真的存在，否则这条断言什么都没测');
  assert.equal(v.offSubject, 0);
});

t('一屏只有一个大标题 ⇒ 不报', () => {
  const v = layoutVerdict({ blocks: [B(200, 300, 64, 700, '标题')] });
  assert.deepEqual(v.violations, []);
});

t('页脚按 H 的比例判（脚注挪低一点也还是母题，不是写死像素）', () => {
  const H = 1080;
  const y = H * RESERVED_BANDS.footer;
  const v = layoutVerdict({ blocks: [B(128, y - 10, 21, 300, '脚注'), B(660, 620, 96, 600, '主体')] });
  assert.deepEqual(v.violations, []);
});

t('alpha 很低（还没揭晓）的绘制不算占了一屏', () => {
  const dim = [0, 1, 2, 3, 4].map((i) => B(400 + i * 200, 300 + i * 90, 24, 150, 'd' + i, 0.05));
  const v = layoutVerdict({ blocks: [...sodiumScreen({}), ...dim] });
  assert.deepEqual(v.violations, [], 'alpha < minAlpha 的块必须被丢掉');
});

t('阈值可以被任务覆盖（limits: { maxBlocks: 3 } 更严、{ maxBlocks: 9 } 更松）', () => {
  const blocks = [
    B(1240, 330, 18, 90, 'R0'),
    B(1240, 356, 18, 90, 'R1'),
    B(300, 200, 20, 150, 'L1'),
    B(1700, 880, 20, 150, 'L2'),
    B(660, 560, 96, 600, '主体'),
  ];
  assert.equal(layoutVerdict({ blocks }).blocks, 4, '夹具要正好 4 块（两个读数合成一块）');
  const loose = layoutVerdict({ blocks, limits: { maxBlocks: 9, maxOffSubject: 9 } });
  const tight = layoutVerdict({ blocks, limits: { maxBlocks: 3, maxOffSubject: 9 } });
  assert.deepEqual(loose.violations, []);
  assert.ok(tight.violations.some((x) => x.kind === 'blocks'));
});

/* ═══════════════════════ 5. 「没声明 focus」不等于通过 */

t('没声明 focus ⇒ noFocus: true、inFocus = -1（「没判」而不是 0）', () => {
  const v = layoutVerdict({ blocks: [B(660, 620, 96, 600, '主体')] });
  assert.equal(v.noFocus, true);
  assert.equal(v.inFocus, -1);
  assert.equal(v.focus, null);
  assert.equal(v.offSubject, 0, '「主体之外有几个看的地方」不依赖 focus，一块都没有时就是 0');
});

t('没声明 focus 时 offSubject 照样算得出来（钠那期 12 段全没声明）', () => {
  const v = layoutVerdict({ blocks: [B(660, 620, 96, 600, '主体'), B(300, 300, 20, 150, 'L1'), B(1600, 700, 20, 150, 'L2'), B(500, 900, 20, 150, 'L3')] });
  assert.equal(v.noFocus, true);
  assert.equal(v.offSubject, 3);
});

t('声明了 focus ⇒ noFocus: false（判据这一半才真的跑了）', () => {
  const v = layoutVerdict({ focus: 'center', blocks: [B(660, 620, 96, 600, '主体')] });
  assert.equal(v.noFocus, false);
  assert.ok(v.inFocus >= 0);
});

/* ═══════════════════════ 6. 报告：形状 + 取最糟那一帧 + 汇总三档 */

t('layoutReport 取最挤的那一帧，并把字段平铺一层（CLI 只读一层）', () => {
  const thin = layoutVerdict({ t: 1, blocks: [B(660, 620, 96, 600, '主体')] });
  const fat = layoutVerdict({
    t: 2,
    focus: 'center',
    blocks: sodiumScreen({ readout: true, extra: [B(300, 250, 20, 150, 'L1'), B(1600, 700, 20, 150, 'L2'), B(500, 860, 20, 150, 'L3')] }),
  });
  assert.ok(fat.violations.length > 0, 'fat 那个夹具必须真的超限，否则这条断言什么都没测');
  const r = layoutReport([{ id: 'seg', samples: [{ t: 1, verdict: thin }, { t: 2, verdict: fat }] }])[0];
  assert.equal(r.judged, true);
  assert.equal(r.samples, 2);
  assert.equal(r.t, 2, '报告的时刻必须是「最挤那一帧」的时刻');
  assert.equal(r.blocks, fat.blocks);
  assert.equal(r.draws, fat.draws);
  assert.equal(r.over, 1, '两帧里只有一帧超限');
  assert.equal(typeof r.focus, 'object');
  assert.ok(Array.isArray(r.violations));
  assert.equal(r.worst, fat, 'worst 就是那一帧的判定对象本身');
});

t('一次采样都没有的段 ⇒ judged: false（「没判」，不是通过）', () => {
  const r = layoutReport([{ id: 'empty', samples: [] }])[0];
  assert.equal(r.judged, false);
  assert.equal(r.worst, null);
  assert.deepEqual(layoutSummary([r]).unjudged, ['empty']);
});

t('layoutSummary 的三档：violates / noFocus / peak / inFocus', () => {
  const withFocus = layoutVerdict({
    t: 1,
    focus: 'center',
    blocks: [B(500, 480, 26, 300, '队列'), B(700, 560, 26, 300, 'A'), B(560, 700, 26, 300, 'B')],
  });
  const noFocus = layoutVerdict({ t: 1, blocks: [B(660, 620, 96, 600, '主体')] });
  const rows = layoutReport([
    { id: 'a', samples: [{ t: 1, verdict: withFocus }] },
    { id: 'b', samples: [{ t: 1, verdict: noFocus }] },
    { id: 'c', samples: [] },
  ]);
  const s = layoutSummary(rows);
  assert.equal(s.segments, 3);
  assert.equal(s.judged, 2);
  assert.deepEqual(s.unjudged, ['c']);
  assert.deepEqual(s.violates.map((r) => r.id), ['a']);
  assert.deepEqual(s.noFocus, ['b']);
  assert.deepEqual(s.inFocus, ['a']);
  assert.ok(s.peak >= 3, 'peak 要报最挤那一帧的块数，拿到 ' + s.peak);
});

t('全干净的片子 ⇒ violates 空、peak 仍是真实块数（不是 0）', () => {
  const v = layoutVerdict({ t: 1, blocks: sodiumScreen({}) });
  const s = layoutSummary(layoutReport([{ id: 'x', samples: [{ t: 1, verdict: v }] }]));
  assert.deepEqual(s.violates, []);
  assert.ok(s.peak > 0, 'peak 不能因为「没违规」就变成 0');
});

/* ═══════════════════════ 7. 静态接线自检（判据对了，还要真的接上） */

t('接线：文字记账在 text.js 里、只认场景那一层、记的是实际绘制', () => {
  assert.ok(/function noteText/.test(TEXT), 'src/core/text.js 必须有 noteText');
  assert.ok(/paint\.layer !== type/.test(TEXT), '只记画在这一层上的字（引擎字幕/HUD 不算）');
  assert.ok(/blocks\.push/.test(TEXT), '要把这一笔记进 paint.blocks');
  assert.ok(/noteText\(\s*this/.test(TEXT), 'write()/karaoke() 要真的调用它');
});

t('接线：engine 开账时把这一层的排版工具放进 paint.layer（存 Layer2D 会恒假）', () => {
  assert.ok(/beginPaint/.test(ENGINE), 'engine 必须调 gl.beginPaint');
  assert.ok(/layer:\s*layer\?\.type/.test(GL), 'paint.layer 必须是 layer.type（TextKit）');
  assert.ok(/this\.type\.gl = gl/.test(GL), 'Layer2D 要把 gl 转给它的 TextKit（否则记账恒假）');
});

t('接线：ctx.focus 从段上读、回落到场景那份；cut() 与配置档都带 focus', () => {
  assert.ok(/focus:\s*item\.focus \?\? item\._scene\?\.focus/.test(ENGINE), 'ctx.focus 的来源');
  assert.ok(/focus: opts\.focus/.test(TL), 'cut() 要把 focus 搬到段上');
  assert.ok(/'focus',/.test(TL), '配置档节点的 TIMELINE_KEYS 里必须有 focus');
});

t('接线：app.js 暴露 layoutRows()（读回记账、不渲染），CLI 按段点名读并汇总', () => {
  assert.ok(/layoutRows\(o = \{\}\)/.test(APP), 'src/app.js 里必须有 layoutRows()');
  assert.ok(/layoutVerdict/.test(APP) && /layoutLimits/.test(APP), 'app.js 必须用这两个纯函数');
  assert.ok(/__anim\.layoutRows\(\{ id \}\)/.test(ANIM), 'CLI 必须按段点名读记账（交叠期同时画着两段）');
  assert.ok(/layoutReport\(/.test(ANIM) && /layoutSummary\(/.test(ANIM), 'CLI 必须用这两个纯函数汇总');
});

t('接线：默认只 warn、--strict 才进 errs（与 1-19 / lint-narration-dup 同一条哲学）', () => {
  assert.ok(/\[版面守门\]/.test(ANIM), 'errs 里要有可定位的前缀');
  assert.ok(/if \(strict\)/.test(ANIM), '--strict 才 gate');
});

t('接线：复述率也接进了 errs（--strict 下）—— 钠那期的第一条病因', () => {
  assert.ok(/\[旁白复述\]/.test(ANIM), 'lint-narration-dup 的命中要在 --strict 下进 errs');
});

t('版面母题保留区与 kit 的带宽同源（改一处要一起改）', () => {
  const BANDS = read('src/kit/bands.js');
  assert.ok(/captionBand/.test(BANDS) && /captionY/.test(BANDS), 'kit/bands.js 仍在管这几条带');
  assert.ok(RESERVED_BANDS.caption > 0.85 && RESERVED_BANDS.caption < 0.95, '说明条那条约 y = 0.90H');
});

t('阈值默认值就是交接单那三条（主体之外 <= 2；每屏 <= 6 块）', () => {
  assert.equal(LAYOUT_LIMITS.maxOffSubject, 2);
  assert.equal(LAYOUT_LIMITS.maxBlocks, 6);
  assert.ok(LAYOUT_LIMITS.gap >= 20 && LAYOUT_LIMITS.gap <= 48, 'gap 该在「一行字」的量级');
});

/* ═══════════ 8. 「主体区 0 块」的读数是哪一种（交接单 F：主体是图形 vs 空屏） */

/**
 * 造一本"绘制账"—— 形状就是 `gl.paint`（`src/core/gl.js` 的 `beginPaint()`：
 * `full/any/lines/text/target/other/layer/blocks/markError`）。
 * 字段的**含义**在 `countNonTextDraws()` 的注释里逐条对着 gl.js 核过：
 *   · `any`   = 所有真的提交过的绘制（Pass.render / blit / LineBatch.flush）；
 *   · `full`  = 其中 blend:false 的全屏 Pass（`_notePaint` 里判定）；
 *   · `lines` = 其中 LineBatch.flush() 的次数；
 *   · `other` = 画到了别的渲染目标上（引擎内部搬运）；
 *   · `blocks`= 文字（`noteText` 记录）；`text` 字段**从来没人写过**，别拿它当文字计数。
 */
const paintBook = (o = {}) => ({
  full: o.full ?? 0, any: o.any ?? 0, lines: o.lines ?? 0, text: 0,
  target: o.target ?? null, other: o.other ?? 0, layer: null,
  blocks: o.blocks ?? [], markError: !!o.markError,
});

t('绘制账：非文字绘制 = any − other − 文字层的那一次合成（gl.paint 的真实字段）', () => {
  // 背景 worldPass（1 次不透明全屏 Pass）+ 波形 lines.flush（1）+ 文字层 comp.draw（1）
  const book = paintBook({ any: 3, full: 1, lines: 1 });
  const r = countNonTextDraws(book, { textLayerDrawn: true });
  assert.equal(r.known, true);
  assert.equal(r.total, 2, '3 笔里减掉文字层那一次 = 2 笔非文字（背景 + 矢量）');
  assert.equal(r.lines, 1, '其中 1 笔是矢量批次');
  assert.equal(r.passes, 1, '另 1 笔是全屏 Pass（背景）');
  // 同一帧、但场景没提交文字层（一个字都没画）：不减那 1 次
  assert.equal(countNonTextDraws(book, { textLayerDrawn: false }).total, 3);
});

t('绘制账：内部搬运（other）不算"画了东西"—— 否则 xform 的段会被误判成有图形', () => {
  const book = paintBook({ any: 4, other: 2, lines: 1 });
  assert.equal(countNonTextDraws(book, { textLayerDrawn: true }).total, 1);
});

t('绘制账：拿不到账 / 错帧卡片 ⇒ known:false（"没判"，不许冒充 0）', () => {
  assert.equal(countNonTextDraws(null).known, false);
  assert.equal(countNonTextDraws(undefined).known, false);
  const bad = countNonTextDraws(paintBook({ any: 5, markError: true }), { textLayerDrawn: true });
  assert.equal(bad.known, false, '错帧卡片不是"这一段的主体"，读数按没判处理');
  assert.equal(bad.error, true);
});

t('主体区 0 块 + 有图形 ⇒ focusNote = graphics（不算"没画东西"）', () => {
  // 一屏只有一条页脚标注（保留区），主体是方波：focus 里一个字块都没有。
  // 与《把信号拆开》的每一段同一个形状 —— 这正是交接单 F 说的那一类读数。
  const v = layoutVerdict({
    t: 1, focus: { x: 140, y: 330, w: 1640, h: 500 },
    blocks: [B(128, 985, 21, 420, '波形 2.4 s · LOW / MID / HIGH')],
    paint: paintBook({ any: 3, full: 1, lines: 1 }), textLayerDrawn: true,
  });
  assert.equal(v.blocks, 1);
  assert.equal(v.inFocus, 0, '主体区里确实 0 块字（这一条原本就没错）');
  assert.equal(v.focusNote, 'graphics');
  assert.equal(v.nonTextDraws, 2, '读数里带上"画了几笔非文字"：背景 + 矢量');
  assert.equal(v.nonTextKnown, true);
  assert.deepEqual(v.violations, [], '这条改动**不放松任何判据**：它本来就不该超限');
  // 平移进报告之后字段还在（CLI 只读一层）
  const row = layoutReport([{ id: 's', samples: [{ t: 1, verdict: v }] }])[0];
  assert.equal(row.focusNote, 'graphics');
  assert.equal(row.nonTextDraws, 2);
});

t('主体区 0 块并且**一笔都没有** ⇒ focusNote = empty（真的像没画东西）', () => {
  const v = layoutVerdict({
    t: 1, focus: 'center',
    blocks: [],
    paint: paintBook({ any: 1 }), textLayerDrawn: true,   // 只有文字层那一次合成，没有别的
  });
  assert.equal(v.inFocus, 0);
  assert.equal(v.nonTextDraws, 0);
  assert.equal(v.focusNote, 'empty', '空屏必须与"主体是图形"分开 —— 这才是这一条改动的意义');
});

t('主体区**有**字块 ⇒ focusNote = text（读数照旧，与图形无关）', () => {
  const v = layoutVerdict({
    focus: 'center',
    blocks: [B(660, 560, 96, 600, '主体')],
    paint: paintBook({ any: 2 }), textLayerDrawn: true,
  });
  assert.equal(v.inFocus, 1);
  assert.equal(v.focusNote, 'text');
});

t('没声明 focus ⇒ focusNote = undeclared（这一条谈不上，不是通过）', () => {
  const v = layoutVerdict({ blocks: [B(660, 560, 96, 600, '主体')] });
  assert.equal(v.noFocus, true);
  assert.equal(v.focusNote, 'undeclared');
  assert.equal(v.nonTextKnown, false, '没传绘制账 ⇒ 这条读数没判');
});

t('focusNoteOf 的判读表（纯函数）：0 块 + 画了图形 / 空屏 / 没账', () => {
  assert.equal(focusNoteOf(1, null), 'text', '有字就是 text（不需要账）');
  assert.equal(focusNoteOf(0, { known: true, total: 3 }), 'graphics');
  assert.equal(focusNoteOf(0, { known: true, total: 0 }), 'empty');
  assert.equal(focusNoteOf(0, null), 'unjudged', '拿不到账 = 没判');
  assert.equal(focusNoteOf(0, { known: false, total: 0 }), 'unjudged');
});

t('这条读数**不动判据**：maxInFocus / maxOffSubject / maxBlocks 一个都没改', () => {
  assert.equal(LAYOUT_LIMITS.maxInFocus, 2);
  assert.equal(LAYOUT_LIMITS.maxOffSubject, 2);
  assert.equal(LAYOUT_LIMITS.maxBlocks, 6);
  // 同一屏、同一批字，带上/不带绘制账，判据结果必须**逐字相同**
  const base = {
    focus: 'center',
    blocks: [B(500, 480, 26, 300, '队列'), B(700, 560, 26, 300, 'A'), B(560, 700, 26, 300, 'B')],
  };
  const a = layoutVerdict(base);
  const b = layoutVerdict({ ...base, paint: paintBook({ any: 9, lines: 4 }), textLayerDrawn: true });
  assert.deepEqual(b.violations, a.violations, '读数变了，判据一个字都不许变');
  assert.equal(b.inFocus, a.inFocus);
  assert.equal(b.offSubject, a.offSubject);
  assert.deepEqual(a.violations.map((v) => v.kind), ['in-focus'], '这个夹具本来就是超限的（3 块 > 2）');
});

/* ═══════════ 9. labelRow：一次绘制 = 1 块（这才是"标注合并成一行"的关键） */

/**
 * 假 Canvas2D（照 test-karaoke.mjs 的写法）：`measureText` 每个码元 10px，
 * `fillText` 全部记下来。用它把"到底真的画了几次"数出来 —— 判据看到的 1 块就是从这里来的。
 */
function fakeCanvas() {
  const rec = { texts: [], depth: 0 };
  const fake = {
    font: '', textAlign: '', textBaseline: '', fillStyle: '', globalAlpha: 1,
    measureText: (s) => ({ width: String(s).length * 10 }),
    fillText(s, x, y) { rec.texts.push({ s, x, y, alpha: this.globalAlpha, fill: this.fillStyle }); },
    save() { rec.depth++; }, restore() { rec.depth--; },
    beginPath() {}, rect() {}, clip() {},
  };
  return { fake, rec };
}

/** 把 TextKit 的记账接到一本假账上（`noteText` 判的就是 `type.gl.paint.layer === type`）。 */
function withPaint(tk, book) {
  tk.gl = { paint: { ...book, layer: tk, blocks: book.blocks ?? [] } };
  return tk.gl.paint;
}

t('labelRow：三段标签只发**一次** writeLine ⇒ 记账 1 条、念出来是一行', () => {
  const { fake, rec } = fakeCanvas();
  const tk = new TextKit(fake);
  const paint = withPaint(tk, paintBook({}));
  const w = labelRow(tk, [{ s: 'LOW' }, { s: 'MID' }, { s: 'HIGH' }], 100, 900, { size: 21, family: 'mono' });
  // 一次绘制：fillText 被逐字调了很多次，但**记账**只有一条（noteText 在整行画完之后记一次）
  assert.equal(paint.blocks.length, 1, '记账必须是 1 条 —— 否则"合并成一行"对判据完全无效');
  assert.equal(paint.blocks[0].sample, 'LOW　·　MID　·　HIGH', '记账里的文本就是整行（含分隔符）');
  assert.equal(rec.depth, 0, 'save/restore 配平');
  // 几何：返回的宽度 = 三段 + 两个分隔符（每个码元 10px）
  assert.equal(w, 'LOW　·　MID　·　HIGH'.length * 10, '返回整行宽度（含分隔符）');
});

t('labelRow：一行 = 判据里的**一块**（各站一处时是四块、"看的地方"超限）', () => {
  const { fake } = fakeCanvas();
  const tk = new TextKit(fake);
  // 真实形状：几个标签**各站在自己的柱子上方**（y 不同，相差 > min(gap, 21×0.8) ⇒ textGroups 不合并）
  const sep = withPaint(tk, paintBook({}));
  tk.writeLine('波形', 300, 700, { size: 21 });
  tk.writeLine('LOW', 1090, 760, { size: 21 });
  tk.writeLine('MID', 1360, 820, { size: 21 });
  tk.writeLine('HIGH', 1630, 880, { size: 21 });
  assert.equal(sep.blocks.length, 4, '分四处写 = 4 条记账');
  const many = layoutVerdict({ blocks: sep.blocks.map((b) => ({ ...b, w: 60 })) });
  assert.equal(many.blocks, 4, '各在一处（y 不同）= 4 块');
  // 主体 = 最大的一块 ∪ focus 里的块；没声明 focus 时主体就是其中一块 ⇒ 其余 3 个是"看的地方"
  assert.equal(many.offSubject, 3, '主体之外 3 个"看的地方" > 上限 2 —— 交接单 F 卡住的就是这一项');
  assert.ok(many.violations.some((v) => v.kind === 'off-subject'), '这条判据**照旧会响**（我们没有放松它）');

  // labelRow：一条基线、一条记账
  const one = withPaint(tk, paintBook({}));
  labelRow(tk, [{ s: '波形' }, { s: 'LOW' }, { s: 'MID' }, { s: 'HIGH' }], 300, 700, { size: 21 });
  assert.equal(one.blocks.length, 1, 'labelRow = 1 条记账');
  const few = layoutVerdict({ blocks: one.blocks.map((b) => ({ ...b, w: 600 })) });
  assert.equal(few.blocks, 1, '合起来之后判据只数到 1 块');
  assert.equal(few.offSubject, 0, '合成一行之后"看的地方"归零');
  assert.deepEqual(few.violations, [], '于是判据 ② 通过 —— 这就是"标注合并成一行"省下的时间');
});

t('⚠ 说清楚一件事：**同一基线**上的三段标签，判据本来就只算一块（诚实清单）', () => {
  // textGroups() 是**按 y 单链聚类**（src/layout.js 的 textGroups），横向隔着多远都不影响。
  // 所以"合并成一行"真正省掉的是：① 记账条数（n 次文字绘制 → 1 次）；
  // ② 三个标签各站一处（y 不同）时的块数。别把这两件事说成"一字排开就一定三块"。
  const { fake } = fakeCanvas();
  const tk = new TextKit(fake);
  const paint = withPaint(tk, paintBook({}));
  tk.writeLine('LOW', 1090, 700, { size: 21 });
  tk.writeLine('MID', 1360, 700, { size: 21 });
  tk.writeLine('HIGH', 1630, 700, { size: 21 });
  assert.equal(paint.blocks.length, 3, '记账照样是 3 条（"这块字有多碎"的读数会露出来）');
  const v = layoutVerdict({ blocks: paint.blocks.map((b) => ({ ...b, w: 60 })) });
  assert.equal(v.blocks, 1, '同一基线上的三段落判据只算一块 —— 这是既有行为，不是 labelRow 的功劳');
});

t('labelRow：anchor 居中 / 右对齐按整行宽度算（x 是锚点，不是左边）', () => {
  const items = [{ s: '波形' }, { s: '2.4 s' }];
  const W = '波形　·　2.4 s'.length * 10;
  const at = (anchor) => {
    const { fake, rec } = fakeCanvas();
    const tk = new TextKit(fake);
    const w = labelRow(tk, items, 960, 500, { size: 21, anchor });
    // 第一个字画在哪 = 整行的起点（TextKit 逐字 fillText，整行偏移由它按 align 摊到每个字）
    return { w, first: rec.texts[0].x };
  };
  const l = at('left'), c = at('center'), r = at('right');
  assert.equal(l.w, W, '三种锚点的整行宽度必须一样');
  assert.equal(c.w, W); assert.equal(r.w, W);
  assert.equal(l.first, 960, 'left：第一段就画在 x');
  assert.equal(c.first, 960 - W / 2, 'center：整行中心在 x');
  assert.equal(r.first, 960 - W, 'right：整行右边对齐 x');
});

t('labelRow：gap 可换；各段颜色按位置生效；空 items 不画也不抛', () => {
  const { fake, rec } = fakeCanvas();
  const tk = new TextKit(fake);
  withPaint(tk, paintBook({}));
  const w = labelRow(tk, [{ s: 'A' }, { s: 'B' }], 10, 20, { gap: ' | ', size: 30 });
  assert.equal(w, 'A | B'.length * 10, '换一个分隔符，宽度跟着变');
  assert.equal(rec.texts[0].s, 'A');
  // 各段自带颜色 ⇒ 一次绘制里按字符取色（TextKit 的 color 支持数组，按簇下标取）
  const { fake: f2, rec: r2 } = fakeCanvas();
  const tk2 = new TextKit(f2);
  withPaint(tk2, paintBook({}));
  labelRow(tk2, [{ s: 'LOW', c: 'rgb(1,2,3)' }, { s: 'HIGH', c: 'rgb(4,5,6)' }], 0, 0, { size: 20 });
  assert.equal(r2.texts[0].fill, 'rgb(1,2,3)', '第一个字用第一段的颜色');
  assert.equal(r2.texts[r2.texts.length - 1].fill, 'rgb(4,5,6)', '最后一个字用最后一段的颜色');
  // 空 / 非法输入：不画、返回 0、不抛
  const { fake: f3, rec: r3 } = fakeCanvas();
  const tk3 = new TextKit(f3);
  withPaint(tk3, paintBook({}));
  assert.equal(labelRow(tk3, [], 0, 0, {}), 0);
  assert.equal(labelRow(tk3, null, 0, 0, {}), 0);
  assert.equal(r3.texts.length, 0, '空 items 一笔都不画');
});

t('接线：CLI 的「主体区 …」读数按 focusNote 分流（三种写法都在，且不放松判据）', () => {
  // 打印在 scripts/anim.mjs 的 focusReading() —— 它是**纯函数**，但这里不 import 它
  // （anim.mjs 是 CLI 入口，import 会把它整份跑起来）。所以用两条静态断言钉住它真的接上了、
  // 且三种分支都在。判据一侧的**行为**由上面 §8 那几条钉着（带/不带绘制账，violations 逐字相同）。
  assert.ok(new RegExp('主体区 \\$\\{focusReading\\(w\\)}').test(ANIM), 'CLI 那一行必须读 focusReading()');
  assert.ok(/case 'graphics':/.test(ANIM) && /case 'empty':/.test(ANIM), '三种读数分支都要在');
  assert.ok(/focusNote: worst.focusNote/.test(read('src/layout.js')), '读数要平铺进 layoutReport（CLI 只读一层）');
});

t('labelRow 已在 kit 的统一出口里（任务照 docs 写就能 import 到）', () => {
  assert.ok(/export \{[^}]*labelRow[^}]*\} from '\.\/layout\.js'/.test(read('src/kit/index.js')),
    'src/kit/index.js 要导出 labelRow');
});


/* ── C1 几何判据：字压字 / 出画 / 撞字幕（注入缺陷必须报 / 去掉不许报） ── */
const G = (x0, y0, x1, y1, sample = '字') => ({ x0, y0, x1, y1, sample });
const kinds = (v) => v.map((x) => x.kind);

t('C1 overlap：两块交叠 >15% 较小块 ⇒ 报；分开 ⇒ 不报', () => {
  const a = G(100, 300, 500, 400), b = G(450, 320, 900, 420);   // 交叠 50×80=4000，较小块 400×100=40000 → 10%？
  // 构造明确 >15%：a 400×100=40000，b 与 a 交叠 200×100=20000 = 50%
  const b2 = G(300, 300, 700, 400);
  assert.ok(kinds(geometryViolations([a, b2], { W: 1920, H: 1080 })).includes('overlap'), '交叠 50% 必须报');
  assert.ok(!kinds(geometryViolations([a, G(600, 300, 900, 400)], { W: 1920, H: 1080 })).includes('overlap'), '分开不许报');
});
t('C1 overlap：保留区（页眉）里的字不参与', () => {
  const top1 = G(100, 10, 500, 60), top2 = G(300, 10, 700, 60);   // y1=60 < 1080×0.115≈124 ⇒ 页眉保留区
  assert.ok(!kinds(geometryViolations([top1, top2], { W: 1920, H: 1080 })).includes('overlap'), '页眉版式字不算字压字');
});
t('C1 overlap：allowOverlap 豁免', () => {
  const a = G(100, 300, 500, 400, '主体'), b = G(300, 300, 700, 400, '标注');
  assert.ok(kinds(geometryViolations([a, b], { W: 1920, H: 1080 })).includes('overlap'), '未豁免要报');
  assert.ok(!kinds(geometryViolations([a, b], { W: 1920, H: 1080, allowOverlap: ['标注'] })).includes('overlap'), '豁免后不报');
});
t('C1 off-frame：锚点越出画幅 ⇒ error；画幅内 ⇒ 不报', () => {
  const out = G(1950, 300, 2000, 400);   // 锚点 x0=1950 > 1920
  const v = geometryViolations([out], { W: 1920, H: 1080 });
  assert.ok(v.some((x) => x.kind === 'off-frame' && x.level === 'error'), '出画是 error 级');
  assert.ok(!kinds(geometryViolations([G(100, 300, 500, 400)], { W: 1920, H: 1080 })).includes('off-frame'), '画幅内不报');
  assert.ok(!kinds(geometryViolations([G(1800, 300, 2000, 400)], { W: 1920, H: 1080 })).includes('off-frame'), '右对齐字宽近似不判出画（防 LOW/MID/HIGH 假阳性）');
});
t('C1 off-safe：越安全边距（画幅内、成块内容字）⇒ warn；边距内 / 小装饰字 ⇒ 不报', () => {
  const near = { ...G(10, 300, 500, 400), size: 40 };   // x0=10 < pad=40，画幅内，size≥32
  const v = geometryViolations([near], { W: 1920, H: 1080, pad: 40 });
  assert.ok(v.some((x) => x.kind === 'off-safe' && x.level === 'warn'), '越边距是 warn 级');
  assert.ok(!kinds(geometryViolations([{ ...G(100, 300, 500, 400), size: 40 }], { W: 1920, H: 1080, pad: 40 })).includes('off-safe'), '边距内不报');
  assert.ok(!kinds(geometryViolations([{ ...G(10, 300, 500, 400), size: 20 }], { W: 1920, H: 1080, pad: 40 })).includes('off-safe'), '小装饰字（计数器/角标）不判 off-safe');
});
t('C1 caption-hit：压进此刻字幕 ⇒ 报；无字幕 ⇒ 不判', () => {
  const cap = { x0: 600, y0: 40, x1: 1320, y1: 104 };
  const hit = G(700, 60, 1100, 120);   // 与字幕带相交
  assert.ok(kinds(geometryViolations([hit], { W: 1920, H: 1080, captionRect: cap })).includes('caption-hit'), '撞字幕要报');
  assert.ok(!kinds(geometryViolations([hit], { W: 1920, H: 1080 })).includes('caption-hit'), '没字幕不判');
  assert.ok(!kinds(geometryViolations([G(700, 300, 1100, 400)], { W: 1920, H: 1080, captionRect: cap })).includes('caption-hit'), '不交不报');
});
t('C1 接线：layoutVerdict 把几何判据并进 violations', () => {
  // 用出画判据验接线（单块即可，不依赖聚类）：x 越出画幅 ⇒ off-frame
  const blocks = [B(1950, 350, 40, 400, '出画')];   // 锚点 x0=1950 > 1920
  const v = layoutVerdict({ blocks, W: 1920, H: 1080 });
  assert.ok(v.violations.some((x) => x.kind === 'off-frame'), 'layoutVerdict 含几何判据 off-frame');
});
/* ────────────────────────────────────────────────────────────────── 汇总 */

console.log('test-layout: ' + passed + ' 项通过' + (failed.length ? '，' + failed.length + ' 项失败' : ''));
for (const f of failed) console.log(f);
process.exit(failed.length ? 1 : 0);
