// @ts-check
/**
 * 阶段 2A 数据对照回归（纯 Node，不开浏览器）：
 *   node tools/test-remotion-task-eval.mjs
 *
 * 三组对照：
 *   ① example-config-only：834 帧 / 边界 [0,210,474,684,834)（与阶段 1 口径一致）
 *   ② _info-lab：dark / paper 变体合并（对象递归、数组整体替换、未知变体抛错）
 *   ③ nekohome-intro-ja：六段切点与 anim cues 的秒值逐段一致（±半帧量化），
 *      旁白 dur:{vo} 语义、音轨归一、缺失素材报告。
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateTask, normalizeAudio, missingAssets } from '../packages/remotion/task-eval.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async (name) => await import(`../tasks/${name}/task.config.mjs`);

/* ① example-config-only */
{
  const mod = await load('example-config-only');
  const p = evaluateTask('example-config-only', mod);
  assert.equal(p.durationInFrames, 834);
  assert.deepEqual([...p.segments.map((s) => s.startFrame), p.durationInFrames], [0, 210, 474, 684, 834]);
  assert.deepEqual(p.segments.map((s) => s.id), ['hook', 'chart', 'kinetic', 'outro']);
  assert.equal(p.audio.split, false);
  assert.equal(p.narration, null);
  console.log('① example-config-only: 834 帧 / 边界一致');
}

/* ② _info-lab 变体 */
{
  const mod = await load('_info-lab');
  const base = evaluateTask('_info-lab', mod);
  assert.equal(base.segments.length, 3);
  assert.equal(base.durationInFrames, 1080); // 3×6s×60

  const dark = evaluateTask('_info-lab', mod, { variant: 'dark' });
  assert.equal(dark.style.name, 'noir');
  assert.equal(dark.style.palette.signal, '#8ad7ff');
  assert.equal(dark.segments.length, 3); // dark 只改风格，时间线不动

  const paper = evaluateTask('_info-lab', mod, { variant: 'paper' });
  assert.equal(paper.style.name, 'paper');
  assert.equal(paper.segments.length, 2); // 数组整体替换：3 段 → 2 段
  assert.deepEqual(paper.segments.map((s) => s.id), ['bigtype', 'chart']);
  assert.equal(paper.durationInFrames, 600); // 2×5s×60
  assert.deepEqual(paper.segments[1].params.values, [0.2, 0.5, 0.9]);

  assert.throws(() => evaluateTask('_info-lab', mod, { variant: 'nope' }), /没有变体 "nope"/);
  // 深合并规则单测：对象递归、数组替换
  const { deepMergeInto } = await import('../src/core/util.js');
  const t = { a: { x: 1, y: 2 }, arr: [1, 2, 3], s: 'old' };
  deepMergeInto(t, { a: { y: 9, z: 3 }, arr: [7], s: 'new' });
  assert.deepEqual(t, { a: { x: 1, y: 9, z: 3 }, arr: [7], s: 'new' });
  console.log('② _info-lab: dark/paper 变体合并 + 数组替换 + 未知变体抛错');
}

/* ③ nekohome-intro-ja */
{
  const mod = await load('nekohome-intro-ja');
  const zh = JSON.parse(readFileSync(path.join(ROOT, 'tasks/nekohome-intro-ja/audio/ja-sub-zh.narration.json'), 'utf8'));
  const { makeNarration } = await import('../src/core/narration.js');
  const nd = makeNarration(zh, { duration: 47.245 });
  const p = evaluateTask('nekohome-intro-ja', mod, { narrationData: nd });

  // 六段切点：直接调用旧命令，干净检出也能生成对照。
  const cues = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', [
    "import { run } from './scripts/cmd/cues.mjs';",
    "import { setRest } from './scripts/lib/cli/args.mjs';",
    "setRest(['nekohome-intro-ja', '--json']);",
    'await run();',
  ].join('\n')], { cwd: ROOT, encoding: 'utf8' }));
  assert.equal(p.segments.length, 6);
  assert.deepEqual(p.segments.map((s) => s.id), ['open', 'nuomi', 'tsundere', 'xiaoying', 'phrases', 'end']);
  for (let i = 0; i < 6; i++) {
    const seg = p.segments[i], cue = cues.scenes[i];
    assert.equal(seg.id, cue.id);
    assert.ok(Math.abs(seg.startSec - cue.start) < 1e-6, `${seg.id} start ${seg.startSec} vs ${cue.start}`);
    assert.ok(Math.abs(seg.endSec - cue.end) < 1e-6, `${seg.id} end ${seg.endSec} vs ${cue.end}`);
    // 帧边界 = round(秒×60)，误差 ≤ 半帧
    assert.ok(Math.abs(seg.startFrame - cue.start * 60) <= 0.5);
    assert.ok(Math.abs(seg.endFrame - cue.end * 60) <= 0.5);
  }
  assert.equal(p.durationInFrames, Math.round(47.245 * 60)); // 2835（47.245×60=2834.7）
  assert.equal(p.overlaps.length, 0);

  // 音轨归一：分轨写法
  assert.deepEqual(
    { music: p.audio.music, vo: p.audio.vo, mix: p.audio.mix, analysis: p.audio.analysis, packaging: p.audio.packaging },
    { music: './audio/bed.mp3', vo: './audio/ja-vo.mp3', mix: './audio/ja-mix.mp3', analysis: './audio/bed.mp3', packaging: './audio/ja-mix.mp3' },
  );
  // normalizeAudio 两种写法
  assert.equal(normalizeAudio('./x.mp3').packaging, './x.mp3');
  assert.equal(normalizeAudio(null).split, false);

  // 字幕表：10 句中文，首句 0.335s
  assert.equal(p.narration.lines.length, 10);
  assert.equal(p.narration.lines[0].text, '介绍一下我们家这位。');
  assert.ok(Math.abs(p.narration.lines[0].start - 0.335) < 1e-9);
  assert.equal(p.style.name, 'paper');
  assert.equal(p.captionsEnabled, true);

  // 干净检出只有配乐和字幕，生成的旁白轨与混音轨缺失。
  const trackedAssets = new Set(['./audio/bed.mp3', './audio/ja-sub-zh.narration.json']);
  assert.deepEqual(missingAssets(p, (file) => trackedAssets.has(file)), [
    { task: 'nekohome-intro-ja', file: './audio/ja-vo.mp3' },
    { task: 'nekohome-intro-ja', file: './audio/ja-mix.mp3' },
  ]);
  assert.deepEqual(missingAssets(p, () => true), []);
  console.log('③ nekohome-intro-ja: 六段切点 ±半帧 / 音轨分轨 / 10 句中文字幕 / 缺失报告');
}

/* ④ 求值器边界：变体嵌套污染 / 四种时间线写法 / 非整帧 dur */
{
  const { cut, seq } = await import('../src/timeline.js');
  // 嵌套 palette 污染：变体改 signal 后，原模块与后续 base 求值必须不受影响
  const mod = {
    default: { title: 't', fps: 60, palette: { signal: '#111111' }, timeline: [{ type: 'title', dur: 2 }] },
    variants: { v: { palette: { signal: '#222222' } } },
  };
  const v = evaluateTask('t', mod, { variant: 'v' });
  assert.equal(v.style.palette.signal, '#222222');
  assert.equal(mod.default.palette.signal, '#111111', '原模块 palette 被变体污染');
  assert.equal(evaluateTask('t', mod).style.palette.signal, '#111111', 'base 求值被先前变体污染');

  // 四种时间线写法
  const scene = { id: 's', render() { return {}; } };
  const cutArr = evaluateTask('t', { default: { fps: 60, timeline: [cut(scene, { dur: 2 }), cut(scene, { dur: 3, id: 's2' })] } });
  assert.deepEqual(cutArr.segments.map((s) => [s.id, s.startFrame, s.endFrame]), [['s', 0, 120], ['s2', 120, 300]]);
  const seqTl = evaluateTask('t', { default: { fps: 60, timeline: seq([cut(scene, { dur: 2 })]) } });
  assert.deepEqual([seqTl.segments[0].startFrame, seqTl.segments[0].endFrame], [0, 120]);
  const laidOut = evaluateTask('t', { default: { fps: 60, timeline: [{ id: 'x', scene, start: 1, end: 3 }] } });
  assert.deepEqual([laidOut.segments[0].startFrame, laidOut.segments[0].endFrame], [60, 180]);

  // 非整帧 dur：0.0333s @60fps → round(1.998)=2 帧；累计取整不漂移
  const frac = evaluateTask('t', { default: { fps: 60, timeline: [
    { type: 'title', dur: 0.0333 }, { type: 'title', dur: 0.0333 }, { type: 'title', dur: 0.0334 },
  ] } });
  assert.deepEqual(frac.segments.map((s) => s.endFrame), [2, 4, 6]);
  assert.equal(frac.durationInFrames, 6);

  // overlap 数据对照（视觉合成归阶段 3，这里只验排程）
  const ov = evaluateTask('t', { default: { fps: 60, timeline: seq([
    cut(scene, { dur: 2 }), cut(scene, { dur: 2, id: 'b', overlap: 0.5 }),
  ]) } });
  assert.equal(ov.overlaps.length, 1);
  assert.ok(Math.abs(ov.overlaps[0].overlapSec - 0.5) < 1e-9);
  assert.equal(ov.segments[1].startFrame, 90); // 1.5s × 60

  // 乱序 at：总帧数取 max end，不是最后一段的 end
  const oo = evaluateTask('t', { default: { fps: 60, timeline: [
    cut(scene, { dur: 5, id: 'long' }), cut(scene, { dur: 1, id: 'short', at: 1 }),
  ] } });
  assert.equal(oo.durationInFrames, 300);

  // build() 排序后，模板类型和参数仍应属于原来的镜头。
  const reordered = evaluateTask('t', { default: { timeline: seq([
    { type: 'title', id: 'later', at: 3, dur: 1, title: '原本标题', params: { title: '覆盖标题' } },
    seq([{ type: 'chart', id: 'earlier', at: 1, dur: 1, values: [0.4, 0.7] }]),
  ]) } });
  assert.deepEqual(reordered.segments.map(({ id, type, params, startFrame }) => ({ id, type, params, startFrame })), [
    { id: 'earlier', type: 'chart', params: { values: [0.4, 0.7] }, startFrame: 60 },
    { id: 'later', type: 'title', params: { title: '覆盖标题' }, startFrame: 180 },
  ]);

  // par 组：多段同起点，每段都要报与更早段的交叠
  const { par } = await import('../src/timeline.js');
  const pg = evaluateTask('t', { default: { fps: 60, timeline: par(0.5, [
    cut(scene, { dur: 2 }), cut(scene, { dur: 3, id: 'b' }), cut(scene, { dur: 2, id: 'c' }),
  ]) } });
  assert.equal(pg.overlaps.length, 2);
  console.log('④ 边界：变体隔离 / 四种时间线写法 / 非整帧累计取整 / overlap 排程 / 乱序 at / par 组');
}

console.log('test-remotion-task-eval: PASS');
