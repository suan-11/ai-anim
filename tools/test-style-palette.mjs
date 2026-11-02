#!/usr/bin/env node
/**
 * 风格包「调色板是否真的画到画面上」的判据。
 *
 *   node tools/test-style-palette.mjs [--styles a,b,c] [--task _style-sampler] [--t 6]
 *
 * 做法：起一次 dev 会话，对每套风格读两样东西 ——
 *   ① `window.__animPalette.hex.ink`（引擎**认为**的底色）
 *   ② 渲染后左上角附近的像素（画面**实际**的底色）
 * 两者差超过阈值就报错。
 *
 * 为什么需要它：换一套风格时，调色板解析对不代表画面对 —— 背景可能来自
 * 模板自带的 Pass（颜色烘进 shader 或在构造时缓存）。这类问题肉眼要盯很久，机器一秒就抓到。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const styles = (opt('styles', 'mg-flat-vector,mg-vhs,mg-bauhaus,mg-hud,mg-pixel')).split(',');
const task = opt('task', '_style-sampler');
const at = Number(opt('t', '6'));
// 允许后处理带来的偏差：角落一定被暗角/颗粒压暗，实测 23–38，取 45 留余量
const TOL = Number(opt('tol', '45'));

const PORT = Number(opt('port', '5211'));
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/** 等端口就绪（vite 冷启动要十几秒；写死 sleep 会在慢机器上假失败） */
async function waitPort(port, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const resp = await fetch('http://127.0.0.1:' + port + '/');
      if (resp.ok) return true;
    } catch { /* 还没起 */ }
    await sleep(700);
  }
  return false;
}

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** @type {{style:string, ink:string|null, want:number[], rgb:number[]}[]} */
const results = [];
let promise = null;
let fail = 0;
try {
  if (!(await waitPort(PORT))) throw new Error('vite 没在 60s 内起来（端口 ' + PORT + '）');
  const browser = await chromium.launch({ channel: 'chrome' });
  // ⚠ 复用同一个页面：每套风格开一个新 page 会把 WebGL 上下文用光，
  //   后面几套的场景 setup 直接失败 —— 画面变成错误卡（#5f2222），看起来像"调色板不对"。
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  for (const s of styles) {
    await page.goto(`http://127.0.0.1:${PORT}/?task=${task}&style=${s}&t=${at}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__anim?.info?.().duration > 0, { timeout: 180000 });
    const r = await page.evaluate(async (tt) => {
      // ⚠ 必须关后处理：暗角（vignette 0.5）会把角上的底色压掉几十级，
      //   于是「调色板 vs 画面」永远差一截 —— 判据要量的是**底色本身**，不是被暗角吃掉之后的角。
      const px = await window.__anim.pixels(tt, { skipPost: true });
      const info = window.__anim.info();
      const W = info.pw, H = info.ph;
      // 左上角内缩 8px 取一点（避开可能的最后一列 padding）
      const idx = ((H - 1 - 8) * W + 8) * 4;
      // ⚠ 比的是**底色**（bg），不是 ink：`gl.clear` / worldPass 用的是 P.bg，
  //   两套风格 bg 与 ink 不同（亮底风格尤其明显）时，比 ink 会假红。
  const pal = window.__animPalette?.hex ?? {};
  return { ink: pal.bg ?? pal.ink ?? null, inkRaw: pal.ink ?? null, bgRaw: pal.bg ?? null, rgb: [px[idx], px[idx + 1], px[idx + 2]], style: info.style };
    }, at);
    if (!r.ink) { console.log('? ' + s + ' 拿不到调色板'); continue; }
    results.push({ style: s, ink: r.ink, want: hex2rgb(r.ink), rgb: r.rgb });
    const want = hex2rgb(r.ink);
    const d = dist(want, r.rgb);
    const ok = d <= TOL;
    if (!ok) fail++;
    console.log(
      (ok ? '  PASS  ' : '  FAIL  ') + s.padEnd(17)
      + 'bg ' + r.ink + '（ink ' + r.inkRaw + '） → 画面 #' + r.rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
      + '  Δ' + d
    );
  }
  await browser.close();
  await promise;
  // 序关系：ink 亮的风格，画面也必须更亮（防止"都变灰"这种整体塌陷蒙混过关）
  const rows = results.filter((x) => x.ink);
  const light = rows.filter((x) => lum(x.want) > 128);
  const dark = rows.filter((x) => lum(x.want) < 64);
  if (light.length && dark.length) {
    const minLight = Math.min(...light.map((x) => lum(x.rgb)));
    const maxDark = Math.max(...dark.map((x) => lum(x.rgb)));
    const ok = minLight > maxDark + 40;
    if (!ok) fail++;
    console.log(
      (ok ? '  PASS  ' : '  FAIL  ') + '亮底/暗底分档（亮底最低 ' + minLight.toFixed(0)
      + ' vs 暗底最高 ' + maxDark.toFixed(0) + '）'
    );
  }
} finally {
  vite.kill();
}
console.log('');
console.log(fail ? `✗ ${fail} 套风格的底色与调色板不一致` : '✓ 所有风格的底色都跟调色板一致');
process.exitCode = fail ? 1 : 0;
