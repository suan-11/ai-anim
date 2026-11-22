#!/usr/bin/env node
// @ts-check
/**
 * `scripts/lib/cues.mjs` 与 `anim cues` CLI 单元测试（离线，无需 Chrome / ffmpeg）。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractKeyTriggers, buildCuesData, formatCuesText } from '../scripts/lib/cues.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
  console.log(`  ✓ ${msg}`);
}

console.log('test-cues:');

// 1. extractKeyTriggers：停用词过滤、技术词保留、allWords、lt 相对折算、上限采样
{
  const words = [
    { w: '问题', start: 21.721, end: 22.078 },
    { w: '在 ', start: 22.474, end: 22.665 },
    { w: 'sRGB ', start: 22.678, end: 23.583 },
    { w: '的', start: 23.584, end: 23.595 },
    { w: '编码。', start: 23.596, end: 24.055 },
  ];
  const trig = extractKeyTriggers(words, 20.55);
  ok(trig.length === 3 && trig.map((x) => x.w).join(',') === '问题,sRGB,编码',
    `过滤停用词并保留技术词与标点清洗（实得 ${trig.map((x) => x.w).join(',')}）`);
  ok(Math.abs(trig[1].lt - 2.13) < 0.01 && Math.abs(trig[0].lt - 1.17) < 0.01,
    `w.start 准确折算为段内 lt（问题@${trig[0].lt}, sRGB@${trig[1].lt}）`);

  const all = extractKeyTriggers(words, 20.55, { allWords: true });
  ok(all.length === 5 && all.some((x) => x.w === '的'), 'allWords: true 保留全部非空词含停用词');

  // 超 maxPerLine 时优先保首尾 + 数字/字母技术词
  const labels = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  const longWords = labels.map((lb, i) => ({
    w: i === 5 ? '21.4%' : `词语${lb}`,
    start: 10 + i * 0.4,
    end: 10 + (i + 1) * 0.4,
  }));
  const sampled = extractKeyTriggers(longWords, 10, { maxPerLine: 6 });
  ok(sampled.length === 6 && sampled[0].w === '词语一' && sampled[5].w === '词语十二' && sampled.some((x) => x.w === '21.4%'),
    '超出 maxPerLine=6 时抽样保留首尾与数字技术词 21.4%');
}

// 2. buildCuesData：三种输入形态
{
  // A) 含 words 的 timing
  const dA = buildCuesData({
    task: 'demoA',
    timing: {
      total: 30,
      overlap: 0.5,
      scenes: [
        {
          id: 's1', start: 0, slot: 12,
          lines: [{ index: 0, offset: 0.8, dur: 3.1, text: '测试第一句 50%。', words: [{ w: '测试', start: 0.8, end: 1.4 }, { w: '50%。', start: 2.2, end: 3.0 }] }],
        },
        {
          id: 's2', start: 11.5, slot: 18.5,
          lines: [{ index: 0, offset: 1.0, dur: 2.0, text: '收尾。', words: [{ w: '收尾。', start: 12.5, end: 13.8 }] }],
        },
      ],
    },
  });
  ok(dA.sourceKind === 'timing' && dA.scenes[0].cutStartLt === 11.5 && dA.scenes[0].releaseByLt === 11.35,
    'timing 形态精确计算 cutStartLt=11.5 与 releaseByLt=11.35');
  ok(dA.scenes[1].cutStartLt === null && dA.scenes[1].releaseByLt === null, '末段 cutStartLt / releaseByLt 为 null');

  // B) 无 words 的 timing（beast 形态）
  const dB = buildCuesData({
    task: 'demoB',
    timing: {
      total: 17.5,
      overlap: 0.625,
      scenes: [
        { id: 'hook', start: 0, slot: 8.75, lines: [{ cue: 0.6, offset: 0.965, dur: 1.992, text: '先看一句话。' }] },
        { id: 'whatis', start: 8.125, slot: 9.375, lines: [{ cue: 0.4, offset: 1.1, dur: 2.0, text: '第二段。' }] },
      ],
    },
  });
  const txtB = formatCuesText(dB);
  ok(dB.scenes[0].lines[0].triggers.length === 0 && !txtB.includes('词点:'),
    '无 words 时正常输出句时刻且不打印空的词点行');

  // C) 纯 narration.json + timeline 回退
  const dC = buildCuesData({
    task: 'demoC',
    narration: {
      lines: [
        { id: 'l1', start: 0.5, dur: 2.5, text: '开场白 L=0.5。', words: [{ w: '开场白', start: 0.5 }, { w: 'L=0.5。', start: 1.8 }] },
        { id: 'l2', start: 11.2, dur: 3.0, text: '第二段内容。', words: [{ w: '第二段', start: 11.2 }] },
      ],
    },
    timeline: [
      { id: 'a', start: 0, end: 10.5 },
      { id: 'b', start: 10.0, end: 20.0 },
    ],
  });
  ok(dC.sourceKind === 'narration' && dC.scenes.length === 2
    && dC.scenes[0].cutStartLt === 10 && dC.scenes[0].lines[0].ltStart === 0.5
    && dC.scenes[1].lines[0].ltStart === 1.2,
  '纯 narration + timeline 回退按段切分并折算段内 lt');
}

// 3. 端到端 CLI 验证
{
  const jRes = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'anim.mjs'), 'cues', 'oklab', '--json'], {
    cwd: ROOT, encoding: 'utf8', timeout: 15_000,
  });
  ok(jRes.status === 0, `anim cues oklab --json 退出码 0（实得 ${jRes.status}）`);
  const json = JSON.parse(jRes.stdout || '{}');
  const hook = json.scenes?.find((s) => s.id === 'hook');
  const gamma = json.scenes?.find((s) => s.id === 'gamma_trap');
  const srgbTrig = gamma?.lines?.[0]?.triggers?.find((w) => w.w === 'sRGB');
  ok(hook?.cutStartLt === 20.55 && hook?.releaseByLt === 20.4,
    `oklab hook cutStartLt=${hook?.cutStartLt}, releaseByLt=${hook?.releaseByLt}`);
  ok(srgbTrig && Math.abs(srgbTrig.lt - 2.13) < 0.05,
    `oklab gamma_trap 首句 sRGB 落在 lt ≈ 2.13s（实得 ${srgbTrig?.lt}s）`);

  const tRes = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'anim.mjs'), 'cues', 'oklab', '--scene', 'hook'], {
    cwd: ROOT, encoding: 'utf8', timeout: 15_000,
  });
  const bytes = Buffer.byteLength(tRes.stdout || '', 'utf8');
  ok(tRes.status === 0 && bytes > 100 && bytes < 1024 && tRes.stdout.includes('cutStart=20.55s') && !tRes.stdout.includes('[02] gamma_trap'),
    `anim cues oklab --scene hook 退出码 0 且单段精简 ${bytes} B < 1024 B`);

  const dRes = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'anim.mjs'), 'cues', 'demo'], {
    cwd: ROOT, encoding: 'utf8', timeout: 15_000,
  });
  const dOut = `${dRes.stdout || ''}\n${dRes.stderr || ''}`;
  ok(dRes.status === 1 && dOut.includes('anim say'),
    'anim cues demo（无配音时间表）返回退出码 1 并提示先跑 anim say');

  const mRes = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'anim.mjs'), 'cues', 'oklab', '--scene', 'nonexistent_seg'], {
    cwd: ROOT, encoding: 'utf8', timeout: 15_000,
  });
  const mOut = `${mRes.stdout || ''}\n${mRes.stderr || ''}`;
  ok(mRes.status === 1 && mOut.includes('可用段名'),
    'anim cues 传入不存在的段名时返回退出码 1 并列出可用段名');
}

console.log(`\n✓ test-cues 全部通过（${passed} 项）`);
