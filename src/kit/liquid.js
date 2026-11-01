// @ts-check
/**
 * `src/kit/liquid.js` —— **流体原语**：域扭曲（domain warp）+ 液滴涟漪。
 *
 * 两样东西，都能单独用：
 *   · `liquidPass(ctx, opts)` —— 整帧的流体底：两层域扭曲的 fbm 在 ink/ink2/signal 之间取色，
 *     时间只吃 `t`（确定性）；
 *   · `liquidWarp(ctx, srcTex, opts)` —— 把**已有画面**按流体场扭一下（字幕/前景不受影响时用它做"水下感"）。
 *
 * 为什么做成引擎原语而不是某个模板的私有代码：
 * 域扭曲是通用能力 —— 液体、极光、玻璃、纸张受潮都是同一套 `p += fbm(p)` 的变形；
 * 写成 kit 之后，新风格只要换参数，不用重写一遍 shader。
 *
 * 两条纪律：
 *   · **时间只进 uniform**（`t`），绝不在 JS 里累积相位 —— 否则 seek 之后画面接不上；
 *   · **幅度要给上限**：`warp` 超过 1.2 会把文字糊成浆糊，只在纯底色上用大值。
 */

import { Pass } from '../core/gl.js';

/** 域扭曲 fbm（GLSL 片段，供本文件与外部模板复用） */
export const GLSL_WARP = /* glsl */ `
  float wv(vec2 p) {
    return sin(p.x * 1.7 + sin(p.y * 1.3)) * 0.5 + 0.5;
  }
  float fbm2(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) {
      s += a * wv(p);
      p *= 2.02;
      a *= 0.5;
    }
    return s / 0.9375;
  }
`;

/**
 * 整帧流体底。返回一个 Pass，调用方每帧 `.render(gl, out, t, dt)`。
 * @param {any} ctx 场景 ctx
 * @param {{ scale?: number, speed?: number, warp?: number, contrast?: number }} [opts]
 */
export function liquidPass(ctx, opts = {}) {
  const Q = ctx.P;
  const scale = opts.scale ?? 2.1;
  const speed = opts.speed ?? 0.06;
  const warp = opts.warp ?? 0.55;
  const contrast = opts.contrast ?? 1.0;
  return new Pass(ctx.gl, /* glsl */ `
    uniform vec3 cInk, cInk2, cSig;
    uniform float scale, speed, warp, contrast, vig;
    ${GLSL_WARP}
    void main() {
      vec2 p = vUv * scale;
      float tt = t * speed;
      // 两层域扭曲：第一层决定大形状，第二层把边界搅成液态
      vec2 q = vec2(fbm2(p + vec2(0.0, tt)), fbm2(p + vec2(5.2, -tt)));
      p += (q - 0.5) * warp * 2.0;
      float d = fbm2(p + vec2(tt * 0.7, tt * 0.4));
      vec3 col = mix(cInk, cInk2, smoothstep(0.25, 0.75, d));
      col = mix(col, cSig, smoothstep(0.62, 0.95, d) * 0.55 * contrast);
      // 高光：液面上一道很薄的亮边（让它像"液体"而不是"云"）
      float rim = smoothstep(0.58, 0.60, d) * (1.0 - smoothstep(0.60, 0.66, d));
      col += cSig * rim * 0.35;
      col *= 1.0 - vig * smoothstep(0.35, 1.2, length((vUv - 0.5) * vec2(1.0, 1.05)) * 1.5);
      fragColor = vec4(col, 1.0);
    }`, {
    cInk: Q.ink, cInk2: Q.ink2, cSig: Q.signal,
    scale, speed, warp, contrast, vig: 0.38,
  }, { key: 'kit_liquid_bg_' + scale + '_' + warp, blend: false });
}

/**
 * 把一张已经画好的画面按流体场扭一下（液滴涟漪 / 水下感）。
 * 注意：**会扭曲整张纹理**，包括上面的文字 —— 想要文字不糊就只把背景传进来。
 * @param {any} ctx @param {any} srcTex 源纹理 @param {{ amount?: number, freq?: number }} [opts]
 */
export function liquidWarp(ctx, srcTex, opts = {}) {
  const amount = opts.amount ?? 6;
  const freq = opts.freq ?? 9;
  return new Pass(ctx.gl, /* glsl */ `
    uniform sampler2D src;
    uniform vec2 res;
    uniform float amount, freq;
    ${GLSL_WARP}
    void main() {
      vec2 p = vUv;
      float n1 = fbm2(p * freq + vec2(t * 0.35, 0.0)) - 0.5;
      float n2 = fbm2(p * freq + vec2(0.0, t * 0.28) + 7.7) - 0.5;
      vec2 off = vec2(n1, n2) * amount / res;
      fragColor = vec4(texture(src, p + off).rgb, 1.0);
    }`, { src: null, res: [ctx.gl.w, ctx.gl.h], amount, freq }, { key: 'kit_liquid_warp', blend: false, jitter: false });   // 重采样已有画面：不吃抖动
}
