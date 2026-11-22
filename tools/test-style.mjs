#!/usr/bin/env node
// @ts-check
/**
 * 风格包 + 字幕层的**纯逻辑**回归（不需要 GPU / 浏览器，几毫秒跑完）。
 *
 *   node tools/test-style.mjs
 *
 * 为什么这份测试值得存在：风格系统管的是**每一支片子的观感**，
 * 需要守住默认值解析、合并优先级、字体/色板完整性、防默认参数污染与字幕带约束。
 *
 * 另外还钉住字幕层的两条语义（`docs/CAPTIONS.md`）：
 *   · 默认**关**（`resolveCaptionStyle(null, null) === false`）—— 没写 `captions` 不擅自开字幕；
 *   · 字幕带落在 `style.grid.captionBand` 里，且 x 只占中间那一段（不是整幅宽度）。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLES, resolveStyle, listStyles, gridFor, GRID_BASE } from '../src/style/index.js';
import { resolveCaptionStyle, DEFAULT_CAPTION_STYLE, makeCaptionLayer } from '../src/core/captions.js';
import { makeNarration, makeNarrationReader } from '../src/core/narration.js';
import { makePalette } from '../src/core/palette.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let fail = 0;
let pass = 0;
/** @param {boolean} cond @param {string} msg */
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); } else { fail++; console.error(`✗ ${msg}`); }
}
/** @param {string} msg */
function section(msg) { console.log(`\n── ${msg} ──`); }

/* ---------------------------------------------------------------- 风格包 */

section('风格包：默认解析与独立自包含');
const def = resolveStyle({});
ok(def.name === 'print', '不写 style → print');
ok(Object.keys(def.palette).length > 0, 'print 有自己独立的 palette（不依赖隐式空对象）');
ok(Object.keys(def.fonts).length > 0, 'print 有自己独立的 fonts（不依赖隐式空对象）');
ok(Object.keys(def.post).length > 0, 'print 有自己独立的 post 基线');
ok(def.captions === false, 'print 默认**不开**字幕（显式写 captions: true 才开）');
ok(resolveStyle(false) === null, 'style: false → 显式关掉风格系统（返回 null）');

section('风格包：清单与形状');
const all = listStyles();
ok(all.length >= 5, `至少 5 套风格（实测 ${all.length} 套：${all.map((s) => s.name).join(' / ')}）`);
for (const [name, s] of Object.entries(STYLES)) {
  ok(!!s.label && !!s.note, `${name} 有 label 与 note（CLI/文档要读）`);
  ok(!!s.motif, `${name} 声明了背景母题（${s.motif}）`);
  // ⚠ 查的是**合并之后**的栅格（resolveStyle），不是风格包自己写的那份：
  //   mg15 那 15 套只覆盖 pad/top 这些差量，captionBand 由 GRID_BASE 补上 ——
  //   引擎读的也是合并后的那份（`gridFor()`），拿原始 pack 去断言就成了假红。
  const g = resolveStyle({ style: name }).grid;
  ok(!!g && Array.isArray(g.captionBand) && g.captionBand.length === 2,
    `${name} 有栅格与字幕带`);
}
// 每套风格必须显式声明底色或正文色
for (const [name, s] of Object.entries(STYLES)) {
  ok(!!(s.palette.ink || s.palette.bone), `${name} 显式声明了底色或正文色`);
}

section('风格包：合并与报错');
const paper = resolveStyle({ style: 'paper' });
ok(paper.name === 'paper' && paper.palette.ink === '#f3f0e7', "style: 'paper' → 纸面反色（ink 变浅）");
const tuned = resolveStyle({ style: { name: 'paper', grid: { pad: 160 } } });
ok(tuned.grid.pad === 160 && tuned.grid.footerY === GRID_BASE.footerY, '对象写法：局部覆盖 pad，其余沿用');
let threw = '';
try { resolveStyle({ style: '不存在的风格' }); } catch (e) { threw = String(e.message); }
ok(threw.includes('print') && threw.includes('paper'), '未知风格抛错，并列出可用风格（不静默）');
ok(gridFor(def, 1920, 1080) === def.grid, '1080p 下 gridFor 原样返回');
const half = gridFor(def, 1280, 720);
ok(half.captionBand[0] < GRID_BASE.captionBand[0], '720p 下栅格按比例缩小');

// 字幕带的位置是**引擎保留区**，风格包不该挪它（第一版把 terminal / noir 挪到底部，
// 出图当场看到字幕贴到画面下沿、第二行被裁掉一半）。这里钉住"必须在画面上半部"。
for (const [name] of Object.entries(STYLES)) {
  const cb = resolveStyle({ style: name }).grid.captionBand;
  ok(cb[0] >= 0 && cb[1] <= 400,
    `${name}.grid.captionBand 在画面上半部（实测 [${cb[0]}, ${cb[1]}]）—— 底部被模板与 kit 元件占满了`);
}

section('字幕层：开关语义');
ok(resolveCaptionStyle(null, null) === false, '没有风格、任务也没写 → 关');
ok(resolveCaptionStyle(null, true) !== false, 'captions: true → 开（用默认样式）');
ok(resolveCaptionStyle(null, { size: 60 }).size === 60, 'captions: {…} → 开并覆盖样式');
const paperStyle = resolveStyle({ style: 'paper' });
ok(resolveCaptionStyle(paperStyle, null) !== false, '风格包写了 captions → 这套风格默认开字幕');
ok(resolveCaptionStyle(paperStyle, false) === false, 'captions: false 能盖掉风格包的默认开');
ok(resolveCaptionStyle(null, true).karaoke === false,
  '默认**不做**逐词高亮（关键词突显那条对照实验的方向是负效应，见 captions.js 注释）');
// 这条是文档审计抓出来的真实不一致：风格包里的 CAPTIONS_BASE 一度把 karaoke 写成 true，
// 于是 print 之外的**四套风格全都默认开了逐词高亮**，与引擎默认和文档口径都相反。
// ⚠ 查的是**归一之后**的字幕样式（resolveCaptionStyle）：风格包只写"长什么样"的差量
//   （size / weight / bg），karaoke / hold / fade 由 DEFAULT_CAPTION_STYLE 在
//   `resolveCaptionStyle()` 里垫底 —— 拿风格包自己那份去断言，是把"没覆盖"误读成"改成了 undefined"。
for (const [name] of Object.entries(STYLES)) {
  const cs = resolveCaptionStyle(resolveStyle({ style: name }), null);
  if (!cs) continue;
  ok(cs.karaoke === DEFAULT_CAPTION_STYLE.karaoke,
    `${name}.captions.karaoke 与引擎默认一致（要开只能显式开）`);
  // 时间语义是**引擎契约**（说完留多久、淡变多长），风格包只该改"长什么样"（字号/底衬/颜色）
  ok(cs.hold === DEFAULT_CAPTION_STYLE.hold && cs.fade === DEFAULT_CAPTION_STYLE.fade,
    `${name}.captions 的 hold / fade 与引擎默认一致（风格不改时间语义）`);
}

/* ---------------------------------------------------------------- 整片介质 view */

section('风格包：整片介质 view（默认 off，2026-10-30 拍板）');
{
  // 底线：**所有没写 view 的风格必须解析成 null** —— 否则「上了这个字段」就等于
  // 顺手把全仓库的已交付画面换了一遍介质（这正是它当初需要用户拍板的原因）。
  ok(def.view === null, 'print 的 view 是 null（整片介质默认关）');
  let withView = 0;
  for (const [name] of Object.entries(STYLES)) {
    const s = resolveStyle({ style: name });
    if (s.view) withView++;
    else ok(s.view === null, `${name} 没声明 view ⇒ null（画面一个像素都不变）`);
  }
  ok(withView >= 1, `至少一套风格真的用了 view（实测 ${withView} 套）`);
  ok(withView < Object.keys(STYLES).length, 'view 不是默认开的（不是每套都配上）');

  // 三种写法
  const vStr = resolveStyle({ style: { name: 'paper', view: 'halftone' } }).view;
  ok(vStr && vStr.mode === 'halftone', "字符串写法：view: 'halftone' → { mode: 'halftone' }");
  const vObj = resolveStyle({ style: { name: 'paper', view: { mode: 'crt', cell: 4 } } }).view;
  ok(vObj && vObj.mode === 'crt' && vObj.cell === 4, '对象写法：字段原样保留（cell 不丢）');
  ok(resolveStyle({ style: { name: 'paper', view: false } }).view === null, 'view: false 能显式关掉风格包里的 view');
  ok(resolveStyle({ style: { name: 'h-riso' } }).view.mode === 'halftone', 'h-riso 的整片介质是 halftone（双版套印）');
  const risoView = resolveStyle({ style: { name: 'h-riso' } }).view;
  ok(risoView.passes === 2 && risoView.misreg > 0, 'h-riso 开了 N 版套印（passes 2 + 套准偏移 > 0）');
  ok(risoView.paper && risoView.ink, 'h-riso 显式点名了 paper/ink（浅底风格的调色板角色是反的，不点名会反相）');
  ok(resolveStyle({ style: { name: 'h-vhs' } }).view.mode === 'crt', 'h-vhs 的整片介质是 crt');

  // 写错必须**抛**（模式名一个字母错、画面照出 = 这种错不报出来等于没写）
  let threwView = '';
  try { resolveStyle({ style: { name: 'paper', view: { mode: 'haltfone' } } }); } catch (e) { threwView = String(e.message); }
  ok(threwView.includes('haltfone') && threwView.includes('halftone'), 'view.mode 写错抛错，并列出可用模式名');
  let threwView2 = '';
  try { resolveStyle({ style: { name: 'paper', view: 42 } }); } catch (e) { threwView2 = String(e.message); }
  ok(threwView2.length > 0, 'view 给了数字也必须抛（不静默当 null）');
}

section('风格包：胶片磨损参数（4.2，默认 0）');
{
  for (const [name, s] of Object.entries(STYLES)) {
    for (const k of ['weave', 'flicker', 'scratch']) {
      const v = s.post?.[k];
      if (v == null) continue;
      ok(Number.isFinite(v) && v >= 0 && v <= 2, `${name}.post.${k} = ${v} 合法（0..2 的有限数）`);
    }
  }
  const vhs = resolveStyle({ style: { name: 'h-vhs' } }).post;
  ok((vhs.weave ?? 0) > 0 && (vhs.flicker ?? 0) > 0 && (vhs.scratch ?? 0) > 0,
    'h-vhs 三件套都开了（这是 4.2 的演示风格）');
}

section('字幕层：时间语义与保留带');
const P = makePalette({});
const nar = makeNarrationReader(makeNarration({
  lines: [{ id: 'a', text: '这一句用来测字幕的时间语义。', start: 1, dur: 2 }],
}, { duration: 10 }));
const layer = makeCaptionLayer({
  narration: nar, style: { ...DEFAULT_CAPTION_STYLE }, P, W: 1920, H: 1080, grid: def.grid,
});
ok(layer.active(0.5) === null, '句子开始前：不显示');
ok(layer.active(1.5)?.line.id === 'a', '句子进行中：显示');
ok(layer.active(2.0).alpha > 0.95, '句子进行中：不透明度接近 1');
ok(layer.active(3.4)?.line.id === 'a', `说完之后仍停留 ${DEFAULT_CAPTION_STYLE.hold}s（观众还在读）`);
ok(layer.active(4.5) === null, '超出停留窗之后：消失');
const b = layer.band;
const cb = def.grid.captionBand;
ok(b.y0 === cb[0] && b.y1 === cb[1], '字幕带 y 取自风格栅格的 captionBand');
ok(b.x0 > 400 && b.x1 < 1520, `字幕带 x 只占中间一段（${b.x0}–${b.x1}），不横跨整幅`);
ok(Math.abs((b.x0 + b.x1) / 2 - 960) < 2, '字幕带水平居中');
// 默认在顶部：底部已经被模板的 readout / 页脚 / 说明条占满了（见 style/index.js 的注释）
ok(cb[1] <= 200, `默认字幕带在顶部（y ${cb[0]}–${cb[1]}），不与底部元件抢位置`);

section('风格包：防初始默认污染（Pass / post 基线 / 类型校验）');
{
  const glSrc = readFileSync(path.join(ROOT, 'src/core/gl.js'), 'utf8');
  const engSrc = readFileSync(path.join(ROOT, 'src/core/engine.js'), 'utf8');
  ok(/opts\.palette\s*\?\?\s*gl\?\.palette\s*\?\?\s*DEFAULT_PALETTE/.test(glSrc),
    'Pass 优先读取 gl?.palette 再回退 DEFAULT_PALETTE（C_INK/C_SIGNAL 随风格包走）');
  ok(/hit\.src\s*===\s*fragSrc/.test(glSrc),
    'GL.program 按 key 缓存时校对 fragSrc 一致性，不复用旧着色器');
  ok(/this\.gl\.palette\s*=\s*this\.P/.test(engSrc),
    'Engine 构造时把 P 挂到 gl.palette（先于 Post 与场景建 Pass）');
  ok(/post\s*=\s*\{\s*\.\.\.post,\s*\.\.\.\(ovObj\s*\?\?\s*\{\}\),\s*\.\.\.\(stylePost\s*\?\?\s*\{\}\),\s*\.\.\.\(item\.post\s*\?\?\s*\{\}\)\s*\}/.test(engSrc),
    'Engine.composite 按 DEFAULT → 场景 return → style.post → item.post 合并，且 return 为空时 stylePost 仍生效');

  const VALID_DITHER = new Set(['off', 'rpdf', 'tpdf']);
  const hexLum = (hex) => {
    const n = parseInt(String(hex).slice(1), 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  };
  const mgSans = new Set();
  for (const [name, s] of Object.entries(STYLES)) {
    const post = s.post ?? {};
    ok(post.dither === undefined || VALID_DITHER.has(post.dither),
      `${name}.post.dither 合法（非数字，实测 ${String(post.dither)}）`);
    ok(post.blur === undefined || post.blur === 0,
      `${name}.post.blur 为 undefined 或 0（不把径向缩放模糊焊进风格基线）`);
    ok(typeof post.halation === 'number' && Number.isFinite(post.halation),
      `${name}.post.halation 显式声明（不泄露 DEFAULT_POST.halation）`);
    const pal = makePalette(s.palette ?? {});
    if (hexLum(pal.hex.ink) > 0.5) {
      for (const k of ['bloom', 'halation', 'vignette', 'shoulder', 'ca']) {
        ok(typeof post[k] === 'number' && Number.isFinite(post[k]),
          `浅底 ${name}.post.${k} 显式声明（防深色电影默认泄露，实测 ${post[k]}）`);
      }
    }
    if (name.startsWith('mg-') && s.fonts?.sans) mgSans.add(s.fonts.sans);
  }
  ok(mgSans.size >= 3, `mg15 至少使用 3 套不同 sans 字体栈（实测 ${mgSans.size} 套）`);
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} 项通过${fail ? `，${fail} 项失败` : ''}`);
process.exit(fail ? 1 : 0);
