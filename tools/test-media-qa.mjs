#!/usr/bin/env node
// @ts-check
/**
 * 1-39 的测试：`anim qa` 的**解析 + 分档**（纯函数），外加一条真 ffmpeg 的端到端夹具。
 *
 * 跑法：
 *   node tools/test-media-qa.mjs
 *
 * 为什么先测解析再测命令：黑场/静帧的区间是 ffmpeg **打在 stderr 里的日志**，不是结构化输出 ——
 * 正则错一个字符、或者"片尾只有 start 没有 end"没处理，命令照样退出 0、报告里什么都不说。
 * 这种"看起来跑了"的假覆盖正是 1-19 那条纪律要防的，所以判据全部落在纯函数上；
 * 端到端那一条只为证明「真的能从文件里量出来」，量不出来会明说跳过（不假装通过）。
 */
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readCliSource } from './lib/cli-source.mjs';

import {
  parseDetectIntervals, classifyMediaScan, run, tryRun, ffmpegArgv, scanMediaFile,
} from '../scripts/lib/media.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let passed = 0;
const lines = [];
/** @param {string} name @param {() => void} fn */
function t(name, fn) {
  try { fn(); passed++; lines.push(`  ✓ ${name}`); }
  catch (err) { lines.push(`  ✗ ${name}\n      ${String(err.message).split('\n').join('\n      ')}`); throw Object.assign(new Error(name), { cause: err }); }
}

/* ---------------------------------------------------------------- 1. 解析 */

const BLACK_LOG = `
[blackdetect @ 000001] black_start:1.03333 black_end:2.06667 black_duration:1.03333
[blackdetect @ 000001] black_start:7.5 black_end:9 black_duration:1.5
`;

t('parseDetectIntervals：黑场两条，成对取 start/end', () => {
  const got = parseDetectIntervals(BLACK_LOG, 'black');
  assert.equal(got.length, 2);
  assert.ok(Math.abs(got[0].start - 1.03333) < 1e-6);
  assert.ok(Math.abs(got[0].end - 2.06667) < 1e-6);
  assert.ok(Math.abs(got[1].duration - 1.5) < 1e-9);
});

t('parseDetectIntervals：静帧日志（`lavfi.freezedetect.freeze_start` 前缀）也认', () => {
  const log = '[freezedetect @ 000002] lavfi.freezedetect.freeze_start: 3.2\n'
    + '[freezedetect @ 000002] lavfi.freezedetect.freeze_end: 5\n';
  const got = parseDetectIntervals(log, 'freeze');
  assert.equal(got.length, 1);
  assert.equal(got[0].start, 3.2);
  assert.equal(got[0].end, 5);
  assert.ok(Math.abs(got[0].duration - 1.8) < 1e-9, `duration=${got[0].duration}`);
});

t('parseDetectIntervals：片尾只有 start（开到文件结束）→ end=null，不丢', () => {
  const got = parseDetectIntervals('[blackdetect @ x] black_start:9.5 black_duration:2.5', 'black');
  assert.equal(got.length, 1);
  assert.equal(got[0].end, null);
  assert.equal(got[0].duration, null);
});

t('parseDetectIntervals：空输入 / 无命中返回空数组（不是 undefined）', () => {
  assert.deepEqual(parseDetectIntervals('', 'black'), []);
  assert.deepEqual(parseDetectIntervals('[info] nothing here', 'freeze'), []);
});

/* ---------------------------------------------------------------- 2. 分档 */

const base = {
  file: 'x.mp4', duration: 10, fps: 30, width: 1920, height: 1080,
  hasVideo: true, hasAudio: true, decode: { ok: true, error: null }, black: [], freeze: [], audio: null,
};
const cls = (patch, opts) => classifyMediaScan({ ...base, ...patch }, opts);

t('分档：中段黑场 → warn；片头/片尾的黑 → info（设计如此）', () => {
  const v = cls({ black: [{ start: 4, end: 4.5, duration: 0.5 }, { start: 0.1, end: 0.4, duration: 0.3 }, { start: 9.5, end: 10, duration: 0.5 }] });
  assert.equal(v.warnings.length, 1);
  assert.equal(v.infos.length, 2);
  assert.match(v.warnings[0].text, /4\.00s 起黑场 0\.50s/);
});

t('分档：静帧 < maxFreeze 是 info，≥ maxFreeze 才是 warn（hold 段合法）', () => {
  const v = cls({ freeze: [{ start: 2, end: 4, duration: 2 }, { start: 5, end: 9, duration: 4 }] });
  assert.equal(v.infos.filter((i) => i.kind === 'freeze').length, 1);
  assert.equal(v.warnings.filter((i) => i.kind === 'freeze').length, 1);
});

t('分档：落在黑场里的静帧被丢掉（黑场天然静止，不许重复报）', () => {
  const v = cls({ black: [{ start: 4, end: 5, duration: 1 }], freeze: [{ start: 4, end: 5, duration: 1 }] });
  assert.equal(v.items.filter((i) => i.kind === 'freeze').length, 0);
  assert.equal(v.warnings.length, 1);
});

t('分档：片尾开口的黑场（end=null）用总时长收口', () => {
  const v = cls({ black: [{ start: 9.6, end: 10, duration: 0.4 }] });
  assert.equal(v.warnings.length, 0);
  assert.match(v.infos[0].text, /片尾淡出/);
});

t('分档：解码失败是 error；静音是 warn；贴满刻度只是 info', () => {
  assert.equal(cls({ decode: { ok: false, error: 'Invalid data' } }).errors.length, 1);
  assert.equal(cls({ audio: { meanDb: -70, peakDb: -62 } }).warnings.length, 1);
  const hot = cls({ audio: { meanDb: -3, peakDb: -0.05 } });
  assert.equal(hot.warnings.length, 0);
  assert.match(hot.infos[0].text, /贴满刻度/);
});

t('分档：全干净时 items 为空（"零读数"也是一条结论）', () => {
  assert.equal(cls({ audio: { meanDb: -18, peakDb: -2 } }).items.length, 1); // 只剩音量读数
  assert.equal(cls({}).items.length, 0);
});

t('分档：阈值原样带回（打印时要用，不许调用方再写一遍）', () => {
  const v = cls({}, { head: 1, tail: 2, maxFreeze: 5 });
  assert.deepEqual(v.thresholds.head, 1);
  assert.deepEqual(v.thresholds.tail, 2);
  assert.deepEqual(v.thresholds.maxFreeze, 5);
});

/* ---------------------------------------------------------------- 3. 接线自检 */

t('接线：CLI 里真的有 `qa` 命令与帮助行', () => {
  // 读 CLI 的拼接源码视图（anim.mjs + 拆分后的 scripts/cmd、scripts/lib/cli）—— 见 tools/lib/cli-source.mjs
  const src = readCliSource();
  assert.ok(/^\s*qa: cmdQa,/m.test(src), 'dispatch 表里没有 qa');
  assert.ok(src.includes('node scripts/anim.mjs qa <task>'), '帮助块里没有 qa 的用法行');
  assert.ok(src.includes('classifyMediaScan'), 'cmdQa 没接分类器');
});

/* ---------------------------------------------------------------- 4. 端到端（要 ffmpeg） */

const probe = tryRun([...ffmpegArgv(), '-version']);
if (probe.spawnError || probe.status !== 0) {
  lines.push('  ○ 端到端：跳过（这台机器没有 ffmpeg —— 没验 ≠ 通过）');
} else {
  const dir = path.join(ROOT, 'out', '_staging', 'test-media-qa');
  const file = path.join(dir, 'bad.mp4');
  mkdirSync(dir, { recursive: true });
  rmSync(file, { force: true });
  // 1s 红 + 1s 黑 + 2s testsrc（在动）+ 4s 蓝（死静）—— 中段黑场 1 条 + 超长静帧 1 条
  const made = run([
    ...ffmpegArgv(), '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=480x270:r=30:d=1',
    '-f', 'lavfi', '-i', 'color=c=black:s=480x270:r=30:d=1',
    '-f', 'lavfi', '-i', 'testsrc=s=480x270:r=30:d=2',
    '-f', 'lavfi', '-i', 'color=c=blue:s=480x270:r=30:d=4',
    '-filter_complex', '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', file,
  ], { timeout: 120000 });
  t('端到端：合成夹具编码成功', () => assert.equal(made.status, 0, made.stderr.slice(-300)));

  const scan = scanMediaFile(file, { timeoutMs: 120000 });
  t('端到端：时长 8s、无音轨（没音频时 audio=null，不报"静音"）', () => {
    assert.ok(Math.abs(scan.duration - 8) < 0.2, `duration=${scan.duration}`);
    assert.equal(scan.audio, null);
  });
  t('端到端：黑场 1.00s 被量出来（±0.2s）', () => {
    assert.ok(scan.black.length >= 1, `black=${JSON.stringify(scan.black)}`);
    assert.ok(Math.abs(scan.black[0].start - 1) < 0.2, `start=${scan.black[0].start}`);
  });
  t('端到端：末尾 4s 死静被量出来，并分档成 warn', () => {
    assert.ok(scan.freeze.some((f) => f.duration >= 3.5), `freeze=${JSON.stringify(scan.freeze)}`);
    const v = classifyMediaScan(scan);
    assert.ok(v.warnings.some((w) => /静帧/.test(w.text)), JSON.stringify(v.warnings));
    assert.ok(v.warnings.some((w) => /黑场/.test(w.text)), JSON.stringify(v.warnings));
  });
  t('端到端：解码校验通过（文件是我们自己编的）', () => assert.equal(scan.decode.ok, true, scan.decode.error));
}

/* ---------------------------------------------------------------- 汇总 */

console.log(`\nanim qa 的解析 / 分档（1-39） —— ${passed} 项\n`);
for (const line of lines) console.log(line);
console.log('');
