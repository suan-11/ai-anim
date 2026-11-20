#!/usr/bin/env node
// @ts-check
/**
 * tools/test-ref.mjs —— 参考片拆解（1-76）纯函数判据的离线回归。
 * 用**合成帧差序列**测，不起 ffmpeg / GPU。解码抽帧（IO）不在这里测。
 */
import assert from 'node:assert/strict';
import { detectCuts, bpmCandidates, segmentMotion, motionHeat, aggregateCellHeat } from '../scripts/lib/ref-analysis.mjs';

let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓ ' + m); };
const fps = 8;

console.log('① detectCuts 场景切点');
{
  // 基线运动 ~5，第 40 帧一个硬切尖峰 60
  const diff = new Array(100).fill(5);
  diff[40] = 60;
  const cuts = detectCuts(diff, fps);
  ok(cuts.length === 1 && cuts[0].frame === 40, '单个硬切尖峰被检到（frame 40）');
  ok(Math.abs(cuts[0].t - 40 / fps) < 1e-9, '切点时刻 = frame/fps');
}
{
  const diff = new Array(100).fill(0).map((_, i) => 5 + (i % 3));   // 只有中等运动
  ok(detectCuts(diff, fps).length === 0, '纯中等运动不误报切点');
}
{
  // 持续高运动（平台，不是尖峰）不应被当成切点
  const diff = new Array(100).fill(5);
  for (let i = 30; i < 50; i++) diff[i] = 40;
  ok(detectCuts(diff, fps).length === 0, '持续高运动平台不算硬切（要尖峰）');
}
{
  // 两个相近（<minGap）但各自孤立的尖峰 ⇒ 合并取最强
  const diff = new Array(100).fill(5);
  diff[40] = 50; diff[43] = 70;   // 间隔 3 帧 < minGap(0.5s×8=4)
  const cuts = detectCuts(diff, fps, { minGapSec: 0.5 });
  ok(cuts.length === 1 && cuts[0].strength === 70, '相近尖峰合并取最强');
}

console.log('② bpmCandidates 节拍网格');
{
  const cutTimes = [1, 2, 3, 4, 5, 6, 7, 8];   // 每 1s 一切 = 60 BPM
  const r = bpmCandidates(cutTimes, 9);
  ok(r.candidates[0].bpm === 60, '整 1s 切点 ⇒ 首选 60 BPM');
  ok(r.candidates[0].score > 0.9, '完美贴网格 ⇒ 高分');
}
{
  const cutTimes = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];   // 每 0.5s = 120 BPM
  const r = bpmCandidates(cutTimes, 3.5);
  ok(r.candidates[0].bpm === 120, '整 0.5s 切点 ⇒ 首选 120 BPM');
}
{
  // 无节奏切点（样本要够多，少量切点碰巧贴网格的概率高）：最高分应明显低于完美网格
  const cutTimes = [0.31, 0.89, 1.42, 2.11, 2.63, 3.29, 3.81, 4.47, 5.02, 5.66, 6.18, 6.79, 7.35, 7.98];
  const r = bpmCandidates(cutTimes, 8.5);
  ok(r.candidates[0].score < 0.7, '乱切点 ⇒ 最高分不高（无明显节奏）');
  ok(r.randomBaseline > 0 && r.randomBaseline < 0.5, '给出随机基线供解读');
}

console.log('③ segmentMotion 每段运动量');
{
  const diff = new Array(80).fill(0);
  for (let i = 0; i < 40; i++) diff[i] = 2;     // 段0 动
  for (let i = 40; i < 80; i++) diff[i] = 0.1;  // 段1 静
  const segs = segmentMotion(diff, [40], fps);
  ok(segs.length === 2, '一个切点 ⇒ 两段');
  ok(Math.abs(segs[0].meanMotion - 2) < 1e-6, '段0 平均运动=2');
  ok(segs[1].stillRatio > 0.9, '段1 几乎全静');
  ok(Math.abs(segs[0].dur - 40 / fps) < 1e-9, '段时长 = 帧数/fps');
}

console.log('④ motionHeat / aggregateCellHeat 热图');
{
  const diff = new Array(80).fill(1);
  for (let i = 40; i < 50; i++) diff[i] = 20;   // 中段最热
  const heat = motionHeat(diff, fps, 8);
  ok(heat.length === 8, '分桶数正确');
  ok(Math.max(...heat.map((h) => h.level)) === 1, '最热桶归一到 1');
  ok(heat.every((h) => h.level >= 0 && h.level <= 1), 'level 都在 0..1');
}
{
  const grid = { cols: 2, rows: 1 };
  // 两帧：cell0 动、cell1 静；切点在帧1 ⇒ 段0=[帧0]、段1=[帧1]
  const cellDiffs = [null, [10, 0], [10, 0]];
  const ch = aggregateCellHeat(cellDiffs, [1], grid);
  ok(ch.length === 2, '一个切点 ⇒ 两段热图');
  ok(ch[1].cells[0] === 10 && ch[1].cells[1] === 0, '段1 单元均值正确（哪格在动）');
}

console.log('\n✓ 参考片拆解判据：' + passed + ' 项通过');
