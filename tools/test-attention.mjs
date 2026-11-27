import assert from 'node:assert/strict';
import { measureAttention, reduceAttentionFrame } from '../src/core/attention.js';
import { attentionStep, attentionSummary, planAttention, summarizeAttentionBlocks } from '../scripts/lib/attention.mjs';
import { renderAttentionReport } from '../scripts/lib/attention-report.mjs';
import { evaluateAttentionRhythm } from '../scripts/lib/attention-rhythm.mjs';

const frame = (patches = [], background = 24) => {
  const width = 160, height = 90;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const patch = patches.find((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
      const color = patch?.color ?? [background, background, background];
      rgba.set([...color, 255], (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
};
const left = { x: 16, y: 27, w: 15, h: 15, color: [238, 238, 238] };
const right = { ...left, x: 129 };
const leftRect = { x: 0, y: 0.12, w: 0.36, h: 0.6 };
const rightRect = { ...leftRect, x: 0.64 };
const single = frame([left]);
const plain = measureAttention(frame());
assert.equal(plain.concentration, null);
assert.equal(plain.hotspot, null);
assert.ok(plain.heat.every((value) => value === 0));
const exposure = measureAttention(frame([], 180), { previous: frame() });
assert.equal(exposure.concentration, null, 'uniform exposure changes have no spatial fixation');

const on = measureAttention(single, { focus: leftRect });
const off = measureAttention(single, { focus: rightRect });
assert.ok(on.focusShare > 0.95);
assert.equal(off.focusShare, 0);
assert.deepEqual(on.hotspot, off.hotspot, 'target must not bias the measured hotspot');
assert.equal(measureAttention(single).focusShare, null);
assert.ok(on.hotspot.x < 0.25 && on.hotspot.y < 0.5);
assert.ok(measureAttention(frame([right])).hotspot.x > 0.75);
assert.ok(measureAttention(frame([left, right])).concentration < on.concentration * 0.7);
assert.ok(measureAttention(single, { previous: frame() }).strength > on.strength);
assert.ok(Math.max(...on.heat) === 255);
assert.equal(on.heatWidth * on.heatHeight, on.heat.length);
assert.deepEqual(measureAttention(single, { focus: leftRect }), on);
const isoluminant = measureAttention(frame([{ ...left, color: [110, 0, 8] }]));
assert.ok(isoluminant.hotspot.x < 0.25, 'color contrast is visible even at nearly equal luma');

const raw = Uint8Array.of(255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255);
assert.deepEqual([...reduceAttentionFrame(raw, 2, 2, { flipY: true }).rgba.slice(0, 4)], [0, 0, 255, 255]);
assert.deepEqual([...reduceAttentionFrame(raw, 2, 2, { longEdge: 1 }).rgba], [128, 0, 128, 255]);
assert.equal(measureAttention(reduceAttentionFrame(raw, 2, 2)).heat.length, 4);

assert.equal(attentionStep(), 0.25);
for (const invalid of [0, 'x', Infinity, -0.5]) assert.throws(() => attentionStep(invalid), /采样步长/);
const info = {
  duration: 7.5, rhythmOffset: 4,
  timeline: [{ start: 0, end: 3.11 }, { start: 3, end: 7.5 }],
  rhythm: { blocks: [{ t_start: 0, t_end: 5.1, beat_role: 'pressure' }, { t_start: 5.1, t_end: 12, beat_role: 'hold' }] },
};
const plan = planAttention(info, 0.5);
assert.equal(plan.times[0], 0);
assert.equal(plan.times.at(-1), 7);
assert.ok(plan.times.includes(3.11));
assert.equal(plan.times.filter((t) => t === 3).length, 1);
assert.ok(plan.times.some((t) => Math.abs(t - 1.1) < 1e-9));
assert.deepEqual(plan.events.map((event) => event.role), ['pressure', 'hold']);
assert.equal(plan.events[1].end, 7.5);
assert.match(attentionSummary({ samples: [on, plain] }), /1\/2.+主体内显著性/);
const summaries = summarizeAttentionBlocks([
  { start: 0, end: 2, role: 'pressure' }, { start: 2, end: 4, role: 'hold' }, { start: 4, end: 5, role: 'residue' },
], [
  { ...on, t: 0 }, { ...off, t: 1 }, { ...plain, t: 2 }, { ...on, t: 2.5 },
]);
assert.deepEqual(summaries.map(({ samples, measured, focused, inside }) => [samples, measured, focused, inside]), [
  [2, 2, 2, 1], [2, 1, 1, 1], [0, 0, 0, 0],
]);
assert.equal(summaries[0].lowestFocusTime, 1);
assert.equal(summaries[0].meanFocusShare, on.focusShare / 2);
assert.equal(summaries[1].lowestFocusTime, 2.5);
assert.equal(summaries[2].meanFocusShare, null);
assert.equal(summaries[2].lowestFocusTime, null);

const rhythmEvents = ['pressure', 'hold', 'release', 'residue']
  .map((role, i) => ({ role, start: i * 3, end: (i + 1) * 3 }));
const encodeAttention = (t, value) => {
  const energy = (value - 0.15) / 0.75;
  return { t, concentration: 0.6, strength: 8 * energy / (1 - energy) };
};
const fixture = {
  duration: 12, events: rhythmEvents,
  samples: Array.from({ length: 48 }, (_, i) => encodeAttention(i / 4, 0.50)),
};
const flat = evaluateAttentionRhythm(fixture);
assert.equal(flat.hook.status, 'review');
assert.ok(flat.waves[0].issues.includes('weak_rise') && flat.waves[0].issues.includes('weak_fall'));
const planned = { ...fixture, samples: flat.series.map(({ t, target }) => encodeAttention(t, target)) };
const match = evaluateAttentionRhythm(planned);
assert.equal(match.score, 100);
assert.equal(match.status, 'observed');
assert.equal(match.hook.status, 'observed');
assert.equal(match.waves[0].issues.length, 0);
const weighted = evaluateAttentionRhythm({ ...fixture, samples: flat.series
  .map(({ t, target }) => encodeAttention(t, target + (t < 3 ? 0.04 : -0.04))) });
assert.ok(Math.abs(weighted.bias + 0.008) < 1e-10);
assert.ok(Math.abs(weighted.variance - 0.001536) < 1e-10, 'the first 3 of 12 seconds must contribute 6/15 of the weight');
const sustained = evaluateAttentionRhythm({ ...fixture, samples: flat.series
  .map(({ t, target }) => encodeAttention(t, t >= 9 ? 0.80 : target)) });
assert.ok(sustained.waves[0].issues.includes('weak_fall'));
assert.equal(evaluateAttentionRhythm({ ...planned, only: ['intro'] }).reason, 'partial');
assert.equal(evaluateAttentionRhythm({ ...planned, events: rhythmEvents.slice(1) }).reason, 'incomplete_events');
const html = renderAttentionReport({ task: '</script><script>oops()</script>', samples: [] });
assert.ok(html.includes('\\u003c/script>'));
assert.ok(!html.includes('<script>oops()'));

// 双档目标曲线（docs/BENCHMARK-WEIGHTED.md）：bit 缺省深谷 / aigen 高位保持
import { ATTENTION_PROFILES } from '../scripts/lib/attention-rhythm.mjs';
assert.deepEqual(Object.keys(ATTENTION_PROFILES), ['bit', 'aigen']);
// fixture 事件布局：pressure[0,3) hold[3,6) release[6,9) residue[9,12)；前3s走hook包络
const bitPlan = evaluateAttentionRhythm(planned);
assert.equal(bitPlan.profile, 'bit');
const bitTarget = (t) => bitPlan.series.find((r) => Math.abs(r.t - t) < 1e-9)?.target;
assert.ok(Math.abs(bitTarget(5.75) - 0.393) < 0.01, 'bit hold 末段应≈0.39（低位期待）');
assert.ok(bitTarget(4.5) < 0.45, 'bit hold 应低位');
assert.ok(Math.max(...bitPlan.series.filter((r) => r.t >= 6 && r.t < 9).map((r) => r.target)) >= 0.69, 'bit release 峰应≈0.70');
assert.ok(Math.abs(bitTarget(6) - 0.35) < 0.01, 'bit release 起于蓄势低点0.35');
// pressure 深蹲直接验包络（fixture 的 pressure 落在 hook 窗内）
assert.ok(Math.abs(ATTENTION_PROFILES.bit.pressure(1) - 0.30) < 1e-9, 'bit pressure 末段应=0.30');
assert.ok(ATTENTION_PROFILES.aigen.pressure(1) > 0.5, 'aigen pressure 浅蹲不下0.5');
// aigen 档：同一时间线目标整体上移，hold≥0.55、无深谷
const aigenPlan = evaluateAttentionRhythm({ ...fixture, profile: 'aigen', samples: fixture.samples });
assert.equal(aigenPlan.profile, 'aigen');
const aigenTarget = (t) => aigenPlan.series.find((r) => Math.abs(r.t - t) < 1e-9)?.target;
assert.ok(aigenTarget(4.5) >= 0.55, 'aigen hold 中高位');
assert.ok(Math.min(...aigenPlan.series.filter((r) => r.t >= 3).map((r) => r.target)) > 0.5, 'aigen 全片无深谷');
// aigen 完美贴合自己的曲线也应满分
const aigenMatch = evaluateAttentionRhythm({ ...fixture, profile: 'aigen',
  samples: aigenPlan.series.map(({ t, target }) => encodeAttention(t, target)) });
assert.equal(aigenMatch.score, 100);
assert.equal(aigenMatch.hook.status, 'observed');
// 未知档位回落 bit
assert.equal(evaluateAttentionRhythm({ ...planned, profile: 'nonsense' }).profile, 'bit');
console.log('PASS 注意力曲线：像素信号、分块聚合、加权方差、开头钩子和峰谷验收 + bit/aigen 双档');
