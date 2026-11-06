#!/usr/bin/env node
// @ts-check
/**
 * 场景离线自查夹具：用一套**假 ctx** 把整条时间轴的场景在 Node 里跑一遍。
 *
 *   node tools/scene-harness.mjs <任务名> [--times 0.5,3,7.5] [--scene hook,ctm] [--json] [-v]
 *
 * 它**不是渲染命令**：不起 Vite、不开 Chrome、不写仓库里的任何文件、不读像素。
 * 所以它可以在渲染跑着的时候随便跑，也适合给并行的写场景子代理当"提交前自查"。
 *
 * ## 它查什么（都不需要 GPU）
 *
 *   ① 跑场：`setup(ctx)` + 在若干时刻调 `render(ctx)`，任何抛错都点名到 `文件:行号`：
 *      未定义变量、类型错误、调了不存在的 API、拼错的字段（会静默变 undefined ⇒ NaN）。
 *   ② 确定性（引擎的地基）：同一时刻**连着渲两遍**，逐条比对绘制调用序列
 *      （lines / text / type / comp / Pass 的调用名 + 参数 + uniform 值）。
 *      不一致 = 场景里混进了 `Math.random` / `Date.now` / 逐帧累积状态。
 *      再渲一遍「同 t、不同 f.idx」：序列不同只报**警告** —— 逐帧抖动（grain）是合法用法。
 *   ③ 静态扫描：`Math.random(` / `Date.now(` / `performance.now(` / `new Date(` /
 *      `Math.floor(t*60)`（按帧抖帧）/ `this.x +=`（逐帧累积），给出 `文件:行号`。
 *   ④ 数值健全：NaN / ±Inf 出现在线坐标、文字坐标、post 返回值、**Pass 的 uniform** 里
 *      （uniform 是 undefined 也点名 —— 那是"整屏白/黑"最常见的根子）。
 *   ⑤ 骨架：画了线没 flush、写了字没 clear/upload/comp.draw、交叠期没铺满整帧、
 *      线批超过 6 万条被丢掉、文字出画、这一刻什么都没画。
 *
 * ## 它抓不到什么（诚实划界）
 *
 *   · **shader 编译错误**：没有 GLSL 编译器。只能查"重复声明 vUv/fragColor/t/…"、
 *     "又写了一次 #version"、"没有 void main()"这三类形状错误。
 *   · **像素**：亮度、过曝、色彩空间、几何朝向、遮挡、NaN 进帧缓冲 —— 一个都查不了，
 *     那是 `still` / `check` / `probe-raymarch` 的活。
 *   · **真的需要 GPU 的 setup**（Three.js 桥、自己建 WebGL 上下文）：会**跳过**并在报告里说明。
 *   · 引擎自己的镜头模板（`src/shots/*.js`）与 `src/kit/*` 不在扫描范围 —— 那不是这个任务的代码。
 *
 * ## 与三份原型的关系
 *
 * 上一轮（optifine）子代理各写了一份假 ctx 跑场器：`out/_staging/mock-render.mjs`（查几何/
 * 版面）、`out/_staging/check-scenes.mjs`（静态扫描 + import 一遍）、
 * `out/_staging/_scene-harness.mjs`（假 LineBatch + 文字框）、`out/_staging/sodium-scene-harness.mjs`
 * （写死的三段）。这个文件把它们合成一个：跑场 + 静态扫描 + 确定性比对三条都留下（原型各占一条），
 * 并补上四份原型都没有的：真 `Pass`/`RT`（用假 WebGL2 驱动，原型里 `new Pass` 一碰就炸）、
 * 引擎级共享背景与交叠期的 `ctx.under`、逐条绘制调用序列、`文件:行号` 归因、退出码。
 * 丢掉的：写死某个任务的东西（`tasks/optifine/audio/timing.mjs` 的 stretch/slot、
 * 写死的 `IDS = ['cull','hd','natural']`、写死的时刻表与"文案在第几秒出现"这类判据）——
 * 那些是**某一支片子的判据**，该写成任务自己的探针，不该长在通用工具里。
 *
 * ## 用法与耗时
 *
 * demo / example-config-only / _calib 三个任务实测 **1 秒以内**。写场景的子代理提交前跑一次：
 * `node tools/scene-harness.mjs <任务> --scene <你负责的段>`。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { makePalette } from '../src/core/palette.js';
import { GLSL_COMMON, RT } from '../src/core/gl.js';
import * as U from '../src/core/util.js';
import { frameSeed } from '../src/core/scene.js';
import { build, isConfigNode } from '../src/timeline.js';
import { MusicData, SILENT } from '../src/core/audio.js';
import { makeNarration, makeNarrationReader } from '../src/core/narration.js';
import { TextKit } from '../src/core/text.js';
import { polySpans, circleSpans } from '../src/core/fill.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 与任务无关的过程性提醒（读不到分析文件、调色板少名字…） */
const NOTES = [];

/* ══════════════════════════════════════════════════════════════ 命令行 */

const HELP = `场景离线自查（假 ctx 跑场：不碰 GPU、不写文件、不读像素）

  node tools/scene-harness.mjs <任务名> [选项]

选项
  --times 0.5,3,7.5   在这些**段内秒**上跑（每段自己的 0..时长）。不给就自动取
                      0 / 0.05 / 0.3 / 1s 与 1% · 12% · 30% · 50% · 70% · 86% · 99% 处
  --scene hook,ctm    只查这几段（段名 = HUD / --only 里用的那个；--only 是同义词）。
                      静态扫描与退出码都跟着一起收窄 —— 并行写场景时各查各的
  --json              输出机器可读结果（stdout 只有 JSON）
  -v, --verbose       把每一段的采样时刻与"这一刻画了多少"逐条打出来
  -h, --help          这段帮助

退出码
  0 = 没有错误（只有警告也算通过）    1 = 至少一处错误（抛错 / 不确定 / 静态违规）
`;

function parseArgs(argv) {
  const o = { task: null, times: null, scenes: null, json: false, verbose: false, help: false };
  const list = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '-v' || a === '--verbose') o.verbose = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--times') o.times = list(argv[++i]).map(Number);
    else if (a.startsWith('--times=')) o.times = list(a.slice(8)).map(Number);
    else if (a === '--scene' || a === '--only') o.scenes = list(argv[++i]);
    else if (a.startsWith('--scene=')) o.scenes = list(a.slice(8));
    else if (a === '--') continue;
    else if (a.startsWith('-')) throw new Error(`不认识的参数：${a}（-h 看用法）`);
    else if (!o.task) o.task = a;
    else throw new Error(`多余的位置参数：${a}（一次只查一个任务）`);
  }
  if (o.times && o.times.some((x) => !Number.isFinite(x) || x < 0)) {
    throw new Error('--times 只能是若干个非负秒数，例如 --times 0.5,3,7.5');
  }
  return o;
}

/* ══════════════════════════════════════════════════════════ 小工具 */

/** 打印用：浮点取到 1e-4（够看出"哪里不一样"，又不会被尾数噪声刷屏） */
const n4 = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? String(Number(v.toFixed(4))) : String(v)) : String(v));
/** 比较用：全精度 —— 确定性只关心"完全一样"，显示才需要好看 */
const rawOf = (v) => String(v);
const colSig = (c) => (Array.isArray(c) ? `[${c.map(n4).join(',')}]` : String(c));
const colRaw = (c) => (Array.isArray(c) ? `[${c.map(rawOf).join(',')}]` : String(c));

function finiteList(tag, vals, bad) {
  for (const v of vals) {
    if (typeof v === 'number' && !Number.isFinite(v)) { bad.push(`${tag} 出现了非有限值：${vals.map(n4).join(', ')}`); return; }
  }
}

/** 从错误里挖出"哪一行"：优先任务目录里的帧，其次第一帧非本工具的帧 */
function locOf(err, preferDir) {
  const st = String((err && err.stack) || '');
  const frames = [];
  for (const line of st.split('\n').slice(1)) {
    const m = /\(?((?:[A-Za-z]:)?[^()\s]+?\.m?js):(\d+):(\d+)\)?\s*$/.exec(line.trim());
    if (!m) continue;
    let f = m[1];
    try { if (f.startsWith('file:')) f = fileURLToPath(f); } catch { /* 保留原样 */ }
    if (f.includes('scene-harness.mjs')) continue;
    frames.push({ file: f, line: Number(m[2]), col: Number(m[3]) });
  }
  const hit = preferDir ? frames.find((f) => f.file.startsWith(preferDir)) : null;
  const pick = hit ?? frames[0] ?? null;
  if (!pick) return null;
  return { ...pick, rel: path.relative(ROOT, pick.file).split(path.sep).join('/') };
}

const errLine = (e) => String((e && e.message) || e).split('\n')[0];
const short = (s) => { const t = String(s); return t.length > 20 ? t.slice(0, 20) + '…' : t; };
/** 段内最后一帧的时刻（别落到段外） */
const lastFrame = (dur, fps) => Math.max(0, dur - 1 / fps);

/* ══════════════════════════════════════════════════════════ 静态扫描 */

/**
 * 把注释去掉再扫：注释里出现 `Math.random()` 是在解释"为什么不用它"（原型们的教训）。
 * 模板字符串**保留** —— GLSL 就住在里面，而 GLSL 里不会有 `this.x +=` 这种 JS 写法。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** 这一行属于哪个方法（只认顶格/两格缩进的方法名，够用了） */
function methodAt(lines, idx) {
  for (let i = idx; i >= 0; i--) {
    const m = /^\s{0,2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(lines[i]);
    if (m) return m[1];
  }
  return null;
}

const FORBIDDEN = [
  { re: /Math\.random\s*\(/g, level: 'error', kind: 'random', msg: 'Math.random() —— 一帧会被拆成多个子帧乱序渲染，每子帧都调一次 ⇒ 画面抖动。用 rng(seed) 在 setup 里预计算' },
  { re: /\bDate\.now\s*\(/g, level: 'error', kind: 'wallclock', msg: 'Date.now() —— 时间只能来自 f.t / f.lt' },
  { re: /\bperformance\.now\s*\(/g, level: 'error', kind: 'wallclock', msg: 'performance.now() —— 时间只能来自 f.t / f.lt' },
  { re: /\bnew Date\s*\(/g, level: 'error', kind: 'wallclock', msg: 'new Date() —— 时间只能来自 f.t / f.lt' },
  { re: /Math\.floor\s*\([^)]*\*\s*60\s*\)/g, level: 'warn', kind: 'frameflip', msg: 'Math.floor(t*60) 按帧抖帧 —— 一帧内所有子帧会取到不同值（双重曝光）。逐帧抖动要用 f.idx；手持感用 shakeSmooth(f.t, amp)' },
  { re: /\bthis\.[\w$]+\s*\+=/g, level: 'accum', kind: 'accumulate', msg: '逐帧累积状态（this.x += …）—— 子帧乱序、可任意 seek，累积值没有意义。把位置写成时间的函数：x = f(t - birth)' },
  { re: /\bthis\.[\w$]+\s*=\s*this\.[\w$]+\s*\+/g, level: 'accum', kind: 'accumulate', msg: '逐帧累积状态（this.x = this.x + …）—— 同上' },
  { re: /\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/g, level: 'warn', kind: 'async', msg: 'render 里起异步 / 定时器 —— render 必须是同步的纯函数，异步改状态会让每一帧都不一样' },
];

/** 扫一个文件，返回 findings（带 文件:行号 + 所在方法） */
function scanSource(file, rel) {
  const src = readFileSync(file, 'utf8');
  const code = stripComments(src);
  const lines = code.split('\n');
  const rawLines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const f of FORBIDDEN) {
      f.re.lastIndex = 0;
      let m;
      while ((m = f.re.exec(line))) {
        const method = methodAt(lines, i);
        let level = f.level;
        // `this.x += ` 在 setup 里是正常的预计算；在 render/draw 里才是逐帧累积。
        if (level === 'accum') level = method === 'render' || method === 'draw' ? 'error' : method === 'setup' ? 'skip' : 'warn';
        if (level === 'skip') continue;
        out.push({
          file: rel, line: i + 1, col: m.index + 1, level, kind: f.kind, method,
          message: f.msg, snippet: rawLines[i].trim().slice(0, 120),
        });
      }
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════ GLSL 形状检查 */

/**
 * `Pass` 会把自己的 frag 拼成 `#version 300 es` + 调色板 + `GLSL_COMMON` + 你的 frag。
 * 没有 GLSL 编译器，但"重复声明"这一类形状错误能在拼好的源码上直接查出来 ——
 * `AGENTS.md` §8 把"不要重复声明 vUv/fragColor/t/res"列成高频坑。
 */
const GLSL_COMMON_NAMES = ['vUv', 'fragColor', 't', 'dt', 'res', 'PX_SCALE', 'RES_LOGICAL'];
function glslShapeCheck(key, fullSrc) {
  const i = fullSrc.indexOf(GLSL_COMMON);
  if (i < 0) return [];                                   // 不是引擎拼的 src（自己 new Pass 的变体）
  const frag = fullSrc.slice(i + GLSL_COMMON.length);
  const out = [];
  if (/^\s*#version/m.test(frag)) out.push(`Pass "${key}" 的 frag 里又写了一次 #version（引擎已经加过 #version 300 es）`);
  for (const n of GLSL_COMMON_NAMES) {
    const re = new RegExp(`^\\s*(?:in|out|uniform)\\s+\\w+\\s+${n}\\s*;`, 'm');
    if (re.test(frag)) out.push(`Pass "${key}" 的 frag 里重复声明了 ${n}（GLSL_COMMON 已经提供）—— shader 会编译失败`);
  }
  if (!/void\s+main\s*\(/.test(frag)) out.push(`Pass "${key}" 的 frag 里没有 void main()`);
  return out;
}

/* ══════════════════════════════════════════════════ 假 GPU（WebGL2 桩） */

/**
 * 最小的 WebGL2 替身。**够真的 `Pass` / `RT` 跑起来** —— 这是与原型最大的区别：
 * 原型只桩了 lines/text/comp，任何 `new Pass(...)` 的场景一碰就炸；这里让引擎自己的
 * `Pass`/`RT`（`src/core/gl.js`）原样工作，于是 `pass.u.k.value = x`、`pass.set()`、
 * 延迟编译、uniform 值是 undefined 时的点名（`Pass._warnUniform` 走 console.warn）全都保留，
 * 只是"最后一笔"从不真的画 —— 画到 `gl.blit` 时被记进绘制序列。
 */
class FakeWebGL2 {
  constructor(owner) {
    this.__owner = owner;
    this.__prog = null;
    Object.assign(this, {
      VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
      ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893, STATIC_DRAW: 0x88e4, DYNAMIC_DRAW: 0x88e8,
      FLOAT: 0x1406, UNSIGNED_BYTE: 0x1401, UNSIGNED_SHORT: 0x1403, HALF_FLOAT: 0x140b,
      TRIANGLES: 0x0004, LINES: 0x0001, BLEND: 0x0be2, DEPTH_TEST: 0x0b71, CULL_FACE: 0x0b44, SCISSOR_TEST: 0x0c11,
      FUNC_ADD: 0x8006, MAX: 0x8008, MIN: 0x8007, ONE: 1, ZERO: 0, SRC_ALPHA: 0x0302,
      ONE_MINUS_SRC_ALPHA: 0x0303, SRC_COLOR: 0x0300, DST_COLOR: 0x0306,
      RGBA: 0x1908, RGB: 0x1907, RGBA8: 0x8058, RGBA16F: 0x881a, SRGB8_ALPHA8: 0x8c43,
      TEXTURE_2D: 0x0de1, TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, CLAMP_TO_EDGE: 0x812f,
      NEAREST: 0x2600, LINEAR: 0x2601, TEXTURE0: 0x84c0,
      FRAMEBUFFER: 0x8d40, RENDERBUFFER: 0x8d41, COLOR_ATTACHMENT0: 0x8ce0,
      DEPTH_ATTACHMENT: 0x8d00, DEPTH_COMPONENT16: 0x81a5, FRAMEBUFFER_COMPLETE: 0x8cd5,
      COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x0100, NO_ERROR: 0,
      UNPACK_FLIP_Y_WEBGL: 0x9240, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
      RENDERER: 0x1f01, VENDOR: 0x1f00, VERSION: 0x1f02, MAX_TEXTURE_SIZE: 0x0d33,
    });
    this.__n = 0;
  }
  _obj(kind) { return { __gl: kind, id: ++this.__n }; }
  createShader() { return this._obj('shader'); }
  createProgram() { const p = this._obj('program'); p.__values = {}; return p; }
  createTexture() { return this._obj('texture'); }
  createFramebuffer() { return this._obj('fbo'); }
  createRenderbuffer() { return this._obj('rbo'); }
  createBuffer() { return this._obj('buffer'); }
  createVertexArray() { return this._obj('vao'); }
  shaderSource() {} compileShader() {} attachShader() {} linkProgram() {} bindAttribLocation() {}
  deleteShader() {} deleteProgram() {} deleteTexture() {} deleteBuffer() {} deleteVertexArray() {}
  getShaderParameter() { return true; }        // 不编译 ⇒ 永远"成功"（编译错误抓不到，见文件头）
  getProgramParameter() { return true; }
  getShaderInfoLog() { return ''; }
  getProgramInfoLog() { return ''; }
  getAttribLocation() { return 0; }
  getExtension() { return null; }
  getParameter(p) { return typeof p === 'number' ? String(p) : null; }
  checkFramebufferStatus() { return this.FRAMEBUFFER_COMPLETE; }
  /** uniform 位置带名字：这样 `uniform1f(loc, v)` 能把值记回程序对象，做确定性比对 */
  getUniformLocation(prog, name) { return { __loc: true, prog, name }; }
  useProgram(p) { this.__prog = p; }
  _set(loc, v) { if (loc && loc.__loc && loc.prog) loc.prog.__values[loc.name] = v; }
  uniform1f(loc, v) { this._set(loc, v); }
  uniform1i(loc, v) { this._set(loc, v); }
  uniform2f(loc, a, b) { this._set(loc, [a, b]); }
  uniform3f(loc, a, b, c) { this._set(loc, [a, b, c]); }
  uniform4f(loc, a, b, c, d) { this._set(loc, [a, b, c, d]); }
  uniform1fv(loc, v) { this._set(loc, Array.from(v)); }
  uniformMatrix3fv(loc, t, v) { this._set(loc, Array.from(v)); }
  uniformMatrix4fv(loc, t, v) { this._set(loc, Array.from(v)); }
  bindTexture() {} activeTexture() {} texImage2D() {} texSubImage2D() {} texParameteri() {}
  pixelStorei() {} bindFramebuffer() {} framebufferTexture2D() {} framebufferRenderbuffer() {}
  renderbufferStorage() {} bindRenderbuffer() {} viewport() {} clearColor() {} clear() {}
  enable() {} disable() {} blendEquation() {} blendFunc() {} blendFuncSeparate() {}
  bindVertexArray() {} bindBuffer() {} bufferData() {} bufferSubData() {}
  enableVertexAttribArray() {} vertexAttribPointer() {} drawArrays() {} drawElements() {}
  readPixels() {} finish() {} flush() {}
}

/**
 * 假的 `GL`：字段与真 `GL` 同名（w/h/pw/ph/scale/ctx/paint/program/uniform/blit/clear），
 * 于是引擎的 `Pass`/`RT` 与场景里的 `const { W, H } = gl` 都能原样工作。
 */
class FakeGL {
  constructor({ w, h, scale, owner }) {
    this.w = w; this.h = h; this.scale = scale;
    this.pw = Math.round(w * scale); this.ph = Math.round(h * scale);
    this.ctx = new FakeWebGL2(owner);
    this.programs = new Map();
    this.paint = null;
    this.__owner = owner;
    this.renderer = 'scene-harness（无 GPU）';
    this.rendererInfo = { renderer: this.renderer, unmaskedRenderer: this.renderer, unmasked: false };
    this.rendererLabel = this.renderer;
  }
  get W() { return this.w; }
  get H() { return this.h; }
  get PW() { return this.pw; }
  get PH() { return this.ph; }
  get aspect() { return this.w / this.h; }

  /** 与引擎 `GL._notePaint` 同口径：`blend:false && !noFull` 才算"铺满整帧" */
  _notePaint(g, target, opts = {}) {
    const p = this.paint;
    if (!p) return;
    const blend = opts.blend ?? false;
    if (!blend && !opts.noFull) p.full++;
    p.any++;
    if (p.target && p.target !== target) p.other++;
  }

  clear(rt, color = [0, 0, 0], alpha = 1) {
    const rec = this.__owner.rec;
    if (!rec) return;
    finiteList('gl.clear 颜色', color, rec.problems);
    rec.add(`gl.clear(${nameOfTarget(rt)}, [${colSig(color)}])`, `gl.clear(${nameOfTarget(rt)},[${colRaw(color)}])`);
    rec.stats.clears++;
    // 用非黑色铺满整帧 = 真的给了这一段一个底（纯黑 clear 不算：引擎自己就会先清黑）
    if (Array.isArray(color) && (color[0] > 0.002 || color[1] > 0.002 || color[2] > 0.002)) rec.stats.inkClear = true;
  }

  program(key, src) {
    const hit = this.programs.get(key);
    if (hit) return hit;
    const p = this.ctx.createProgram();
    p.__key = key;
    const prog = { program: p, uniforms: new Map(), key, src };
    this.programs.set(key, prog);
    const rec = this.__owner.rec;
    if (rec) rec.add(`pass.new(${key})`, `pass.new(${key})`);
    const probe = this.__owner.curProbe;
    if (probe) for (const m of glslShapeCheck(key, src)) {
      if (!probe.warnings.some((w) => w.message === m)) probe.warnings.push({ kind: 'glsl', message: m });
    }
    return prog;
  }

  uniform(prog, name) { return this.ctx.getUniformLocation(prog.program, name); }

  /** 真 `Pass.render` 的最后一步；这里只记账 + 记 uniform 快照 */
  blit(target = null, opts = {}) {
    const rec = this.__owner.rec;
    const p = this.ctx.__prog;
    const key = (p && p.__key) || '?';
    if (rec) {
      const us = (p && p.__values) || {};
      const names = Object.keys(us).sort();
      const sig = names.map((n) => `${n}=${summ(us[n], n4)}`).join(' ');
      const raw = names.map((n) => `${n}=${summ(us[n], rawOf)}`).join(' ');
      rec.add(`pass.draw(${key}${sig ? ' ' + sig : ''})`, `pass.draw(${key}${raw ? ' ' + raw : ''})`);
      rec.stats.passes++;
      rec.stats.passKeys.add(key);
      // 数组里的 NaN/Inf 是 `_warnUniform` 查不到的（它只看 `typeof v === 'number'`）
      for (const n of names) finiteList(`uniform ${n}`, Array.isArray(us[n]) ? us[n] : [us[n]], rec.problems);
    }
    this._notePaint(this.ctx, target, opts);
  }

  readPixels() { throw new Error('scene-harness 不读像素（离线跑场没有 GPU 缓冲）'); }
  resize() { return this; }
}

/** 值的摘要：数字走 n4/rawOf，数组折成 `[len:…]`，纹理说成 tex */
function summ(v, f) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'number') return f(v);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return JSON.stringify(v.length > 24 ? v.slice(0, 24) + '…' : v);
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const a = Array.from(/** @type {any} */ (v));
    return `[${a.length}:${a.slice(0, 4).map(f).join(',')}${a.length > 4 ? ',…' : ''}]`;
  }
  if (v && (v.__tex || v.tex)) return 'tex';
  return `{${Object.keys(v).slice(0, 3).join(',')}}`;
}

const nameOfTarget = (t) => (!t ? 'canvas' : t.__tag || (t.__textLayer ? 'text' : 'rt'));

/* ══════════════════════════════════════════════════ 假绘制层（lines/text） */

const CAPACITY = 60000;    // 与 src/core/engine.js 的 `new LineBatch(gl, 60000)` 一致

/**
 * 假 `LineBatch`。**必须写成 class**：任务的 `_kit.js` 会照引擎的写法往实例上挂
 * `_push`/`flush`（那种"排完队再 delete 掉"的技巧），自有属性被删掉之后要能落回原型上的
 * 原版 —— 用普通对象字面量会在这里崩（原型 `_scene-harness.mjs` 踩过）。
 */
class FakeLines {
  constructor(owner) { this.__owner = owner; this.__n = 0; this.dropped = 0; }
  get __rec() { return this.__owner.rec; }

  begin() { this.__n = 0; const rec = this.__rec; if (rec) { rec.add('lines.begin', 'lines.begin'); rec.stats.batches++; } return this; }

  _push(ax, ay, bx, by, width, color) {
    const rec = this.__rec;
    if (this.__n >= CAPACITY) { this.dropped++; return this; }   // 引擎：满了就丢（quietly）
    this.__n++;
    if (!rec) return this;
    rec.add(
      `lines.seg(${n4(ax)},${n4(ay)},${n4(bx)},${n4(by)},${n4(width)},${colSig(color)})`,
      `lines.seg(${rawOf(ax)},${rawOf(ay)},${rawOf(bx)},${rawOf(by)},${rawOf(width)},${colRaw(color)})`,
    );
    rec.stats.segs++;
    finiteList('lines.seg 坐标', [ax, ay, bx, by, width], rec.problems);
    if (!Array.isArray(color) || color.length < 3) rec.problems.push(`lines 的颜色不是 [r,g,b]：${JSON.stringify(color)}`);
    else finiteList('lines 颜色', color, rec.problems);
    // "整段都画到画面外"：摄影机跑飞、或者整层被挪走了。
    // 判据刻意放得很松（九成以上完全在画面外才报），免得把刻意的入场位移误判成错误。
    const m = 40;
    if (Math.min(ax, bx) > rec.W + m || Math.max(ax, bx) < -m || Math.min(ay, by) > rec.H + m || Math.max(ay, by) < -m) {
      rec.stats.segsOutside++;
    }
    // 包围盒：用来发现"坐标单位写错"——0..1 的归一化坐标当像素用，80 条线会全挤在左上角一小块
    const b = rec.stats.bbox;
    if (ax < b.x0) b.x0 = ax; if (ax > b.x1) b.x1 = ax;
    if (ay < b.y0) b.y0 = ay; if (ay > b.y1) b.y1 = ay;
    if (bx < b.x0) b.x0 = bx; if (bx > b.x1) b.x1 = bx;
    if (by < b.y0) b.y0 = by; if (by > b.y1) b.y1 = by;
    return this;
  }
  seg(ax, ay, bx, by, width = 1, color = [1, 1, 1]) { return this._push(ax, ay, bx, by, width, color); }
  band(x0,x1,y,h,color) { return this._push(x0,y,x1,y,-Math.abs(h),color); }
  fillPoly(pts,color=[1,1,1],step=1) {
    for(const s of polySpans(pts,step)) this.band(s.x,s.x+s.w,s.y,s.h,color);
    return this;
  }
  fillCircle(x,y,r,color=[1,1,1],step=1) {
    for(const s of circleSpans(x,y,r,step)) this.band(s.x,s.x+s.w,s.y,s.h,color);
    return this;
  }

  polyline(pts, width = 1, color = [1, 1, 1], closed = false) {
    if (!Array.isArray(pts)) { this.__rec?.problems.push('polyline 的 pts 不是数组'); return this; }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (!Array.isArray(a) || !Array.isArray(b)) { this.__rec?.problems.push('polyline 的点不是 [x, y]'); break; }
      this._push(a[0], a[1], b[0], b[1], width, color);
    }
    if (closed && pts.length > 2) this._push(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], width, color);
    return this;
  }
  circle(cx, cy, r, width = 1, color = [1, 1, 1], segs = 48) {
    const rec = this.__rec;
    if (rec) {
      rec.add(`lines.circle(${n4(cx)},${n4(cy)},${n4(r)},${n4(width)},${colSig(color)},${segs})`,
        `lines.circle(${rawOf(cx)},${rawOf(cy)},${rawOf(r)},${rawOf(width)},${colRaw(color)},${segs})`);
      rec.stats.circles++;
    }
    const pts = [];
    for (let i = 0; i <= segs; i++) { const a = (i / segs) * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return this.polyline(pts, width, color);
  }
  rect(x, y, w, h, width = 1, color = [1, 1, 1]) {
    return this.polyline([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], width, color, true);
  }
  tick(x, y, len = 8, width = 1, color = [1, 1, 1], angle = 0) {
    const dx = Math.cos(angle) * len * 0.5, dy = Math.sin(angle) * len * 0.5;
    return this._push(x - dx, y - dy, x + dx, y + dy, width, color);
  }
  /** 与引擎同口径：沿 y 铺横线，步进 step（默认 2 逻辑像素） */
  fillRect(x, y, w, h, color = [1, 1, 1], step = 2) {
    const rec = this.__rec;
    if (!(w > 0) || !(h > 0)) {
      // ⚠ 只报警告，不报错：引擎对这种调用是"画一条 0.5px 的细线"，而"从 0 长出来"的
      //   第一帧本来就会传 h=0（optifine 的 multicore 就是这样）—— 那是刻意的，不是 bug。
      if (rec && !rec.stats.zeroRects) rec.stats.zeroRects = `${n4(w)}×${n4(h)}`;
      return this;
    }
    const s = Math.max(0.5, step);
    const n = Math.max(1, Math.ceil(h / s));
    const dy = h / n;
    if (rec) { rec.stats.fills++; if (w * h >= 0.9 * rec.W * rec.H) rec.stats.bigFill = true; }
    for (let i = 0; i < n; i++) this._push(x, y + i * dy + dy * 0.5, x + w, y + i * dy + dy * 0.5, dy + 0.5, color);
    return this;
  }
  flush(target = null) {
    const rec = this.__rec;
    const n = this.__n;
    this.__n = 0;
    if (this.dropped && rec) { rec.problems.push(`线批超过 ${CAPACITY} 条，有 ${this.dropped} 条被静默丢掉（引擎的行为：宁可少画不要崩）`); this.dropped = 0; }
    if (!rec) return n;
    rec.add(`lines.flush(${nameOfTarget(target)},${n})`, `lines.flush(${nameOfTarget(target)},${n})`);
    rec.stats.flushes++;
    if (n > 0) { rec.paint.any++; rec.paint.lines++; }   // 引擎：flush 是带混合的绘制，不算"铺满整帧"
    return n;
  }
  dispose() {}
}

/** 粗估字宽：CJK / 全角标点按 1.0em，其余按 0.55em（偏保守，宁可高估） */
function estW(s, size = 64, tracking = 0) {
  const chars = [...String(s)];
  let w = 0;
  for (const ch of chars) w += /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/.test(ch) ? size : size * 0.55;
  return w + Math.max(0, chars.length - 1) * tracking;
}

/** `css()` 出来的 'rgba(r,g,b,a)' —— 透明度藏在颜色里，不解析它就会把"已经淡到 0"的字算成还在画 */
function alphaOfColor(c) {
  if (typeof c !== 'string') return 1;
  const m = /rgba?\(([^)]*)\)/.exec(c);
  if (!m) return 1;
  const parts = m[1].split(',').map((v) => Number(v.trim()));
  return parts.length >= 4 && Number.isFinite(parts[3]) ? parts[3] : 1;
}

const OPT_KEYS = ['size', 'weight', 'family', 'color', 'alpha', 'align', 'anchor', 'stagger', 'staggerDur', 't', 'from', 'tracking'];
const optSig = (o, f) => OPT_KEYS.filter((k) => o[k] !== undefined).map((k) => `${k}:${summ(o[k], f)}`).join(',');

/** 假 `TextKit`：镜像真实现的**可见性语义**（k ≤ 0 的字形根本不画） */
class FakeTextKit {
  constructor(owner) { this.__owner = owner; }
  // Run the real trigger/clip calculation; fake Canvas only records its geometry.
  withSize(style) { return style; }
  reveal(text,x,y,opts) { return TextKit.prototype.reveal.call(this,text,x,y,opts); }
  get __rec() { return this.__owner.rec; }
  setFamilies() { return this; }
  font(style = {}) { return `${style.size ?? 64}px`; }
  measure(text, style = {}) { return estW(text, style.size ?? 64, style.tracking ?? 0); }
  layout(text, style = {}) {
    const clusters = [...String(text)];
    const tracking = style.tracking ?? 0;
    const cum = new Array(clusters.length + 1);
    const x = new Array(clusters.length);
    let n = 0;
    for (let i = 0; i < clusters.length; i++) {
      cum[i] = n; x[i] = n + i * tracking;
      n += estW(clusters[i], style.size ?? 64, 0);
    }
    cum[clusters.length] = n + Math.max(0, clusters.length - 1) * tracking;
    return { clusters, cum, x };
  }
  /** 与真 write 同构的可见性判断，再把"这一笔字"记进绘制序列 */
  write(text, x, y, opts = {}) {
    const rec = this.__rec;
    const str = String(text);
    const size = opts.size ?? 64;
    const stagger = opts.stagger ?? 0;
    const dur = opts.staggerDur ?? 0.45;
    const t = opts.t ?? 0;
    const ramp = Array.isArray(opts.alpha);
    const constAlpha = ramp ? 1 : U.clamp(opts.alpha ?? 1);
    const perGlyph = stagger > 0 || ramp;
    const clusters = [...str];
    let glyphs = 0;
    let alphaMax = 0;
    for (let i = 0; i < clusters.length; i++) {
      const k = perGlyph ? U.sat((t - i * stagger) / dur) : 1;
      if (k <= 0) continue;                       // 引擎：k ≤ 0 是"整个字形不画"，不是画成透明
      glyphs++;
      const a = ramp ? U.lerp(opts.alpha[0], opts.alpha[1], k) : constAlpha;
      if (a > alphaMax) alphaMax = a;
    }
    if (glyphs === 0) {
      // ⚠ 空串不算"字形被跳过"：打字机效果（`str.slice(0, k)`）在开头本来就会写一个空串，
      //   引擎那边也只是 fillText('') —— 不是"这块字不见了"。
      if (rec && str.length > 0) { rec.stats.invisibleText++; rec.stats.writes.push({ s: str, drawn: false }); }
      return this;
    }
    if (!rec) return this;
    rec.stats.writes.push({ s: str, drawn: true });
    rec.add(`type.write("${short(str)}",${n4(x)},${n4(y)},${optSig(opts, n4)},${glyphs}字)`,
      `type.write(${JSON.stringify(str)},${rawOf(x)},${rawOf(y)},${optSig(opts, rawOf)},${glyphs})`);
    rec.stats.texts++;
    rec.stats.glyphs += glyphs;
    finiteList('type.write 坐标', [x, y, size], rec.problems);
    if (opts.color !== undefined && typeof opts.color !== 'string') {
      rec.problems.push(`type.write 的颜色不是字符串（先用 css(P.x) 包一下）：「${short(str)}」→ ${JSON.stringify(opts.color)}`);
    }
    this.__box(str, x, y, opts, glyphs, alphaMax * alphaOfColor(opts.color));
    return this;
  }
  writeLine(text, x, y, opts = {}) {
    const w = this.measure(text, opts);
    const anchor = opts.anchor ?? 'left';
    // 与引擎同构（`src/core/text.js` 的 `writeLine` 现在就是一层转发到 `write`）：
    // 锚点直接变成 `align`，由 `write()` 按整行算偏移。
    this.write(text, x, y, { ...opts, align: anchor });
    return w;
  }
  karaoke(text, words, x, y, t, opts = {}) {
    const rec = this.__rec;
    const str = String(text);
    const n = Array.isArray(words) ? words.length : 0;
    if (rec) {
      rec.add(`type.karaoke("${short(str)}",${n}词,${n4(x)},${n4(y)},${n4(t)})`,
        `type.karaoke(${JSON.stringify(str)},${n},${rawOf(x)},${rawOf(y)},${rawOf(t)})`);
      rec.stats.texts++;
      rec.stats.glyphs += [...str].length;
    }
    this.__box(str, x, y, opts, [...str].length, alphaOfColor(opts.color));
    return this;
  }
  wrap(text, style = {}, maxWidth = 1200) {
    const out = [];
    for (const para of String(text).split('\n')) {
      let cur = '';
      for (const tk of para.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]|\S+\s*|\s+/g) ?? [para]) {
        const test = cur + tk;
        if (cur && this.measure(test, style) > maxWidth) { out.push(cur.trimEnd()); cur = tk.trimStart(); }
        else cur = test;
      }
      out.push(cur.trimEnd());
    }
    return out;
  }
  paragraph(text, x, y, style = {}, opts = {}) {
    const rec = this.__rec;
    if (rec) rec.add(`type.paragraph("${short(text)}",${n4(x)},${n4(y)})`, `type.paragraph(${JSON.stringify(String(text))},${rawOf(x)},${rawOf(y)})`);
    return this;
  }
  writeOnPath(text, pts, style = {}, opts = {}) {
    const rec = this.__rec;
    const n = Array.isArray(pts) ? pts.length : 0;
    if (rec) rec.add(`type.writeOnPath("${short(text)}",${n}点)`, `type.writeOnPath(${JSON.stringify(String(text))},${n})`);
    return this;
  }
  clearCache() {}

  /**
   * 出画判定：只算"还看得见"的那一笔（alpha > 0.03）。
   *
   * ⚠ 包围盒必须按引擎的 `align` 语义算。**2026-10-24 起引擎的 align 是「整行」的**
   * （`src/core/text.js` 的 `write()`：内部一律按 left 摆字，再把整行宽度那一份偏移
   * 加进 x）—— 所以三种写法与 `writeLine(..., { anchor })` 完全等价：
   *   align:'left'   → [x, x + w]
   *   align:'right'  → [x - w, x]          （chart 右上角那个读数就是这么写的）
   *   align:'center' → [x - w/2, x + w/2]
   *
   * 历史：在这之前引擎是**逐字**生效的（align:'center' ⇒ 整行右移半个字宽），
   * 这一层也照着那个错误语义算过 —— 于是它只能"忠实地"把错的包围盒报出来
   * （demo 的 kinetic 一直报「文字长期出画」，那既是真 bug，又被这条判据看见）。
   * 引擎修好之后这里必须跟着改，否则判据会开始误报。
   */
  __box(text, x, y, opts, glyphs, alpha) {
    const rec = this.__rec;
    if (!rec || glyphs === 0) return;
    const str = String(text);
    if (glyphs < [...str].length) return;          // 逐字入场中途：整体包围盒没有意义
    rec.stats.textCalls++;
    if (!Number.isFinite(alpha) || alpha <= 0.03) return;
    const size = opts.size ?? 64;
    const w = estW(str, size, opts.tracking ?? 0);
    const align = opts.align ?? 'left';
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    const x1 = align === 'center' ? x + w / 2 : align === 'right' ? x : x + w;
    rec.stats.visibleTexts++;
    // y 用**基线**±三分之一字高，而不是整块字形框：引擎是 alphabetic 基线，`y = 32` 这种
    // 贴着上边缘的标注再叠上"ascender 估计"就会变成 -22、被误判出画（optifine 的 hook 就是这样）。
    // 真正的出画是"基线整个跑到画布外"，那才值得报。
    const box = { s: str, x0, x1, y0: y - size * 0.35, y1: y + size * 0.35, size };
    // 容差 2%（宽度是估的，不是量的）：24px 的擦边不值得当问题报，100px+ 的才值得
    const tx = Math.max(12, 0.02 * rec.W), ty = Math.max(12, 0.02 * rec.H);
    const off = box.x0 < -tx || box.x1 > rec.W + tx || box.y0 < -ty || box.y1 > rec.H + ty;
    // 逐**时刻**记，最后按"这行字是不是**一直**在画外"下结论 —— 入场/出场位移会让一行字
    // 在某一刻跑到画外，那是正常的（sodium/optifine 的成品里就有好几处）。
    rec.stats.boxes.push({ s: str, off, x0: box.x0, x1: box.x1, y0: box.y0 });
    if (off) rec.stats.offFrame.push(box);
  }
}

/** 假的最小 Canvas2D：只为了让"直接往 text.ctx 上画"的场景不炸（记调用名，不画） */
class Fake2D {
  constructor(owner) { this.__owner = owner; }
  save() {} restore() {} clearRect() {} beginPath() {} closePath() {} rect() {} clip() {}
  arc() {} moveTo() {} lineTo() {} stroke() {} fill() {} translate() {} rotate() {} scale() {}
  setTransform() {} resetTransform() {} createPattern() { return null; } putImageData() {}
  drawImage(...a) { this.__owner.rec?.add(`text.ctx.drawImage(${a.length} 参数)`, `text.ctx.drawImage(${a.length})`); }
  fillText(s, x, y) {
    this.__owner.rec?.add(`text.ctx.fillText("${short(s)}",${n4(x)},${n4(y)})`, `text.ctx.fillText(${JSON.stringify(String(s))},${rawOf(x)},${rawOf(y)})`);
  }
  strokeText() {}
  measureText(s) { return { width: estW(s, 64) }; }
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  getImageData() { return { data: new Uint8ClampedArray(4), width: 1, height: 1 }; }
}

/** 假 `Layer2D`（文字图层）—— 引擎一景一层，这里也一样 */
class FakeTextLayer {
  constructor(owner, W, H, scale) {
    this.__owner = owner;
    this.w = W; this.h = H; this.scale = scale;
    this.canvas = { width: Math.round(W * scale), height: Math.round(H * scale) };
    this.ctx = new Fake2D(owner);
    this.tex = { __textLayer: true };
    this.__tex = true;
    this.__textLayer = true;
    this.__tag = 'text';
    this.dirty = true;
    this._uploaded = false;
    this.type = new FakeTextKit(owner);
    this.type.ctx = this.ctx;
  }
  get __rec() { return this.__owner.rec; }
  clear() { this._uploaded = false; const rec = this.__rec; if (rec) { rec.add('text.clear', 'text.clear'); rec.stats.textClears++; } return this; }
  fill(color) { const rec = this.__rec; if (rec) { rec.add(`text.fill(${summ(color, n4)})`, `text.fill(${summ(color, rawOf)})`); rec.stats.bigFill = true; } return this; }
  upload() { this._uploaded = true; const rec = this.__rec; if (rec) { rec.add('text.upload', 'text.upload'); rec.stats.uploads++; } return this; }
  resize() { return this; }
  dispose() {}
}

/** 假 `Compositor`：只记"叠了哪一层、什么模式" */
class FakeComp {
  constructor(owner) { this.__owner = owner; }
  draw(gl, tex0, target, opts = {}) {
    const rec = this.__owner.rec;
    if (!rec) return this;
    const sig = [`mode:${opts.mode ?? 'normal'}`, `opacity:${n4(opts.opacity ?? 1)}`, opts.premult ? 'premult' : 'straight',
      Array.isArray(opts.rect) ? `rect:[${opts.rect.map(n4).join(',')}]` : ''].filter(Boolean).join(',');
    const raw = [`mode:${opts.mode ?? 'normal'}`, `opacity:${rawOf(opts.opacity ?? 1)}`, opts.premult ? 1 : 0,
      Array.isArray(opts.rect) ? `rect:[${opts.rect.map(rawOf).join(',')}]` : ''].filter(Boolean).join(',');
    rec.add(`comp.draw(${nameOfTarget(tex0)}→${nameOfTarget(target)},${sig})`, `comp.draw(${nameOfTarget(tex0)}→${nameOfTarget(target)},${raw})`);
    rec.stats.comps++;
    rec.paint.any++;
    return this;
  }
}

/* ══════════════════════════════════════════════════ 一次 render 的记账 */

class Rec {
  constructor(W, H) {
    this.W = W; this.H = H;
    this.raw = []; this.sig = [];
    this.problems = [];
    this.paint = { full: 0, any: 0, lines: 0, target: null, other: 0 };
    this.stats = {
      segs: 0, segsOutside: 0, batches: 0, flushes: 0, circles: 0, fills: 0, bigFill: false, inkClear: false,
      texts: 0, glyphs: 0, textCalls: 0, visibleTexts: 0, invisibleText: 0, uploads: 0, textClears: 0,
      comps: 0, passes: 0, clears: 0, offFrame: [], boxes: [], passKeys: new Set(), writes: [], zeroRects: null,
      bbox: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
    };
  }
  add(sig, raw) { this.sig.push(sig); this.raw.push(raw); }
}

function firstDiff(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return { i, a: a[i], b: b[i], lenA: a.length, lenB: b.length };
  return null;
}

/* ══════════════════════════════════════════════════════════ ctx 构造 */

/** 引擎 `SceneCtx` 的字段（`src/core/engine.js` 的 `_ctxFor`）+ 近两轮加的 world/grid/style/captions */
const CTX_KEYS = new Set([
  'f', 'gl', 'out', 'under', 'comp', 'P', 'text', 'type', 'lines', 'music', 'lyrics', 'narration',
  'params', 'W', 'H', 'start', 'end', 'item', 'util', 'rng', 'clear', 'setXform', 'xform',
  'world', 'grid', 'style', 'captions', 'fonts', 'hud',
]);
/** `Frame` 的字段（`src/core/scene.js` 的 typedef + 引擎实现） */
const F_KEYS = new Set([
  't', 'dt', 'lt', 'p', 'start', 'end', 'beat', 'bar', 'beatPhase', 'fps', 'idx', 'seed',
  'preview', 'seeked', 'tin', 'tout', 'under', 'a', 'rgb', 'params', 'narration',
]);
/**
 * 调色板里"可以没有"的名字：`src/kit/world.js` 与 `src/kit/elements.js` 都写
 * `P.cyan ?? P.signal` —— 那是引擎自己在探测可选色，不是任务拼错了。
 */
const OPTIONAL_PAL = new Set(['cyan']);

/**
 * 读了一个不存在的字段 → 记一条警告。
 * 为什么值得管：拼错的字段以前会静默变成 `undefined` ⇒ 后面的算式变成 `NaN` ⇒ 整屏白，
 * 而且报错的地方离写错的地方很远（这个引擎最贵的一类 bug）。
 */
function watching(target, allowed, missing, label) {
  return new Proxy(target, {
    get(t, k, r) {
      if (typeof k === 'symbol') return Reflect.get(t, k, r);
      if (!(k in t) && !allowed.has(k)) {
        if (!missing.has(k)) missing.set(k, `${label}.${k} 不存在（引擎没给这个字段；如果是拼错了，这里就是源头）`);
        return undefined;
      }
      return Reflect.get(t, k, r);
    },
  });
}

/* ══════════════════════════════════════════════════════ 任务加载（Node 版） */

/** 与 `src/tasks.js` 的 `normalizeAudio()` 同一套规则（那边跑在 Vite 里，Node 进不去） */
function normalizeAudio(audio) {
  const s = (v) => (typeof v === 'string' && v ? v : null);
  if (!audio) return { analysis: null };
  if (typeof audio === 'string') return { analysis: audio };
  return { analysis: s(audio.music) ?? s(audio.mix) ?? s(audio.vo) };
}

function taskNames() {
  const dir = path.join(ROOT, 'tasks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => existsSync(path.join(dir, d, 'task.config.mjs'))).sort();
}

async function loadTaskSpec(name) {
  // 任务名默认是 `tasks/<名字>`；带路径分隔符时当成目录（自查这套工具本身、或任务还没搬进 tasks/ 时用）
  const dir = /[\\/]/.test(name) ? path.resolve(ROOT, name) : path.join(ROOT, 'tasks', name);
  const cfg = path.join(dir, 'task.config.mjs');
  if (!existsSync(cfg)) {
    throw new Error(`没有任务 "${name}"（${path.relative(ROOT, cfg)} 不存在）。可用：${taskNames().join(', ') || '(空)'}`);
  }
  const mod = await import(pathToFileURL(cfg).href);
  const spec = mod.default ?? mod;
  if (!spec || typeof spec !== 'object') throw new Error(`tasks/${name}/task.config.mjs 没有 export default 一个对象`);
  // 具名导出 `export const world = (ctx) => Pass`（与 src/tasks.js 的 loadTask 同一行逻辑）
  if (spec.world == null && mod.world != null) spec.world = mod.world;

  /* ── 音乐：有预计算的分析 json 就用它（时间线里的 { beat }、f.beat、f.a 全靠它） ── */
  let music = SILENT;
  const track = normalizeAudio(spec.audio).analysis;
  let analysisPath = track ? path.join(dir, track.replace(/\.[^./\\]+$/, '') + '.analysis.json') : null;
  if (analysisPath && !existsSync(analysisPath)) analysisPath = null;
  if (!analysisPath && !track) {
    const adir = path.join(dir, 'audio');
    const hit = existsSync(adir) ? readdirSync(adir).find((f) => f.endsWith('.analysis.json')) : null;
    if (hit) analysisPath = path.join(adir, hit);
  }
  if (analysisPath) {
    try {
      const j = JSON.parse(readFileSync(analysisPath, 'utf8'));
      if (j && Array.isArray(j.beats)) music = new MusicData(j, { url: analysisPath });
      else NOTES.push(`音频分析 ${path.relative(ROOT, analysisPath)} 里没有 beats —— 按无声处理`);
    } catch (e) { NOTES.push(`读不了音频分析：${errLine(e)}`); }
  }

  /* ── 旁白表（docs/NARRATION.md）：与 src/app.js 同一套（文件 / 内联） ── */
  let narrationData = null;
  if (spec.narration && typeof spec.narration !== 'string') {
    try { narrationData = makeNarration(spec.narration, { duration: spec.duration }); }
    catch (e) { NOTES.push(`旁白表归一失败：${errLine(e)}`); }
  } else if (typeof spec.narration === 'string') {
    const p = path.join(dir, spec.narration);
    if (existsSync(p)) {
      try { narrationData = makeNarration(JSON.parse(readFileSync(p, 'utf8')), { duration: spec.duration }); }
      catch (e) { NOTES.push(`读不了旁白表 ${spec.narration}：${errLine(e)}`); }
    } else NOTES.push(`旁白表 ${spec.narration} 不存在 —— ctx.narration 会是空实现`);
  }
  const narration = makeNarrationReader(narrationData);

  /* ── 时间线：配置档（{ type: 'chart' }）必须走 build()，与 src/tasks.js 的选路一致 ── */
  const raw = spec.timeline;
  if (!raw) throw new Error(`tasks/${name}/task.config.mjs 没有 timeline`);
  /** 配置档节点按出现顺序记下来：报告里要能说"这段是哪个模板画的" */
  const cfgTypes = [];
  const walkCfg = (n) => {
    if (Array.isArray(n)) { n.forEach(walkCfg); return; }
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n.items)) { n.items.forEach(walkCfg); return; }
    if (isConfigNode(n)) cfgTypes.push({ type: n.type, id: n.id ?? null });
  };
  walkCfg(raw);
  let timeline = raw;
  if (!Array.isArray(raw) || raw.some(isConfigNode)) {
    try {
      timeline = build(raw, {
        ...(music !== SILENT ? { beats: music.beats, downbeats: music.downbeats, bpm: music.bpm } : {}),
        narration: narrationData,
      });
    } catch (e) {
      throw new Error(`tasks/${name}/task.config.mjs 的时间线不合法：\n${String((e && e.message) || e)}`);
    }
  }
  if (!Array.isArray(timeline) || !timeline.length) throw new Error(`${path.relative(ROOT, cfg)} 的 timeline 是空的`);
  return { name: /[\\/]/.test(name) ? path.basename(dir) : name, dir, spec, timeline, music, narration, narrationData, cfgTypes };
}

/** 与引擎 load() 同一套：懒加载函数 → 模块 → 类 → 对象 */
async function resolveScene(s) {
  let scene = s;
  if (typeof scene === 'function') scene = await scene();
  if (scene && scene.default) scene = scene.default;
  if (typeof scene === 'function') scene = new scene();
  return scene;
}

/** 任务里会参与"这一帧画面"的源码文件：scenes/ 下的 .js（含 _kit.js）+ task.config.mjs */
function sourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d)) {
      const p = path.join(d, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (e.endsWith('.js') || e.endsWith('.mjs')) out.push(p);
    }
  };
  walk(path.join(dir, 'scenes'));
  const cfg = path.join(dir, 'task.config.mjs');
  if (existsSync(cfg)) out.push(cfg);
  return out.sort();
}

/* ══════════════════════════════════════════════════════════════ 主流程 */

async function main() {
  const t0 = Date.now();
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.task) {
    process.stdout.write(HELP);
    return args.help ? 0 : 1;
  }

  const T = await loadTaskSpec(args.task);
  const spec = T.spec;
  const W = Number(spec.width ?? 1920);
  const H = Number(spec.height ?? 1080);
  const fps = Number(spec.fps ?? 60);
  const scale = Math.max(1, Math.min(4, Number(spec.scale ?? 1)));
  const duration = Number(spec.duration ?? Math.max(0, ...T.timeline.map((i) => i.end)));

  const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

  /* ── 场景模块：逐个 import 一遍，一是拿"哪个对象来自哪个文件"，二是文件坏了当场报 ── */
  const objectFile = new Map();
  const fileErrors = [];
  const scenesDir = path.join(T.dir, 'scenes');
  const sceneFiles = existsSync(scenesDir) ? sourceFiles(T.dir).filter((f) => f.startsWith(scenesDir + path.sep)) : [];
  for (const f of sceneFiles) {
    try {
      const m = await import(pathToFileURL(f).href);
      if (m.default && (typeof m.default === 'object' || typeof m.default === 'function')) objectFile.set(m.default, f);
    } catch (e) {
      const msg = errLine(e);
      // `.css` / 图片这类资源 import 是 Vite 才认的，Node 侧当然失败 —— 那是环境差异，不是场景的错
      if (/Unknown file extension|ERR_UNKNOWN_FILE_EXTENSION|Cannot find module .*\.(css|png|jpe?g|webp|gif|glb|gltf|mp3|wav|woff2?)/i.test(msg)) {
        NOTES.push(`${rel(f)} 在 Node 里 import 不了（${msg}）—— Vite 才认的资源 import，离线自查跳过这个文件`);
      } else {
        fileErrors.push({ file: rel(f), message: msg, loc: locOf(e, T.dir) });
      }
    }
  }

  /* ── 共享的假设备（引擎里 lines/comp/gl 也是全片共用的，这里照做） ── */
  const owner = { rec: null, curProbe: null };
  const gl = new FakeGL({ w: W, h: H, scale, owner });
  const lines = new FakeLines(owner);
  const comp = new FakeComp(owner);
  const palMissing = new Map();
  const P = watching(
    makePalette({ ...(spec.styleResolved?.palette ?? {}), ...(spec.palette ?? {}) }),
    OPTIONAL_PAL, palMissing, 'P',
  );
  const newLayer = () => new FakeTextLayer(owner, W, H, scale);
  /** 一段自己的共享背景（`cut(shot, { world: … })`）解析结果 */
  const ctxFor = (o) => makeCtx({ T, gl, lines, comp, P, owner, W, H, fps, ...o });

  /* ── 全片共享背景（task.config 的 world / worldPass）：与引擎一样在 load 阶段建一次 ── */
  const worldSpec = spec.world ?? null;
  let worldPass = null;
  let worldError = null;
  if (worldSpec) {
    try {
      const ctx0 = ctxFor({ item: { id: '__world', start: 0, end: 1, params: {} }, t: 0, idx: 0, extras: {}, text: newLayer(), under: null, world: null, rec: null, probe: null });
      worldPass = typeof worldSpec === 'function' ? worldSpec(ctx0) : worldSpec;
    } catch (e) { worldError = errLine(e); }
  }

  /* ── 场景准备：加载 + setup（与引擎同序） ── */
  const probes = T.timeline.map((item) => {
    const file = objectFile.get(item.scene);
    return {
      item, id: item.id, _file: file ?? null,
      file: file ? rel(file) : (T.cfgTypes.length ? 'task.config.mjs（配置档节点）' : '(没在 scenes/ 里找到这个对象)'),
      start: item.start, end: item.end, dur: item.end - item.start,
      scene: null, ownWorld: null, status: 'ok', gpuSkip: null,
      errors: [], warnings: [], samples: [], perms: null, text: null, timesUsed: [],
      textSeen: new Map(), boxSeen: new Map(), sampleW: W, sampleH: H,
    };
  });
  // 配置档任务：段名 → 模板名（只为了让报告里说清"这段是谁画的"）
  if (T.cfgTypes.length) {
    const byId = new Map();
    for (const c of T.cfgTypes) if (c.id) byId.set(c.id, c.type);
    probes.forEach((pr, i) => {
      pr.tpl = byId.get(pr.id) ?? (T.cfgTypes.length === T.timeline.length ? T.cfgTypes[i].type : null);
    });
  }

  /* ── 静态扫描：扫"这一帧画面可能用到的源码" ──
   * 有 `--scene` 时只扫选中段落的文件（+ 没有任何段落认领的共享文件，例如 `scenes/_kit.js`）——
   * 这样并行的子代理各查各的，不会因为别人刚半写完的文件把自己的退出码弄红。 */
  const wantedFiles = args.scenes
    ? new Set(probes.filter((p) => args.scenes.includes(p.id)).map((p) => p._file).filter(Boolean))
    : null;
  const claimed = new Set(probes.map((p) => p._file).filter(Boolean));
  const staticFindings = [];
  for (const f of sourceFiles(T.dir)) {
    if (wantedFiles && claimed.has(f) && !wantedFiles.has(f)) continue;
    try { staticFindings.push(...scanSource(f, rel(f))); }
    catch (e) {
      staticFindings.push({ file: rel(f), line: 0, col: 0, level: 'error', kind: 'read', method: null, message: `读不了这个文件：${errLine(e)}`, snippet: '' });
    }
  }

  /** 这一段用什么当底：'auto' = 全片共享背景；false/未声明 = 场景自己负责；对象 = 本段专用 */
  const worldFor = (pr) => {
    const w = pr.item.world;
    if (w === false || w == null) return null;
    if (w === 'auto') return worldPass;
    return pr.ownWorld;
  };

  for (const pr of probes) {
    try {
      pr.scene = await resolveScene(pr.item.scene);
      if (!pr.scene || typeof pr.scene.render !== 'function') {
        pr.errors.push({ kind: 'load', message: '这一段没有 render()（场景必须是 { id, render } 对象、mjs 模块或类）' });
        pr.status = 'error';
        continue;
      }
      if (typeof pr.scene.id === 'string' && pr.scene.id !== pr.item.id && !pr.item.id.startsWith(pr.scene.id)) {
        pr.warnings.push({ kind: 'id', message: `scene.id = "${pr.scene.id}"，但时间线里的段名是 "${pr.item.id}"（--only / HUD / 报错用的是段名）` });
      }
      owner.curProbe = pr;
      if (typeof pr.scene.setup === 'function') {
        // 引擎给 setup 的 ctx：`_ctxFor(item, 0, 1)` —— 注意 out 是 undefined、lt 是 -start，这里照抄
        const ctx = ctxFor({ item: pr.item, t: 0, idx: 1, extras: {}, text: newLayer(), under: null, world: null, rec: new Rec(W, H), probe: pr });
        try { await pr.scene.setup(ctx); }
        catch (e) {
          const msg = errLine(e);
          if (isGpuError(e)) {
            pr.status = 'skipped';
            pr.gpuSkip = msg;
            pr.warnings.push({ kind: 'gpu-skip', message: `这一段的 setup 需要 GPU，已跳过：${msg}` });
          } else {
            pr.status = 'error';
            pr.errors.push({ kind: 'setup', message: msg, loc: locOf(e, T.dir) });
          }
        }
      }
      if (pr.status === 'ok' && pr.item.world && pr.item.world !== 'auto' && pr.item.world !== false) {
        try {
          const ctx = ctxFor({ item: pr.item, t: 0, idx: 1, extras: {}, text: newLayer(), under: null, world: null, rec: new Rec(W, H), probe: pr });
          pr.ownWorld = typeof pr.item.world === 'function' ? pr.item.world(ctx) : pr.item.world;
        } catch (e) {
          if (isGpuError(e)) pr.warnings.push({ kind: 'gpu-skip', message: `这一段的背景需要 GPU，已跳过：${errLine(e)}` });
          else pr.errors.push({ kind: 'world', message: `建这一段的背景失败：${errLine(e)}`, loc: locOf(e, T.dir) });
        }
      }
      owner.curProbe = null;
    } catch (e) {
      pr.status = 'error';
      pr.errors.push({ kind: 'load', message: `场景加载失败：${errLine(e)}`, loc: locOf(e, T.dir) });
    }
  }

  const probeOf = (item) => probes.find((p) => p.item === item) ?? null;
  const activeAt = (t) => T.timeline.filter((i) => t >= i.start && t < i.end).sort((a, b) => a.start - b.start);

  /* ── 只查指定的段 ── */
  const selected = new Set(probes.map((p) => p.id));
  if (args.scenes) {
    const missing = args.scenes.filter((s) => !selected.has(s));
    if (missing.length) {
      throw new Error(`--scene 里这些段不存在：${missing.join(', ')}。这个任务的段名：${[...selected].join(', ')}`);
    }
    for (const pr of probes) if (!args.scenes.includes(pr.id)) pr.status = 'unselected';
  }
  const wanted = probes.filter((pr) => pr.status !== 'unselected');

  /* ── 跑场 ── */
  for (const pr of wanted) {
    if (pr.status !== 'ok' || typeof pr.scene?.render !== 'function') continue;
    const text = newLayer();
    pr.text = text;
    const times = sampleTimes(pr.dur, fps, args.times, pr);
    pr.timesUsed = times;
    if (!times.length) {
      pr.warnings.push({ kind: 'times', message: `没有落在这一段里的时刻（--times 是**段内秒**：每段自己的 0..${pr.dur.toFixed(2)}s）` });
      continue;
    }

    for (const lt of times) {
      const t = pr.start + lt;
      // 引擎在 t 时刻会把所有在播的段按顺序渲一遍：本段之前的那些段的成帧，就是本段的 ctx.under
      const actives = activeAt(t);
      const mine = actives.findIndex((i) => i === pr.item);
      let under = null;
      for (let k = 0; k < Math.max(0, mine); k++) {
        const other = probeOf(actives[k]);
        if (!other || typeof other.scene?.render !== 'function') continue;
        const rt = tag(new RT(gl, gl.pw, gl.ph), 'under');
        const rec = new Rec(W, H);
        try {
          owner.rec = rec; owner.curProbe = other;
          other.scene.render(ctxFor({
            item: actives[k], t, idx: frameIndexOf(t, fps),
            extras: { out: rt, dt: 1 / fps, tin: 1, tout: 0, under: null },
            text: other.text ?? newLayer(), under: null, world: worldFor(other), rec, probe: other,
          }));
        } catch { /* 那是别人的段，它自己那一轮会报 */ }
        owner.rec = null; owner.curProbe = null;
        under = rt;
      }
      const idx = frameIndexOf(t, fps);
      const tin = mine > 0 ? U.sat((t - pr.item.start) / Math.max(1e-3, actives[mine - 1].end - pr.item.start)) : 1;
      const next = actives[mine + 1];
      const tout = next ? U.sat((t - next.start) / Math.max(1e-3, pr.item.end - next.start)) : 0;

      const outRt = tag(new RT(gl, gl.pw, gl.ph), 'out');
      const world = worldFor(pr);
      const isOverlap = !!under && tin < 1;

      /** 跑一遍：世界背景 → 场景 render。返回这一遍的记账 */
      const run = (idx2) => {
        const rec = new Rec(W, H);
        owner.rec = rec; owner.curProbe = pr; gl.paint = rec.paint;
        let post = null; let err = null;
        try {
          if (world) world.render(gl, outRt, t, 1 / fps);       // 引擎：声明了 world 的段由引擎先铺底
          post = pr.scene.render(ctxFor({
            item: pr.item, t, idx: idx2,
            extras: { out: outRt, dt: 1 / fps, tin, tout, under },
            text, under, world, rec, probe: pr,
          }));
        } catch (e) { err = e; }
        gl.paint = null; owner.rec = null; owner.curProbe = null;
        return { rec, post, err };
      };

      run(idx);                       // 热身：让"第一次调用才建的缓存"落定（引擎里 setup 之后第一帧也是这个待遇）
      const variant = run(idx + 7);   // 同 t、不同 idx
      const a = run(idx);
      const b = run(idx);

      if (a.err) {
        addErr(pr, {
          kind: 'render', lt, t, message: errLine(a.err), loc: locOf(a.err, T.dir),
          stack: String((a.err && a.err.stack) || '').split('\n').slice(0, 4).join('\n'),
        });
        continue;
      }
      pr.samples.push({ lt, t, calls: a.rec.raw.length, ...sampleStats(a.rec) });
      for (const w of a.rec.stats.writes) {
        const hit = pr.textSeen.get(w.s) ?? { calls: 0, drawn: 0 };
        hit.calls++; if (w.drawn) hit.drawn++;
        pr.textSeen.set(w.s, hit);
      }
      for (const b of a.rec.stats.boxes) {
        const hit = pr.boxSeen.get(b.s) ?? { visible: 0, off: 0, box: b };
        hit.visible++; if (b.off) hit.off++;
        hit.box = b;
        pr.boxSeen.set(b.s, hit);
      }
      for (const p of a.rec.problems) addErr(pr, { kind: 'value', lt, t, message: p });
      if (a.post && typeof a.post === 'object') {
        const bad = [];
        for (const [k, v] of Object.entries(a.post)) {
          if (typeof v === 'number') { if (!Number.isFinite(v)) bad.push(`post.${k} = ${v}`); }
          else if (Array.isArray(v)) finiteList(`post.${k}`, v, bad);
        }
        for (const m of bad) addErr(pr, { kind: 'value', lt, t, message: `${m}（后处理拿到非有限值 = 整屏白/黑）` });
      }
      skeletonCheck(pr, a.rec, isOverlap, lt, t);

      /* ② 确定性：同一时刻连着两遍 —— 不一致就是 Math.random / 墙钟 / 逐帧累积 */
      if (!pr.perms) pr.perms = { ok: true, bad: null, idxSensitive: null, checked: 0 };
      pr.perms.checked++;
      const d = firstDiff(a.rec.raw, b.rec.raw);
      if (d && pr.perms.ok) {
        pr.perms.ok = false;
        pr.perms.bad = { lt, t, i: d.i, lenA: d.lenA, lenB: d.lenB };
        addErr(pr, {
          kind: 'determinism', lt, t,
          message: `同一时刻渲染两遍，第 ${d.i + 1} 个绘制调用不一样：\n`
            + `          第一遍 ${a.rec.sig[d.i] ?? '(没有这个调用)'}\n`
            + `          第二遍 ${b.rec.sig[d.i] ?? '(没有这个调用)'}\n`
            + `          调用总数 ${d.lenA} vs ${d.lenB}`
            + `\n          → Math.random / Date.now / 逐帧累积状态都会这样；这一段的画面在成片里会抖`,
        });
      }
      /* f.idx 敏感性：只报警告 —— 逐帧抖动（grain）是合法用法。
         ⚠ 确定性已经不通过时不再报这一条：同一时刻两遍都不一样，idx 敏感只是同一个根因的表象。 */
      const di = firstDiff(a.rec.raw, variant.rec.raw);
      if (di && pr.perms.ok && !pr.perms.idxSensitive) {
        pr.perms.idxSensitive = { lt, t, i: di.i };
        const intent = /\bidx\b|\bseed\b/.test(a.rec.sig[di.i] ?? '') ? '' : '（这一条调用名里没有 idx/seed，多半不是刻意的抖动）';
        pr.warnings.push({
          kind: 'idx', lt, t,
          message: `同 t、不同 f.idx 时第 ${di.i + 1} 个调用不同：\n`
            + `          idx=${idx}   ${a.rec.sig[di.i] ?? '(没有这个调用)'}\n`
            + `          idx=${idx + 7}   ${variant.rec.sig[di.i] ?? '(没有这个调用)'}${intent}\n`
            + `          刻意的逐帧抖动（grain / 甩帧）可以忽略；但画面**位置**跟着 idx 变属于"振动"不是手持`
            + `（用 shakeSmooth(f.t, amp)，见 docs/history/IMPROVEMENTS-1-3.md）`,
        });
      }
    }
    glyphVerdict(pr);
    layoutVerdict(pr);
  }

  // `--times` 是**段内秒**：给成整片时刻的话，大时刻会一段都落不进去 —— 那正是最容易被误解的一步
  if (args.times) {
    const used = new Set(wanted.flatMap((p) => p.timesUsed));
    const dropped = args.times.filter((x) => !used.has(Number(x.toFixed(4))));
    if (dropped.length) {
      NOTES.push(`--times 里这些时刻没落进任何段：${dropped.join(', ')}`
        + `（--times 是**段内秒** = 每段自己的 0..时长；要用整片时刻就减去段起点。这个任务最长的一段是 `
        + `${Math.max(0, ...T.timeline.map((i) => i.end - i.start)).toFixed(2)}s）`);
    }
  }

  /* ── 汇总 ── */
  const errors = [];
  const warnings = [];
  for (const pr of wanted) {
    for (const e of pr.errors) errors.push({ scene: pr.id, ...e });
    for (const w of pr.warnings) warnings.push({ scene: pr.id, ...w });
  }
  for (const f of staticFindings) (f.level === 'error' ? errors : warnings).push({ scene: null, sceneFile: f.file, kind: `static:${f.kind}`, ...f });
  for (const f of fileErrors) errors.push({ scene: null, kind: 'import', message: f.message, loc: f.loc, file: f.file });
  if (worldError) errors.push({ scene: null, kind: 'world', message: `全片共享背景（task.config 的 world）建不出来：${worldError}` });
  for (const [k, msg] of palMissing) warnings.push({ scene: null, kind: 'palette', message: msg });

  const result = {
    tool: 'scene-harness', version: 1, task: T.name, title: spec.title ?? '',
    width: W, height: H, fps, scale, duration, hasAudio: T.music !== SILENT,
    scenes: probes.map((pr) => ({
      id: pr.id, file: pr.file, tpl: pr.tpl ?? null, start: pr.start, end: pr.end, dur: pr.dur,
      status: pr.status, gpuSkipped: pr.gpuSkip, times: pr.timesUsed, samples: pr.samples,
      determinism: pr.perms, errors: pr.errors, warnings: pr.warnings,
    })),
    static: staticFindings,
    notes: NOTES,
    summary: {
      scenes: wanted.length,
      ok: wanted.filter((p) => p.status === 'ok' && !p.errors.length).length,
      failed: wanted.filter((p) => p.status === 'error' || p.errors.length).length,
      skipped: wanted.filter((p) => p.status === 'skipped').length,
      unselected: probes.length - wanted.length,
      errors: errors.length, warnings: warnings.length,
      ms: Date.now() - t0,
    },
  };
  result.summary.exitCode = errors.length ? 1 : 0;

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.summary.exitCode;
  }
  printHuman(result, probes, args);
  return result.summary.exitCode;
}

function tag(o, t) { o.__tag = t; return o; }

/**
 * 同一段、同一个错误在多个时刻复现是常态（11 个采样点 × 同一个 TypeError）。
 * 只留一条、记下复现次数 —— 子代理要读的是"哪里错了"，不是同一句话刷 11 遍。
 */
function addErr(pr, e) {
  const key = (x) => `${x.kind}|${x.message}|${x.loc ? `${x.loc.rel}:${x.loc.line}` : ''}`;
  const hit = pr.errors.find((x) => key(x) === key(e));
  if (hit) { hit.repeat = (hit.repeat ?? 0) + 1; hit.lastT = e.t; return hit; }
  pr.errors.push(e);
  return e;
}

function sampleStats(rec) {
  const s = rec.stats;
  return {
    segs: s.segs, texts: s.texts, glyphs: s.glyphs, invisible: s.invisibleText, uploads: s.uploads,
    passes: s.passes, comps: s.comps, flushes: s.flushes, clears: s.clears, full: rec.paint.full,
  };
}

/** 骨架体检：画了线没 flush、写了字没 clear/upload/comp.draw、交叠期没铺满整帧… */
function skeletonCheck(pr, rec, inOverlap, lt, t) {
  const s = rec.stats;
  const push = (kind, message, level = 'warn') => {
    const arr = level === 'error' ? pr.errors : pr.warnings;
    if (arr.some((x) => x.kind === kind)) return;
    arr.push({ kind, lt, t, message });
  };
  if (s.segs > 0 && s.flushes === 0) push('flush', `画了 ${s.segs} 条线但一次都没 lines.flush() —— 这些线不会出现在画面上`);
  if (s.texts > 0 && s.textClears === 0) push('text-clear', '这一刻写了字但没有 text.clear() —— 上一帧的字会叠上来');
  if (s.texts > 0 && s.uploads === 0) push('text-upload', '写了字但没 text.upload() —— 字不会出现');
  if (s.texts > 0 && s.comps === 0) push('text-comp', '写了字但没 comp.draw(gl, text, ctx.out) —— 字不会出现');
  if (s.zeroRects) push('fillrect-zero', `lines.fillRect 的长或高是 0（${s.zeroRects}）—— 这一笔画不出东西。如果这是"从 0 长出来"的第一帧，忽略即可`);
  if (s.segs >= 50 && s.segsOutside / s.segs > 0.9) {
    push('offscreen', `这一刻画的线有 ${s.segsOutside}/${s.segs} 条完全在画面外（${rec.W}×${rec.H}）—— 摄影机跑飞了，或者整层被挪走了`);
  }
  // 「几十条线全挤在指甲盖大的一小块」= 典型的**单位写错**（0..1 的归一化坐标当像素用）
  if (s.segs >= 50) {
    const b = s.bbox;
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    if (bw >= 0 && bh >= 0 && bw * bh < 0.01 * rec.W * rec.H) {
      push('unit-mixup', `这一刻 ${s.segs} 条线全挤在 ${Math.round(bw)}×${Math.round(bh)} 的一小块里（画面 ${rec.W}×${rec.H}）`
        + `—— 坐标是不是用了 0..1 的归一化值？引擎要的是**逻辑像素**`);
    }
  }
  if (s.offFrame.length && pr.boxSeen.size === 0) {
    // 只给单点兜底（正常情况下出画由 layoutVerdict 按整段判）
    const b = s.offFrame[0];
    push('offframe', `文字出画：${s.offFrame.length} 处，例如「${short(b.s)}」 x ${Math.round(b.x0)}..${Math.round(b.x1)} y ${Math.round(b.y0)}（画面 ${rec.W}×${rec.H}；宽度是估计值，CJK 按 1em 算）`);
  }
  // 「什么都没画」：一次绘制都没有、**而且**连一个非黑的底都没有。
  // 清成非黑（`gl.clear(out, P.ink)`）算"给了这一帧一个底"——_calib/scenes/probe.js 就是
  // 靠这个出标定色的（它整段不画任何几何，那不是 bug）。清成纯黑仍然算空：那正是
  // fidus 那次"9 段里 8 段的底是纯黑"的形状。
  if (s.segs + s.fills === 0 && s.texts === 0 && s.passes === 0 && s.comps === 0 && !s.inkClear) {
    push('empty', '这一刻什么都没画（0 条线 / 0 行字 / 0 个 Pass，也没清成非黑）—— 空场景，或者条件分支写反了');
  }
  // 交叠期：自己声明了 handlesTransition 的段必须铺满整帧，否则那一段的底是纯黑且不报错
  if (inOverlap && pr.scene?.handlesTransition && !s.bigFill && !s.inkClear && rec.paint.full === 0 && !pr.item.world && !pr.ownWorld) {
    push('bg', '交叠期这一帧没有铺满整帧的底（没有整帧 Pass / 全屏 fillRect / 非黑 gl.clear）—— 底会是纯黑，而且不报错（docs/history/IMPROVEMENTS-1-3.md P0-2）');
  }
}

/**
 * 文字可见性的**整段**判据。
 *
 * 为什么必须按整段看：单个时刻"字形被 k ≤ 0 跳过"是正常的 —— 逐字入场的第一帧本来就
 * 什么都不画，打字机效果在 t=0 写的就是空串。按时刻报会把每一段的开头都误报一遍
 * （第一版就是这么误报的；optifine 13 段里有 6 段被冤枉）。
 *
 * 真正值得报的是这三种（都要**整段**成立才报）：
 *   ① 一次字形都没画出来，而且写了非空的字 ⇒ 这块字在成片里根本不存在
 *      （beast 那次的"字典 4 个大格凭空消失"就是这一类，docs/history/IMPROVEMENTS-1-3.md P0-1）；
 *   ② 同一行字写了好几次、一次都没画出来 ⇒ 这行字永远不会出现（t/stagger 对不上）；
 *   ③ 整段都在 upload / comp.draw 文字层，却一个字都没写 ⇒ 这层字是死的。
 */
function glyphVerdict(pr) {
  const s = pr.samples;
  if (!s.length) return;
  // "整段都没出现"必须有**段尾**的证据：采样点只到段中间时（例如 --times 0.5,3），
  // 一句"3.2s 才淡入"的字当然还没出现 —— 那不是 bug。默认采样一定会采到段尾。
  const covered = s[s.length - 1].lt >= pr.dur * 0.9;
  if (!covered) return;
  const inv = s.filter((x) => x.invisible > 0);
  const withGlyphs = s.filter((x) => x.glyphs > 0);
  const add = (kind, message) => { if (!pr.warnings.some((w) => w.kind === kind)) pr.warnings.push({ kind, message }); };
  if (inv.length && !withGlyphs.length) {
    add('text-invisible', `整段一次字形都没画出来：${inv.reduce((a, b) => a + b.invisible, 0)} 次 type.write 全部被 k ≤ 0 跳过`
      + `（${inv.length}/${s.length} 个时刻都这样，含段尾）—— 这块字在成片里不存在。`
      + `stagger/staggerDur 与传给它的 t 对不上（docs/history/IMPROVEMENTS-1-3.md P0-1）`);
  }
  const never = [...pr.textSeen.entries()]
    .filter(([k, v]) => k.length > 0 && v.calls >= 2 && v.drawn === 0).map(([k]) => k);
  if (never.length) {
    add('text-never', `这些字写了好几次、但一次字形都没画出来（k ≤ 0 整段成立）：`
      + never.slice(0, 4).map((x) => `「${short(x)}」`).join('、')
      + (never.length > 4 ? ` 等 ${never.length} 行` : '')
      + ` —— stagger / t / staggerDur 对不上；多半是 t 给成了常数或负值`);
  }
  if (s.every((x) => x.uploads > 0 && x.texts === 0 && x.invisible === 0)) {
    add('text-empty', '整段都在 text.upload() / comp.draw()，但一次字都没写 —— 这一层的字是死的（条件分支永远不成立？）');
  }
}

/**
 * 版面判据：**一直**在画外的字才报。
 *
 * 入场/出场位移（`enterOffset`）会让一行字在某一刻跑到画外 —— 那是设计，不是 bug
 * （sodium 的「视野外」、optifine 的「01」列都是这样）。真正值得报的是"每次出现都越界"：
 * 那才是版面算错了（或者忘了乘 W/H）。
 */
function layoutVerdict(pr) {
  const bad = [...pr.boxSeen.entries()]
    .filter(([k, v]) => k.length > 0 && v.off >= 2 && v.off >= 0.8 * v.visible)
    .map(([k, v]) => ({ s: k, ...v }));
  if (!bad.length) return;
  pr.warnings.push({
    kind: 'offframe',
    message: `文字长期出画（出现的时刻里有八成以上越界）：`
      + bad.slice(0, 3).map((b) => `「${short(b.s)}」 x ${Math.round(b.box.x0)}..${Math.round(b.box.x1)} y ${Math.round(b.box.y0)}（${b.off}/${b.visible} 个时刻）`).join('；')
      + (bad.length > 3 ? ` 等 ${bad.length} 行` : '')
      + ` —— 画面 ${pr.sampleW}×${pr.sampleH}；宽度是估计值（CJK 按 1em），2% 以内不算`,
  });
}

function frameIndexOf(t, fps) { return Math.floor(t * fps + 1e-6); }

/** 默认时刻：早帧最容易炸（除零 / 首帧 / 交叠刚开始），所以 0 与 0.05 一定要有 */
function sampleTimes(dur, fps, userTimes, pr) {
  const lo = 0, hi = lastFrame(dur, fps);
  const clamp = (v) => Math.max(lo, Math.min(hi, v));
  let list;
  if (userTimes && userTimes.length) {
    list = userTimes.filter((x) => x < dur - 1e-9).map(clamp);
    if (!list.length) return [];
  } else {
    const set = new Set();
    for (const f of [0.01, 0.12, 0.3, 0.5, 0.7, 0.86, 0.99]) set.add(clamp(f * dur));
    for (const a of [0, 0.05, 0.3, 1.0]) if (a < dur) set.add(clamp(a));
    set.add(clamp(hi));
    if (pr.item.handlesTransition || pr.item.overlap) set.add(clamp(0.02));
    list = [...set];
  }
  return [...new Set(list.map((v) => Number(v.toFixed(4))))].sort((a, b) => a - b).slice(0, 12);
}

const GPU_HINTS = [
  /document is not defined/, /window is not defined/, /navigator is not defined/,
  /WebGL/, /getContext/, /createElement/, /THREE/, /WebGLRenderer/, /RT incomplete/,
  /three\/build/, /Cannot find package 'three'/,
];
const isGpuError = (e) => GPU_HINTS.some((re) => re.test(String((e && e.message) || e)));

/* ══════════════════════════════════════════════════════════════ ctx */

/**
 * 造一个假 `SceneCtx`。字段与引擎的 `_ctxFor()` 一一对应，派生量也照抄
 * （p / beat / bar / beatPhase / seed / tin / tout），`util` / `rng` 用**真的**
 * `src/core/util.js`（它是纯函数，没必要再桩一份）。未知字段的读取记一条警告 ——
 * 拼错的字段会静默变 undefined ⇒ NaN ⇒ 整屏白，而且报错的地方离写错的地方很远。
 */
function makeCtx({ T, gl, lines, comp, P, owner, W, H, fps, item, t, idx, extras, text, under, world, rec, probe }) {
  const missing = new Map();
  const lt = t - item.start;
  const dur = Math.max(1e-6, item.end - item.start);
  const layer = text ?? new FakeTextLayer(owner, W, H, gl.scale);
  const f = {
    t, dt: extras.dt ?? 1 / fps, lt, p: U.sat(lt / dur),
    start: item.start, end: item.end, fps,
    idx, seed: frameSeed(idx),
    beat: 0, bar: 0, beatPhase: 0,
    preview: false, seeked: !!extras.seeked,
    tin: extras.tin ?? 1, tout: extras.tout ?? 0,
    under: under ?? null,
    a: T.music.at ? T.music.at(t) : {},
    params: item.params ?? {},
    narration: T.narration,
  };
  const beat = T.music.beatAt ? T.music.beatAt(t) : t * 2;
  f.beat = beat; f.bar = beat / 4; f.beatPhase = beat - Math.floor(beat);

  // 场景级变换（ctx.setXform）：引擎里这个对象是**每段一个、每帧归零**的，这里照做
  const xform = probe
    ? (probe._xform ?? (probe._xform = { x: 0, y: 0, scale: 1, rot: 0, anchor: null, p: 0, q: 0, on: false, edge: 'clamp' }))
    : { x: 0, y: 0, scale: 1, rot: 0, anchor: null, p: 0, q: 0, on: false, edge: 'clamp' };
  xform.on = false; xform.edge = 'clamp';

  const raw = {
    f, gl, out: extras.out, under: under ?? null,
    comp, P, text: layer, type: layer.type,
    lines, music: T.music, lyrics: null, narration: T.narration,
    params: f.params, W, H, start: item.start, end: item.end, item,
    util: U, rng: U.rng,
    world: world ?? null, grid: null, style: null, captions: null, fonts: null, hud: null,
    clear: (c = [0, 0, 0]) => gl.clear(extras.out, c),
    setXform: (o = {}) => {
      xform.x = o.x ?? 0; xform.y = o.y ?? 0;
      xform.scale = o.scale ?? 1; xform.rot = o.rot ?? 0;
      xform.anchor = o.anchor ?? null;
      xform.p = o.p ?? 0; xform.q = o.q ?? 0;
      xform.edge = o.edge === 'black' ? 'black' : 'clamp';
      xform.on = true;
      if (rec) {
        const view = { x: xform.x, y: xform.y, scale: xform.scale, rot: xform.rot, anchor: xform.anchor, p: xform.p, q: xform.q, edge: xform.edge };
        rec.add(`setXform(${JSON.stringify(view, (k, v) => (typeof v === 'number' ? n4(v) : v))})`,
          `setXform(${JSON.stringify(view)})`);
        const bad = [];
        if (!Number.isFinite(xform.x) || !Number.isFinite(xform.y)) bad.push('x/y');
        if (!Number.isFinite(xform.scale) || xform.scale <= 0) bad.push('scale 必须是 > 0 的有限数');
        if (!Number.isFinite(xform.rot)) bad.push('rot');
        if (xform.anchor && (xform.anchor.length < 2 || !Number.isFinite(xform.anchor[0]) || !Number.isFinite(xform.anchor[1]))) bad.push('anchor 必须是 [x, y]');
        if (bad.length) rec.problems.push(`setXform 参数不合法：${bad.join('、')}（引擎会点名）`);
      }
      return xform;
    },
    xform,
  };
  const fProxy = watching(f, F_KEYS, missing, 'f');
  raw.f = fProxy;
  const proxy = watching(raw, CTX_KEYS, missing, 'ctx');
  // 未知字段的警告记在"当前这一段"身上（读的是 owner 上的探针，跑场时才有）
  Object.defineProperty(proxy, '__missing', { value: missing, enumerable: false });
  return proxy;
}

/* ══════════════════════════════════════════════════════════ 人话输出 */

function printHuman(R, probes, args) {
  const out = [];
  const p = (s = '') => out.push(s);
  const S = R.summary;
  const byId = new Map(R.scenes.map((x) => [x.id, x]));
  const line = '─'.repeat(46);

  p(`场景离线自查：${R.task}　${R.title}`);
  p(`  ${R.scenes.length} 段 · ${R.duration.toFixed(2)}s · ${R.width}×${R.height} @${R.fps}fps${R.scale > 1 ? ` ×${R.scale}` : ''}${R.hasAudio ? ' · 有音乐分析' : ' · 无音频'}`);
  p('  假 ctx 跑场：不起 Vite、不开 Chrome、不写文件、不读像素');
  for (const n of R.notes) p(`  · ${n}`);
  p('');

  /* 静态扫描 */
  const st = R.static;
  const stErr = st.filter((x) => x.level === 'error');
  const stWarn = st.filter((x) => x.level !== 'error');
  p(`── 静态扫描 ${line}`);
  if (!st.length) p('  ✓ 没有铁律违规（Math.random / Date.now / performance.now / new Date / 逐帧累积 / 按帧抖帧）');
  else {
    p(`  ${stErr.length ? '✗' : '⚠'} ${stErr.length} 错误 · ${stWarn.length} 警告`);
    for (const x of st.slice(0, 12)) {
      p(`      ${x.level === 'error' ? '✗' : '⚠'} ${x.file}:${x.line}${x.method ? `　（在 ${x.method} 里）` : ''}`);
      p(`        ${x.message}`);
      if (x.snippet) p(`        ${x.snippet}`);
    }
    if (st.length > 12) p(`      …还有 ${st.length - 12} 条`);
  }
  p('');

  /* 逐段 */
  p(`── 逐段跑场 ${line}`);
  for (const pr of probes) {
    const sc = byId.get(pr.id) ?? { errors: [], warnings: [], samples: [] };
    if (pr.status === 'unselected') {
      p(`  ·  ${String(pr.id).padEnd(12)} ${pr.start.toFixed(2)}–${pr.end.toFixed(2)}s　（--scene 没选中，这次没查）`);
      continue;
    }
    const mark = pr.status === 'error' || sc.errors.length ? '✗' : pr.status === 'skipped' ? '⚠' : '✅';
    const head = `  ${mark} ${String(pr.id).padEnd(12)} ${pr.start.toFixed(2)}–${pr.end.toFixed(2)}s`;
    const tplNote = sc.tpl ? `　[模板 ${sc.tpl}]` : '';
    if (pr.status === 'skipped') { p(`${head}　setup 需要 GPU，已跳过${tplNote}`); }
    else if (!sc.samples.length) { p(`${head}　${sc.errors.length ? sc.errors[0].message.split('\n')[0] : '没有可用的时刻'}${tplNote}`); }
    else {
      const s = sc.samples;
      const med = (k) => Math.round(s.reduce((a, b) => a + b[k], 0) / s.length);
      const mx = (k) => Math.max(...s.map((x) => x[k]));
      p(`${head}　${s.length} 个时刻　线 ${med('segs')}（峰值 ${mx('segs')}）· 字 ${mx('texts')} 行 · Pass ${mx('passes')} · 层 ${mx('comps')}${tplNote}`);
    }
    if (pr.status !== 'skipped') {
      const det = sc.determinism;
      if (det && det.checked) {
        p(det.ok
          ? `      ✓ 确定性：同一时刻两遍逐调用一致（${det.checked} 个时刻）`
          : '      ✗ 确定性：同一时刻两遍不一致（见下）');
        if (det.idxSensitive) p('      ⚠ f.idx 敏感（合法与否取决于用途，见下）');
      }
      if (args.verbose && sc.samples.length) {
        p(`      ⏱ 采样（段内秒）：${sc.samples.map((s) => s.lt.toFixed(2)).join(' ')}`);
        for (const s of sc.samples) {
          p(`        t=${s.lt.toFixed(2).padStart(6)}s  调用 ${String(s.calls).padStart(4)}  线 ${String(s.segs).padStart(4)}  字 ${String(s.texts).padStart(3)}`
            + `（字形 ${String(s.glyphs).padStart(4)}${s.invisible ? ` / 跳过 ${s.invisible}` : ''}）  Pass ${s.passes}  层 ${s.comps}  flush ${s.flushes}  整帧 ${s.full}`);
        }
      }
    }
    for (const e of sc.errors.slice(0, 5)) {
      const when = e.lt !== undefined ? `t=${e.lt.toFixed(2)}s（整片 ${e.t.toFixed(2)}s）` : '';
      p(`      ✗ ${e.kind}${when ? ' ' + when : ''}：${String(e.message).split('\n')[0]}`);
      for (const l of String(e.message).split('\n').slice(1)) p(`        ${l.trim()}`);
      if (e.loc) p(`        → ${e.loc.rel}:${e.loc.line}:${e.loc.col}`);
      if (e.repeat) p(`        · 另外 ${e.repeat} 个时刻同样报错（最后一个 t=${(e.lastT ?? 0).toFixed(2)}s）—— 已折叠`);
    }
    if (sc.errors.length > 5) p(`      …还有 ${sc.errors.length - 5} 条错误`);
    for (const w of sc.warnings.slice(0, 4)) {
      const when = w.lt !== undefined ? `t=${w.lt.toFixed(2)}s ` : '';
      p(`      ⚠ ${w.kind} ${when}${String(w.message).split('\n')[0]}`);
      for (const l of String(w.message).split('\n').slice(1)) p(`        ${l.trim()}`);
    }
    if (sc.warnings.length > 4) p(`      …还有 ${sc.warnings.length - 4} 条警告`);
  }
  p('');

  /* 汇总 */
  p(`── 汇总 ${line}`);
  p(`  ${S.scenes} 段：${S.ok} ✓ / ${S.failed} ✗ / ${S.skipped} 跳过（需要 GPU）${S.unselected ? `（另外 ${S.unselected} 段被 --scene 略过）` : ''}`);
  p(`  ${S.errors} 条错误 · ${S.warnings} 条警告 · 用时 ${(S.ms / 1000).toFixed(2)}s`);
  if (S.skipped) p('  ⚠ 跳过的段这次**没有被自查**（setup 要真 GPU）—— 那几段只能靠 still / check 看图');
  if (S.errors) p('  ✗ 有错误 → 退出码 1');
  else p(`  ✅ 没抓到错误${S.warnings ? '（有警告）' : ''} → 退出码 0`);
  if (!S.errors && S.warnings) p('  提醒：警告不阻断。确定性 / 交叠期黑底 / 文字出画这几类值得当场修掉再交。');
  process.stdout.write(out.join('\n') + '\n');
}

/* ══════════════════════════════════════════════════════════════ 入口 */

main()
  .then((code) => { process.exitCode = code | 0; })
  .catch((e) => {
    // 参数写错 / 任务不存在 / 工具自己崩了：都按"这次没通过"报（非零），但只说人话，不糊一屏栈
    process.stderr.write(`scene-harness：${errLine(e)}\n`);
    if (process.env.HARNESS_DEBUG) process.stderr.write(`${(e && e.stack) || e}\n`);
    process.exitCode = 1;
  });
