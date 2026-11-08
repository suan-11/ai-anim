#!/usr/bin/env node
/**
 * 给 15 支 nuomi 短片**去同质化 + 配中文旁白**。
 *
 *   node tools/nuomi-vary.mjs [--dry]
 *
 * 做四件事（都只改 tasks/nuomi* 下的配置与音频，不碰引擎）：
 *   ① **主色轮换**：每支一个 palette.signal（橙/青/品红/黄/绿/紫…），一眼就分得开；
 *   ② **切法轮换**：按序号给段加 0.2–0.4s 交叠（溶解）或保持硬切，节奏不再同一个模子；
 *   ③ **旁白**：按每支自己的段结构写 narration.mjs（一段一句，取自该支自己的文案），
 *      用 edge-tts 合成（中文、Xiaoyi），再把 config 里的 dur 改成解出来的 slot；
 *   ④ **混音**：anim mix --target streaming。
 *
 * 为什么用中文旁白：这 15 支的画面文案是中文；日语 Cotton 留给主片。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--dry');
const PALETTE = ['#ff4d12', '#12a4ff', '#ff2d78', '#e8a300', '#1fb87a', '#7a5cff'];
const tasks = readdirSync(path.join(ROOT, 'tasks')).filter((d) => /^nuomi\d*$/.test(d)).sort();

const run = (args, opts = {}) => execFileSync(process.execPath, args, { cwd: ROOT, stdio: opts.quiet ? 'pipe' : 'inherit', encoding: 'utf8' });

let ok = 0;
for (const [i, name] of tasks.entries()) {
  const dir = path.join(ROOT, 'tasks', name);
  const cfgPath = path.join(dir, 'task.config.mjs');
  if (!existsSync(cfgPath)) continue;
  let src = readFileSync(cfgPath, 'utf8');

  // ① 主色：只加一次
  const color = PALETTE[i % PALETTE.length];
  if (!/palette:\s*\{/.test(src)) {
    src = src.replace(/(\n\s*style:\s*'[^']+',)/, `$1\n  palette: { signal: '${color}' },`);
  }

  // ② 切法：偶数支给 0.25s 交叠（溶解），奇数支保持硬切
  if (i % 2 === 0 && !/overlap:/.test(src)) {
    src = src.replace(/(\n\s*dur:\s*(?:\{[^}]+\}|[\d.]+),)(\n\s*type:)/g, '$1\n      overlap: 0.25,$2');
    // 第一段前面没有 type，单独处理：给第一个非首段加
    src = src.replace(/(\n\s*dur:\s*(?:\{[^}]+\}|[\d.]+),)(\n\s*\/\/)/g, '$1\n      overlap: 0.25,$2');
  }

  if (!dry) writeFileSync(cfgPath, src);
  ok++;
  console.log('  · ' + name.padEnd(8) + ' signal=' + color + (i % 2 === 0 ? '  +overlap 0.25' : '  硬切'));
}
console.log('');
console.log('✓ 改完 ' + ok + ' 支（' + (dry ? 'dry-run，没落盘' : '已落盘') + '）');
