import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  extractRenderer, nativeChunkRanges, overlapAwareChunkRanges, remotionCommand, remotionPartsDirectory,
  remotionScaleWarning, remotionVideoName, resolveSamples, videoFrameRange,
} from '../scripts/lib/cli/remotion.mjs';
import { finalVideo } from '../scripts/lib/cli/paths.mjs';
import { peekTaskName, resolveRenderer } from '../scripts/lib/cli/renderer.mjs';
import { readRegistry } from '../scripts/lib/remotion-registry.mjs';

assert.deepEqual(extractRenderer(['demo', '-t', '0']), { renderer: null, explicit: false, args: ['demo', '-t', '0'] });
assert.deepEqual(extractRenderer(['--renderer', 'remotion', 'example-config-only']), {
  renderer: 'remotion', explicit: true, args: ['example-config-only'],
});
assert.deepEqual(extractRenderer(['demo', '--renderer=legacy']), { renderer: 'legacy', explicit: true, args: ['demo'] });
assert.throws(() => extractRenderer(['--renderer', '--draft']), /remotion 或 legacy/);
assert.throws(() => extractRenderer(['--renderer=legacy', '--renderer=remotion']), /只能指定一次/);

assert.ok(remotionCommand('still', 'remotion'));
assert.ok(remotionCommand('check', 'remotion'));
assert.ok(remotionCommand('review', 'remotion'));
assert.ok(remotionCommand('verify', 'remotion'));
assert.ok(remotionCommand('qa', 'remotion'));
assert.ok(!remotionCommand('video', 'legacy'));
assert.ok(!remotionCommand('queue', 'remotion'));
assert.throws(() => remotionCommand('sheet', 'remotion'), /暂不支持 --renderer remotion/);

// 选路优先级与自动回退
const registry = readRegistry();
assert.equal(peekTaskName(['-t', '1,2', 'paperfold']), 'paperfold');
assert.equal(peekTaskName(['--segments', '10', 'nekohome-intro-ja']), 'nekohome-intro-ja');
assert.equal(peekTaskName(['--sheet', 'paperfold', '--quick']), 'paperfold');

for (const regTask of ['example-config-only', 'nekohome-intro-ja', 'paperfold', 'world-execute-me']) {
  for (const cmd of ['still', 'shot', 'video', 'check', 'review', 'verify', 'qa']) {
    const r = resolveRenderer(cmd, [regTask], { registry, env: {} });
    assert.equal(r.renderer, 'remotion', `${regTask} ${cmd} 默认应走 remotion`);
    assert.equal(r.source, 'auto');
  }
}
assert.equal(resolveRenderer('video', ['demo'], { registry, env: {} }).renderer, 'legacy');
assert.equal(resolveRenderer('sheet', ['example-config-only'], { registry, env: {} }).renderer, 'legacy');

// 优先级：--renderer > ANIM_RENDERER > auto
{
  const r = resolveRenderer('video', ['paperfold', '--renderer', 'legacy'], { registry, env: { ANIM_RENDERER: 'remotion' } });
  assert.equal(r.renderer, 'legacy');
  assert.equal(r.source, 'flag');
}
{
  const r = resolveRenderer('video', ['demo'], { registry, env: { ANIM_RENDERER: 'remotion' } });
  assert.equal(r.renderer, 'remotion');
  assert.equal(r.source, 'env');
}
assert.throws(() => resolveRenderer('video', ['demo'], { registry, env: { ANIM_RENDERER: 'invalid' } }), /ANIM_RENDERER/);

// 自动回退 legacy
{
  const r1 = resolveRenderer('check', ['paperfold', '--only', 'hook'], { registry, env: {} });
  assert.equal(r1.renderer, 'legacy');
  assert.equal(r1.source, 'auto-fallback');
  assert.equal(r1.fallbackFlag, '--only');

  const r2 = resolveRenderer('video', ['paperfold', '--gpu', 'high'], { registry, env: {} });
  assert.equal(r2.renderer, 'legacy');
  assert.equal(r2.source, 'auto-fallback');
  assert.equal(r2.fallbackFlag, '--gpu');
}

assert.deepEqual(videoFrameRange(3.45, 3.55, 60, 834), [207, 212]);
assert.deepEqual(videoFrameRange(0, 13.9, 60, 834), [0, 833]);
assert.throws(() => videoFrameRange(0, 0.001, 60, 834), /不足一帧/);
assert.throws(() => videoFrameRange(12, 14, 60, 834), /影片内/);
const segments = [0, 210, 474, 684].map((startFrame) => ({ startFrame }));
assert.deepEqual(nativeChunkRanges(207, 212, 20, segments), [[207, 209], [210, 212]]);
assert.deepEqual(nativeChunkRanges(207, 212, 2, segments), [[207, 208], [209, 209], [210, 211], [212, 212]]);

const task = 'example-config-only';
const full = { short: false, draft: false, from: 0, to: 13.9, duration: 13.9 };
assert.equal(remotionVideoName(task, full), 'example-config-only.remotion.mp4');
assert.equal(remotionVideoName(task, { ...full, draft: true }), 'example-config-only.remotion.draft.mp4');
assert.equal(remotionVideoName(task, { ...full, from: 1, to: 2 }), 'example-config-only.remotion.1-2.mp4');
assert.equal(remotionVideoName(task, { ...full, short: true, to: 4 }), 'shot_0-4.remotion.mp4');
assert.equal(remotionPartsDirectory(path.join('out', task, 'example-config-only.remotion.mp4')),
  path.join('out', task, 'example-config-only.remotion.parts'));

assert.equal(resolveSamples({ eval: 'task-eval' }, { draft: true }), 1);
assert.equal(resolveSamples({ eval: 'task-eval' }, { draft: false }), 'auto');
assert.equal(resolveSamples({ eval: 'task-eval' }, { draft: true, samplesOpt: 'auto' }), 'auto');
assert.equal(resolveSamples({ eval: 'config-only' }, { draft: true }), 1);
assert.equal(remotionScaleWarning({ eval: 'task-eval' }, 2),
  'Remotion 下 --scale 2 只是放大位图，不是真 4K；要真 4K 用 --renderer legacy --scale 2');
assert.equal(remotionScaleWarning({ eval: 'config-only' }, 2), null);
assert.equal(remotionScaleWarning({ eval: 'task-eval' }, 1), null);

// The canonical final render is chosen by mtime when both renderer outputs exist.
{
  const root = mkdtempSync(path.join(tmpdir(), 'anim-final-video-'));
  const dir = path.join(root, 'out', 'fixture');
  mkdirSync(dir, { recursive: true });
  const legacy = path.join(dir, 'fixture.mp4');
  const remotion = path.join(dir, 'fixture.remotion.mp4');
  const hints = [];
  try {
    assert.equal(finalVideo('fixture', { root, onBoth: (message) => hints.push(message) }), null);
    writeFileSync(legacy, 'legacy');
    assert.equal(finalVideo('fixture', { root, onBoth: (message) => hints.push(message) }), legacy);
    writeFileSync(remotion, 'remotion');
    utimesSync(legacy, 1000, 1000);
    utimesSync(remotion, 2000, 2000);
    assert.equal(finalVideo('fixture', { root, onBoth: (message) => hints.push(message) }), remotion);
    assert.match(hints[0], /取较新的/);
    utimesSync(legacy, 3000, 3000);
    assert.equal(finalVideo('fixture', { root, onBoth: (message) => hints.push(message) }), legacy);
    assert.equal(hints.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function rejects(args, reason) {
  const result = spawnSync(process.execPath, ['scripts/anim.mjs', ...args], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, reason);
}

rejects(['video', 'demo', '--renderer=remotion'], /未验证 Remotion 出片/);
rejects(['video', task, '--renderer', 'remotion', '--only', 'title'], /暂不支持 --only/);
rejects(['check', task, '--renderer', 'remotion', '--only', 'hook'], /暂不支持 --only/);
rejects(['video', task, '--renderer', 'remotion', '--segments', '0'], /--segments.*正数秒数/);
rejects(['video', task, '--renderer', 'remotion', '--force'], /--force 必须与 --segments/);

// 交叠感知分块：切点绝不落在交叠窗内，覆盖完整无缝
{
  const segs = [
    { id: 'hook', startFrame: 0, endFrame: 216 },
    { id: 'bridge', startFrame: 202, endFrame: 389 },
    { id: 'mechanism', startFrame: 374, endFrame: 662 },
    { id: 'data', startFrame: 648, endFrame: 878 },
    { id: 'close', startFrame: 864, endFrame: 1152 },
  ];
  const overlaps = [[202, 216], [374, 389], [648, 662], [864, 878]];
  for (const size of [10, 24, 50, 240]) {
    const chunks = overlapAwareChunkRanges(0, 1151, size, segs);
    let expect = 0;
    for (const [s, e] of chunks) {
      assert.equal(s, expect, 'chunk gap');
      expect = e + 1;
      for (const [os, oe] of overlaps) {
        assert.ok(!(expect > os && expect < oe), `cut ${expect} inside overlap [${os},${oe})`);
      }
    }
    assert.equal(expect, 1152, 'full coverage');
  }
  // 硬切边界优先：example-config-only 四段全硬切
  const hard = [{ startFrame: 0 }, { startFrame: 210 }, { startFrame: 474 }, { startFrame: 684 }];
  assert.deepEqual(nativeChunkRanges(207, 212, 20, hard), [[207, 209], [210, 212]]);
}
console.log('test-remotion-cli: PASS（渲染器选择、默认选路、自动回退、兼容报错、切片区间、分块目录、成片选择、采样默认、scale 提示、交付命名、交叠避切）');
