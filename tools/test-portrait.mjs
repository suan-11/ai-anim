#!/usr/bin/env node
// @ts-check
/**
 * 竖屏适配的**纯逻辑**回归（BACKLOG 1-52，不需要 GPU / 浏览器）。
 *
 *   node tools/test-portrait.mjs
 *
 * 这份测试守的是三件容易"静默错"的事：
 *   ① **横屏原样返回不额外换算** —— `fitStyleToFrame()` 对横屏直接**原样返回同一个对象**
 *      （连引用都不换），只有竖屏（`H > W`）才按短边换算栅格与字号；
 *   ② **竖屏不能靠"按高缩放"** —— 那是第一版最容易写错的地方（`H/1080` = 1.777，
 *      `pad` 会变成 213）。短边是宽，所以缩放系数必须是 `W/1080`；
 *   ③ **字幕带要落在 61%–70% 高度、且避开 B 站底部 UI**（≈1800 以下是进度条与作者位）。
 */

import {
  GRID_BASE, GRID_PORTRAIT, fitStyleToFrame, resolveStyle, gridFor,
} from '../src/style/index.js';
import { resolveTypeSize, PORTRAIT_TYPE_SCALE } from '../src/style/tokens.js';
import { bands } from '../src/kit/bands.js';

let fail = 0;
let pass = 0;
/** @param {boolean} cond @param {string} msg */
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); } else { fail++; console.error(`✗ ${msg}`); }
}
/** @param {string} msg */
function section(msg) { console.log(`\n── ${msg} ──`); }

const W = 1080;
const H = 1920;
const style = resolveStyle('flat');

/* ---------------------------------------------------------------- 横屏：原样返回 */

section('横屏：原样返回不额外换算');
for (const [w, h] of [[1920, 1080], [1280, 720], [3840, 2160]]) {
  const fitted = fitStyleToFrame(style, w, h);
  ok(fitted === style, `${w}×${h}：fitStyleToFrame 原样返回**同一个对象**（没有新建、没有换算）`);
}
const printStyle = resolveStyle({});
ok(fitStyleToFrame(printStyle, 1920, 1080) === printStyle, 'print 风格横屏也不动');
ok(GRID_BASE.pad === 120 && GRID_BASE.captionBand[0] === 40, 'GRID_BASE 本体没被改脏（pad 120 / 字幕带 [40,104]）');

/* ---------------------------------------------------------------- 竖屏栅格 */

section('竖屏：栅格换成 1080×1920 那一套');
const p = fitStyleToFrame(style, W, H);
ok(p !== style, '竖屏**新建**了对象（不能改原 style，横屏还要用）');
ok(p.portrait === true, '打上了 portrait 标记（kit/场景可以读）');
ok(p.grid.pad === GRID_PORTRAIT.pad, `pad = ${GRID_PORTRAIT.pad}（不是按高缩放的 213）`);
ok(p.grid.top === GRID_PORTRAIT.top, `top = ${GRID_PORTRAIT.top}`);
ok(p.grid.pad * 2 < W * 0.25, '左右边距合计不到画幅的 25%（窄画幅要留住内容宽度）');
ok(p.grid.contentBottom < p.grid.captionBand[0], 'contentBottom 在字幕带上沿**上方**（正文不许压字幕）');
ok(p.grid.footerY > p.grid.captionBand[1], '页脚在字幕带**下方**');
ok(p.grid.footerY < 1750, '页脚在 B 站竖屏 UI（≈1800）之上');

section('竖屏：字幕带落在 61%–70%，且避开 B 站底部 UI');
const [y0, y1] = p.grid.captionBand;
ok(y0 / H >= 0.58 && y0 / H <= 0.66, `带子上沿 ${y0} = ${(y0 / H * 100).toFixed(1)}% 高度（目标 ≈61%）`);
ok(y1 / H >= 0.66 && y1 / H <= 0.74, `带子下沿 ${y1} = ${(y1 / H * 100).toFixed(1)}% 高度（目标 ≈70%）`);
ok(y1 < 1800, '带子整体在 B 站底部 UI（≈1800）之上');
ok(y1 - y0 >= 120, `带高 ${y1 - y0}px 够放两行字幕`);

section('竖屏：按短边（宽）缩放，不是按高');
ok(gridFor(style, 1080, 1920).pad === GRID_PORTRAIT.pad, '1080 宽时 pad 不缩放（×1.0）');
ok(gridFor(style, 720, 1280).pad === Math.round(GRID_PORTRAIT.pad * (720 / 1080)), '720 宽时按 720/1080 缩放');
ok(gridFor(resolveStyle({}), 1920, 1080).pad === GRID_BASE.pad, '横屏仍走 GRID_BASE（print 没覆盖 pad）');
ok(gridFor(style, 1920, 1080).pad === 128, '横屏时风格自己的覆盖照旧生效（flat 的 pad 128）');

/* ---------------------------------------------------------------- 字号 */

section('竖屏：字号阶梯 ×1.35（语义字号跟着走）');
ok(Math.abs(PORTRAIT_TYPE_SCALE - 1.35) < 1e-9, `PORTRAIT_TYPE_SCALE = ${PORTRAIT_TYPE_SCALE}`);
const heroLandscape = resolveTypeSize('hero', style.tokens);
const heroPortrait = resolveTypeSize('hero', p.tokens);
ok(heroPortrait === Math.round(heroLandscape * PORTRAIT_TYPE_SCALE), `hero ${heroLandscape} → ${heroPortrait}（竖屏）`);
ok(heroPortrait / W <= 0.2, `hero 占短边 ${(heroPortrait / W * 100).toFixed(0)}%（<= 20%，四个字还放得下）`);
ok(resolveTypeSize('label', p.tokens) > resolveTypeSize('label', style.tokens), 'label 也跟着放大');
ok(style.tokens.type.hero === 136, '横屏的 token 没被改脏');

section('竖屏：线宽跟着放大，但字重/节奏/质感不放大');
ok(p.tokens.rule.hair > style.tokens.rule.hair, `hair ${style.tokens.rule.hair} → ${p.tokens.rule.hair}`);
ok(p.tokens.weight.hero === style.tokens.weight.hero, '字重不缩放（与画幅无关）');
ok(p.tokens.motion.stagger === style.tokens.motion.stagger, '错峰秒数不缩放（节奏与画幅无关）');
ok(p.tokens.texture.grain === style.tokens.texture.grain, '颗粒不放大（放大就变噪点）');

/* ---------------------------------------------------------------- 字幕 */

section('竖屏：字幕换成竖屏参数');
const capsL = resolveStyle('paper').captions;
const capsP = fitStyleToFrame(resolveStyle('paper'), W, H).captions;
ok(capsP.size > capsL.size, `字号 ${capsL.size} → ${capsP.size}`);
ok(capsP.maxCharsPerLine <= 12, `每行最多 ${capsP.maxCharsPerLine} 字（竖屏窄，16 字会溢出）`);
ok(capsP.position === 'bottom', "position = 'bottom'（在带内往上叠，不顶到带上沿之外）");
ok(capsP.size * capsP.maxCharsPerLine <= W - p.grid.pad * 2 + 8,
  `${capsP.size}×${capsP.maxCharsPerLine} = ${capsP.size * capsP.maxCharsPerLine}px 不超过内容宽 ${W - p.grid.pad * 2}px`);
ok(fitStyleToFrame(resolveStyle('print'), W, H).captions === false, 'print 的字幕默认仍是关的（竖屏也一样）');

section('竖屏：字幕保留带 x 覆盖到内容宽（不然冲突判成假阴性）');
const bs = bands(W, H, p.grid).sub;
ok(bs.x1 - bs.x0 >= (W - p.grid.pad * 2) * 0.85, `字幕带 x 宽 ${bs.x1 - bs.x0}px ≥ 内容宽的 85%`);
const bsL = bands(1920, 1080, GRID_BASE).sub;
ok(bsL.x1 - bsL.x0 === Math.round(1920 * 0.38), '横屏的字幕带宽度不变（0.19×2）');

/* ---------------------------------------------------------------- 风格覆盖 */

section('风格可以覆盖竖屏栅格');
const custom = resolveStyle({ style: { name: 'flat', gridPortrait: { pad: 64 } } });
const customP = fitStyleToFrame(custom, W, H);
ok(customP.grid.pad === 64, '任务级 gridPortrait 覆盖生效（pad 64）');
ok(customP.grid.top === GRID_PORTRAIT.top, '没覆盖的键仍取默认（top）');

console.log(`\n${fail ? `✗ ${fail} 项失败` : `✓ ${pass} 项全部通过`}（共 ${pass + fail} 项）`);
process.exit(fail ? 1 : 0);
