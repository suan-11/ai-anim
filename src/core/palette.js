// @ts-check
/**
 * 调色板。风格统一靠的是「一套颜色 + 一套字体 + 一种颗粒」贯穿全片，
 * 而不是每个镜头各配一套。默认是 pdoom 那种印刷品配色：墨黑 + 骨白 + 信号橙。
 *
 * 用法：
 *   JS:   P.ink, P.bone, P.signal        // 线性 [r,g,b]，可直接给 canvas/GL
 *         css(P.signal, 0.6)             // 'rgba(...)' 字符串，给 Canvas2D
 *   GLSL: C_INK, C_BONE, C_SIGNAL        // 引擎自动注入到每个 shader 的常量
 *
 * 任务里可在 task.config.mjs 的 palette 字段覆盖（键名任意，全部会被注入 GLSL）。
 */

import { hexToLinear, css as cssOf, linearToSrgb } from './util.js';

/** @typedef {[number, number, number]} RGB */

export const DEFAULT_PALETTE = {
  ink: '#0a0a0b',      // 背景
  ink2: '#151517',     // 面板
  graphite: '#5e5b57', // 次要线条
  ash: '#9c978f',      // 弱化文字
  bone: '#eee9df',     // 纸/正文
  signal: '#ff4d12',   // 唯一的高饱和强调色（光点、高亮、被唱到的词）
  ember: '#ff8a3d',    // 热核
  blood: '#c21d0b',    // 深阴影
  acid: '#d8ff3c',     // 极少用的第二强调色，一个片子里最多出现一次
};

/** 建立调色板对象：既是线性颜色表，也能生成 GLSL 常量。 */
export function makePalette(overrides = {}) {
  // `bg` = 整帧底色（缺省 = ink）。以前底色是隐含约定：gl.clear / worldPass 用 ink，
  // 个别模板（chart 的纸面）用 bone 当底 —— 换风格时两套约定打架，看起来像"背景反色"。
  // 现在底色只有一个名字，模板一律读 P.bg。
  // ⚠ 顺序有意义：先铺默认、再盖风格覆盖，**最后**才补 bg 的缺省。
  //   老写法把 `bg:` 放在最前面，随后被 `...DEFAULT_PALETTE` 里的 bg 盖回去 ——
  //   于是「只改 ink 的亮底风格」（mg-bauhaus / mg-hud / mg-pixel / mg-flat-vector / mg-vhs）
  //   画面上仍是深底，而调色板自报亮底（2026-11-02 全量回归 test-style-palette 抓到的真 bug）。
  const hexes = { ...DEFAULT_PALETTE, ...overrides };
  hexes.bg = overrides.bg ?? overrides.ink ?? hexes.ink ?? DEFAULT_PALETTE.ink;
  /** @type {Record<string, RGB>} */
  const linear = {};
  /** @type {Record<string, string>} */
  const hex = {};
  for (const [k, v] of Object.entries(hexes)) {
    hex[k] = v;
    linear[k] = hexToLinear(v);
  }
  const P = {
    hex,
    linear,
    /** 取线性色。P.ink / P.bone … 直接可读 */
    ...linear,
    /** CSS 字符串，给 Canvas2D 用 */
    css(name, alpha = 1) {
      const c = linear[name];
      if (!c) throw new Error(`palette has no colour '${name}'`);
      return cssOf(c, alpha);
    },
    /** 亮度缩放，保持色相 */
    dim(name, k) {
      const c = linear[name];
      return c.map((x) => x * k);
    },
    /** 生成 GLSL 常量：C_INK / C_BONE / C_SIGNAL …，并附带 C_<NAME>_SRGB */
    glsl() {
      let out = '// palette\n';
      for (const [k, c] of Object.entries(linear)) {
        const N = k.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        out += `const vec3 C_${N} = vec3(${c.map((x) => x.toFixed(6)).join(', ')});\n`;
        const s = c.map((x) => linearToSrgb(x).toFixed(6)).join(', ');
        out += `const vec3 C_${N}_SRGB = vec3(${s});\n`;
      }
      return out;
    },
    /** 名字列表，给文档/HUD 用 */
    names() { return Object.keys(linear); },
  };
  return P;
}

/** 默认调色板（引擎在任务未覆盖时使用）。 */
export const P = makePalette();

/** @typedef {ReturnType<typeof makePalette>} Palette */
