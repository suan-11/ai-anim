// @ts-check
/**
 * WebGL2 图形层。全片渲染就在这一层上：
 *   线性 HDR（RGBA16F）-> Pass 叠加 -> 后处理 -> 最后一步才转 sRGB。
 *
 * 单位约定（重要）：
 *   场景一律用「逻辑像素」布局：W × H（默认 1920×1080），坐标原点左上、y 向下。
 *   实际帧缓冲是 W*SCALE × H*SCALE（SCALE=2 就是真 4K）。
 *   shader 里要拿逻辑像素坐标就用 `vec2 p = FRAG_PX;`（已按 SCALE 除过），
 *   要拿物理像素就用 `gl_FragCoord.xy`。
 */

import { clamp, sat, linearToSrgb } from './util.js';
import { polySpans, circleSpans, sectorSpans } from './fill.js';
import { P as DEFAULT_PALETTE } from './palette.js';
import { TextKit } from './text.js';

/** @typedef {import('./util.js').RGB} RGB */

/**
 * 8bit 目标的 sRGB 编码表（256 项，懒加载）。
 *
 * 用途：`readPixels(rt,'srgb')` 遇到非浮点目标时，值域只有 0..255 这 256 档，
 * 逐像素算 `Math.round(sat(linearToSrgb(v/255))*255)` 是纯浪费 —— 查表结果**完全相同**
 * （表就是这么算出来的），一次构建、永久复用。
 * @returns {Uint8Array}
 */
let _srgb8 = null;
function srgb8Lut() {
  if (_srgb8) return _srgb8;
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) t[i] = Math.round(sat(linearToSrgb(i / 255)) * 255);
  _srgb8 = t;
  return t;
}

/* ------------------------------------------------------------------ 着色器公共前奏 */

/**
 * 注入到每个 Pass 的 GLSL 前缀。它已经包含：
 *   in vec2 vUv; out vec4 fragColor; uniform float t, dt; uniform vec2 res, RES_LOGICAL;
 *   uniform float PX_SCALE; uniform vec2 FRAG_PX  —— 见下面的 getter 说明
 * 以及工具函数与常量。写 shader 时**不要**重复声明这些名字。
 */
export const GLSL_COMMON = /* glsl */ `
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 fragColor;
uniform float t;        // 秒：整片时间（不是场景局部时间）
uniform float dt;       // 本帧步长（离屏渲染时是子帧间距）
uniform vec2  res;      // 物理分辨率（W*SCALE, H*SCALE）
uniform float PX_SCALE; // res.x / W
uniform vec2  RES_LOGICAL; // 逻辑分辨率（W, H）

/* GLSL ES 3.00 没有 gl_FragCoord 的逻辑版本，这里用宏 + 自算的方式提供。
   需要逻辑像素坐标时写： vec2 p = FRAG_PX;
   ⚠⚠ **FRAG_PX 的 y 是向上的**（第 0 行 = 画面**底部**，就是 gl_FragCoord 本身）。
      别和 JS 侧那套"逻辑像素 y 向下"混起来 —— post.center、ctx.setXform 的 anchor、
      lines / type 的坐标全都是 y 向下，**只有 shader 里的 FRAG_PX 是 y 向上**。
      混错的后果是"整个世界上下颠倒"，而且常常看不出来（对称的画面完全正常）：
      raymarch 的 rayDir() 曾经照抄 pdoom 又翻了一次 y，地板就跑到天上去了。
      要在 shader 里得到"y 向下"的坐标，自己写 RES_LOGICAL.y - FRAG_PX.y。 */
#define FRAG_PX (gl_FragCoord.xy / PX_SCALE)

const float PI  = 3.141592653589793;
const float TAU = 6.283185307179586;

float sat(float x) { return clamp(x, 0.0, 1.0); }
vec3  sat(vec3 x)  { return clamp(x, vec3(0.0), vec3(1.0)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

/* 把逻辑像素换算成 vUv 空间的一步：uStep(1.0) 就是 1 逻辑像素 */
vec2 uStep(float px) { return vec2(px / RES_LOGICAL); }

/* 各向异性抗锯齿的覆盖率：d 是到形状的有符号距离（逻辑像素），aa 是过渡宽度 */
float aaFill(float d, float aa) { return 1.0 - smoothstep(-aa, aa, d); }
float aaStroke(float d, float w, float aa) { return aaFill(abs(d) - w, aa); }

/* 描一根「逻辑像素宽」的细线：不管 SCALE 是 1 还是 2 都是同样的墨水浓度 */
float pxLine(float d, float a, float b) {
  float w = max(fwidth(d), 1e-5) * PX_SCALE;
  return 1.0 - smoothstep(a * w, b * w, abs(d));
}

/* 哈希 / 噪声（与 JS 侧 util.js 里的不是同一套，但同样确定性） */
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1, 0, 0));
  float n010 = hash13(i + vec3(0, 1, 0)), n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1)), n101 = hash13(i + vec3(1, 0, 1));
  float n011 = hash13(i + vec3(0, 1, 1)), n111 = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
vec2 curl2(vec2 p, float e) {
  float n1 = vnoise(p + vec2(0, e)), n2 = vnoise(p - vec2(0, e));
  float n3 = vnoise(p + vec2(e, 0)), n4 = vnoise(p - vec2(e, 0));
  return vec2(n1 - n2, n4 - n3) / (2.0 * e);
}

/* 2D 有符号距离场原料 */
float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = sat(dot(pa, ba) / max(dot(ba, ba), 1e-9));
  return length(pa - ba * h);
}
float sdRound(vec2 p, vec2 b, float r) { return sdBox(p, b - r) - r; }
float sdRing(vec2 p, float r, float w) { return abs(length(p) - r) - w; }
float sdTri(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
float smin(float a, float b, float k) {
  float h = sat(0.5 + 0.5 * (b - a) / k);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float smax(float a, float b, float k) { return -smin(-a, -b, k); }

/* 3D SDF（raymarching 用） */
float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdBox3(vec3 p, vec3 b) { vec3 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0); }
float sdTorus(vec3 p, vec2 t) { vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }
float sdCapsule3(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = sat(dot(pa, ba) / max(dot(ba, ba), 1e-9));
  return length(pa - ba * h) - r;
}
vec3 sdfNormal(vec3 p, float e, float d) {
  vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * d + k.yyx * d + k.yxy * d + k.xxx * d);
}

/* 版画 / 排线：darkness 0..1 决定墨的覆盖率，u 是排线相位（一般用世界坐标或法线角） */
float hatch(vec2 u, float darkness) {
  float f = abs(fract(u.x + u.y * 0.5) - 0.5) * 2.0;
  return mix(1.0, sat(1.0 - f / max(0.02, darkness)), step(0.001, darkness));
}
float engrave(vec2 uv, float darkness, float freq, float angle) {
  vec2 d = vec2(cos(angle), sin(angle));
  return hatch(vec2(dot(uv, d) * freq, 0.0), darkness);
}

/* 热色带：0 冷 -> 1 白热（做火花、熔化、冲击用） */
vec3 heat(float x) {
  x = sat(x);
  vec3 c = mix(C_BLOOD * 0.6, C_SIGNAL, sat(x * 2.0));
  c = mix(c, C_EMBER, sat((x - 0.35) * 2.2));
  c = mix(c, vec3(1.4, 1.15, 0.9), sat((x - 0.7) * 3.4));
  return c;
}

vec3 toSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(1e-5)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}
vec3 toLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), c));
}
`;

/** 全屏三角形顶点着色器（比 quad 少一个顶点，且没有对角线接缝）。 */
export const VERT_FULLSCREEN = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPos;
out vec2 vUv;
/**
 * **子像素抖动**（NDC；默认 0 ⇒ 逐像素与从前一致）。
 *
 * 引擎的子帧本来就是"同一帧渲 N 次"，静止时 N 张图逐像素相同、平均 = 一张图 ——
 * 于是"多子帧 AA"从来没生效过。这里把整帧按 GL.jitter 平移亚像素后再栅格化，
 * 累加就是真正的 4× 超采样（见 src/core/sampling.js 的 JITTER_GRID）。
 *
 * 之所以加在这里而不是每个场景自己算：引擎里所有 shader 都是**全屏 Pass**，
 * 顶点一移，vUv 相对屏幕就移了 —— 于是任意 shader 的采样位置都跟着变，不用改场景代码。
 * ⚠ 只对"从几何/程序化内容算出来的"内容成立；**重采样已有图像的 pass 必须退出抖动**
 * （合成器 / 拷贝 / 转场 / xform / 仪器视图），否则抖动会被叠加成"越描越糊"。
 */
uniform vec2 uJitter;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos + uJitter, 0.0, 1.0);
}`;

/* ------------------------------------------------------------------ NV12（YUV420）编码 */

/**
 * NV12 编码着色器 —— 见 `GL.readNV12()`。
 *
 *   mode 0 → 亮度平面 Y（全分辨率）
 *   mode 1 → 交错色度平面 UV（半分辨率，**2×2 盒式平均**）
 *
 * 公式 = ffmpeg 的 `scale=out_color_matrix=bt709` 对"全范围 sRGB 输入"做的事
 * （全范围 RGB → BT.709 limited 范围 YUV，4:2:0）：
 *
 *   Y'  = 16  + 219·(0.2126·R' + 0.7152·G' + 0.0722·B')
 *   Cb  = 128 + 224·(B' − Y') / 1.8556
 *   Cr  = 128 + 224·(R' − Y') / 1.5748
 *
 * ⚠ 系数作用在 **gamma 编码后**（sRGB）的 R'G'B' 上，不是线性光 —— 和 swscale 一致；
 *   先 `toSRGB` 再算，否则暗部会整片偏。
 */
const NV12_FRAG = /* glsl */ `
uniform sampler2D src;
uniform float mode;              // ⚠ 必须是 float：Pass 的数字 uniform 一律走 uniform1f，
                                 //   声明成 int 的话 uniform1f 会静默失败、mode 永远是 0
                                 //   （两个平面都渲染成亮度面 ⇒ 色度整片错，只有量具看得出来）
const vec3 KR = vec3(0.2126, 0.7152, 0.0722);
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (mode < 0.5) {
    vec3 c = sat(toSRGB(max(texelFetch(src, p, 0).rgb, vec3(0.0))));
    fragColor = vec4(vec3((16.0 + 219.0 * dot(c, KR)) / 255.0), 1.0);
  } else {
    ivec2 q = p * 2;
    vec3 s = vec3(0.0);
    for (int j = 0; j < 2; j++) {
      for (int i = 0; i < 2; i++) {
        s += sat(toSRGB(max(texelFetch(src, q + ivec2(i, j), 0).rgb, vec3(0.0))));
      }
    }
    vec3 c = s * 0.25;
    float y = dot(c, KR);
    fragColor = vec4(
      clamp(128.0 / 255.0 + (224.0 / 255.0) * (c.b - y) / 1.8556, 0.0, 1.0),
      clamp(128.0 / 255.0 + (224.0 / 255.0) * (c.r - y) / 1.5748, 0.0, 1.0),
      0.0, 1.0);
  }
}`;

/* ------------------------------------------------------------------ 渲染目标 */

export class RT {
  /**
   * @param {GL} gl
   * @param {number} w 物理像素宽
   * @param {number} h 物理像素高
   * @param {{ float?: boolean, depth?: boolean, nearest?: boolean, format?: 'r8'|'rg8' }} [opts]
   *   `format` 只对 8bit 目标生效：`'r8'` / `'rg8'` 把每像素存储降到 1 / 2 字节
   *   （NV12 回读用，见 `readNV12`）。**不传 = RGBA8，与之前逐字节相同。**
   */
  constructor(gl, w, h, opts = {}) {
    this.gl = gl;
    const g = gl.ctx;
    const float = opts.float !== false;
    const fmt = float ? null : (opts.format ?? null);
    const internal = float ? g.RGBA16F
      : fmt === 'r8' ? g.R8
        : fmt === 'rg8' ? g.RG8
          : g.RGBA8;
    const layout = float ? g.RGBA
      : fmt === 'r8' ? g.RED
        : fmt === 'rg8' ? g.RG
          : g.RGBA;
    const type = float ? g.HALF_FLOAT : g.UNSIGNED_BYTE;
    const filter = opts.nearest ? g.NEAREST : g.LINEAR;
    this.w = Math.max(1, Math.round(w));
    this.h = Math.max(1, Math.round(h));
    /** 是否浮点存储（读回时要据此选类型：RGBA16F 只能用 FLOAT 读） */
    this.float = float;
    /** 8bit 目标的 layout：null = RGBA8（默认），'r8' / 'rg8' = 单/双通道（回读要按它选格式） */
    this.format = fmt;
    this.tex = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, this.tex);
    g.texImage2D(g.TEXTURE_2D, 0, internal, this.w, this.h, 0, layout, type, null);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, filter);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, filter);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    this.fbo = g.createFramebuffer();
    g.bindFramebuffer(g.FRAMEBUFFER, this.fbo);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, this.tex, 0);
    if (opts.depth) {
      this.depth = g.createRenderbuffer();
      g.bindRenderbuffer(g.RENDERBUFFER, this.depth);
      g.renderbufferStorage(g.RENDERBUFFER, g.DEPTH_COMPONENT16, this.w, this.h);
      g.framebufferRenderbuffer(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.RENDERBUFFER, this.depth);
    }
    const status = g.checkFramebufferStatus(g.FRAMEBUFFER);
    if (status !== g.FRAMEBUFFER_COMPLETE) throw new Error(`RT incomplete: 0x${status.toString(16)} (${this.w}x${this.h})`);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
  }
  bind() {
    const g = this.gl.ctx;
    g.bindFramebuffer(g.FRAMEBUFFER, this.fbo);
    g.viewport(0, 0, this.w, this.h);
    return this;
  }
  /** 半分辨率版本（做 bloom 金字塔等） */
  half(div = 2) { return new RT(this.gl, Math.ceil(this.w / div), Math.ceil(this.h / div), { float: true }); }
  dispose() {
    const g = this.gl.ctx;
    g.deleteTexture(this.tex);
    g.deleteFramebuffer(this.fbo);
    if (this.depth) g.deleteRenderbuffer(this.depth);
  }
}

/* ------------------------------------------------------------------ GL 上下文 */

export class GL {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas, { scale = 1 } = {}) {
    const ctx = /** @type {WebGL2RenderingContext | null} */ (
      canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,          // 我们自己做 AA（逐像素 SDF + 多子帧），不要 MSAA
        depth: true,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true, // 离屏逐帧读回需要它
        powerPreference: 'high-performance',
        desynchronized: false,
      })
    );
    if (!ctx) throw new Error('这个 Chrome 没有 WebGL2。用 npm run gpu 看诊断信息。');
    this.ctx = ctx;
    this.canvas = canvas;
    /** 输出倍率：1 = 1920×1080，2 = 3840×2160（真 4K，不是放大） */
    this.scale = scale;
    /**
     * **当前子帧的亚像素抖动**（物理像素，x 向右 / y 向上；[0,0] = 不抖）。
     *
     * 由引擎在渲染每个子帧之前设置（`src/core/engine.js` 的 `addSamples`），
     * 之后自动下发到全屏 Pass（`Pass.render`）与 LineBatch（`flush`）。
     * **只有"从几何/程序化内容算出像素"的那条路该抖**；重采样已有图像的 pass 一律
     * `new Pass(gl, frag, uniforms, { jitter: false })`（见 `Pass` 构造器）。
     *
     * 为什么不是每个子帧自己算：抖动是"相机侧"的量，同一子帧里所有内容必须用**同一个**
     * 偏移，否则背景与前景会各自按不同方向抖、叠加出相对位移。
     * @type {number[]} 长度 2
     */
    this.jitter = [0, 0];

    // 线性 HDR 渲染要能写浮点色（RGBA16F）
    const cbf = ctx.getExtension('EXT_color_buffer_float');
    const cbh = ctx.getExtension('EXT_color_buffer_half_float');
    if (!cbf && !cbh) throw new Error('缺 EXT_color_buffer_float：无法渲染线性 HDR，请更新 Chrome 或换 GPU。');
    this.floatOK = true;
    // 线性过滤半浮点纹理（bloom 采样要它）
    ctx.getExtension('OES_texture_float_linear');
    ctx.getExtension('EXT_float_blend');

    this.programs = new Map();
    /**
     * 外部渲染器注册的清理回调（目前只有 Three.js 桥，见 `three-bridge.js`）。
     *
     * 为什么要有这个口子：桥自己持有一个**独立的 WebGL 上下文**，
     * 而那个上下文只能由桥自己丢。没有这条回调的话，dev 下每改一次场景就会漏一个上下文，
     * 攒到 16 个之后 Chrome 会把新建的那个变成空上下文（画面看起来像"没画"，且不报错）。
     */
    this.onDispose = [];
    /** 本上下文在页面里的唯一编号：程序缓存的 key 要按上下文隔离，见 LineBatch._program() */
    this.instanceId = (GL._nextId = (GL._nextId ?? 0) + 1);
    /**
     * 读回复用缓冲（见 `readPixels` 的说明）。
     * `_pxOut` = 返回给调用者的 8bit RGBA；`_pxTmp` = 浮点目标的 FLOAT 读回中转。
     * 尺寸变了会重新分配（4K 与 1080p 共用同一个 GL 实例时不会串）。
     * @type {Uint8Array|null}
     */
    this._pxOut = null;
    /** @type {Float32Array|null} */
    this._pxTmp = null;
    this.quad = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, this.quad);
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW);
    this.vao = ctx.createVertexArray();
    ctx.bindVertexArray(this.vao);
    ctx.bindBuffer(ctx.ARRAY_BUFFER, this.quad);
    const loc = 0;
    ctx.enableVertexAttribArray(loc);
    ctx.vertexAttribPointer(loc, 2, ctx.FLOAT, false, 0, 0);
    ctx.bindVertexArray(null);

    /** 最终一步：线性 HDR -> sRGB，直接进画布。 */
    this.blitPass = new Pass(this, /* glsl */ `
      uniform sampler2D src;
      void main() { fragColor = vec4(toSRGB(texture(src, vUv).rgb), 1.0); }`,
      { src: { value: null } }, { key: 'gl_blit', jitter: false });

    ctx.disable(ctx.DEPTH_TEST);
    ctx.disable(ctx.CULL_FACE);
    ctx.enable(ctx.BLEND);
    ctx.blendFuncSeparate(ctx.ONE, ctx.ONE_MINUS_SRC_ALPHA, ctx.ONE, ctx.ONE_MINUS_SRC_ALPHA);
    this.renderer = ctx.getParameter(ctx.RENDERER);
    this.vendor = ctx.getParameter(ctx.VENDOR);
    this.maxTex = ctx.getParameter(ctx.MAX_TEXTURE_SIZE);
    /**
     * GPU 信息**一处采集**，`check` / `gpu` / 页面 HUD 都用它。
     *
     * 为什么（`docs/history/IMPROVEMENTS-1-3.md` P2-4）：`check` 过去只打 `RENDERER`，
     * 拿不到 unmasked 串时就是一句 `WebKit WebGL`；而同机的 `anim gpu` 走的是
     * 另一条路径（自己新建一个 canvas + 拿 `WEBGL_debug_renderer_info`），
     * 能拿到 `ANGLE (AMD, AMD Radeon(TM) Graphics …, D3D11)`。
     * 两条命令说法不一致，看日志的人会以为渲染器不一样。
     * 现在两边都从这一个对象读，拿不到 unmasked 就**明确写出来**，而不是含糊。
     */
    const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
    this.rendererInfo = {
      renderer: this.renderer,
      vendor: this.vendor,
      version: ctx.getParameter(ctx.VERSION),
      /** unmasked 串可用吗（不可用时 renderer/vendor 会是笼统的 WebKit 串） */
      unmasked: !!dbg,
      unmaskedRenderer: dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      unmaskedVendor: dbg ? ctx.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
      floatRT: !!ctx.getExtension('EXT_color_buffer_float') || !!ctx.getExtension('EXT_color_buffer_half_float'),
    };
    /** 一行式摘要：优先 unmasked，拿不到就注明 */
    this.rendererLabel = this.rendererInfo.unmaskedRenderer
      || `${this.renderer}（unmasked renderer 不可用）`;
    /**
     * 本帧的绘制记账（见 `_notePaint`）。引擎在每段场景 render 之前会重置它，
     * 用来回答「这一段到底往画面里画了东西没有」——「什么都没画」以前是抓不到的。
     * @type {{ full: number, any: number, lines: number, text: number, target: any, other: number,
     *          layer: any, blocks: any[], markError?: boolean }|null}
     */
    this.paint = null;
  }

  /** 物理尺寸 */
  get PW() { return this.pw; }
  get PH() { return this.ph; }
  /** 逻辑尺寸 */
  get W() { return this.w; }
  get H() { return this.h; }

  /** 按逻辑分辨率 + 倍率设置画布尺寸。逻辑尺寸固定，物理尺寸随 SCALE 变。 */
  resize(w, h, scale = this.scale) {
    this.w = w; this.h = h; this.scale = scale;
    this.pw = Math.round(w * scale);
    this.ph = Math.round(h * scale);
    this.canvas.width = this.pw;
    this.canvas.height = this.ph;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    return this;
  }

  get aspect() { return this.w / this.h; }

  /** 编译（带缓存）一个 Pass 用的程序。 */
  program(key, fragSrc) {
    const hit = this.programs.get(key);
    if (hit) return hit;
    const g = this.ctx;
    const vs = g.createShader(g.VERTEX_SHADER);
    g.shaderSource(vs, VERT_FULLSCREEN);
    g.compileShader(vs);
    if (!g.getShaderParameter(vs, g.COMPILE_STATUS)) throw new Error(`vertex shader:\n${g.getShaderInfoLog(vs)}`);
    const fs = g.createShader(g.FRAGMENT_SHADER);
    g.shaderSource(fs, fragSrc);
    g.compileShader(fs);
    if (!g.getShaderParameter(fs, g.COMPILE_STATUS)) {
      const log = g.getShaderInfoLog(fs) ?? '';
      // 把出错的源码按行号打印出来，方便定位
      const lines = fragSrc.split('\n');
      const detail = log.replace(/ERROR: \d+:(\d+)/g, (m, n) => `${m} | ${(lines[+n - 1] ?? '').trim()}`);
      throw new Error(`fragment shader (${key}):\n${detail}`);
    }
    const p = g.createProgram();
    g.attachShader(p, vs);
    g.attachShader(p, fs);
    g.bindAttribLocation(p, 0, 'aPos');
    g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(`link (${key}):\n${g.getProgramInfoLog(p)}`);
    g.deleteShader(vs);
    g.deleteShader(fs);
    const cached = { program: p, uniforms: new Map() };
    this.programs.set(key, cached);
    return cached;
  }

  uniform(prog, name) {
    if (!prog.uniforms.has(name)) prog.uniforms.set(name, this.ctx.getUniformLocation(prog.program, name));
    return prog.uniforms.get(name);
  }

  /**
   * 直接画全屏三角形。target 为 null 表示画到画布。
   * @param {any} target
   * @param {{ blend?: boolean, full?: boolean, noFull?: boolean }} [opts]
   *        full：这次绘制是否**整帧覆盖**（`blend:false` 的全屏 Pass 是；
   *        合成器带 rect 的图层绘制不是 —— 后者要显式传 `noFull`）
   */
  blit(target = null, opts = {}) {
    const g = this.ctx;
    g.bindVertexArray(this.vao);
    if (target) { target.bind(); } else { g.bindFramebuffer(g.FRAMEBUFFER, null); g.viewport(0, 0, this.pw, this.ph); }
    g.drawArrays(g.TRIANGLES, 0, 3);
    g.bindVertexArray(null);
    this._notePaint(g, target, opts);
  }

  /**
   * 记账：这一帧往哪个目标画过东西、有没有整帧覆盖过。
   *
   * 为什么要它：**「这一段其实什么都没画」是抓不到的** —— 画面看上去有 grain 和暗角，
   * 亮度统计也远超"全黑"阈值，而底其实是一块纯黑（做 fidus 时 9 段里 8 段这样，
   * 见 docs/history/IMPROVEMENTS-1-3.md P0-2）。这里按「实际发生的绘制」记账，
   * 再和「后处理只动过多少像素」比，就能机械地判出来。
   *
   * ⚠ `blend` 必须由**调用方**明确给出（Pass 知道自己设了什么混合），
   *   不能靠 `g.isEnabled(g.BLEND)` 去猜当时的状态 —— 有内部 Pass 会把 BLEND 关掉，
   *   于是后面一次带混合的绘制会被误记成"整帧覆盖"（踩过：一段只有文字的场景被记成覆盖了整帧）。
   *
   * @param {WebGL2RenderingContext} g
   * @param {any} target 渲染目标（null = 画布）
   * @param {{ blend?: boolean, full?: boolean }} opts
   */
  _notePaint(g, target, opts = {}) {
    if (!this.paint) return;
    const blend = opts.blend ?? g.isEnabled(g.BLEND);
    // ⚠ `blend:false`（不透明）**不等于**"铺满了整帧"：合成器的图层绘制也是 blend:false
    //   （它自己保留 rect 外的像素），只有真正的全屏 Pass 才算覆盖整帧。
    if (!blend && !opts.noFull) this.paint.full++;
    this.paint.any++;
    if (this.paint.target && this.paint.target !== target) this.paint.other++;
  }

  /**
   * 开一本新的绘制账（"这一段到底画了什么"）。`layer` = 这一段自己的 2D 图层 ——
   * **版面守门只认画在这一层上的文字**（`src/layout.js` / `docs/LAYOUT.md`），
   * 引擎的字幕层与 HUD 层画在别的图层上，天然不算进去。
   *
   * ⚠ `paint.layer` 存的是这一层的**排版工具**（`layer.type`，TextKit），不是 Layer2D 本身：
   *   记账发生在 `TextKit.write()` 里，它手里只有自己（`src/core/text.js` 的 noteText 比的是
   *   `paint.layer === this`）。第一版存的是 Layer2D，判据恒假、`blocks` 永远是空的，
   *   而且不报错 —— 靠一个探针才查出来（2026-10-16）。
   * @param {any} target @param {any} [layer]
   */
  beginPaint(target = null, layer = null) {
    const p = {
      full: 0, any: 0, lines: 0, text: 0,
      target, other: 0, layer: layer?.type ?? layer ?? null,
      blocks: [], markError: false,
    };
    this.paint = p;
    return p;
  }

  /** 清屏（线性色）。 */
  clear(rt, color = [0, 0, 0], alpha = 1) {
    const g = this.ctx;
    if (rt) rt.bind(); else { g.bindFramebuffer(g.FRAMEBUFFER, null); g.viewport(0, 0, this.pw, this.ph); }
    g.clearColor(color[0], color[1], color[2], alpha);
    g.clear(g.COLOR_BUFFER_BIT | (rt && rt.depth ? g.DEPTH_BUFFER_BIT : 0));
  }

  /**
   * 读回像素（Uint8Array，RGBA，逐行自下而上）。
   *
   * 注意：浮点渲染目标（RGBA16F）**不能**用 UNSIGNED_BYTE 读回——实测会返回全 0
   * 并留下一个 INVALID_OPERATION。所以这里先用 FLOAT + Float32Array 读，再自己转成 8bit。
   *
   * ⚠ `encode` 默认是 `'none'`：**原样读线性值**。这是给调试用的（看 HDR 里的真实数值）。
   *   要存图/推流给 ffmpeg 必须用 `'srgb'`，否则成片会比预览暗一大截（见 ENGINE.md §2.3）。
   *
   * ## ⚡ 返回的是**内部缓冲**（复用，不是新数组）
   *
   * 1080p 一帧的中间量是 33MB（RGBA16F ⇒ FLOAT 读回的 Float32Array）+ 8.3MB（结果），
   * **每帧 new 一次**实测要 **195ms/帧**，而复用同一个缓冲只要 **6.4ms**（同一台机器、
   * 同一帧，见 `out/_probe/srgb-lut-check.mjs`）—— 差的是分配（33MB 清零 + 缺页 + GC）。
   * 出片时这条路径每帧都走，所以：
   *
   * · **返回值和下一次 `readPixels()` 共享内存**，不要保存引用跨过下一次调用；
   * · 需要留一份就 `new Uint8Array(buf)`，或传 `{ copy: true }`；
   * · 跨 `await` 的两帧比较（`app.js` 的 `diff()`）必须显式复制 —— 那里已经这么写了。
   *
   * 数学一点没变（还是 FLOAT 读回 + 逐通道 `Math.round(sat(linearToSrgb(v))*255)`），
   * 所以画面与改之前**逐像素相同**（`hashes --baseline` 可验证）。
   *
   * @param {RT} rt
   * @param {'none'|'srgb'} [encode]
   * @param {{ copy?: boolean }} [opts] `copy: true` ⇒ 返回独立副本（默认复用内部缓冲）
   */
  readPixels(rt, encode = 'none', opts = {}) {
    const g = this.ctx;
    const n = rt.w * rt.h * 4;
    // 用局部变量而不是直接 `this._pxOut` 是**有意的**：热循环里访问 `this.xxx` 会让
    // V8 的类型反馈带上「可能是 null」，循环就跑不进最快那一档（实测差 10 倍以上）。
    let buf = this._pxOut;
    if (buf === null || buf.length !== n) {
      buf = new Uint8Array(n);
      this._pxOut = buf;
      this._pxTmp = new Float32Array(n);
    }
    const out = /** @type {Uint8Array} */ (buf);
    rt.bind();
    if (rt.float === false) {
      g.readPixels(0, 0, rt.w, rt.h, g.RGBA, g.UNSIGNED_BYTE, out);
      if (encode === 'srgb') {
        // 8bit 目标只有 256 个可能取值 ⇒ 查表，与逐像素直算**完全相同**（同一个公式）。
        const lut = srgb8Lut();
        for (let i = 0; i < n; i++) out[i] = lut[out[i]];
      }
      return opts.copy ? new Uint8Array(out) : out;
    }
    const f = /** @type {Float32Array} */ (this._pxTmp);
    g.readPixels(0, 0, rt.w, rt.h, g.RGBA, g.FLOAT, f);
    if (encode === 'srgb') {
      for (let i = 0; i < n; i++) {
        const v = f[i] <= 0 ? 0 : f[i];
        out[i] = Math.round(sat(linearToSrgb(v)) * 255);
      }
    } else {
      // 与原实现逐字节等价：`NaN >= 1` 为假 ⇒ Math.round(NaN) ⇒ 写进 Uint8Array 得 0
      for (let i = 0; i < n; i++) {
        const v = f[i] <= 0 ? 0 : f[i];
        out[i] = v >= 1 ? 255 : Math.round(v * 255);
      }
    }
    return opts.copy ? new Uint8Array(out) : out;
  }

  /** 读回**显示空间**（已做 linear→sRGB 编码）的像素，与画布上看到的一致。存图/编码走它。 */
  readDisplayPixels(rt) { return this.readPixels(rt, 'srgb'); }

  /**
   * 把线性光的合成结果编码成 **NV12**（BT.709 limited range，4:2:0），给 ffmpeg 推流用。
   *
   * ## 为什么要它
   * 出片的瓶颈是**传输**：Chrome→Node 的 ws 上限约 110MB/s，而 1080p 一帧 RGBA 是 8.3MB
   * ⇒ 每帧 ~73ms（`docs/PERF.md` §5.3，攒帧也救不了）。在 GPU 上先转成 YUV420 再传，
   * 每帧只要 3.11MB（**-62%**），而且 ffmpeg 那一侧连色彩转换都不用做了。
   *
   * ## 画质
   * 成片**本来就是** yuv420p（`-pix_fmt yuv420p`），色度二次采样早就发生了 ——
   * 这里只是把"同一个 4:2:0 转换"从 ffmpeg 的 swscale 挪到 GPU 上做，**不是新增一次损失**。
   * 唯一会变的是色度下采样的滤波器核（这里是 2×2 盒式平均，swscale 用 bicubic）——
   * 差异只出现在彩色边缘、亚像素级，`verify` 的容差能覆盖（见 `docs/PERF.md` §5.4a）。
   *
   * 两条路（`readPixels(rt,'srgb')` 与这里）必须给出同一张画面：`tools/probe-nv12.mjs`
   * 就是把 GPU 的 NV12 与"CPU 从 RGBA 现算的 NV12"逐字节比，判据是 ±1 以内。
   *
   * @param {RT} rt 线性光的渲染目标（一般是 `engine.outRT`）
   * @returns {Uint8Array} NV12：先 Y 平面（w×h），再交错 UV 平面（w/2 × h/2，U,V,U,V…）；
   *   行序**自下而上**，与 `readPixels` 一致（ffmpeg 那侧统一 `vflip`）
   */
  readNV12(rt) {
    const g = this.ctx;
    const w = rt.w, h = rt.h;
    const uw = w >> 1, uh = h >> 1;
    let st = this._nv12;
    if (!st || st.w !== w || st.h !== h) {
      st = this._nv12 = {
        w, h,
        // 两个平面按 1 / 2 字节每像素存储（R8 / RG8）—— 回读量因此从
        // 「Y 按 RGBA 读 8.29MB + UV 2.07MB = 10.37MB」降到「2.07 + 1.04 = 3.11MB」，
        // 也不再需要 CPU 紧凑化了。
        // ANGLE 对 R8/RG8 的 readPixels(RED/RG) 支持由 `tools/probe-r8.mjs` 钉住。
        y: new RT(this, w, h, { float: false, format: 'r8' }),
        uv: new RT(this, uw, uh, { float: false, format: 'rg8' }),
        pass: new Pass(this, NV12_FRAG, { src: rt, mode: 0 }, { key: 'nv12_encode', blend: false }),
        buf: new Uint8Array((w * h * 3) >> 1),
      };
      // 这一笔不是"画面的一部分"：别让它进背景守门的记账（`_notePaint`）
      st.pass.noFull = true;
    }
    const p = st.pass;
    p.set({ src: rt, mode: 0 });
    p.render(this, st.y, 0, 0);
    p.set({ mode: 1 });
    p.render(this, st.uv, 0, 0);

    const out = st.buf;
    // ⚠ `PACK_ALIGNMENT` 默认是 4：R8/RG8 的行宽不是 4 的倍数时 readPixels 会给**每一行**
    //   补到 4 字节边界（probe-r8 量到 13 像素宽的 R8 行距是 16），直接按紧凑布局喂给
    //   ffmpeg 会整片错位。钉成 1 之后两个平面直接落进 `out` 的连续区间 ——
    //   以前那两行「逐像素抽 R / RG」的循环因此整个删掉。
    g.pixelStorei(g.PACK_ALIGNMENT, 1);
    st.y.bind();
    g.readPixels(0, 0, w, h, g.RED, g.UNSIGNED_BYTE, out.subarray(0, w * h));
    st.uv.bind();
    g.readPixels(0, 0, uw, uh, g.RG, g.UNSIGNED_BYTE, out.subarray(w * h, w * h + uw * uh * 2));
    g.pixelStorei(g.PACK_ALIGNMENT, 4);
    return out;
  }

  dispose() {
    for (const f of this.onDispose ?? []) {
      try { f(); } catch { /* 清理失败不该把 dispose 整个打断 */ }
    }
    this.onDispose = [];
    for (const p of this.programs.values()) this.ctx.deleteProgram(p.program);
    this.programs.clear();
  }
}

/* ------------------------------------------------------------------ 全屏 Pass */

/**
 * 一个全屏片段着色器。frag 里直接写 void main(){ fragColor = ...; }，
 * 自动带上 GLSL_COMMON（vUv / t / res / C_INK … / 噪声 / SDF）。
 *
 *   const bg = new Pass(gl, `uniform vec3 k; void main(){ fragColor = vec4(C_INK*k, 1.0); }`, { k: [1,1,1] });
 *   bg.set({ k: [0.5,0.5,0.5] }).render(gl, target);
 */
export class Pass {
  /**
   * @param {GL} gl
   * @param {string} frag
   * @param {Record<string, any>} [uniforms] 初值；数组长度决定 vec2/vec3/vec4，数字是 float，纹理是 texture 对象
   * @param {{ palette?: string, key?: string, blend?: boolean, jitter?: boolean }} [opts]
   *        `jitter: false` = **这一笔退出子像素抖动**。凡是"把已有图像重新采样一遍"的 pass
   *        （合成器 / 拷贝 / 转场混合 / xform / 仪器视图 / 降采样）都必须写它：
   *        它们的输入已经是抖过的内容，再抖一次等于把画面又平移一次 —— 多个 pass 叠起来
   *        就会变成"越描越糊"（早期内容比后画的糊，而且随 pass 数量增加）。
   *        默认 `true`：场景自己 new 的 Pass（背景 / raymarch / world）**应该**参与抖动。
   */
  constructor(gl, frag, uniforms = {}, opts = {}) {
    this.gl = gl;
    this.key = opts.key ?? `pass_${hashString(frag)}`;
    this.blend = opts.blend ?? true;
    /** 这一笔要不要吃 `gl.jitter`（见构造器的 `jitter` 选项） */
    this.jitter = opts.jitter !== false;
    // 调色板以 GLSL 常量的形式注入（C_INK / C_SIGNAL …），任务可以在 task.config 里覆盖。
    // 后处理链也要用它（heat() 等函数），所以默认注入全局调色板。
    const pal = opts.palette ?? DEFAULT_PALETTE;
    const palSrc = typeof pal === 'string' ? pal : pal?.glsl?.() ?? '';
    // 精度限定符必须在调色板常量之前（const 里的小数需要精度）
    const src = `#version 300 es\nprecision highp float;\nprecision highp int;\n${palSrc}${GLSL_COMMON}\n${frag}`;
    this.prog = /** @type {any} */ (null);
    this.src = src;
    /** 记账用：这一笔不是"铺满整帧"（合成器的图层绘制会置位，见 Compositor.draw） */
    this.noFull = false;
    /** @type {Record<string, any>} */
    this.u = {};
    for (const k of Object.keys(uniforms)) this.u[k] = { value: uniforms[k] };
    this._ready = false;
  }

  /** 延迟到第一次 render 才编译（这样 palette 之类的注入已经就绪）。 */
  _ensure() {
    if (this._ready) return;
    this.prog = this.gl.program(this.key, this.src);
    this._ready = true;
  }

  /** 设置 uniform。也可以直接写 p.u.k.value = x。 */
  set(values) {
    for (const [k, v] of Object.entries(values)) {
      if (!this.u[k]) this.u[k] = { value: v };
      else this.u[k].value = v;
    }
    return this;
  }

  /** 声明一个之后会用到的 uniform（可选的显式写法）。 */
  declare(name, value) {
    this.u[name] = { value };
    return this;
  }

  /**
   * uniform 值不对劲时点名（每个名字只说一次）。
   * 见 `render()` 里那段注释：静默保持 0 的 uniform 会把"写错了"变成"画面很奇怪"。
   */
  _warnUniform(name, why) {
    this._warned ??= new Set();
    if (this._warned.has(name)) return;
    this._warned.add(name);
    console.warn(
      `[Pass ${this.key}] uniform \`${name}\` ${why} —— 它会是 0，shader 不会报错。` +
      `检查拼写 / 字段名（例如 camera3() 给的是 pos/right/up/fwd，不是 camPos/camR/camU/camF）。`,
    );
  }

  render(gl, target = null, time = 0, dt = 1 / 60) {
    this._ensure();
    const g = gl.ctx;
    g.useProgram(this.prog.program);
    // 子像素抖动：全屏三角形的顶点一移，vUv 相对屏幕就移了 —— 任意 shader 的采样位置都跟着变。
    // `jitter: false` 的 pass 显式写 0（不能"留上一次的值"：同一个程序会被不同 pass 复用）。
    {
      const loc = gl.uniform(this.prog, 'uJitter');
      if (loc !== null && loc !== undefined) {
        const j = this.jitter ? gl.jitter : null;   // 缺字段 = 不抖（离线单测的假 gl 没有它）
        g.uniform2f(loc, j ? (j[0] * 2) / gl.pw : 0, j ? (j[1] * 2) / gl.ph : 0);
      }
    }
    g.uniform1f(gl.uniform(this.prog, 't'), time);
    g.uniform1f(gl.uniform(this.prog, 'dt'), dt);
    g.uniform2f(gl.uniform(this.prog, 'res'), gl.pw, gl.ph);
    g.uniform2f(gl.uniform(this.prog, 'RES_LOGICAL'), gl.w, gl.h);
    g.uniform1f(gl.uniform(this.prog, 'PX_SCALE'), gl.scale);
    let unit = 0;
    for (const [name, u] of Object.entries(this.u)) {
      if (u === undefined) continue;
      const v = u.value;
      const loc = gl.uniform(this.prog, name);
      if (loc === null || loc === undefined) continue;
      // ⚠ 静默的 uniform 是"整屏白/黑"这类事故最常见的根子：值写成 `undefined`
      //   （典型：`{ camPos: c.pos }` 字段名对不上、参数对象拼错、可选字段没给），
      //   或者算出来是 `NaN`。这两种情况下 uniform 会**保持 0**，shader 照样跑完、
      //   照样不报错，只是画面变成一个说不清的东西（`normalize(vec3(0))` = NaN → 整屏白）。
      //   所以这里点名，每个 (pass, uniform) 只说一次，避免每帧刷屏。
      if (v === undefined) { this._warnUniform(name, '值是 undefined'); continue; }
      if (typeof v === 'number' && !Number.isFinite(v)) { this._warnUniform(name, `值是 ${v}`); continue; }
      if (typeof v === 'number') g.uniform1f(loc, v);
      else if (typeof v === 'boolean') g.uniform1i(loc, v ? 1 : 0);
      else if (v && v.__tex) {
        g.activeTexture(g.TEXTURE0 + unit);
        g.bindTexture(g.TEXTURE_2D, v.tex);
        g.uniform1i(loc, unit);
        unit++;
      } else if (Array.isArray(v) || v instanceof Float32Array) {
        const a = v;
        if (a.length === 2) g.uniform2f(loc, a[0], a[1]);
        else if (a.length === 3) g.uniform3f(loc, a[0], a[1], a[2]);
        else if (a.length === 4) g.uniform4f(loc, a[0], a[1], a[2], a[3]);
        else if (a.length === 9) g.uniformMatrix3fv(loc, false, a);
        else if (a.length === 16) g.uniformMatrix4fv(loc, false, a);
        else if (a.length > 16) g.uniform1fv(loc, a);
      } else if (v && v.tex) {
        g.activeTexture(g.TEXTURE0 + unit);
        g.bindTexture(g.TEXTURE_2D, v.tex);
        g.uniform1i(loc, unit);
        unit++;
      }
    }
    let noteBlend = this.blend;
    if (this.blend) {
      g.enable(g.BLEND);
      if (this.blendFn === 'add') {
        // 纯加法（子帧累加用）：src + dst
        g.blendEquation(g.FUNC_ADD);
        g.blendFuncSeparate(g.ONE, g.ONE, g.ZERO, g.ONE);
      } else if (this.blendFn === 'max') {
        g.blendEquation(g.MAX);
        g.blendFunc(g.ONE, g.ONE);
      } else {
        // 直通 alpha 混合（shader 输出直通色，由混合器乘 alpha）
        g.blendEquation(g.FUNC_ADD);
        g.blendFuncSeparate(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA, g.ONE, g.ONE_MINUS_SRC_ALPHA);
      }
    } else {
      g.disable(g.BLEND);
      g.blendEquation(g.FUNC_ADD);
      noteBlend = false;
    }
    gl.blit(target, { blend: noteBlend, full: true, noFull: this.noFull });
    return this;
  }}

/* ------------------------------------------------------------------ 2D 图层（文字 / 图形） */

/**
 * 一张逻辑分辨率（×SCALE）的 Canvas2D，画完上传成纹理叠到场景上。
 * Canvas2D 用 sRGB 颜色：用 css(P.signal, 0.8) 取色。
 * 注意：文字与图形都走这里，每帧上传一次（1080p 约 1–3 ms，4K 约 4 倍）。
 */
export class Layer2D {
  /** @param {GL} gl @param {number} [w] @param {number} [h] */
  constructor(gl, w = gl.w, h = gl.h) {
    this.gl = gl;
    this.w = w; this.h = h;
    this.canvas = document.createElement('canvas');
    this.ctx = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d', { willReadFrequently: false }));
    /**
     * 这一层自己的排版工具。**必须一层一个**：
     * TextKit 把字体/字距状态存在 ctx 上，如果所有图层共用一个 TextKit，
     * 场景画字就会画到别的画布上去（踩过：文字全部凭空消失）。
     */
    this.type = new TextKit(this.ctx);
    /**
     * 把这一层所属的 GL 转给排版工具 —— **版面守门靠它记账**（`src/core/text.js` 的 noteText
     * 要读 `gl.paint`：这一帧画在**哪一层**、画了几块字）。以前 TextKit 上没有这个字段，
     * 判据恒假、`paint.blocks` 永远是空的（而且不报错）—— 2026-10-16 用探针查出来的。
     */
    this.type.gl = gl;
    this.resize(gl.scale);
    const g = gl.ctx;
    this.tex = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, this.tex);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    this.dirty = true;
    this.__tex = true;
  }
  resize(scale) {
    this.scale = scale;
    this.canvas.width = Math.round(this.w * scale);
    this.canvas.height = Math.round(this.h * scale);
    // 让所有绘制代码继续用逻辑像素
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this._alloc = false;
    this._uploaded = false;
    this.type?.clearCache?.();
  }
  /** 清空（默认全透明）。每次绘制新的一帧都要先调用它。 */
  clear() {
    const c = this.ctx;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.restore();
    this.dirty = true;
    this._uploaded = false;
    return this;
  }
  /** 画满整块画布（做纸底色等） */
  fill(color) {
    const c = this.ctx;
    c.save();
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.fillStyle = color;
    c.fillRect(0, 0, this.w, this.h);
    c.restore();
    this.dirty = true;
    this._uploaded = false;
    return this;
  }
  /**
   * 上传到 GPU，返回可当 uniform 传的纹理句柄。
   *
   * 注意两个坑（都踩过）：
   *   1) Chrome 对「同一张 canvas 连续 texImage2D」只留最后一次提交，纹理内容可能还是上一帧的。
   *      所以这里第一次上传用 texImage2D 建立 SRGB8_ALPHA8 存储，之后一律用 texSubImage2D。
   *   2) 不要翻转 Y 轴：合成器的 shader 负责把「逻辑坐标 y 向下」映射到「vUv 的 y 向上」。
   *      两边都翻会互相抵消，画面就上下颠倒。
   */
  upload() {
    if (this._uploaded) return this;   // 同一帧内多处调用只上传一次（一帧要传 ~8MB）
    const g = this.gl.ctx;
    g.bindTexture(g.TEXTURE_2D, this.tex);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (!this._alloc) {
      // SRGB8_ALPHA8：硬件把 Canvas2D 的 sRGB 值解码成线性光，之后一切都在线性空间里算
      g.texImage2D(g.TEXTURE_2D, 0, g.SRGB8_ALPHA8, g.RGBA, g.UNSIGNED_BYTE, this.canvas);
      this._alloc = true;
    } else {
      g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, g.RGBA, g.UNSIGNED_BYTE, this.canvas);
    }
    this.dirty = false;
    this._uploaded = true;
    return this;
  }
  get texHandle() { return this.tex; }
  /**
   * **这一层自己的排版工具**（= `this.type`）。暴露给版面守门用：
   * 文字宽度必须在**同一个 TextKit 实例**上量（字体栈/字距缓存都在实例里），
   * 拿别的实例量出来的宽度会差一截（`src/layout.js` 的判据依赖它）。
   */
  get typekit() { return this.type; }
  dispose() { this.gl.ctx.deleteTexture(this.tex); }
}

/* ------------------------------------------------------------------ 合成器 */

/**
 * 把一个纹理叠到目标上。这是场景里叠图层的通用手段：
 *   comp.draw(gl, layer.upload(), out)                       // 正常叠加
 *   comp.draw(gl, rt.texture, out, { mode: 'add', tint: P.signal, opacity: 0.6 })
 *
 * 实现方式：一个全屏 pass 同时读「源图层」和「目标」两张纹理，算完再写回去。
 * 这样不存在「读自己写自己」的反馈回路（那是未定义行为，实测整层消失），
 * 也不需要中间缓冲——中间缓冲那条路会让未被覆盖的像素被清掉，等于把整帧擦掉。
 *
 * mode: normal | add | screen | multiply | max | min | overlay
 * premult：源纹理是否已经乘过 alpha（Canvas2D 画布是 premultiplied，传 true）
 */
export class Compositor {
  constructor(gl) {
    this.gl = gl;
    this.work = null;
    this.alt = null;
    this.pass = new Pass(gl, /* glsl */ `
      uniform sampler2D src;
      uniform sampler2D src2;
      uniform int  mode;
      uniform float opacity;
      uniform vec3 tint;
      uniform vec4 rect;     // x, y, w, h（目标区域，逻辑像素）
      uniform vec4 uvRect;   // 源采样矩形 (u0, v0, du, dv)
      uniform float premult;
      void main() {
        // 先取目标，任何情况下都要原样保留未被覆盖的像素
        vec3 dst = texture(src2, vUv).rgb;

        vec2 p = FRAG_PX;
        bool inside = p.x >= rect.x && p.x < rect.x + rect.z && p.y >= rect.y && p.y < rect.y + rect.w;
        if (!inside) { fragColor = vec4(dst, 1.0); return; }

        vec2 uv = uvRect.xy + (p - rect.xy) / rect.zw * uvRect.zw;
        uv.y = 1.0 - uv.y;              // 逻辑坐标 y 向下，vUv 的 y 向上
        vec4 s = texture(src, uv);
        if (premult > 0.5) s.rgb /= max(s.a, 1e-4);   // 还原成直通 alpha
        s.rgb *= tint;
        float a = clamp(s.a * opacity, 0.0, 1.0);
        vec3 col;
        if (mode == 0)      col = mix(dst, s.rgb, a);                       // normal
        else if (mode == 1) col = dst + s.rgb * a;                          // add
        else if (mode == 2) col = 1.0 - (1.0 - dst) * (1.0 - s.rgb * a);    // screen
        else if (mode == 3) col = dst * mix(vec3(1.0), s.rgb, a);           // multiply
        else if (mode == 4) col = max(dst, s.rgb * a);                      // max
        else if (mode == 5) col = min(dst, mix(vec3(1.0), s.rgb, a));       // min
        else if (mode == 6) {                                               // overlay
          vec3 lo = 2.0 * dst * s.rgb;
          vec3 hi = 1.0 - 2.0 * (1.0 - dst) * (1.0 - s.rgb);
          col = mix(dst, mix(lo, hi, vec3(greaterThanEqual(dst, vec3(0.5)))), a);
        } else col = mix(dst, s.rgb, a);
        fragColor = vec4(col, 1.0);
      }`, {
      src: { value: null }, src2: { value: null }, mode: 0, opacity: 1,
      tint: [1, 1, 1], rect: [0, 0, 1920, 1080], uvRect: [0, 0, 1, 1], premult: 0,
    }, { key: 'compositor_draw', blend: false, jitter: false });   // 重采样已有内容：不吃抖动
    this.copy = new Pass(gl, /* glsl */ `
      uniform sampler2D src; uniform float opacity;
      void main() { fragColor = vec4(texture(src, vUv).rgb, opacity); }`,
      { src: { value: null }, opacity: 1 }, { key: 'compositor_copy', jitter: false });
  }

  /** 目标尺寸变了就换掉内部缓冲。 */
  _sync(gl) {
    if (!this.sink || this.sink.w !== gl.pw || this.sink.h !== gl.ph) {
      this.sink?.dispose();
      this.sink = new RT(gl, gl.pw, gl.ph);
    }
    return this.sink;
  }

  /**
   * 叠图层。做法：先把目标拷进内部快照，再「读快照 + 读图层 -> 写回目标」。
   *
   * 为什么不能直接「读目标 + 写目标」：WebGL 规范规定「纹理既是当前 framebuffer 的附件、
   * 又当采样源」是**未定义行为**，实测那个 sampler 采出来全黑——于是整帧内容被静默丢掉。
   * 多一次快照拷贝（4K 下约 1–2 ms）换来绝对正确，很划算。
   *
   * @param {GL} gl
   * @param {any} tex0 源图层（Layer2D 或 RT）
   * @param {RT} target 目标（内容会被更新）
   * @param {{ mode?: string|number, opacity?: number, tint?: RGB, rect?: number[], uvRect?: number[], premult?: boolean }} [opts]
   */
  draw(gl, tex0, target, opts = {}) {
    const modes = { normal: 0, add: 1, screen: 2, multiply: 3, max: 4, min: 5, overlay: 6 };
    const mode = typeof opts.mode === 'string' ? (modes[opts.mode] ?? 0) : (opts.mode ?? 0);
    const vh = gl.h;
    const rect = opts.rect ?? [0, 0, gl.w, gl.h];
    const uvRect = opts.uvRect ?? [0, 0, 1, 1];
    const from = this._snapshot(gl, target);
    this.pass.u.src.value = tex(tex0);
    this.pass.u.src2.value = tex(from);
    this.pass.set({
      mode,
      opacity: opts.opacity ?? 1,
      tint: opts.tint ?? [1, 1, 1],
      // 目标区域是逻辑像素、y 向下；shader 里 vUv 的 y 向上，所以翻一下
      rect: [rect[0], vh - rect[1] - rect[3], rect[2], rect[3]],
      uvRect: [uvRect[0], uvRect[1], uvRect[2], uvRect[3]],
      premult: opts.premult ? 1 : 0,
    });
    // 这一笔只是"往画面上叠了一层"（rect 之外原样保留），不是铺满整帧
    this.pass.noFull = true;
    this.pass.render(gl, target, 0, 1 / 60);
    this.pass.noFull = false;
    return this;
  }
  /** 内部快照缓冲（尺寸随输出变）。 */
  _snapshot(gl, target) {
    for (const k of ['work', 'alt']) {
      const rt = this[k];
      if (!rt || rt.w !== gl.pw || rt.h !== gl.ph) {
        rt?.dispose();
        this[k] = new RT(gl, gl.pw, gl.ph);
      }
    }
    // 每次交替用哪一张，避免「上次的快照」被这次覆盖时还在被采样
    this._snapFlip = !this._snapFlip;
    const buf = this._snapFlip ? this.work : this.alt;
    // ⚠ 快照是纯粹的内部搬运，不是"这一段画了东西" —— 记账要跳过它，
    //   否则「漏画背景」的场景会因为 comp.draw 的快照而看起来"画过了"。
    const paint = gl.paint;
    gl.paint = null;
    this.blitBack(gl, target, buf);
    gl.paint = paint;
    return buf;
  }

  /** 把一张纹理整幅拷到目标（安全版：绝不读自己）。 */
  blitBack(gl, from, target) {
    if (from === target) return this;
    if (!this.passthrough) {
      this.passthrough = new Pass(gl, /* glsl */ `
        uniform sampler2D src;
        void main() { fragColor = texture(src, vUv); }`,
        { src: { value: null } }, { key: 'compositor_passthrough', blend: false, jitter: false });
    }
    this.passthrough.u.src.value = tex(from);
    this.passthrough.render(gl, target, 0, 1 / 60);
    return this;
  }

  /** 单纯拷贝（等比混合），给过渡用。 */
  copyOver(gl, tex0, target, opacity = 1) {
    this.copy.u.src.value = tex(tex0);
    this.copy.u.opacity.value = opacity;
    // 引擎内部的拷贝不算"某一段画了东西"（否则会污染 worldAudit 的记账）
    const paint = gl.paint;
    gl.paint = null;
    this.copy.render(gl, target, 0, 1 / 60);
    gl.paint = paint;
    return this;
  }

  /** a、b 两张图按 k 混合，结果进 target。场景做自定义转场时用（f.under 是上一个场景）。 */
  mixTo(gl, aTex, bTex, k, target) {
    if (!this.mixPass) {
      this.mixPass = new Pass(gl, /* glsl */ `
        uniform sampler2D a; uniform sampler2D b; uniform float k;
        void main() { fragColor = vec4(mix(texture(a, vUv).rgb, texture(b, vUv).rgb, k), 1.0); }`,
        { a: { value: null }, b: { value: null }, k: 0 }, { key: 'compositor_mix', jitter: false });
    }
    this.mixPass.u.a.value = tex(aTex);
    this.mixPass.u.b.value = tex(bTex);
    this.mixPass.u.k.value = k;
    this.mixPass.render(gl, target, 0, 1 / 60);
    return this;
  }
}

/* ------------------------------------------------------------------ 线段批（GPU 胶囊） */

/**
 * 一条线一批：GPU 端把「线段」画成胶囊，一次 draw call 能画上万条。
 * 这是做矢量插画、图表、手写笔迹、粒子轨迹的主力。
 *
 * 坐标用逻辑像素，原点左上，y 向下。
 *   const L = new LineBatch(gl, 20000);
 *   L.begin(); L.seg(x0,y0,x1,y1, width, color); L.polyline(pts, width, color); L.flush(out);
 */
export class LineBatch {
  /** @param {GL} gl @param {number} capacity 最多多少条线段 */
  constructor(gl, capacity = 20000) {
    this.gl = gl;
    this.capacity = capacity;
    const g = gl.ctx;
    // 每条线段 6 顶点；每顶点 13 个 float：aA(2) aB(2) aWidth(1) aColor(4) aCorner(2) aSide(1) aU(1)
    this.data = new Float32Array(capacity * 6 * 13);
    this.offset = 0;
    this.buf = g.createBuffer();
    this.vao = g.createVertexArray();
    // 先编译程序：attribute 位置由 layout(location=…) 固定在 shader 里
    this.progPair = this._program();
    g.bindVertexArray(this.vao);
    g.bindBuffer(g.ARRAY_BUFFER, this.buf);
    g.bufferData(g.ARRAY_BUFFER, this.data.byteLength, g.DYNAMIC_DRAW);
    const stride = 13 * 4;
    const attrs = /** @type {[string, number][]} */ ([
      ['aA', 2], ['aB', 2], ['aWidth', 1], ['aColor', 4], ['aCorner', 2], ['aSide', 1], ['aU', 1],
    ]);
    let off = 0;
    for (const [name, size] of attrs) {
      const loc = g.getAttribLocation(this.progPair.program, name);
      if (loc >= 0) {
        g.enableVertexAttribArray(loc);
        g.vertexAttribPointer(loc, size, g.FLOAT, false, stride, off);
      }
      off += size * 4;
    }
    g.bindVertexArray(null);
  }

  _program() {
    const g = this.gl.ctx;
    const src = `#version 300 es
precision highp float;
layout(location=0) in vec2 aA;
layout(location=1) in vec2 aB;
layout(location=2) in float aWidth;
layout(location=3) in vec4 aColor;
layout(location=4) in vec2 aCorner;   // -1..1 沿线段方向
layout(location=5) in float aSide;    // -1 或 1：法线方向
layout(location=6) in float aU;       // 0..1 沿线段的参数（做渐变/虚线）
uniform vec2 RES_LOGICAL;             // 逻辑分辨率（顶点用逻辑像素，换算与 SCALE 无关）
uniform vec2 uJitter;                 // 子像素抖动（NDC，y 向上；0 = 不抖）
out vec2 vP; out float vW; out vec4 vC; out float vU; out vec2 vA; out vec2 vB;
void main() {
  // 子像素抖动：**平移几何本身**（逻辑像素，y 向下），而不是只挪 gl_Position。
  //
  // 为什么不能只挪 gl_Position：覆盖率的 AA 是在片元里按 vA / vB 算距离的，
  // 几何挪了而端点没挪，边缘带就跟栅格化足迹错开 —— 结果不是更平滑，而是四个子帧
  // 各自按同一条曲线取值（等于没抖）。所以 a / b 与 vA / vB 一起平移。
  vec2 jit = vec2(uJitter.x * 0.5 * RES_LOGICAL.x, -uJitter.y * 0.5 * RES_LOGICAL.y);
  vec2 a = aA + jit, b = aB + jit;
  vec2 d = b - a;
  float len = max(length(d), 1e-5);
  vec2 dir = d / len;
  vec2 nrm = vec2(-dir.y, dir.x);
  // **宽度为负 = "带"（band）**：填充面的扫描行用它（见 LineBatch.fillRect 的注释）。
  // 胶囊要 1.5px 余量给圆头抗锯齿；带是**硬边矩形**，不能有余量 —— 余量会让相邻两行重叠，
  // 半透明填充就会被叠两遍（实测 alpha 0.5 的面：应 188 实测 194～236，行距越细越浓）。
  float wt = abs(aWidth);
  float hw = wt * 0.5 + (aWidth > 0.0 ? 1.5 : 0.0);
  vec2 p = mix(a, b, (aCorner.x * 0.5 + 0.5)) + nrm * aSide * hw;
  vP = p; vW = aWidth; vC = aColor; vU = aU; vA = a; vB = b;
  // 用**逻辑**分辨率换算裁剪空间：p 本来就是逻辑像素，除以逻辑尺寸得到的 NDC 与 SCALE 无关。
  // （曾经用物理 res 再靠 PX_SCALE 还原，SCALE>1 时几何会落错位置/被裁掉 —— 4K 下矢量消失的根因。）
  // 几何已经平移过了（见上面的 jit），这里**不能再加** uJitter —— 加了就是 2 倍位移。
  vec2 clip = (p / RES_LOGICAL) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;
    // ⚠ 程序缓存的 key 必须**带上上下文**：一张页面里可能存在多个 WebGL2 上下文
    //   （引擎自己一个、页面上别的 canvas 又一个）。只按源码哈希做 key 的话，
    //   第二个上下文会拿到第一个上下文的 program 对象 —— 那是**别的上下文的程序**，
    //   在当前上下文里画不出任何东西（而且不报错）。踩过：诊断脚本里 LineBatch 全黑。
    const key = `linebatch_v2#${this.gl.instanceId}`;   // v2 = 加了 uJitter（子像素抖动）
    const hit = this.gl.programs.get(key);
    const p = hit ?? (() => {
      const vs = g.createShader(g.VERTEX_SHADER);
      g.shaderSource(vs, src); g.compileShader(vs);
      if (!g.getShaderParameter(vs, g.COMPILE_STATUS)) throw new Error('LineBatch VS:\n' + g.getShaderInfoLog(vs));
      const fs = g.createShader(g.FRAGMENT_SHADER);
      g.shaderSource(fs, `#version 300 es
precision highp float;
in vec2 vP; in float vW; in vec4 vC; in float vU; in vec2 vA; in vec2 vB;
out vec4 fragColor;
uniform vec2 res;
uniform float PX_SCALE;
void main() {
  vec2 d = vB - vA; float len = max(length(d), 1e-5); vec2 dir = d / len;
  // vA/vB 是逻辑像素（原点左上、y 向下）；gl_FragCoord 是物理像素（左下原点）。
  // 先换回逻辑像素并翻 y，再算距离。直接拿物理像素去比会整体错位一倍（踩过）。
  vec2 q = gl_FragCoord.xy / PX_SCALE;
  q.y = res.y / PX_SCALE - q.y;
  float tt = clamp(dot(q - vA, dir), 0.0, len);
  float dist = length(q - (vA + dir * tt));
  // 过渡带 = 半个**物理**像素（fwidth 给出 1 物理像素对应多少逻辑像素）。
  // 这样 1080p 与 4K 下同一根细线的墨水浓度一致，4K 只是边缘更锐；
  // 若按逻辑像素取固定宽度，4K 下细线会被摊薄到看不见（踩过）。
  float aa = max(0.5 * fwidth(dist), 1e-4);
  float cov;
  if (vW < 0.0) {
    // ── 带（填充面的扫描行）：**只在 x 方向抗锯齿，y 方向是硬边**
    //
    // 为什么 y 不能抗锯齿：相邻两行共用同一条边界，两边各给 50% 覆盖率时
    // 合成出来是 1-(1-0.5)² = 75% ⇒ 一道比面更暗/更亮的**横纹**，而且 alpha 面
    // 还会被叠两遍描浓。硬边 + 几何严格分区 ⇒ 每个采样点只落在**一行**里，
    // 覆盖率精确为 1；竖向的平滑交给多子帧的亚像素抖动（4× 超采样）。
    // ⚠ 过渡带必须从 **0** 起算：smoothstep(-aa, aa, 0) 等于 0.5，
    //   写成那样会让带内部**整片只得到半覆盖率**（alpha 0.5 的面会画成 0.25 → 137 而不是 188）。
    float along = dot(q - vA, dir);
    float beyond = max(max(-along, along - len), 0.0);
    cov = 1.0 - smoothstep(0.0, aa * 2.0, beyond);
  } else {
    cov = 1.0 - smoothstep(vW * 0.5 - aa, vW * 0.5 + aa, dist);
  }
  if (cov <= 0.002) discard;
  fragColor = vec4(vC.rgb * vC.a * cov, vC.a * cov);
}`);
      g.compileShader(fs);
      if (!g.getShaderParameter(fs, g.COMPILE_STATUS)) throw new Error('LineBatch FS:\n' + g.getShaderInfoLog(fs));
      const prog = g.createProgram();
      g.attachShader(prog, vs); g.attachShader(prog, fs); g.linkProgram(prog);
      if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error('LineBatch link:\n' + g.getProgramInfoLog(prog));
      const c = { program: prog, uniforms: new Map() };
      this.gl.programs.set(key, c);
      return c;
    })();
    return p;
  }

  /** 开始一批。之后连续调用 seg/polyline/circle…，最后 flush。 */
  begin() { this.offset = 0; this.drawing = true; return this; }

  _push(ax, ay, bx, by, width, color, u0 = 0, u1 = 1) {
    if (this.offset + 6 > this.capacity * 6) return this; // 满了就丢（宁可少画不要崩）
    const D = this.data;
    let o = this.offset * 13;
    const a = color[3] ?? 1;
    // 两个三角形组成胶囊的包围盒：aCorner.x 沿线方向(-1..1)，aCorner.y==side 决定法线侧
    const corners = /** @type {[number, number, number][]} */ ([
      [-1, -1, u0], [1, -1, u1], [-1, 1, u0],
      [-1, 1, u0], [1, -1, u1], [1, 1, u1],
    ]);
    for (const [ux, side, u] of corners) {
      D[o++] = ax; D[o++] = ay; D[o++] = bx; D[o++] = by; D[o++] = width;
      D[o++] = color[0]; D[o++] = color[1]; D[o++] = color[2]; D[o++] = a;
      D[o++] = ux; D[o++] = side; D[o++] = side; D[o++] = u;
    }
    this.offset += 6;
    return this;
  }

  /** 一条线段。color 是 [r,g,b] 线性（可 >1 让它发光）或 [r,g,b,a]。 */
  seg(ax, ay, bx, by, width = 1, color = [1, 1, 1]) { return this._push(ax, ay, bx, by, width, color); }

  /**
   * **带**：一条硬边矩形（宽度参数取**负**交给 shader，见 `_program` 里 `vW < 0` 那一支）。
   *
   * 这是填充面该用的图元：填充 = 一定数量的水平带，带与带**严格分区、不重叠**，
   * 所以半透明填充的浓度与行距无关（胶囊拼法下相邻行的 AA 边会互相叠加：
   * alpha 0.5 的面在 step 0.5 时实测被描成 222，而正确值是 188）。
   * 竖向的平滑不靠几何、靠多子帧的亚像素抖动。
   */
  band(x0, x1, y, h, color = [1, 1, 1]) { return this._push(x0, y, x1, y, -Math.abs(h), color); }

  /** 折线。pts 是 [[x,y], ...]。 */
  polyline(pts, width = 1, color = [1, 1, 1], closed = false) {
    for (let i = 1; i < pts.length; i++) this.seg(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], width, color);
    if (closed && pts.length > 2) this.seg(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], width, color);
    return this;
  }

  /** 圆（用折线近似，够用且便宜）。 */
  circle(cx, cy, r, width = 1, color = [1, 1, 1], segs = 48) {
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return this.polyline(pts, width, color);
  }

  /** 矩形描边。 */
  rect(x, y, w, h, width = 1, color = [1, 1, 1]) {
    return this.polyline([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], width, color, true);
  }

  /**
   * 填充矩形。**一条批**，不是"逐行画横线"。
   *
   * 为什么要有它：LineBatch 画的是胶囊（描边），以前想做面板底色只能用横线一格格填
   * （`fidus/_kit.js` 的 fillRect 一帧几百条线段）。现在一条批就够，
   * 而且颜色支持 alpha（[r,g,b,a]），是**真半透明叠加**（片元输出 premultiplied，
   * 混合是 ONE / ONE_MINUS_SRC_ALPHA）。
   *
   * 实现：沿 y 方向用足够密的横线铺满，线宽等于步进 —— 相邻两条的胶囊正好拼成一个矩形。
   * 步进越细边缘越准，代价是批里的条数（默认 2 逻辑像素一步：1080p 满屏面板约 540 条）。
   *
   * @param {number} x @param {number} y 左上角（逻辑像素，y 向下）
   * @param {number} w @param {number} h
   * @param {number[]} color `[r,g,b]` 或 `[r,g,b,a]`，线性值
   * @param {number} [step] 覆盖步进（逻辑像素），越小越精确也越贵
   */
  fillRect(x, y, w, h, color = [1, 1, 1], step = 1) {
    if (!(w > 0) || !(h > 0)) return this;
    const s = Math.max(0.5, step);
    const n = Math.max(1, Math.ceil(h / s));
    const dy = h / n;
    for (let i = 0; i < n; i++) this.band(x, x + w, y + i * dy + dy * 0.5, dy, color);
    return this;
  }

  /**
   * **填充多边形**（偶奇规则，带洞也支持）。
   *
   * `pts` 可以是单环 `[[x,y],…]`，也可以是多个环 `[[[...]], [[...]]]` —— 多环时内环自动挖洞。
   * 实现是 `src/core/fill.js` 的扫描线（纯函数、可离线单测），这里只负责把跨度画成线。
   *
   * ⚠ 这是「面」，不是「线」：不要拿它叠一层描边再叠一层填充，两层都用 `lines` 会有排序问题；
   *   描边用 `polyline(pts, w, col, true)`，填充用这个，先填充后描边即可。
   *
   * @param {number[][] | number[][][]} pts 单环或多环（多环 = 带洞）
   * @param {number[]} color 线性 RGB 或 RGBA
   * @param {number} [step] 扫描行距（逻辑像素，默认 2；越小越精确也越贵）
   */
  fillPoly(pts, color = [1, 1, 1], step = 1) {
    for (const sp of polySpans(pts, step)) this.band(sp.x, sp.x + sp.w, sp.y, sp.h, color);
    return this;
  }

  /** **填充圆**（比 `fillPoly` 逼近更准也更便宜：每行一次 `sqrt`）。 */
  fillCircle(cx, cy, r, color = [1, 1, 1], step = 1) {
    for (const sp of circleSpans(cx, cy, r, step)) this.band(sp.x, sp.x + sp.w, sp.y, sp.h, color);
    return this;
  }

  /**
   * **填充扇环 / 扇形**：`r0 > 0` 是扇环，`r0 = 0` 是实心扇形。
   * 角度是弧度、0 指向 +x，y 向下为正（所以 π/2 朝下）。
   */
  fillSector(cx, cy, r0, r1, a0, a1, color = [1, 1, 1], step = 1) {
    for (const sp of sectorSpans(cx, cy, r0, r1, a0, a1, step)) this.band(sp.x, sp.x + sp.w, sp.y, sp.h, color);
    return this;
  }

  /** 十字准星 / 刻度，做工程图风格很有用。 */
  tick(x, y, len = 8, width = 1, color = [1, 1, 1], angle = 0) {
    const dx = Math.cos(angle) * len * 0.5, dy = Math.sin(angle) * len * 0.5;
    return this.seg(x - dx, y - dy, x + dx, y + dy, width, color);
  }

  /** 最后一步：上传并画到 target。返回画了多少条线段。 */
  flush(target = null) {
    const g = this.gl.ctx;
    if (this.offset === 0) return 0;
    const p = this.progPair;
    g.useProgram(p.program);
    g.bindVertexArray(this.vao);
    g.bindBuffer(g.ARRAY_BUFFER, this.buf);
    g.bufferSubData(g.ARRAY_BUFFER, 0, this.data, 0, this.offset * 13);
    g.uniform2f(this.gl.uniform(p, 'res'), this.gl.pw, this.gl.ph);
    g.uniform2f(this.gl.uniform(p, 'RES_LOGICAL'), this.gl.w, this.gl.h);
    g.uniform1f(this.gl.uniform(p, 'PX_SCALE'), this.gl.scale);
    {
      // 缺字段时按"不抖"处理（离线单测里的假 gl 没有 jitter）
      const j = this.gl.jitter;
      const loc = this.gl.uniform(p, 'uJitter');
      if (loc !== null && loc !== undefined) {
        g.uniform2f(loc, j ? (j[0] * 2) / this.gl.pw : 0, j ? (j[1] * 2) / this.gl.ph : 0);
      }
    }
    g.enable(g.BLEND);
    g.blendFuncSeparate(g.ONE, g.ONE_MINUS_SRC_ALPHA, g.ONE, g.ONE_MINUS_SRC_ALPHA);
    if (target) target.bind(); else { g.bindFramebuffer(g.FRAMEBUFFER, null); g.viewport(0, 0, this.gl.pw, this.gl.ph); }
    g.drawArrays(g.TRIANGLES, 0, this.offset);
    g.bindVertexArray(null);
    if (this.gl.paint) this.gl.paint.lines++;
    this.gl._notePaint(g, target, { blend: true });
    const n = this.offset / 6;
    this.offset = 0;
    this.drawing = false;
    return n;
  }

  dispose() {
    this.gl.ctx.deleteBuffer(this.buf);
    this.gl.ctx.deleteVertexArray(this.vao);
  }
}

/* ------------------------------------------------------------------ 工具 */

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** 把纹理或 RT 包成 uniform 值 */
export function tex(handle) {
  return { tex: /** @type {any} */ (handle).tex ?? handle, __tex: true };
}

/** 逻辑像素 -> 归一化 uv（y 向下） */
export function toUv(gl, x, y) {
  return [x / gl.w, 1 - y / gl.h];
}
