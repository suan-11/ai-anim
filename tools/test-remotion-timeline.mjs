// 阶段 1 离线自检：帧级时间线必须与验收口径逐字一致（纯 JS，不开浏览器）。
//   node tools/test-remotion-timeline.mjs
import assert from 'node:assert/strict';
import { buildFrameTimeline, resolveSeconds } from '../packages/remotion/timeline.mjs';
import config from '../tasks/example-config-only/task.config.mjs';

const tl = buildFrameTimeline(config);
assert.equal(tl.width, 1920);
assert.equal(tl.height, 1080);
assert.equal(tl.fps, 60);
assert.equal(tl.durationInFrames, 834, '总帧数必须是 834');
assert.deepEqual(
  [...tl.segments.map((s) => s.startFrame), tl.durationInFrames],
  [0, 210, 474, 684, 834],
  '镜头边界必须是 0/210/474/684/834（排他终点）',
);
assert.deepEqual(tl.segments.map((s) => s.id), ['hook', 'chart', 'kinetic', 'outro']);
assert.deepEqual(tl.segments.map((s) => s.endFrame - s.startFrame), [210, 264, 210, 150]);
// 模板参数透传（时间线字段不许混进 params）
assert.equal(tl.segments[0].params.title, '只写配置，就能出片');
assert.equal(tl.segments[0].params.dur, undefined);
assert.deepEqual(tl.segments[1].params.values, [0.833, 1.0, 1.0, 0.5, 0.667, 0.667, 0.333, 0.833]);
assert.deepEqual(tl.segments[2].params.headline, ['只写配置', '不用写场景']);
// dur 解析与 src/timeline.js 同式
assert.equal(resolveSeconds({ beat: 7 }), 3.5);
assert.equal(resolveSeconds({ bar: 2 }), 4);
assert.equal(resolveSeconds(undefined), 4);
assert.throws(() => resolveSeconds(NaN));

// 两段各 7.5 帧，绝对终点是第 15 帧。
const fractionalTimeline = buildFrameTimeline({
  fps: 60,
  timeline: [{ type: 'title', dur: 0.125 }, { type: 'chart', dur: 0.125 }],
});
assert.deepEqual(fractionalTimeline.segments.map((s) => [s.startFrame, s.endFrame]), [[0, 8], [8, 15]]);
assert.equal(fractionalTimeline.durationInFrames, 15);
assert.throws(() => buildFrameTimeline({ timeline: [{ type: 'title', at: 0 }] }), /timeline\[0\].*at/);
assert.throws(() => buildFrameTimeline({ timeline: [{ type: 'title', overlap: 0.5 }] }), /overlap/);
assert.throws(() => buildFrameTimeline({ timeline: [{ type: 'title', dur: 0.001 }] }), /timeline\[0\].*帧区间/);
console.log('test-remotion-timeline: PASS（834 帧、绝对切点取整、参数透传、排程校验）');
