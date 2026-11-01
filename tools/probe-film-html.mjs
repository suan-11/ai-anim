#!/usr/bin/env node
/**
 * tools/probe-film-html.mjs —— 单文件播放器（`anim film-html`）的量具。
 *
 *   node tools/probe-film-html.mjs out/pv-king/film.html
 *
 * 判据（缺一条就红）：
 *   ① 页面能加载且不抛错（console / pageerror 都算）
 *   ② `window.__film` 存在、total > 0
 *   ③ 拖到 5 个时刻各截一张图，**都不是纯黑/纯白**（说明引擎真的在画）
 *   ④ 逐帧：t 与 t+1/60 两帧**不完全相同**（说明它在动，不是一张静态图）
 */
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('用法：node tools/probe-film-html.mjs <film.html>'); process.exit(2); }
const abs = path.resolve(file);
const shotDir = path.join(path.dirname(abs), 'film-probe');
mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(pathToFileURL(abs).href, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__film, null, { timeout: 30000 });
const total = await page.evaluate(() => window.__film.total);
console.log('total', total, 's');

const stats = [];
for (const frac of [0.02, 0.25, 0.5, 0.75, 0.98]) {
  const t = +(total * frac).toFixed(2);
  await page.evaluate((tt) => { window.__film.t = tt; }, t);
  await page.waitForTimeout(120);
  const png = path.join(shotDir, 'f_' + t.toFixed(2) + '.png');
  await page.locator('#c').screenshot({ path: png });
  const st = await page.evaluate(() => {
    const c = document.getElementById('c');
    const g = c.getContext('webgl2', { preserveDrawingBuffer: true });
    const px = new Uint8Array(4 * 64);
    const out = [];
    for (let i = 0; i < 64; i++) {
      g.readPixels((i % 8) * Math.floor(c.width / 8), Math.floor(i / 8) * Math.floor(c.height / 8), 1, 1, g.RGBA, g.UNSIGNED_BYTE, px.subarray(i * 4, i * 4 + 4));
      out.push(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    }
    return { mean: out.reduce((a, b) => a + b, 0) / out.length, hash: out.join(',') };
  });
  stats.push({ t, ...st });
}

const flat = stats.filter((s) => s.mean < 2 || s.mean > 253);
const moving = await page.evaluate(async () => {
  const f = window.__film;
  f.t = 1.0; const a = document.getElementById('c').toDataURL();
  f.t = 1.0 + 1 / 60; const b = document.getElementById('c').toDataURL();
  return a !== b;
});

let bad = 0;
if (errs.length) { console.log('✗ 页面报错：'); errs.slice(0, 5).forEach((e) => console.log('   ' + e)); bad++; }
if (!(total > 0)) { console.log('✗ total 不是正数'); bad++; }
if (flat.length) { console.log('✗ ' + flat.length + ' 个时刻整帧近乎纯色（mean ' + flat.map((s) => s.t + ':' + s.mean.toFixed(1)).join(', ') + '）'); bad++; }
if (!moving) { console.log('✗ 相邻两帧完全相同（画面是静止图）'); bad++; }
if (!bad) console.log('✓ 单文件播放器可用（5 个时刻都有画面，逐帧在动）· 截图在 ' + path.relative(process.cwd(), shotDir));
await browser.close();
if (bad) process.exitCode = 1;
