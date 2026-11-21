// @ts-check
/**
 * oklab —— 全片共享的色彩数学（JS + GLSL）、母题标尺与摄影机曲线。
 * 所有坐标均为 1920×1080 逻辑像素（y 向下）；GLSL 内用 p = vec2(FRAG_PX.x, RES_LOGICAL.y - FRAG_PX.y) 对齐。
 */
import { css, lerp, prog, sat, smoothstep, spring } from '../../../src/core/util.js';
import { bandsOf, cameraAt, mul, withAlpha } from '../../../src/kit/index.js';

/** IEC 61966-2-1 sRGB → 线性光 */
export function srgbToLinScalar(c) {
  const v = sat(c);
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** 线性光 → IEC 61966-2-1 sRGB */
export function linToSrgbScalar(c) {
  const v = sat(c);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** Björn Ottosson (2020) 线性 sRGB → Oklab (L, a, b) */
export function linToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/** Oklab (L, a, b) → 线性 sRGB */
export function oklabToLin(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

/** 线性 sRGB → CIE XYZ (D65) */
export function linToXyz(r, g, b) {
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
    0.0193339 * r + 0.1191920 * g + 0.9503041 * b,
  ];
}

/** CIE XYZ (D65) → 线性 sRGB */
export function xyzToLin(x, y, z) {
  return [
    +3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.9692660 * x + 1.8760108 * y + 0.0415560 * z,
    +0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}

/** CIE XYZ (D65) → CIELAB */
export function xyzToCielab(x, y, z) {
  const n = [x / 0.95047, y / 1.00000, z / 1.08883];
  const f = n.map((v) => (v >= 0.008856 ? Math.cbrt(Math.max(v, 1e-6)) : 7.787 * v + 16 / 116));
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

/** CIELAB → CIE XYZ (D65) */
export function cielabToXyz(L, a, b) {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const f = [fx, fy, fz];
  const n = f.map((v) => (v >= 0.206896 ? v * v * v : (v - 16 / 116) / 7.787));
  return [n[0] * 0.95047, n[1] * 1.00000, n[2] * 1.08883];
}

/** CIELAB 蓝→白线性插值（与 GLSL evalBlueWhiteCielab 同公式，返回线性 sRGB） */
export function evalBlueWhiteCielabLin(u) {
  const t = sat(u);
  const aLab = xyzToCielab(...linToXyz(0, 0, 1));
  const bLab = xyzToCielab(...linToXyz(1, 1, 1));
  const m = [lerp(aLab[0], bLab[0], t), lerp(aLab[1], bLab[1], t), lerp(aLab[2], bLab[2], t)];
  return xyzToLin(...cielabToXyz(...m)).map(sat);
}

/** 共享 GLSL 色彩空间算子（不重复声明 GLSL_COMMON 的 toSRGB / toLinear / sat / sdRound / aaFill） */
export const GLSL_OKLAB_MATH = /* glsl */ `
vec3 cbrt3(vec3 v) {
  return sign(v) * pow(max(abs(v), vec3(1e-8)), vec3(1.0 / 3.0));
}

vec3 linToOklab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  vec3 lms = cbrt3(vec3(l, m, s));
  return vec3(
    0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
    1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
    0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z
  );
}

vec3 oklabToLin(vec3 lab) {
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;
  return vec3(
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

bool inSrgbGamut(vec3 rgb) {
  return all(greaterThanEqual(rgb, vec3(-0.002))) && all(lessThanEqual(rgb, vec3(1.002)));
}

vec3 evalRedGreenSrgb(float u) {
  return toLinear(mix(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), sat(u)));
}

vec3 evalRedGreenLinear(float u) {
  return mix(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), sat(u));
}

vec3 evalRedGreenOklab(float u) {
  vec3 a = linToOklab(vec3(1.0, 0.0, 0.0));
  vec3 b = linToOklab(vec3(0.0, 1.0, 0.0));
  return max(oklabToLin(mix(a, b, sat(u))), vec3(0.0));
}

vec3 evalBlueWhiteOklab(float u) {
  vec3 a = linToOklab(vec3(0.0, 0.0, 1.0));
  vec3 b = linToOklab(vec3(1.0, 1.0, 1.0));
  return sat(oklabToLin(mix(a, b, sat(u))));
}

vec3 linToXyz(vec3 c) {
  return vec3(
    0.4124564 * c.r + 0.3575761 * c.g + 0.1804375 * c.b,
    0.2126729 * c.r + 0.7151522 * c.g + 0.0721750 * c.b,
    0.0193339 * c.r + 0.1191920 * c.g + 0.9503041 * c.b
  );
}

vec3 xyzToLin(vec3 xyz) {
  return vec3(
    +3.2404542 * xyz.x - 1.5371385 * xyz.y - 0.4985314 * xyz.z,
    -0.9692660 * xyz.x + 1.8760108 * xyz.y + 0.0415560 * xyz.z,
    +0.0556434 * xyz.x - 0.2040259 * xyz.y + 1.0572252 * xyz.z
  );
}

vec3 xyzToCielab(vec3 xyz) {
  vec3 n = xyz / vec3(0.95047, 1.00000, 1.08883);
  vec3 f = mix(7.787 * n + 16.0 / 116.0, pow(max(n, vec3(1e-6)), vec3(1.0 / 3.0)), step(vec3(0.008856), n));
  return vec3(116.0 * f.y - 16.0, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
}

vec3 cielabToXyz(vec3 lab) {
  float fy = (lab.x + 16.0) / 116.0;
  float fx = lab.y / 500.0 + fy;
  float fz = fy - lab.z / 200.0;
  vec3 f = vec3(fx, fy, fz);
  vec3 n = mix((f - 16.0 / 116.0) / 7.787, f * f * f, step(vec3(0.206896), f));
  return n * vec3(0.95047, 1.00000, 1.08883);
}

vec3 evalBlueWhiteCielab(float u) {
  vec3 a = xyzToCielab(linToXyz(vec3(0.0, 0.0, 1.0)));
  vec3 b = xyzToCielab(linToXyz(vec3(1.0, 1.0, 1.0)));
  return sat(xyzToLin(cielabToXyz(mix(a, b, sat(u)))));
}

float roundBoxMask(vec2 p, vec2 xy, vec2 wh, float r) {
  float d = sdRound(p - (xy + wh * 0.5), wh * 0.5, r);
  return aaFill(d, 1.1);
}

float roundBoxEdge(vec2 p, vec2 xy, vec2 wh, float r, float w) {
  float d = sdRound(p - (xy + wh * 0.5), wh * 0.5, r);
  return aaStroke(d, w, 1.0);
}
`;

/** 统一取段内设计时间（与 timing.mjs 的 stretch 对应）。 */
export const localT = (ctx) => ctx.f.lt / (ctx.params?.stretch ?? 1);

/**
 * 顶部安全段标与右上角章节编号：严格避开居中字幕保留带（x=595..1325, y=40..104）。
 */
export function drawHeader(ctx, { num, title, rightLabel, t, alpha, dx = 0, dy = 0 }) {
  const { P, type } = ctx;
  const B = bandsOf(ctx);
  const a = alpha ?? sat(t / 0.45);
  if (a <= 0.01) return;
  const x0 = ctx.grid?.pad ?? 160;
  const hy = B.tag.y - 6 + dy;
  type.writeLine(num, x0 + dx, hy, {
    anchor: 'left', size: 28, weight: 700, family: 'mono', color: css(P.signal, a),
  });
  type.writeLine(title, x0 + 48 + dx, hy, {
    anchor: 'left', size: 28, weight: 600, family: 'sans', color: css(P.bone, a * 0.92),
  });
  if (rightLabel) {
    // 放到页脚保留带（y=1018 >= 972），避免与左上角同 y 聚类后横跨中间字幕带
    type.writeLine(rightLabel, B.hudR.x1 + dx, B.foot.y + dy, {
      anchor: 'right', size: 20, weight: 500, family: 'mono', color: css(P.ash, a * 0.8),
    });
  }
}

/** 全片统一底部光谱标尺边界（400..1760, 中点 1080, y=890），与主色带严格同轴。 */
export const RAIL_BOX = { x: 400, w: 1360, y: 890 };

/**
 * 全片贯通母题：底部水平采样标尺（spectrum-rail），让跨段切点"坐标不断"。
 */
export function drawSpectrumRail(ctx, { x = RAIL_BOX.x, w = RAIL_BOX.w, y = RAIL_BOX.y, probeU = 0.5, alpha = 1, dx = 0, dy = 0 }) {
  const { lines, P } = ctx;
  if (alpha <= 0.01) return;
  const x0 = x + dx;
  const yy = y + dy;
  const dim = withAlpha(P.graphite, 0.58 * alpha);
  const tickC = withAlpha(P.ash, 0.68 * alpha);
  lines.seg(x0, yy, x0 + w, yy, 2, dim);
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    const xx = x0 + u * w;
    const major = i % 5 === 0;
    lines.seg(xx, yy - (major ? 10 : 5), xx, yy + (major ? 10 : 5), major ? 2 : 1.2, major ? tickC : dim);
  }
  const px = x0 + sat(probeU) * w;
  lines.circle(px, yy, 7.5, 2.5, withAlpha(P.signal, alpha));
  lines.fillCircle(px, yy, 4.2, withAlpha(P.signal, alpha));
}

/** 摄影棚中性后处理基线：直调 cameraAt 传入动态 zoomBase，修复 cameraPost 忽略 zoomBoost 的死代码。 */
export function oklabPost(f, { zoomBoost = 0, fade = 0 } = {}) {
  const cam = cameraAt(f.t, {
    zoomBase: 1.006 + zoomBoost,
    zoomAmp: 0.006,
    shakeAmp: 0.75,
  });
  return {
    ...cam,
    bloom: 0.06,
    ca: 0,
    grain: 0.010,
    vignette: 0.54,
    fade,
  };
}

export { bandsOf, css, lerp, mul, prog, sat, smoothstep, spring, withAlpha };
