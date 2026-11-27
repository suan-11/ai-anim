// @ts-check
/** transition-plan.mjs 的回归：转场不能推走段起点，总时长不能变。 */
import assert from 'node:assert/strict';
import { planTransitions } from '../packages/remotion/transition-plan.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ✓', name); };

const segs = [
  { id: 'a', startFrame: 0, endFrame: 210 },
  { id: 'b', startFrame: 210, endFrame: 474 },
  { id: 'c', startFrame: 474, endFrame: 684 },
  { id: 'd', startFrame: 684, endFrame: 834 },
];

t('紧邻段 + 0.25s@60fps：补时长后每段仍从自己的 startFrame 起', () => {
  const p = planTransitions({ segments: segs, transitionSec: 0.25, fps: 60 });
  // 15 帧一个缝；除最后一段外都补 15
  assert.deepEqual(p.items.map((i) => i.pad), [15, 15, 15, 0]);
  assert.equal(p.items[0].durationInFrames, 225);
  assert.equal(p.items[3].durationInFrames, 150);
  // 游标推演：TransitionSeries 里 start_{i+1} = start_i + dur_i - t_{i+1}
  let cursor = segs[0].startFrame;
  p.items.forEach((it, i) => {
    if (i > 0) cursor -= it.transitionBefore.frames;
    assert.equal(cursor, segs[i].startFrame, `第 ${i} 段起点被推走`);
    cursor += it.durationInFrames;
  });
  assert.equal(p.totalFrames, 834, '总时长必须等于最后一段 endFrame');
});

t('transitionSec=0：等价硬切，不补时长', () => {
  const p = planTransitions({ segments: segs, transitionSec: 0, fps: 60 });
  assert.deepEqual(p.items.map((i) => i.pad), [0, 0, 0, 0]);
  assert.deepEqual(p.items.map((i) => i.durationInFrames), [210, 264, 210, 150]);
  assert.equal(p.totalFrames, 834);
});

t("'none' 缝：该缝不加转场也不补", () => {
  const p = planTransitions({ segments: segs, transitionSec: 0.25, fps: 60, transitions: ['wipe', 'none', 'fade'] });
  assert.deepEqual(p.items.map((i) => i.transitionBefore?.frames ?? 0), [0, 15, 0, 15]);
  // 第 3 段前面是 none → 它不用为「前一个转场」补齐
  assert.deepEqual(p.items.map((i) => i.pad), [15, 0, 15, 0]);
  assert.equal(p.totalFrames, 834);
});

t('有交叠的缝用交叠秒数，且走 linear', () => {
  const ov = [{ index: 2, overlapSec: 0.6 }];
  const p = planTransitions({ segments: segs, transitionSec: 0.25, fps: 24, overlaps: ov });
  assert.equal(p.items[2].transitionBefore.frames, 14); // 0.6 * 24 取整
  assert.equal(p.items[2].transitionBefore.linear, true);
  assert.equal(p.totalFrames, 834);
});

t('关掉 compensate：回到旧行为（后续段被推前），总时长变短', () => {
  const p = planTransitions({ segments: segs, transitionSec: 0.25, fps: 60, compensate: false });
  assert.deepEqual(p.items.map((i) => i.pad), [0, 0, 0, 0]);
  assert.ok(p.totalFrames < 834, '不补偿时总时长应变短');
  assert.equal(p.totalFrames, 834 - 45);
});

t('段间有空档：pad 吸收空档，绝对起点仍对齐', () => {
  const gap = [
    { id: 'a', startFrame: 0, endFrame: 100 },
    { id: 'b', startFrame: 140, endFrame: 240 },
  ];
  const p = planTransitions({ segments: gap, transitionSec: 0.25, fps: 24, compensate: true });
  assert.equal(p.items[0].pad, 6 + 40); // 转场 6 帧 + 空档 40 帧
  let cursor = 0;
  p.items.forEach((it, i) => {
    if (i > 0) cursor -= it.transitionBefore.frames;
    assert.equal(cursor, gap[i].startFrame);
    cursor += it.durationInFrames;
  });
});

console.log(`test-remotion-transitions: PASS（${n} 组：补时长对齐 / 硬切 / none 缝 / 交叠 linear / 不补偿 / 段间空档）`);
