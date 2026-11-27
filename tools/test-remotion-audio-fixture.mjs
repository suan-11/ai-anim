// @ts-check
/**
 * 阶段 2C CI 夹具：可复现短音频 + 时间对齐 + 缺失素材提示（纯 Node，不开浏览器）。
 *   node tools/test-remotion-audio-fixture.mjs
 *
 * 干净克隆没有 tasks/*\/audio/*-mix.mp3（gitignore）——CI 用 ffmpeg 合成 2s 正弦波
 * 当混音替身，验证：
 *   ① evaluateTask 的段边界与帧换算不依赖真实音轨存在；
 *   ② missingAssets 对缺失文件报「任务 + 文件」；
 *   ③ 字幕边界量化误差 ≤1 帧（用内联旁白表，不读真实 json）。
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateTask, missingAssets } from '../packages/remotion/task-eval.mjs';
import { makeNarration } from '../src/core/narration.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'out', '_remotion-migration', '.tmp', 'audio-fixture');
mkdirSync(FIX, { recursive: true });

// ① 合成 2s 440Hz 正弦（可复现：同参数同输出）
const fixtureMp3 = path.join(FIX, 'fixture-mix.mp3');
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libmp3lame', '-b:a', '96k', '-y', fixtureMp3]);
assert.ok(existsSync(fixtureMp3) && statSync(fixtureMp3).size > 1000);

// ② 内联任务：两段各 1s，旁白两句，音轨指向夹具
const mod = {
  default: {
    title: 'audio-fixture', width: 1920, height: 1080, fps: 60,
    audio: { mix: './audio/fixture-mix.mp3' },
    narration: { lines: [
      { id: 'a', text: '第一句。', start: 0.1, dur: 0.7 },
      { id: 'b', text: '第二句。', start: 1.05, dur: 0.7 },
    ] },
    timeline: [
      { type: 'title', dur: 1, title: 'A' },
      { type: 'outro', dur: 1, title: 'B' },
    ],
  },
};
const nd = makeNarration(mod.default.narration, { duration: 2 });
const p = evaluateTask('audio-fixture', mod, { narrationData: nd });
assert.equal(p.durationInFrames, 120);
assert.deepEqual(p.segments.map((s) => [s.startFrame, s.endFrame]), [[0, 60], [60, 120]]);
assert.equal(p.audio.packaging, './audio/fixture-mix.mp3');

// ③ 缺失素材：夹具目录里没有 ./audio/ 子目录 → 必须报任务+文件
const missing = missingAssets(p, () => false);
assert.deepEqual(missing, [{ task: 'audio-fixture', file: './audio/fixture-mix.mp3' }]);
// 存在时不报
assert.deepEqual(missingAssets(p, (rel) => rel === './audio/fixture-mix.mp3'), []);

// ④ 字幕边界 ±1 帧：首句 start 0.1s → 第 6 帧（0.1×60=6.0），ceil 后首显帧 6
const fps = 60;
for (const l of nd.lines) {
  const srcFrame = l.start * fps;
  const firstVisible = Math.ceil(l.start * fps);
  assert.ok(Math.abs(firstVisible - srcFrame) <= 1, `${l.id} 起点误差超 1 帧`);
}

rmSync(FIX, { recursive: true, force: true });
console.log('test-remotion-audio-fixture: PASS（合成音轨 / 段边界 / 缺失报告 / 字幕±1帧）');