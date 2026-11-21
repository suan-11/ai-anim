#!/usr/bin/env node
// @ts-check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSource, taskSignals, pixelSignals, computeCraftScore } from './lib/craft-signals.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  passed++;
  console.log('  ✓ ' + msg);
};

/** 构造 160×90 RGBA 缓冲（每个 16×9 网格恰为 10×10 像素），便于精确测边界。 */
function makeRgba(w, h, bgLumByte = 250) {
  const buf = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = bgLumByte;
    buf[i * 4 + 1] = bgLumByte;
    buf[i * 4 + 2] = bgLumByte;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

function paintCells(buf, w, h, count, lumByte = 20) {
  const COLS = 16, ROWS = 9;
  for (let idx = 0; idx < count; idx++) {
    const cx = idx % COLS;
    const cy = Math.floor(idx / COLS);
    const x0 = Math.floor((cx * w) / COLS), x1 = Math.floor(((cx + 1) * w) / COLS);
    const y0 = Math.floor((cy * h) / ROWS), y1 = Math.floor(((cy + 1) * h) / ROWS);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const off = (y * w + x) * 4;
        // 给半格暗、半格更暗，确保格内均值离背景众数足够远
        const v = ((x + y) % 2 === 0) ? lumByte : Math.max(0, lumByte - 15);
        buf[off] = v; buf[off + 1] = v; buf[off + 2] = v;
      }
    }
  }
}

console.log('test-craft:');

// 1. 静态源码信号正反例
{
  const badFont = scanSource(`c.font = '600 34px sans-serif';`, 'scenes/a.js');
  ok(badFont.some((x) => x.code === 'CRAFT-FONT'), '裸 sans-serif 命中 CRAFT-FONT');

  const badFontSerif = scanSource(`c.font = '32px serif';`, 'scenes/a.js');
  ok(badFontSerif.some((x) => x.code === 'CRAFT-FONT'), '.font = "...px serif" 命中 CRAFT-FONT');

  const goodSerif = scanSource(`type.write('正文', 100, 200, { family: 'serif', size: 42, color: css(P.bone) });`, 'scenes/a.js');
  ok(!goodSerif.some((x) => x.code === 'CRAFT-FONT'), "type.write 的 family: 'serif' 不误报 CRAFT-FONT");

  const badRaw = scanSource(`c.fillText('hello', 10, 20); c.strokeText('x', 10, 30);`, 'scenes/a.js');
  ok(badRaw.some((x) => x.code === 'CRAFT-RAWTEXT' && x.count === 2), 'fillText/strokeText 命中 CRAFT-RAWTEXT');

  const badColor = scanSource(`c.fillStyle = '#101828'; c.strokeStyle = 'rgba(31,111,235,0.5)';`, 'scenes/a.js');
  ok(badColor.some((x) => x.code === 'CRAFT-COLOR'), '硬编码色多于 P. 引用命中 CRAFT-COLOR');

  const goodPalette = scanSource(`const a = css(P.bone, 0.9); const b = P.signal; const c = '#101828';`, 'scenes/a.js');
  ok(!goodPalette.some((x) => x.code === 'CRAFT-COLOR'), 'P. 引用多于硬编码色时不报 CRAFT-COLOR');

  const cfgPalette = scanSource(`export default { palette: { ink: '#05070a', bone: '#eee9df', signal: '#ff4d12' } };`, 'tasks/x/task.config.mjs');
  ok(!cfgPalette.some((x) => x.code === 'CRAFT-COLOR'), 'task.config.mjs 的 palette 定义块不误报 CRAFT-COLOR');

  const commented = scanSource(`// c.font = '30px sans-serif'; c.fillText('x', 0, 0); '#123456'`, 'scenes/a.js');
  ok(commented.length === 0, '注释中的代码不误报');
}

// 2. light-seconds 源码夹具测试
{
  const lsSrc = readFileSync(path.join(ROOT, 'tools', 'fixtures', 'craft', 'light-seconds-travel.js'), 'utf8');
  const sHits = scanSource(lsSrc, 'travel.js');
  const tHits = taskSignals({
    segments: [{ id: 'light-seconds', start: 0, end: 20 }],
    durations: [20],
    templateTypes: [],
    hasWorld: false,
    sourceTexts: [lsSrc],
  });
  const codes = new Set([...sHits, ...tHits].map((x) => x.code));
  ok(codes.has('CRAFT-FONT'), 'light-seconds 夹具命中 CRAFT-FONT');
  ok(codes.has('CRAFT-RAWTEXT'), 'light-seconds 夹具命中 CRAFT-RAWTEXT');
  ok(codes.has('CRAFT-COLOR'), 'light-seconds 夹具命中 CRAFT-COLOR');
  ok(codes.has('CRAFT-MONO'), 'light-seconds 夹具命中 CRAFT-MONO');
  ok(codes.has('CRAFT-STATIC-CAM'), 'light-seconds 夹具命中 CRAFT-STATIC-CAM');
}

// 3. taskSignals 阈值边界
{
  ok(!taskSignals({ segments: 1, durations: [15], hasWorld: false, sourceTexts: ['cameraPost'] }).some((x) => x.code === 'CRAFT-MONO'), '1 段 15.0s 不触发 CRAFT-MONO');
  ok(taskSignals({ segments: 1, durations: [15.1], hasWorld: false, sourceTexts: ['cameraPost'] }).some((x) => x.code === 'CRAFT-MONO'), '1 段 15.1s 触发 CRAFT-MONO');

  ok(!taskSignals({ segments: 5, durations: [3, 3, 3, 3, 3], templateTypes: ['chart', 'kinetic'], hasWorld: true, sourceTexts: ['cameraPost'] }).some((x) => x.code === 'CRAFT-TEMPLATE'), '2/5=40% 模板不触发 CRAFT-TEMPLATE');
  ok(taskSignals({ segments: 5, durations: [3, 3, 3, 3, 3], templateTypes: ['chart', 'kinetic', 'scan'], hasWorld: true, sourceTexts: ['cameraPost'] }).some((x) => x.code === 'CRAFT-TEMPLATE'), '3/5=60% 模板触发 CRAFT-TEMPLATE');
  ok(taskSignals({ segments: 10, durations: Array(10).fill(3), templateTypes: ['chart', 'chart', 'chart'], hasWorld: true, sourceTexts: ['cameraPost'] }).some((x) => x.code === 'CRAFT-TEMPLATE'), '同模板 3 次触发 CRAFT-TEMPLATE');
  ok(!taskSignals({ segments: 5, durations: [3, 3, 3, 3, 3], templateTypes: ['placeholder', 'placeholder', 'placeholder'], hasWorld: true, sourceTexts: ['cameraPost'] }).some((x) => x.code === 'CRAFT-TEMPLATE'), 'placeholder 占位符不计入 CRAFT-TEMPLATE');

  ok(taskSignals({ segments: 2, durations: [4, 4], hasWorld: false, sourceTexts: ['makeShot'] }).some((x) => x.code === 'CRAFT-NOWORLD'), '多段无 world 触发 CRAFT-NOWORLD');
  ok(!taskSignals({ segments: 2, durations: [4, 4], hasWorld: true, sourceTexts: ['makeShot'] }).some((x) => x.code === 'CRAFT-NOWORLD'), '多段有 world 不触发 CRAFT-NOWORLD');

  ok(taskSignals({ segments: 2, durations: [4, 4], hasWorld: true, sourceTexts: ['gl.clear(ctx.out)'] }).some((x) => x.code === 'CRAFT-STATIC-CAM'), '无摄影机接口触发 CRAFT-STATIC-CAM');
  ok(!taskSignals({ segments: 2, durations: [4, 4], hasWorld: true, sourceTexts: ['cameraPost(f.t)'] }).some((x) => x.code === 'CRAFT-STATIC-CAM'), '有 cameraPost 不触发 CRAFT-STATIC-CAM');
}

// 4. pixelSignals 阈值边界（160×90）
{
  // 全纯白 + 2 个小点 → emptyRatio 远超 55% 且扁平
  const empty = makeRgba(160, 90, 250);
  paintCells(empty, 160, 90, 5, 20);
  const rEmpty = pixelSignals(empty, 160, 90);
  ok(rEmpty.signals.some((s) => s.code === 'CRAFT-EMPTY'), `空格占比 ${(rEmpty.stats.emptyRatio * 100).toFixed(0)}% > 55% 命中 CRAFT-EMPTY`);

  // 边界测试：144 格里涂满 65 格（留 79 格空 → 79/144 = 54.86% ≤ 55%）vs 涂满 64 格（留 80 格空 → 80/144 = 55.56% > 55%）
  const edgePass = makeRgba(160, 90, 250);
  paintCells(edgePass, 160, 90, 65, 20);
  const rPass = pixelSignals(edgePass, 160, 90);
  ok(!rPass.signals.some((s) => s.code === 'CRAFT-EMPTY'), `79/144 空 (54.9%) 不触发 CRAFT-EMPTY`);
  ok(!rPass.signals.some((s) => s.code === 'CRAFT-FLAT'), `明暗范围 ${rPass.stats.lumRange.toFixed(2)} >= 0.25 不触发 CRAFT-FLAT`);

  const edgeFail = makeRgba(160, 90, 250);
  paintCells(edgeFail, 160, 90, 64, 20);
  const rFail = pixelSignals(edgeFail, 160, 90);
  ok(rFail.signals.some((s) => s.code === 'CRAFT-EMPTY'), `80/144 空 (55.6%) 触发 CRAFT-EMPTY`);

  // 低对比扁平画面：全部像素在 110..145 之间（range ≈ 0.14 < 0.25）
  const flat = makeRgba(160, 90, 120);
  paintCells(flat, 160, 90, 72, 145);
  const rFlat = pixelSignals(flat, 160, 90);
  ok(rFlat.signals.some((s) => s.code === 'CRAFT-FLAT'), `亮度范围 ${rFlat.stats.lumRange.toFixed(2)} < 0.25 触发 CRAFT-FLAT`);

  ok(computeCraftScore([{ code: 'CRAFT-FONT' }, { code: 'CRAFT-FONT' }, { code: 'CRAFT-RAWTEXT' }]) === 70, '参考分按唯一信号去重扣分');
}

console.log(`\n✓ test-craft：${passed} 项通过`);
