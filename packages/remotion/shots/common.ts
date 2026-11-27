/**
 * Remotion 迁移 · 共享视觉底座。
 *
 * 色板/字体栈与 src/style/index.js 的 print 风格包同源（hex 值逐字一致）；
 * 缓动与 src/core/util.js 的 ease/prog/pulse/rng 同式 —— 每帧都是 (输入, 帧号) 的纯函数。
 * 有意差异（随样片记录，见 out/_remotion-migration/HANDOVER-stage1.md）：
 *   · 旧引擎的 bloom/halation/grain/vignette 后处理链不在阶段 1 复刻（DOM/SVG 直出）；
 *   · 背景 shader 用 SVG feTurbulence / CSS 渐变近似，噪声场不逐像素相同。
 */

export const P = {
  ink: '#0a0a0b',
  ink2: '#151517',
  graphite: '#5e5b57',
  ash: '#9c978f',
  bone: '#eee9df',
  signal: '#ff4d12',
  ember: '#ff8a3d',
  blood: '#c21d0b',
  acid: '#d8ff3c',
} as const;

// print 风格包的字体栈（src/style/index.js SANS/MONO 逐字一致）。
// Archivo / IBM Plex Mono 由 public/fonts/fonts.css 提供（staticFile 引入），中文走系统雅黑。
export const SANS = "'Archivo', 'Noto Sans SC', 'Microsoft YaHei', system-ui, sans-serif";
export const MONO = "'IBM Plex Mono', 'Sarasa Mono SC', 'Consolas', monospace";

export const sat = (x: number) => Math.min(1, Math.max(0, x));

/** prog(t, a, b)：t 在 [a,b] 的位置 → 0..1（b 是结束时刻，不是时长）。 */
export const prog = (t: number, a: number, b: number) => sat((t - a) / (b - a || 1e-9));

export const ease = {
  outCubic: (x: number) => 1 - (1 - x) ** 3,
  inOutCubic: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - 4 * (1 - x) ** 3),
  outExpo: (x: number) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
};

/** pulse(t, period, halfLife)：距最近一次周期事件的指数衰减尖峰（util.js 同式）。 */
export function pulse(t: number, period = 1, halfLife = 0.15) {
  const p = ((t / period) % 1 + 1) % 1;
  const since = (p < 1 ? p : 2 - p) * period;
  return Math.exp(-since / Math.max(1e-6, halfLife));
}

/** rng(seed)：确定性随机流（util.js 逐字同式，绝不 Math.random）。 */
export function rng(seed = 0) {
  let s = (seed | 0) || 1;
  return function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** hex → rgba 字符串（DOM 直接用 sRGB hex；alpha 显式给）。 */
export function rgba(hex: string, alpha = 1) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 逐字入场的单字状态 —— 与 src/core/text.js write() 的逐字动画同式：
 * k = sat((t - i*stagger) / dur)，e = outCubic(k)；
 * from 'up'：dy = (1-e)*dist、alpha = e；from 'scale'：scale = 1 + (1-e)*dist/size。
 *
 * 布局以 Remotion 为准：返回 translate / scale CSS 属性（不用 transform），
 * Studio 可编辑。调用方把 g.translate / g.scale 直接放进 style。
 */
export function glyphEnter(t: number, i: number, stagger: number, dur: number, dist: number, from: 'up' | 'scale', size: number) {
  const k = sat((t - i * stagger) / dur);
  if (k <= 0) return null;
  const e = ease.outCubic(k);
  const rem = 1 - e;
  return {
    opacity: e,
    translate: from === 'up' ? `0px ${rem * dist}px` : '0px 0px',
    scale: from === 'scale' ? String(1 + (rem * dist) / size) : '1',
  };
}