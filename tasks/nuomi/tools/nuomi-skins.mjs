#!/usr/bin/env node
/**
 * 给 15 支 nuomi 短片套上 mg-styles-15 的 15 种风格皮（近似实现）。
 *
 *   node tools/nuomi-skins.mjs [--dry]
 *
 * 参考：https://github.com/Vincentwei1021/mg-styles-15（15 种 MG 风格，各一支 10 秒片，附提示词与源码）
 *
 * ⚠ 这是**皮**不是**骨**：引擎现在能改的是主色、后处理（ca/grain/dither/bloom/halation/tint…）与少量结构旋钮。
 *   真要做到 3D render / cel boil / collage 那种「骨」，得给引擎加新模板（一行一条 BACKLOG）。
 *   皮能解决的是最刺眼的那一层：15 支看起来像同一支。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--dry');

/** clip → [参考风格, signal, post] */
const SKINS = {
  nuomi:   ['03 Flat Vector',        '#ff6a2c', '{ saturation: 1.15, contrast: 1.08, grain: 0.008, bloom: 0.22 }'],
  nuomi2:  ['07 Sticker Explainer',  '#ffd23f', '{ saturation: 1.25, contrast: 1.05, grain: 0.012, bloom: 0.5, halation: 0.35 }'],
  nuomi3:  ['12 Synthwave / VHS',    '#ff2d94', '{ ca: 0.006, grain: 0.055, saturation: 1.3, contrast: 1.1, bloom: 0.85, halation: 0.55 }'],
  nuomi4:  ['11 Geometric Bauhaus',  '#e03c1f', '{ saturation: 1.05, contrast: 1.15, grain: 0.004, bloom: 0.12 }'],
  nuomi5:  ['10 Aurora / Glass',     '#4be1ff', '{ bloom: 1.0, bloomRadius: 1.6, halation: 0.8, grain: 0.01, saturation: 1.1 }'],
  nuomi6:  ['08 Cyberpunk HUD / FUI', '#00e5ff', '{ ca: 0.004, grain: 0.03, contrast: 1.12, bloom: 0.7, tint: [0.85, 1.0, 1.15] }'],
  nuomi7:  ['09 Collage / Cut-out',  '#c8a06a', '{ saturation: 0.9, contrast: 1.05, grain: 0.05, vignette: 0.35 }'],
  nuomi8:  ['13 Pixel Art',          '#8be04e', '{ dither: 0.55, saturation: 1.2, contrast: 1.1, grain: 0.0, bloom: 0.15 }'],
  nuomi9:  ['15 Variety Captions',   '#ff3b5c', '{ saturation: 1.35, contrast: 1.12, bloom: 0.35, grain: 0.02 }'],
  nuomi10: ['06 Shape Morph',        '#a86bff', '{ bloom: 0.6, halation: 0.4, saturation: 1.1, grain: 0.008 }'],
  nuomi11: ['01 Cel / Line Boil',    '#e63946', '{ grain: 0.045, blur: 0.25, saturation: 1.05, contrast: 1.06, bloom: 0.18 }'],
  nuomi12: ['04 Line Art',           '#1f6feb', '{ contrast: 1.18, saturation: 0.85, grain: 0.006, bloom: 0.1 }'],
  nuomi13: ['05 3D Render (soft)',   '#7fd1c1', '{ bloom: 0.55, halation: 0.45, saturation: 1.0, grain: 0.006, vignette: 0.25 }'],
  nuomi14: ['02 Isometric 2.5D',     '#f0a202', '{ contrast: 1.1, saturation: 1.05, grain: 0.008, bloom: 0.2 }'],
  nuomi15: ['14 Liquid Motion',      '#00c2a8', '{ bloom: 0.8, bloomRadius: 1.4, halation: 0.5, grain: 0.012, saturation: 1.1 }'],
};

let n = 0;
for (const [name, [style, signal, post]] of Object.entries(SKINS)) {
  const p = path.join(ROOT, 'tasks', name, 'task.config.mjs');
  let s;
  try { s = readFileSync(p, 'utf8'); } catch { console.log('  skip ' + name); continue; }
  // 主色
  s = s.replace(/palette:\s*\{[^}]*\},/, 'palette: { signal: \'' + signal + '\' },');
  // 后处理：写进 timeline 每个节点的 post（配置档节点支持 post）
  s = s.replace(/\n(\s*)(type:\s*'[^']+',)/g, '\n$1$2\n$1post: ' + post + ',');
  if (!dry) writeFileSync(p, s);
  n++;
  console.log('  · ' + name.padEnd(8) + style.padEnd(22) + signal);
}
console.log('');
console.log('✓ ' + n + ' 支上了皮（' + (dry ? 'dry-run' : '已落盘') + '）');
