// @ts-check
/**
 * src/kit/particles.js —— **零状态 GPU 粒子**（BACKLOG 1-14）。
 *
 * 位置 = f(粒子序号, 时间, uniform) 的**纯函数**：没有 per-particle 状态、没有 CPU 侧
 * 每帧上传、没有 Math.random。顶点着色器用 `gl_VertexID`（GLSL 3.00）按序号算出位置，
 * `setup` 建一次程序，`render(t)` 只更新 uniform + 一次 `drawArrays(POINTS)`。
 * 于是：同一 t 渲两次逐像素一致（确定性），子帧乱序与多子帧运动模糊天然成立。
 *
 * ## 用法
 * ```js
 * import { makeParticles } from '../../../src/kit/index.js';
 * setup(ctx) { this.ps = makeParticles(ctx, { count: 900, preset: 'sparks' }); },
 * draw(ctx) {
 *   // …先铺整帧背景（fillRect / lines），再叠粒子：
 *   this.ps.render(ctx.out, ctx.f.t);
 * }
 * ```
 *
 * ## 与引擎管线的边界（三条，写错不报错只是"看不见"）
 * 1. **自己编译 program、自己绑 FBO**：不走 `Pass`（那是全屏三角形），也不改 `src/core/gl.js`。
 *    混合用引擎同款加法（`ONE, ONE`，HDR 线性值域）—— 粒子是"信号色"，泛光分界线之内。
 * 2. **不参与引擎的亚像素抖动**（`src/core/sampling.js` 的 JITTER_GRID 只注入 `Pass` 的
 *    `uJitter` 与 LineBatch 顶点）：本实现是自定义 program，天然不吃抖动；粒子小而软，
 *    缺这一档超采样看不出来。
 * 3. **坐标是逻辑像素**（1920×1080 基准，y 向下），内部换算到 clip 空间时翻 y；
 *    `gl_PointSize` 是**物理像素**，已按 `gl.scale` 放大。
 *
 * ## 成本
 * 每次 render = 一次 drawArrays(count 个点)。没有嵌套自适应、没有子帧展开 ——
 * 场景的每个子帧各画一遍（它本来就是 t 的纯函数，平均值 = 正确的运动模糊）。
 */

/** 粒子数上限：POINTS 是填充率怪兽，超过这个数画面会被点糊满。 */
export const MAX_PARTICLES = 20000;

/** 确定性 hash（GLSL 侧与 JS 侧同一套常数，测试里两边对拍）。 */
const GLSL_HASH = /* glsl */ `
float hash1(float n) { return fract(sin(n) * 43758.5453123); }
vec2 hash2(float n) {
  return fract(sin(vec2(n, n + 1.37)) * vec2(43758.5453123, 22578.1459123));
}
`;

/**
 * 内置预设。每个给：顶点着色器里的**位置函数**与**颜色函数**（都是 id 与 t 的纯函数）、
 * 默认点大小。坐标 = 逻辑像素（y 向下）。
 */
export const PARTICLE_PRESETS = {
  /** sparks —— 下落火花：从顶部落到底部后从顶上重来（mod 回绕），亮度随下落速度微变。 */
  sparks: {
    size: 5,
    pos: /* glsl */ `
      vec2 posFn(float id, float t, vec2 res) {
        vec2 h = hash2(id * 7.13);
        float speed = 90.0 + h.x * 260.0;              // px/s
        float x = res.x * (0.06 + 0.88 * h.y);
        float y = mod(h.x * 1e4 + t * speed, res.y + 80.0) - 40.0;
        return vec2(x, y);
      }`,
    color: /* glsl */ `
      vec3 colFn(float id, float t, vec2 res) {
        float flick = 0.75 + 0.25 * sin(t * (6.0 + hash1(id) * 8.0) + id);
        return C_SIGNAL * (0.55 + 0.45 * flick);
      }`,
  },
  /** orbit —— 轨道环：所有粒子绕簇心公转，半径有个体差，内外双环由 hash 分层。 */
  orbit: {
    size: 4,
    pos: /* glsl */ `
      vec2 posFn(float id, float t, vec2 res) {
        float n = max(float(uCount), 1.0);
        vec2 c = res * 0.5;
        float ring = step(0.5, hash1(id * 3.1));       // 0/1 两层环
        float r = (0.22 + ring * 0.13 + (hash1(id * 5.7) - 0.5) * 0.02) * min(res.x, res.y);
        float a = (id / n) * 6.2831853 + t * (0.5 + ring * 0.35) + hash1(id) * 0.2;
        return c + vec2(cos(a) * r, sin(a) * r * 0.9);
      }`,
    color: /* glsl */ `
      vec3 colFn(float id, float t, vec2 res) {
        float ring = step(0.5, hash1(id * 3.1));
        return mix(C_SIGNAL, C_BONE, ring * 0.55) * (0.7 + 0.3 * sin(t * 2.0 + id));
      }`,
  },
  /** drift —— 漂移场：每个粒子绕自己的锚点做慢速利萨如漂移，无整体流向。 */
  drift: {
    size: 6,
    pos: /* glsl */ `
      vec2 posFn(float id, float t, vec2 res) {
        vec2 h = hash2(id * 11.7);
        vec2 anchor = vec2(res.x * (0.08 + 0.84 * h.x), res.y * (0.08 + 0.84 * h.y));
        float amp = 14.0 + h.y * 30.0;
        vec2 w = vec2(t * (0.35 + h.x * 0.4) + h.y * 6.28, t * (0.3 + h.y * 0.35) + h.x * 6.28);
        return anchor + vec2(sin(w.x), cos(w.y)) * amp;
      }`,
    color: /* glsl */ `
      vec3 colFn(float id, float t, vec2 res) {
        return C_BONE * (0.28 + 0.22 * sin(t * 1.3 + id * 0.7));
      }`,
  },
};

const VERT_HEAD = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uRes;      // 逻辑分辨率（W, H）
uniform float uT;       // 整片时间（秒）
uniform float uSize;    // 点大小（物理像素）
uniform float uCount;   // 粒子总数（位置函数里做归一用）
out vec3 vCol;
`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vCol;
out vec4 fragColor;
void main() {
  // 软圆点：中心实、边缘淡。加法混合下 vCol 已含强度，alpha 只决定覆盖形状。
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float a = 1.0 - smoothstep(0.55, 1.0, length(d));
  if (a <= 0.004) discard;
  fragColor = vec4(vCol * a, a);
}
`;

/**
 * 建一个零状态粒子系统。在场景 `setup(ctx)` 里调用（编译一次），`render` 每帧只发 uniform。
 *
 * @param {{ gl: any, P: Record<string, [number, number, number]> }} ctx 场景 ctx（要 gl 与调色板）
 * @param {{ count?: number, preset?: keyof typeof PARTICLE_PRESETS,
 *           size?: number, palette?: Record<string, [number, number, number]> }} [opts]
 *        `count` 默认 600（会被夹到 [1, MAX_PARTICLES]）；`preset` 默认 'sparks'；
 *        `palette` 覆盖 C_SIGNAL / C_BONE（默认取 ctx.P，**线性**值，可直接给 >1 做辉光）。
 * @returns {{ render(out: any, t: number): void, count: number, preset: string }}
 */
export function makeParticles(ctx, opts = {}) {
  const presetName = String(opts.preset ?? 'sparks');
  const preset = PARTICLE_PRESETS[presetName];
  if (!preset) {
    throw new Error(`makeParticles：没有粒子预设 "${presetName}"。可用：${Object.keys(PARTICLE_PRESETS).join(' / ')}`);
  }
  const count = Math.max(1, Math.min(MAX_PARTICLES, Math.round(Number(opts.count ?? 600))));
  const P = opts.palette ?? ctx.P;
  const cSig = P.signal ?? [1, 0.4, 0.1];
  const cBone = P.bone ?? [0.9, 0.88, 0.84];
  const paletteChunk = /* glsl */ `
const vec3 C_SIGNAL = vec3(${f3(cSig)});
const vec3 C_BONE = vec3(${f3(cBone)});
`;
  const vert = VERT_HEAD + paletteChunk + GLSL_HASH + preset.pos + preset.color + /* glsl */ `
void main() {
  float id = float(gl_VertexID);
  vec2 p = posFn(id, uT, uRes);
  vCol = colFn(id, uT, uRes);
  vec2 clip = vec2(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = uSize;
}
`;

  const gl = ctx.gl;
  const g = gl.ctx;
  const prog = compile(g, vert, FRAG);
  const vao = g.createVertexArray();
  const U = {
    res: g.getUniformLocation(prog, 'uRes'),
    t: g.getUniformLocation(prog, 'uT'),
    size: g.getUniformLocation(prog, 'uSize'),
    count: g.getUniformLocation(prog, 'uCount'),
  };

  /**
   * @param {any} out ctx.out（RT）：粒子画进这个目标（与 ctx.out 一起用，别传 null）
   * @param {number} t 整片时间（秒）—— 位置的唯一时间源
   */
  function render(out, t) {
    const G = g;
    const tgt = out;
    const tt = t;
    const pw = tgt ? tgt.w : gl.pw, ph = tgt ? tgt.h : gl.ph;
    const sizePx = Math.max(1, (opts.size ?? preset.size) * (gl.scale ?? 1));
    G.bindFramebuffer(G.FRAMEBUFFER, tgt ? tgt.fbo : null);
    G.viewport(0, 0, pw, ph);
    G.useProgram(prog);
    G.bindVertexArray(vao);
    G.uniform2f(U.res, gl.w, gl.h);
    G.uniform1f(U.t, tt);
    G.uniform1f(U.size, sizePx);
    G.uniform1f(U.count, count);
    // 引擎同款加法混合（HDR 线性，ONE/ONE）—— Pass.render 里 'add' 分支的常数
    G.enable(G.BLEND);
    G.blendEquation(G.FUNC_ADD);
    G.blendFuncSeparate(G.ONE, G.ONE, G.ZERO, G.ONE);
    G.drawArrays(G.POINTS, 0, count);
    G.disable(G.BLEND);
  }

  return { render, count, preset: presetName };
}

/** 数组 → GLSL vec3 字面量 */
function f3(c) {
  const a = Array.isArray(c) ? c : [1, 1, 1];
  return a.slice(0, 3).map((v) => Number(v).toFixed(5)).join(', ');
}

/** 自包含编译链（不依赖 gl.js 的 Pass：它只服务全屏三角形）。编译失败当场抛。 */
function compile(g, vertSrc, fragSrc) {
  const sh = (type, src) => {
    const s = g.createShader(type);
    g.shaderSource(s, src);
    g.compileShader(s);
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) {
      const log = g.getShaderInfoLog(s) ?? '(无日志)';
      throw new Error(`particles: shader 编译失败：${log}\n${src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n')}`);
    }
    return s;
  };
  const p = g.createProgram();
  g.attachShader(p, sh(g.VERTEX_SHADER, vertSrc));
  g.attachShader(p, sh(g.FRAGMENT_SHADER, fragSrc));
  g.linkProgram(p);
  if (!g.getProgramParameter(p, g.LINK_STATUS)) {
    throw new Error(`particles: program 链接失败：${g.getProgramInfoLog(p) ?? ''}`);
  }
  return p;
}
