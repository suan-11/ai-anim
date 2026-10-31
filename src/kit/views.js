// @ts-check
/**
 * `src/kit/views.js` —— **仪器视图**：把一帧已经画好的画面换一种「成像方式」呈现。
 *
 * 同一个画面可以有很不一样的介质：
 *
 * ````js
 * import { instrumented } from '../../../src/kit/views.js';
 *
 * instrumented(ctx, { mode: 'halftone', cell: 6 }, (target) => {
 *   lines.flush(target);
 *   comp.draw(gl, text, target, { premult: false });
 * });
 * ````
 *
 * ## 为什么它在引擎里
 *
 * 「半调印刷 / 字符画 / 1-bit 抖动 / 分级平涂 / 热成像 / 像素 / CRT / 雕版排线 / 木刻排线」这九种
 * 成像方式**与题材无关**，只与「你想让观众用什么介质读这份信息」有关。科普片里
 * 同一份数据用三种方式呈现（照片 → 半调印刷 → 1-bit 传真）是成熟手法，而每支片子
 * 重写一遍 GLSL 既贵又容易写错（取色空间、y 轴、网点相位全是坑）。
 *
 * 它落地了 BACKLOG 1-11（仪器视图），并顺手覆盖了风格素材包里反复出现的那几种介质。
 *
 * ## 出处与许可
 *
 * 这一层的**能力清单**是从用户提供的风格素材包（341 条提示词；索引见
 * `docs/REFERENCE-style-pack.md`）里数出来的，但**代码一行没有抄** —— 素材包里
 * 没有任何一份实现（A–G 那组的参考实现是 Canvas2D 绘制函数，与本文件无关）。
 * 这里的配方（网点面积正比于墨量、Bayer 有序抖动、荫罩三相位、桶形畸变）都是公开的
 * 印刷 / 显示原理，GLSL 照原理重写。
 *
 * | 素材包里的说法 | 本文件的 mode |
 * |---|---|
 * | 半调印刷 / 网点 | `halftone`（L29 复古半调案卷、O19 画报网点） |
 * | 字符画 / ASCII / 终端 | `ascii`（E3 字符画、L39 ASCII·CRT、X14 CRT 终端） |
 * | 1-bit 抖动 / 传真 / 老 Mac | `dither`（K28 像素、X17 蓝图、L36 蓝图） |
 * | 分级平涂 / 套色 | `posterize`（L28 Risograph、L11 WPA 丝网、K36 丝网印刷） |
 * | 仪器读数 / 扫描 | `thermal`（BACKLOG 1-11、L11 激光点云） |
 * | 像素化 | `pixel`（V13 像素、X13 16-bit 街机） |
 * | CRT 扫描线 / 荫罩 | `crt`（X14、V12 VHS、L39） |
 * | 雕版 / 木刻排线 | `engrave`（L30 木刻、L31 铜版、O10 线刻插图） |
 *
 * ## 三条纪律（违反都不报错，只会「看着有点不对」）
 *
 * 1. **成像是「事后」的**：先把这一帧完整画进离屏目标（含文字图层），再 `applyView`。
 *    顺序反了就是「文字没被印上」，而画面看起来只是「字更清楚了」。
 * 2. **亮度取显示空间（sRGB 编码后）**，不是线性光 —— 网点面积、抖动阈值、热色带
 *    全是按「人看到的亮度」定的；拿线性 HDR 值算，暗部会整片过曝。`shade()` 已统一处理。
 * 3. **Pass 与离屏目标每段只建一次**（缓存在 `ctx._views`）。每帧 new RT 会把出片速度打下来。
 *
 * 它是**整帧替换**（`blend: false`），所以必须画在最后一步。想在视图之后再加字
 * （例如保留一行清晰读数），就再 `text.clear()` 画一遍并 `comp.draw`。
 */

import { Pass, RT } from '../core/gl.js';

/** @typedef {[number, number, number]} RGB */

/* ------------------------------------------------------------------ 字符画的字形表 */

/**
 * 字符画的字模：每个字 7 行 x 5 列，`#` 是着墨点。
 *
 * 为什么不下载字体、也不走 Canvas2D 画字：这层的输入是**一帧已经合成好的纹理**，
 * 只有 5x7 的点阵能让「每个字符落在自己的格子里」这件事在任何分辨率下都精确成立
 * （用真字体会被 hinting / 亚像素定位毁掉，放大到 4K 还会糊）。
 *
 * ## 顺序必须由**实际着墨点数**决定（`sortGlyphsByInk`）
 *
 * 第一版是**手写**顺序（空格、.、:、-、=、+…），看着像「从少到多」，实际不是：
 * `=` 10 点排在 `o` 8 点前面、`x` 9 点在 `o` 后面 —— 查表出来的明暗关系是错的，
 * 中间调的底图会被印成一张几乎全亮的纸（实测：中灰底整片消失，只剩标题还看得见）。
 * 现在源码里按外观分组写，**运行时按点数稳定排序**，并由 `tools/test-views.mjs` 钉住严格不减。
 */
const GLYPHS = [
  '.....', '.....', '.....', '.....', '.....', '.....', '.....', // 空格
  '.....', '.....', '.....', '.....', '.....', '..#..', '..#..', // .
  '.....', '.....', '..#..', '.....', '.....', '..#..', '.....', // :
  '.....', '.....', '.....', '#####', '.....', '.....', '.....', // -
  '.....', '.....', '#####', '.....', '#####', '.....', '.....', // =
  '.....', '..#..', '#####', '..#..', '.....', '.....', '.....', // +
  '.....', '..#..', '#.#.#', '.###.', '#.#.#', '..#..', '.....', // *
  '.....', '.###.', '#...#', '#...#', '#...#', '.###.', '.....', // o
  '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....', // x
  '.....', '#####', '#####', '#####', '#####', '#####', '.....', // 实心块
  '.###.', '#.#.#', '#.#.#', '#.#.#', '#.#.#', '.###.', '.....', // @
];

/** 一个 5x7 字模的着墨点数（0..35）。 */
export function glyphInk(glyph) {
  let n = 0;
  for (const ch of glyph) if (ch === '#') n++;
  return n;
}

/**
 * 按着墨点数**稳定**排序（点数相同的保持源码顺序）。
 * 排序后 `glyphInk` 严格不减 —— `tools/test-views.mjs` 钉着这一条。
 */
export function sortGlyphsByInk(glyphs) {
  return glyphs
    .map((g, i) => ({ g, i, ink: glyphInk(g) }))
    .sort((p, q) => (p.ink - q.ink) || (p.i - q.i))
    .map((e) => e.g);
}

/** 排序之后的字模表（着色器与 JS 侧看到的是同一份顺序）。 */
const GLYPHS_SORTED = sortGlyphsByInk(GLYPHS);

/** 把 5x7 的字模压成两个 uint（前 4 行 20 bit + 后 3 行 15 bit）。 */
function packGlyphs() {
  const a = [];
  const b = [];
  for (let g = 0; g < GLYPHS_SORTED.length; g++) {
    let lo = 0;
    let hi = 0;
    for (let r = 0; r < 7; r++) {
      const row = GLYPHS_SORTED[g].slice(r * 5, r * 5 + 5);
      let bits = 0;
      for (let c = 0; c < 5; c++) bits = (bits << 1) | (row[c] === '#' ? 1 : 0);
      if (r < 4) lo = (lo << 5) | bits; else hi = (hi << 5) | bits;
    }
    a.push(lo >>> 0);
    b.push(hi >>> 0);
  }
  return { a, b };
}

const GLYPH_SRC = (() => {
  const { a, b } = packGlyphs();
  return 'const uint GA[' + a.length + '] = uint[' + a.length + '](' + a.map((v) => v + 'u').join(', ') + ');\n'
    + 'const uint GB[' + b.length + '] = uint[' + b.length + '](' + b.map((v) => v + 'u').join(', ') + ');';
})();

/** 字模数量（GLSL 里要当常量用，所以从 GLYPHS 算出来注入）。 */
const GLYPH_COUNT = GLYPHS_SORTED.length;

/* ------------------------------------------------------------------ 视图清单 */

/**
 * 视图的清单（给 CLI / 文档 / 场景自检用）。
 *
 * `cost` 是**每像素的额外采样数**；`needs` 说明它对输入的要求（目前全都只要亮度或原色）。
 */
export const VIEWS = {
  halftone: {
    label: '半调印刷',
    note: '把画面印成网点：暗的地方网点大、亮的地方网点小。经典印刷 / 报纸质感，'
      + '也让「这是被印出来的东西」这件事不用旁白去说。',
    cost: 1, needs: 'luma',
  },
  ascii: {
    label: '字符画',
    note: '每个格子里放一个字符，亮度决定放哪个字。老机器 / 终端 / 「这东西是被数出来的」。',
    cost: 1, needs: 'luma',
  },
  dither: {
    label: '1-bit 抖动',
    note: '只有黑白两色，靠 Bayer 有序抖动的棋盘纹理表现灰阶。传真机 / 早期 Mac / 硬边复古。',
    cost: 1, needs: 'luma',
  },
  posterize: {
    label: '分级色阶',
    note: '把连续色阶压成 N 级平涂。丝网印刷 / Risograph / 平涂海报的底子。',
    cost: 1, needs: 'rgb',
  },
  thermal: {
    label: '热成像',
    note: '亮度映射成冷到热的色带。仪器读数 / 扫描 / 「这不是给人看的画面」。',
    cost: 1, needs: 'luma',
  },
  pixel: {
    label: '像素化',
    note: '降分辨率再放大（最近邻）。游戏感 / 复古 / 「它很小」。',
    cost: 1, needs: 'rgb',
  },
  crt: {
    label: 'CRT 显像管',
    note: '扫描线 + 荫罩 + 桶形畸变 + 轻微色渗。老显示器 / 录像带 / 监控。',
    cost: 3, needs: 'rgb',
  },
  engrave: {
    label: '雕版排线',
    note: '用排线的疏密表现明暗（不是网点）。木刻 / 铜版画 / 老科普书插图。',
    cost: 1, needs: 'luma',
  },
  woodcut: {
    label: '多方向排线',
    note: '按明暗**加方向**：亮部一道线、中间调交叉两道、暗部再加第三道，每层更细；'
      + '线沿长度方向会断（木纹崩口），断口由坐标哈希决定。木刻 / 铜版 / 线刻插图的正解。',
    cost: 2, needs: 'luma',
  },
};

/** 视图名（`mode` 的合法取值，顺序与着色器里的整数一致）。 */
export const VIEW_NAMES = Object.keys(VIEWS);

/* ------------------------------------------------------------------ 着色器 */

/**
 * 所有 mode 共用一个程序（分支由 uniform 决定，不会重复编译）。
 *
 * 输入当作**已经合成好的画面**（文字、图形、背景都在里面），
 * 输出是**线性光**（引擎的 out 是 RGBA16F），所以写回前要 `toLinear()`。
 */
const VIEW_FRAG = /* glsl */ `
  uniform sampler2D src;
  uniform float mode;        // 见 VIEW_NAMES 的顺序
  uniform float cell;        // 逻辑像素：字符画行高 / 半调网目间距 / 像素块边长
  uniform float angle;       // 半调网角（弧度）与雕版排线角度
  uniform float levels;      // posterize 的级数
  uniform float amount;      // 0 = 原图，1 = 完全是视图（做「显影」过渡用）
  uniform float accentMix;   // 把最暗/最亮那一档染成强调色的比例
  uniform float scanline;    // CRT 扫描线强度 0..1
  uniform float passes;      // 半调：套印版数 1..4（1 = 单版 = 引擎一直以来的行为）
  uniform float misreg;      // 半调：套准偏移（逻辑像素；0 = 完全对准。1.5–3 是「看得见没对准」的档）
  uniform vec3  cPaper, cInk, cAccent;
  ${GLYPH_SRC}

  /** 逻辑像素、**y 向下**（和 JS 侧坐标一致；FRAG_PX 是 y 向上的，别直接用） */
  vec2 pxDown() { return vec2(FRAG_PX.x, RES_LOGICAL.y - FRAG_PX.y); }

  /**
   * 取一个点的**显示空间**颜色：这些成像方式全是按「人看到的亮度」定的。
   * 输入是线性 HDR，先压到 0..1 再编码成 sRGB —— 与 readPixels(rt,'srgb') 同一口径。
   */
  vec3 shade(vec2 px) {
    vec2 uv = px / RES_LOGICAL;
    uv.y = 1.0 - uv.y;                       // 回到 vUv 的 y 向上
    return sat(toSRGB(max(texture(src, uv).rgb, vec3(0.0))));
  }
  float shadeL(vec2 px) { return luma(shade(px)); }

  vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

  /** 4x4 Bayer（两个 2x2 递归合成），返回 0..1 的 16 级阈值 */
  float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

  /** 冷到热：热成像色带（黑到蓝到青到黄到白），与引擎的 heat() 不是一回事（那个是火花用的） */
  vec3 thermalRamp(float x) {
    x = sat(x);
    vec3 c = mix(vec3(0.02, 0.02, 0.06), vec3(0.10, 0.16, 0.55), smoothstep(0.00, 0.30, x));
    c = mix(c, vec3(0.05, 0.60, 0.60), smoothstep(0.28, 0.52, x));
    c = mix(c, cAccent, smoothstep(0.68, 0.85, x));
    c = mix(c, vec3(1.0, 0.98, 0.88), smoothstep(0.90, 1.0, x));
    return c;
  }

  void main() {
    vec2 px = pxDown();
    vec3 base = shade(px);
    int m = int(mode + 0.5);
    vec3 outc = base;

    if (m == 0) {                             /* ---- 半调印刷 ---- */
      // ⚠ 分两路：passes ≤ 1 走单版（与历史**逐像素相同** —— 所有老片子与
      //   基线都靠这一条），passes ≥ 2 走 N 版套印。两条路别合并：合并就会
      //   让「没写 passes」的画面也变一遍（就等于拿整仓库的 hashes 基线去赌）。
      if (passes <= 1.5) {
        // 网角：0 = 正放，27 度是印刷的惯例（四色叠印不会撞出摩尔纹）
        vec2 q = rot2(px, angle) / max(cell, 1.0);
        vec2 id = floor(q);
        vec2 local = fract(q) - 0.5;
        // 每一格只取中心一次样：这才是真正的网点（逐像素采样会得到「模糊的网点」）
        vec2 center = rot2(id + 0.5, -angle) * max(cell, 1.0);
        float l = shadeL(center);
        // 面积正比于墨量 ⇒ 半径正比于 sqrt(墨量)。上限 0.56 = 1/sqrt(pi)：
        // 超过它网点就互相压住、整格变实心（实测 0.62 时暗部一整片全黑，看不出网）
        float r = sqrt(sat(1.0 - l)) * 0.56;
        float aa = 1.0 / max(cell, 1.0) * 0.9;    // 不到一格的边，够抗锯齿又不糊
        float ink = 1.0 - smoothstep(r - aa, r + aa, length(local));
        outc = mix(cPaper, cInk, ink);
        outc = mix(outc, cAccent, ink * accentMix * smoothstep(0.55, 1.0, l));
      } else {
        /* ---- N 版套印（riso / 丝网 / 双色印刷）----
         *
         * 同一张图分成 N 个「墨量带」：第 i 版只印墨量落在第 i 段的那一块
         * （band = sat((1-l)*N - i)），每版自己的网角、自己的墨色、自己的套准偏移。
         * 版序从**浅墨到深墨**：浅版铺中间调、深版压暗部 —— 这就是双色印刷的做法。
         *
         * 套准偏移（misreg）是这层的关键：真实套印没对准时，相邻两版的网点边界
         * 会错开一条彩色边，画面边缘会长出「红蓝边」—— 少了它，N 版看起来只是
         * 一张多色网点图，不像「印出来的」。偏移方向按黄金角散开（fi * 2.4 rad），
         * 每版方向都不同，避免整齐地朝一个方向偏。
         */
        int np = int(clamp(passes, 1.0, 4.0) + 0.5);
        vec3 acc = cPaper;
        for (int i = 0; i < 4; i++) {
          if (i < np) {
            float fi = float(i);
            // 每版网角错开 30 度：四色印刷的惯例，防多版叠出摩尔纹
            float ang = angle + fi * 0.5236;
            // 套准偏移：方向按黄金角散开、幅度随版号递增（基准版不偏）
            float oa = fi * 2.3999;
            vec2 off = vec2(cos(oa), sin(oa)) * misreg * (fi / max(float(np - 1), 1.0));
            vec2 q = rot2(px - off, ang) / max(cell, 1.0);
            vec2 id = floor(q);
            vec2 local = fract(q) - 0.5;
            // 回到像素空间取这一格的墨量（错位采样 = 套印没对准时读到的是邻格）
            vec2 center = rot2(id + 0.5, -ang) * max(cell, 1.0) + off;
            float l = shadeL(center);
            // 分版：越深的版越晚进入。阈值 th = (i/N)·0.8 —— 第 0 版从纯白就开始有墨，
            // 最后一版只在最暗的 20% 里出现。⚠ 第一版写成 disjoint 的「(1-l)*N - i」：
            //   纸面（亮度 0.62）就有 72% 的强调色覆盖 ⇒ 整屏被染成红的、纸色全丢。
            float th = (fi / float(np)) * 0.8;
            float band = sat(((1.0 - l) - th) / max(1.0 - th, 1e-3));
            float r = sqrt(band) * 0.56;
            float aa = 1.0 / max(cell, 1.0) * 0.9;
            float ink = 1.0 - smoothstep(r - aa, r + aa, length(local));
            // 墨色：浅 → 深（fi=0 是强调色版、最后一版是墨色版）
            vec3 plateInk = mix(cAccent, cInk, fi / max(float(np - 1), 1.0));
            acc = mix(acc, plateInk, ink);
          }
        }
        outc = acc;
      }

    } else if (m == 1) {                      /* ---- 字符画 ---- */
      float cw = max(cell * 0.6, 2.0);          // 等宽字宽高比约 0.6
      vec2 g = vec2(px.x / cw, px.y / max(cell, 1.0));
      vec2 id = floor(g);
      vec2 local = fract(g);
      float l = shadeL((id + 0.5) * vec2(cw, cell));
      // 字形表按墨量从小到大排，所以**亮的地方放密字**（终端那种「亮 = 有笔画」）。
      // 极性由 paper/ink 决定：ascii 默认纸/墨反转（见 applyView 的 SCREEN_POLARITY）。
      // 字模按下标表示「墨量」：亮底（纸）时墨量 = 1-亮度，暗底（终端）时墨量 = 亮度。
      // 写死成 l 的话，终端极性会把整屏变成「背景全实心、文字全空」的反相图。
      // 再加一条亮度补偿：字模最密的那个也只有约六成着墨，直接用会让中间调整片偏黑（实测：
      // 0.75 的灰纸被印成 0.23 的暗屏，图还读得出、字已经没了）。先提一点对比再查表。
      float cov = luma(cPaper) < 0.5 ? l : sat(1.0 - l);
      cov = sat(pow(cov, 0.8) * 1.18);
      int gi = int(clamp(floor(cov * float(${GLYPH_COUNT - 1}) + 0.5), 0.0, float(${GLYPH_COUNT - 1})));
      // 5x7 点阵：把局部坐标吸到格点上，字才干净
      int gx = int(clamp(floor(local.x * 5.0), 0.0, 4.0));
      int gy = int(clamp(floor(local.y * 7.0), 0.0, 6.0));
      uint bits = gy < 4 ? (GA[gi] >> uint((3 - gy) * 5)) : (GB[gi] >> uint((6 - gy) * 5));
      uint bit = (bits >> uint(4 - gx)) & 1u;
      outc = mix(cPaper, cInk, float(bit));

    } else if (m == 2) {                      /* ---- 1-bit 抖动 ---- */
      // 阈值 < 亮度 ⇒ 这一点是纸。**极性写反了画面会整块反相**（黑底白图），
      // 而它在深色底片的片子里"看起来还挺像"，所以这里把方向写明。
      float th = bayer4(px / max(cell, 1.0));
      outc = mix(cPaper, cInk, step(shadeL(px), th));

    } else if (m == 3) {                      /* ---- 分级色阶 ---- */
      float L = max(levels, 2.0);
      // 在**显示空间**压级：线性空间压级会让暗部挤成一团
      outc = sat(floor(base * L + 0.5) / max(L - 1.0, 1.0));

    } else if (m == 4) {                      /* ---- 热成像 ---- */
      outc = thermalRamp(shadeL(px));

    } else if (m == 5) {                      /* ---- 像素化 ---- */
      vec2 blk = max(vec2(cell), vec2(1.0));
      outc = shade((floor(px / blk) + 0.5) * blk);

    } else if (m == 6) {                      /* ---- CRT ---- */
      // 桶形畸变：把 uv 往外推一点点，边缘会「胖」出来
      vec2 uv = vUv * 2.0 - 1.0;
      uv *= 1.0 + 0.035 * dot(uv, uv);
      vec2 q = uv * 0.5 + 0.5;
      // 三枪没对齐那种色渗
      vec3 c = vec3(
        sat(toSRGB(max(texture(src, vec2(q.x + 0.0012, q.y)).rgb, vec3(0.0)))).r,
        sat(toSRGB(max(texture(src, q).rgb, vec3(0.0)))).g,
        sat(toSRGB(max(texture(src, vec2(q.x - 0.0012, q.y)).rgb, vec3(0.0)))).b);
      // 扫描线：按**逻辑像素**走（4K 下不会变成「看不见的细纹」）
      float sl = 0.5 + 0.5 * cos(px.y * PI / max(cell * 0.5, 0.5));
      c *= mix(1.0, 0.55 + 0.45 * sl, scanline);
      // 荫罩：屏幕上的 RGB 竖条
      float mask = 0.5 + 0.5 * cos(px.x * TAU / max(cell * 2.0, 3.0));
      c *= 1.0 - 0.18 * (1.0 - mask);
      // 桶形之后画外的部分要黑掉（不然四角会被拉出一圈边）
      c *= smoothstep(1.0, 0.92, max(abs(q.x - 0.5), abs(q.y - 0.5)) * 2.0);
      c *= 1.0 - 0.55 * smoothstep(0.45, 1.0, length(uv));
      // 扫描线与荫罩是**乘**上去的，会把整屏压暗一档；补回来，否则 CRT 段比别段黑 30%。
      // ⚠ 不能裸乘：浅底画面（纸面图表 / 整屏白底字）会被推成 20%+ 死白，check 的过曝门当场红。
      //   所以亮部走软肩 —— 0.72 以下原样，之上渐近 0.97，永远不会打出死白。
      c *= 1.55;
      const float knee = 0.72;
      c = min(c, vec3(knee))
        + (1.0 - exp(-max(c - knee, vec3(0.0)) / (1.0 - knee))) * (1.0 - knee) * 0.9;
      outc = c;

    } else if (m == 7) {                      /* ---- 雕版排线 ---- */
      // 排线用**线宽**表现明暗：暗的地方线粗到连成片，亮的地方只剩细线。
      // ⚠ 不要用 GLSL_COMMON 的 hatch()/engrave()：那两个的返回值是「这一点的暗度附加值」，
      //   不是「墨的覆盖率」，直接当墨用会得到一张**反相**的版画（实测：整屏斜纹）。
      //   而且它们两参数那版宽度是阶跃、不抗锯齿，做静态版画够用、做整帧成像就是糊。
      // 这里自己写：u 的整数处一根线，线宽 = darkness，用 fwidth 抗锯齿。
      float l = shadeL(px);
      float dark = sat(1.0 - l);
      float u = dot(px, vec2(cos(angle), sin(angle))) / max(cell, 1.0);
      float f = abs(fract(u) - 0.5);                  // 0 = 线心，0.5 = 两线之间
      // 上限 0.46：再宽两根线就粘成实心，版画就没有「线」了（实测 0.5 时暗部整片实黑）
      float hw = 0.46 * pow(dark, 0.8);               // 暗 ⇒ 线宽逼近整格宽
      float aa = max(fwidth(u), 1e-4);
      float ink = 1.0 - smoothstep(hw - aa, hw + aa, 0.5 - f);
      outc = mix(cPaper, cInk, ink);

    } else if (m == 8) {                      /* ---- 多方向排线（木刻 / 铜版） ---- */
      /* 与 engrave 的差别：engrave 只有**一个方向**，全靠线宽表达明暗 —— 于是暗部
       * 只能一路加粗到粘成一片实黑，读起来是"阴影"而不是"刻痕"。
       * 真实的木刻 / 铜版用的是**加方向**：亮部一道线（单排线），中间调交叉两道，
       * 暗部再叠第三道（cross-hatching）。五条纪律，每一条都是出图之后才补上的：
       *
       *   ① **每加一层，那层的线更细**（真实刻刀：第二道压在第一道的空隙里）。
       *      不这么做，三层叠起来立刻饱和成实黑，画面丢一大半。
       *   ② **层与层的边界要抖**（Bayer），不能按亮度硬切 —— 硬切会在中间调上出现
       *      一块一块的"补丁"（有的地方突然多了一道斜纹）。
       *   ③ **线要断**：木刻的刀口顺着木纹崩，铜版的针会跳，所以线沿长度方向有断口；
       *      断口由坐标哈希决定（确定性，不吃时间）。⚠ 段要**长**（~9 格）：
       *      第一版 3 格一段，出图是一排点划线，像传真不像刻痕。
       *   ④ **明暗要取局部平均，不能取单像素**：拿单像素亮度挑层，底图自己的
       *      周期性（面板是一行行铺的、扫描线、网点）会跟排线**拍频**，
       *      出图是一圈圈水波纹般的摩尔纹，把底图整个吃掉。这里用整格 4x4 = 16 点低通。
       *   ⑤ **线距不能逼近像素栅格**（最后一条，也最隐蔽）。这是**次谐波**：
       *      45° 线的周期投影到 x/y 约是"间距 / √2"，线距给 7px / 12px 时它落到 5px / 8.5px
       *      —— 与像素栅格、与图像行距都能凑成近整数比，整屏长出很宽的横向明暗带
       *      （实测看着像"油墨没推开"）。间距 22px 时投影 15.6px，与常见底纹都不成
       *      整数比，出图干净。**线宽按像素给**（不是按格的比例），格大小换了线也不飘。
       */
      // ④ 低通：**黄金角螺旋**取 24 个点，半径跨**整格**。
      //   ⚠ 两条都是出图之后才定下来的：
      //     · 网格采样（4x4、5 点十字）在这一层是**下策**：采样点自己也有周期，
      //       一旦与排线的周期（≈ cell）成整数比，整屏长出大尺度拍频波纹，
      //       看着像"油墨没推开"。黄金角螺旋没有轴向对齐，点与排线不锁相。
      //     · **半径必须 ≥ 底图最小特征尺度**：lines.fillRect 是一行行铺的，行距
      //       可能就是 2-8px。半径小时采样点全落在**同一行**里 —— 于是一块纯平的
      //       灰面上，采样值随"这一行多亮"抖动，出图是一片明暗发丝（实测：三块
      //       纯灰的三档排线，同一块内部明暗不均，像脏了）。半径跨满一格就够盖住
      //       任何一种 fillRect 步进。
      float pc = max(cell, 1.0) * 0.5;
      float l = 0.0;
      for (int i = 0; i < 24; i++) {
        float fi = float(i) + 0.5;
        float r = sqrt(fi / 24.0) * pc;
        float a = fi * 2.39996;                       // 黄金角（弧度）
        l += shadeL(px + vec2(cos(a), sin(a)) * r);
      }
      l *= (1.0 / 24.0);
      float dark = sat(1.0 - l);
      float ink = 0.0;
      for (int layer = 0; layer < 3; layer++) {
        float fi = float(layer);
        // 进入门槛：第 0 层从 0.16 起、第 1 层 0.46、第 2 层 0.72
        float gate = fi < 0.5 ? 0.16 : (fi < 1.5 ? 0.46 : 0.72);
        // ② 抖动过渡：阈值加一点 Bayer，边界才不是硬补丁
        float bayer = (bayer4(px) - 0.5) * 0.09;
        float on = step(gate + bayer, dark);
        if (on > 0.0) {
          float ang = angle + (fi - 1.0) * 0.5236;             // -30° / 0° / +30°
          float freq = max(cell, 1.0) * (1.0 + 0.30 * fi);     // 后加的层更密
          float u = dot(px, vec2(cos(ang), sin(ang))) / freq;
          // ①⑤ 线宽按**像素**给：0.9 / 0.75 / 0.6 px（半宽）—— 与格大小解耦
          float halfPx = 0.9 - 0.15 * fi;
          // ⚠ 新加的层在**刚过门槛时必须是"细而可见"的**，不能从 0 开始长：
          //   纯 pow 的话，第二层在它刚出现的区间里宽度只有零点零几像素 ——
          //   中间调上等于没有，出图看起来还是"一道线"（探针图里中间的灰块
          //   与左边一模一样，只有最暗那块才看得出交叉）。
          //   真实的版画里第二道一出现就是一条细线，然后随明暗变宽。
          float t = sat((dark - gate) / max(1.0 - gate, 0.15));
          float hw = (halfPx / freq) * (0.22 + 0.78 * pow(t, 0.85));
          // ③ 断线（段长 ~9 格，见上）
          float along = dot(px, vec2(-sin(ang), cos(ang)));
          float seg = floor(along / (freq * 9.0));
          float brk = hash12(vec2(seg, fi * 37.0 + 11.0));
          hw *= step(0.10, brk) * (0.62 + 0.38 * brk);
          float f = abs(fract(u) - 0.5);                       // 0 = 线心
          float aa = 0.5 / freq;                               // 固定半格抗锯齿
          ink = max(ink, 1.0 - smoothstep(hw - aa, hw + aa, 0.5 - f));
        }
      }
      outc = mix(cPaper, cInk, sat(ink));
    }

    // amount = 显影强度（0 时逐像素等于输入）
    outc = mix(base, outc, sat(amount));
    // 视图算出来的是**显示空间**的颜色，引擎的 out 要线性光
    fragColor = vec4(toLinear(max(outc, vec3(0.0))), 1.0);
  }`;

/** mode 名 -> 着色器里的整数（与 VIEW_NAMES 的顺序一致）。写错**当场抛**，不静默回落。 */
function modeIndex(mode) {
  const i = VIEW_NAMES.indexOf(String(mode));
  if (i < 0) {
    throw new Error(
      '未知的视图模式 "' + mode + '"。可用的：' + VIEW_NAMES.join(' / ')
      + '（说明见 docs/COOKBOOK.md 的「仪器视图」一节）',
    );
  }
  return i;
}

/** 每种视图的默认格子尺寸（逻辑像素）。字符画要能读出字，网点要密。 */
const DEFAULT_CELL = { ascii: 20, pixel: 6, dither: 3, halftone: 7, engrave: 8, crt: 3, woodcut: 22 };

/**
 * **woodcut 的格子下限**（逻辑像素）。
 *
 * 低于它会出**次谐波**：45° 线的周期投影到 x/y 约是「间距 / √2」，间距 12px 时投影
 * 8.5px —— 与像素栅格、与 `lines.fillRect` 的行距都能凑成近整数比，整屏长出很宽的
 * 横向明暗带（出图看着像「油墨没推开」，而不是线条）。22px 时投影 15.6px，谁都不成整数比。
 *
 * ⚠ 这里**夹住**而不是抛错：这是观感下限，不是契约。但夹住了要留痕（见 `viewCellOf`）。
 */
export const WOODCUT_MIN_CELL = 22;

/**
 * 解析一格的大小（对 woodcut 施加下限保护）。
 *
 * ⚠ 越界时**不改调用方的意图、只夹住并留痕**：把夹到的值写进 `ctx.warnings`，
 *   `check` 会打出来 —— 「我明明写了 cell: 8，出来却是 22」这件事必须说出来，
 *   否则就是又一条「写错了但画面照样出」。
 *
 * @param {{ mode: string, cell?: number }} opts
 * @param {any} [ctx] 有就记 warning（`applyView` / `instrumented` 会传）
 */
function viewCellOf(opts, ctx) {
  const want = opts.cell ?? DEFAULT_CELL[opts.mode] ?? 7;
  if (opts.mode !== 'woodcut') return want;
  const n = Number(want);
  if (!(n >= WOODCUT_MIN_CELL)) {
    if (ctx && Array.isArray(ctx.warnings)) {
      ctx.warnings.push('woodcut 的 cell ' + want + ' 低于下限 ' + WOODCUT_MIN_CELL
        + ' —— 已夹到 ' + WOODCUT_MIN_CELL + '（再小会出次谐波横带，见 src/kit/views.js）');
    }
    return WOODCUT_MIN_CELL;
  }
  return n;
}

/**
 * 哪些视图默认「深底浅字」（像屏幕），哪些默认「浅底深字」（像纸）。
 *
 * 这一条写错**不会报错**，只会整块反相 —— 而反相在深色底片的片子里"看着还挺像"，
 * 所以把它做成显式常量，而不是靠调用方每次都记得传 paper/ink。实测踩过：
 * `ascii` 用纸的极性时，黑底会被印成一整片米白，字反而消失了。
 */
const SCREEN_POLARITY = new Set(['crt']);

/** 每段 ctx 上的缓存槽（Pass 与离屏目标都建一次就够）。 */
function slot(ctx) {
  if (!ctx._views) ctx._views = { rt: null, pass: null };
  return ctx._views;
}

/**
 * 把这一帧画进一个**离屏目标**，返回那个目标（`RT`）。
 *
 * 这是 `applyView` 的配套：成像必须发生在「画面已经完整」之后，
 * 而 `ctx.out` 是**边画边写**的（`comp.draw` 每一步都在改它），
 * 所以要先画到一个干净的目标上，再整体换一种成像方式。
 *
 * ```js
 * const rt = renderCapture(ctx, (target) => {
 *   lines.flush(target);
 *   comp.draw(gl, text, target, { premult: false });
 * });
 * applyView(ctx, rt, { mode: 'ascii', cell: 18 });
 * ```
 *
 * 目标**不会自动清空**：只画了一部分时上一帧的内容会留在里面，要清就自己
 * `gl.clear(target, …)`（和画 `ctx.out` 时的规矩一样）。
 *
 * @param {any} ctx 场景 ctx
 * @param {(target: any) => void} draw 往这个目标上画（和画 `ctx.out` 一样的写法）
 * @returns {any} RT
 */
export function renderCapture(ctx, draw) {
  const gl = ctx.gl;
  const st = slot(ctx);
  if (!st.rt || st.rt.w !== gl.pw || st.rt.h !== gl.ph) {
    if (st.rt) st.rt.dispose?.();
    st.rt = new RT(gl, gl.pw, gl.ph);
  }
  draw(st.rt);
  return st.rt;
}

/**
 * 把一个**已经画好的目标**换一种成像方式，贴回 `ctx.out`（整帧替换）。
 *
 * @param {any} ctx 场景 ctx
 * @param {any} src 源：`renderCapture` 返回的 RT，或任何 `{ tex }` 纹理句柄
 * @param {{
 *   mode: string,             // 见 VIEWS / VIEW_NAMES
 *   cell?: number,            // 逻辑像素：字符画行高 / 半调网目 / 像素块（默认按模式给）
 *   angle?: number,           // 半调网角 / 雕版排线角度（弧度；默认 27 度与 45 度）
 *   levels?: number,          // posterize 级数（默认 4）
 *   amount?: number,          // 0..1 显影强度（默认 1）
 *   accentMix?: number,       // 强调色染进最暗/最亮档的比例（默认 0）
 *   scanline?: number,        // CRT 扫描线强度（默认 0.85）
 *   passes?: number,          // 半调：套印版数 1..4（默认 1 = 单版；≥2 = N 版套印）
 *   misreg?: number,          // 半调：套准偏移（逻辑像素，默认 0；1.5–3 是「明显没对准」）
 *   paper?: RGB, ink?: RGB, accent?: RGB,   // 默认取调色板的 bone / ink / signal
 * }} [opts]
 * @returns {any} ctx.out（方便链式）
 */
export function applyView(ctx, src, opts = {}) {
  const gl = ctx.gl;
  const P = ctx.P;
  const st = slot(ctx);
  const mode = modeIndex(opts.mode);
  if (!st.pass) {
    st.pass = new Pass(gl, VIEW_FRAG, {
      src: null,
      mode: 0, cell: 8, angle: 0.4712, levels: 4, amount: 1, accentMix: 0, scanline: 0.85,
      passes: 1, misreg: 0,
      cPaper: [1, 1, 1], cInk: [0, 0, 0], cAccent: [1, 0.3, 0.07],
    }, { key: 'kit_views', blend: false, jitter: false });   // 整帧重采样（读的已经是抖过的图）
  }
  const p = st.pass;
  p.u.src.value = src;
  p.set({
    mode,
    cell: viewCellOf(opts, ctx),
    // 排线类（engrave / woodcut）默认 45°：这是铜版与木刻的惯例角度 —— 用 27° 时
    // 第一层的线几乎是竖直的，画面读起来像"扫描线"而不是"刻痕"（出图才发现）。
    angle: opts.angle ?? (opts.mode === 'engrave' || opts.mode === 'woodcut' ? Math.PI / 4 : 0.4712),
    levels: opts.levels ?? 4,
    amount: opts.amount ?? 1,
    accentMix: opts.accentMix ?? 0,
    scanline: opts.scanline ?? 0.85,
    // 半调套印：1 版 = 单版（默认，逐像素与历史一致）；2–4 版才走 N 版分支
    passes: Math.min(4, Math.max(1, Math.round(Number(opts.passes ?? 1)) || 1)),
    misreg: Number(opts.misreg) > 0 ? Number(opts.misreg) : 0,
    // 默认配色：纸 / 墨取调色板的 bone 与 ink（换风格时自动跟着走），
    // 极性按模式分（纸的介质浅底深字，屏幕的介质深底浅字）
    cPaper: opts.paper ?? (SCREEN_POLARITY.has(opts.mode) ? P.ink : P.bone),
    cInk: opts.ink ?? (SCREEN_POLARITY.has(opts.mode) ? P.bone : P.ink),
    cAccent: opts.accent ?? P.signal,
  });
  p.render(gl, ctx.out, ctx.f.t, ctx.f.dt);
  return ctx.out;
}

/**
 * 一行式：把这一帧「画 → 换成某种成像」。
 *
 * ```js
 * instrumented(ctx, { mode: 'halftone', cell: 6 }, (target) => {
 *   lines.flush(target);
 *   comp.draw(gl, text, target, { premult: false });
 * });
 * ```
 *
 * @param {any} ctx @param {any} opts @param {(target: any) => void} draw
 */
export function instrumented(ctx, opts, draw) {
  return applyView(ctx, renderCapture(ctx, draw), opts);
}

/**
 * **整段成像**（`style.view`，2026-10-30 用户拍板）：把**已经画完的** `ctx.out` 换一种成像。
 *
 * 与 `instrumented()` 的区别只有一点：源就是 `ctx.out` 本身。而 GL 里「同一张纹理
 * 既当源又当目标」是未定义行为（某些驱动整屏黑、某些驱动出锯齿），所以先把它
 * 拷进离屏目标再成像回来。引擎在「所有段都合成完 → post 之前」调它一次 ——
 * 于是**整片**（含转场合成的画面）都是同一种介质，而不是只有某一段。
 *
 * `view` 为 null / 没有 `mode` ⇒ 什么都不做（默认就是这条路：不写 view 的片子
 * 一个像素都不变）。`view` 可以是 `'halftone'` 这种字符串，也可以是对象
 * （`{ mode, cell, passes, misreg, paper, ink, … }`，字段同 `applyView`）。
 *
 * @param {any} ctx 引擎造的伪 ctx（`{ gl, out, P, comp, f:{t,dt} }`）
 * @param {any} view 风格包 / 任务给的 view 声明
 * @returns {any} ctx.out
 */
export function applyStyleView(ctx, view) {
  const opts = typeof view === 'string' ? { mode: view } : view;
  if (!opts || !opts.mode) return ctx.out;
  const st = slot(ctx);
  if (!st.rt || st.rt.w !== ctx.gl.pw || st.rt.h !== ctx.gl.ph) {
    if (st.rt) st.rt.dispose?.();
    st.rt = new RT(ctx.gl, ctx.gl.pw, ctx.gl.ph);
  }
  // 拷一份：ctx.out 既要当源又要当目标 —— 读自己写自己是 GL 未定义行为
  ctx.comp.copyOver(ctx.gl, ctx.out, st.rt, 1);
  return applyView(ctx, st.rt, opts);
}

/** 视图清单（给文档 / CLI / 场景自检；与 VIEWS 同一份数据，形状更扁平）。 */
export function listViews() {
  return Object.entries(VIEWS).map(([name, v]) => ({
    name, label: v.label, note: v.note, cost: v.cost, needs: v.needs,
    defaultCell: DEFAULT_CELL[name] ?? 7,
  }));
}