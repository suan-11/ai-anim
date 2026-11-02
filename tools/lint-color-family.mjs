#!/usr/bin/env node
/**
 * tools/lint-color-family.mjs —— **色系判据**：这支片子的颜色是不是同一个色系里的事。
 *
 *   node tools/lint-color-family.mjs                     # 全部风格包体检
 *   node tools/lint-color-family.mjs --task pv-king      # 某个任务（风格 + 任务 palette 覆盖）
 *   node tools/lint-color-family.mjs --json
 *
 * 为什么需要它：换风格最常翻的车不是「配色丑」，是**色系散了** ——
 * 底色偏冷、强调色偏暖、第二强调色又落在第三个色系上；观众说不出哪里怪，只觉得「脏」。
 * 人眼对「同一个色系」很敏感、对色相数值不敏感，所以只能机器量。
 *
 * ## 怎么算（**按角色加权**，不是按色值个数）
 *
 * 调色板里的键本来就有主次：`signal` 是主角、`acid` 的文档原话是「一个片子里最多出现一次」、
 * `blood` 是阴影而不是独立的色相主张。按个数数会冤枉所有正经调色板（print 都会被判红）。
 *
 *   signal 1.0 · ember 0.5 · blood 0.5 · acid 0.2 · graphite/ash/bone/bg/ink 不计（中性轴）
 *
 * ## 三条判据
 *
 *   ① 主色系加权占比 ≥ 0.55
 *   ② 前两名色系合计 ≥ 0.85（第三名只能是点缀）
 *   ③ 底与字一明一暗：亮度差 ≥ 0.25；且信号色与底色要拉得开（色相差 ≥30° 或亮度差 ≥0.25）
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLES, resolveStyle } from '../src/style/index.js';
import { makePalette, DEFAULT_PALETTE } from '../src/core/palette.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flag = (n) => argv.includes('--' + n);
const minTop = Number(opt('min-top', '0.55'));
const minTop2 = Number(opt('min-top2', '0.85'));
const minContrast = Number(opt('min-contrast', '0.25'));
const minSignal = Number(opt('min-signal', '30'));

/** 每个色键的**角色权重**（见文件头） */
const WEIGHT = { signal: 1.0, ember: 0.5, blood: 0.5, acid: 0.2 };

function toHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return { h: 0, s: 0, l: 0 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2, d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1) || 1);
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s, l };
}

const FAMILIES = [['红', 345, 15], ['橙', 15, 45], ['黄', 45, 70], ['绿', 70, 160], ['青', 160, 200], ['蓝', 200, 260], ['紫', 260, 300], ['品红', 300, 345]];
function familyOf(hex) {
  const { h, s, l } = toHsl(hex);
  if (s < 0.12 || l < 0.08 || l > 0.94) return { family: '中性', h, s, l };
  for (const [name, a, b] of FAMILIES) {
    if (a < b ? (h >= a && h < b) : (h >= a || h < b)) return { family: name, h, s, l };
  }
  return { family: '红', h, s, l };
}
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** @param {Record<string,string>} palette */
export function checkPalette(palette) {
  const weights = new Map();
  const detail = [];
  let totalW = 0;
  for (const [k, w] of Object.entries(WEIGHT)) {
    const hex = palette[k];
    if (typeof hex !== 'string') continue;
    const f = familyOf(hex);
    detail.push(`${k}=${hex}(${f.family})`);
    if (f.family === '中性') continue;
    weights.set(f.family, (weights.get(f.family) ?? 0) + w);
    totalW += w;
  }
  const sorted = [...weights.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.length ? sorted[0][1] / (totalW || 1) : 1;
  const top2 = sorted.length > 1 ? (sorted[0][1] + sorted[1][1]) / (totalW || 1) : top;

  const problems = [];
  if (totalW > 0 && top < minTop) {
    problems.push(`主色系只占 ${Math.round(top * 100)}%（要求 ≥${Math.round(minTop * 100)}%）：${sorted.map(([f, w]) => f + w.toFixed(1)).join(' / ')}`);
  }
  if (totalW > 0 && top2 < minTop2) {
    problems.push(`前两个色系合计 ${Math.round(top2 * 100)}%（要求 ≥${Math.round(minTop2 * 100)}%）：${sorted.map(([f]) => f).join(' / ')}`);
  }

  const bgHsl = toHsl(palette.bg ?? palette.ink);
  const txHsl = toHsl(palette.bone);
  const contrast = Math.abs(bgHsl.l - txHsl.l);
  if (contrast < minContrast) problems.push(`底色与正文亮度差 ${contrast.toFixed(2)}（要求 ≥${minContrast}）—— 暗底暗字 / 亮底亮字`);

  const sig = toHsl(palette.signal ?? DEFAULT_PALETTE.signal);
  const dh = hueDist(sig.h, bgHsl.h);
  const dl = Math.abs(sig.l - bgHsl.l);
  if (dh < minSignal && dl < minContrast) problems.push(`信号色与底色太近（色相差 ${dh.toFixed(0)}° / 亮度差 ${dl.toFixed(2)}）—— 强调不出来`);

  return { ok: problems.length === 0, problems, families: sorted.map(([f, w]) => f + w.toFixed(1)).join(' '), top, top2, contrast, detail };
}

function report(name, palette, quiet = false) {
  const r = checkPalette(palette);
  if (!quiet) {
    console.log(`${r.ok ? '✓' : '✗'} ${name.padEnd(16)} ${r.families.padEnd(24)} 主 ${String(Math.round(r.top * 100)).padStart(3)}%  前二 ${String(Math.round(r.top2 * 100)).padStart(3)}%  对比 ${r.contrast.toFixed(2)}`);
    for (const p of r.problems) console.log('    · ' + p);
  }
  return r;
}

/** 主色系 + 加权平均色相（撞色系判据用） */
function dominantOf(palette) {
  const weights = new Map();
  for (const [k, w] of Object.entries(WEIGHT)) {
    const hex = palette[k];
    if (typeof hex !== 'string') continue;
    const f = familyOf(hex);
    if (f.family === '中性') continue;
    const cur = weights.get(f.family) ?? { w: 0, h: 0 };
    cur.w += w; cur.h += f.h * w;
    weights.set(f.family, cur);
  }
  const sorted = [...weights.entries()].sort((a, b) => b[1].w - a[1].w);
  if (!sorted.length) return { family: '中性', hue: 0 };
  const [family, agg] = sorted[0];
  return { family, hue: agg.h / agg.w };
}

/** 载入一支任务（或一个风格名）的调色板 hex 表 */
async function paletteOf(name) {
  if (STYLES[name]) {
    const style = resolveStyle(name);
    const palette = makePalette({ ...(style?.palette ?? {}) });
    return { kind: 'style', style: name, hexes: Object.fromEntries(Object.keys(palette.hex).map((k) => [k, palette.hex[k]])) };
  }
  const mod = await import(new URL('../tasks/' + name + '/task.config.mjs', import.meta.url).href);
  const cfg = mod.default ?? mod.config;
  const style = resolveStyle(cfg);
  const palette = makePalette({ ...(style?.palette ?? {}), ...(cfg.palette ?? {}) });
  return { kind: 'task', style: style?.name, hexes: Object.fromEntries(Object.keys(palette.hex).map((k) => [k, palette.hex[k]])) };
}

// ---- 撞色系：和上一支（或指定的另一支）比 ----
const compareTo = opt('compare', '');
if (compareTo) {
  const a = await paletteOf(opt('task', compareTo) && opt('task', '') ? opt('task', '') : (opt('task', '') || compareTo));
  const bTask = compareTo === opt('task', '') ? compareTo : compareTo;
  const A = await paletteOf(opt('task', ''));
  const B = await paletteOf(bTask);
  const da = dominantOf(A.hexes), db = dominantOf(B.hexes);
  const dH = hueDist(da.hue, db.hue);
  const sameFamily = da.family === db.family;
  const clash = sameFamily && dH < 25;
  console.log(`A ${opt('task', '')}  →  ${da.family}（色相 ${da.hue.toFixed(0)}°）${A.style ? '  [' + A.style + ']' : ''}`);
  console.log(`B ${bTask}  →  ${db.family}（色相 ${db.hue.toFixed(0)}°）${B.style ? '  [' + B.style + ']' : ''}`);
  console.log(clash
    ? `⚠ 撞色系：两支都是【${da.family}】，色相只差 ${dH.toFixed(0)}° —— 连着发布会被看成"同一套脸"（docs/STYLE.md 反审美疲劳）`
    : `✓ 没撞色系：${da.family} vs ${db.family}，色相差 ${dH.toFixed(0)}°`);
  if (flag('json')) console.log(JSON.stringify({ a: da, b: db, hueDist: dH, clash }, null, 2));
  process.exitCode = clash ? 1 : 0;
  process.exit();
}

const taskName = opt('task', '');
let bad = 0, total = 0;
const rows = [];
if (taskName) {
  const mod = await import(new URL('../tasks/' + taskName + '/task.config.mjs', import.meta.url).href);
  const cfg = mod.default ?? mod.config;
  const style = resolveStyle(cfg);
  const palette = makePalette({ ...(style?.palette ?? {}), ...(cfg.palette ?? {}) });
  const hexes = Object.fromEntries(Object.keys(palette.hex).map((k) => [k, palette.hex[k]]));
  const r = report(taskName + ' [' + (style?.name ?? 'print') + ']', hexes, flag('json'));
  rows.push({ name: taskName, style: style?.name, ...r });
  total = 1; if (!r.ok) bad = 1;
} else {
  for (const name of Object.keys(STYLES)) {
    const style = resolveStyle(name);
    const palette = makePalette({ ...(style?.palette ?? {}) });
    const hexes = Object.fromEntries(Object.keys(palette.hex).map((k) => [k, palette.hex[k]]));
    total++;
    const r = report(name, hexes, flag('json'));
    rows.push({ name, ...r });
    if (!r.ok) bad++;
  }
}

if (flag('json')) console.log(JSON.stringify({ total, bad, rows }, null, 2));
else console.log(`\n色系检查：${total - bad}/${total} 套通过` + (bad ? `，${bad} 套色系散了` : '，全部同色系'));
if (bad) process.exitCode = 1;
