// @ts-check
/**
 * 镜头模板：`kinetic` —— 动态大字 + GLSL 背景。
 * 原场景：动态文字 + GLSL 背景。演示——shader 域扭曲、逐字上浮、计数器阵列。
 *
 * ```js
 * export default shot('kinetic', { headline: ['第一行', '第二行'] });
 * ```
 */


import { contentOk, atMost } from './pick.js';
import { Pass } from '../core/gl.js';
import { css, ease, prog, rng } from '../core/util.js';

/** 全部参数 = "什么都不传时的画面"（demo 用的就是这一套）。 */
const DEFAULTS = {
  id: 'kinetic',
  headline: ['每一帧', '都是时间的函数'],   // ⚠ 必须是正好两个元素：两行大字
  sub: 'DETERMINISTIC / SEEKABLE / RE-RENDERABLE',
  cellCols: 8,      // 左下角计数器阵列的列数
  cellRows: 5,      // 行数
  cellSeed: 31,     // 确定性随机种子（不要用 Math.random）
};

export function kineticShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    id: o.id,

    setup(ctx) {
      const P = ctx.P;
      // 流动的底：fbm 场 + 域扭曲，只让 signal 色出现在"等高线"上
      this.bg = new Pass(ctx.gl, /* glsl */ `
      uniform float warp;
      void main() {
        vec2 p = (FRAG_PX - 0.5 * RES_LOGICAL) / RES_LOGICAL.y;
        p += 0.06 * vec2(sin(t * 0.15), cos(t * 0.11));
        vec2 q = vec2(fbm(p * 3.0 + t * 0.05), fbm(p * 3.0 + vec2(5.2, 1.3) - t * 0.04));
        float f = fbm(p * 2.0 + q * warp);
        vec3 col = mix(C_INK, C_INK2, smoothstep(0.25, 0.75, f));
        // 等高线：把 f 量化，在边界上画细线
        float band = abs(fract(f * 9.0) - 0.5) * 2.0;
        float w = fwidth(f * 9.0) * 1.5;
        float line = 1.0 - smoothstep(w, w * 3.0, band);
        if (luma(C_INK) > 0.25) {
          col = mix(col, mix(C_GRAPHITE, C_SIGNAL, smoothstep(0.45, 0.85, f)), line * 0.45);
          col = mix(col, C_SIGNAL, 0.04 * exp(-8.0 * dot(p, p)));
        } else {
          col += mix(C_GRAPHITE, C_SIGNAL, smoothstep(0.45, 0.85, f)) * line * 0.55;
          col += C_SIGNAL * 0.05 * exp(-8.0 * dot(p, p));
        }
        // 极轻的噪声，避免出现色带
        col += (hash12(FRAG_PX + fract(t) * 91.0) - 0.5) * 0.012;
        fragColor = vec4(col, 1.0);
      }`, { warp: 1.1 }, { key: 'demo_kinetic_bg', blend: false });

      // 计数器阵列的随机相位（确定性）
      const r = rng(o.cellSeed);
      this.cells = Array.from({ length: o.cellCols * o.cellRows }, () => r());
    },

    render(ctx) {
      const { f, gl, P, text, type, comp, lines } = ctx;
      const { W, H } = gl;
      const t = f.lt;

      this.bg.u.warp.value = 1.0 + 0.4 * Math.sin(t * 0.6);
      this.bg.render(gl, ctx.out, f.t, f.dt);

      // 计数器阵列：一堆等宽数字在滚（机器口吻的纹理）
      text.clear();
      for (let i = 0; i < this.cells.length; i++) {
        const cx = 60 + (i % o.cellCols) * 26;
        const cy = 60 + Math.floor(i / o.cellCols) * 26;
        const v = Math.floor((t * 37 * (0.4 + this.cells[i]) + i * 13) % 1000);
        const a = 0.06 + 0.1 * this.cells[i] * (0.5 + 0.5 * Math.sin(t * 1.3 + i));
        type.write(String(v).padStart(3, '0'), cx, cy, {
          size: 22, family: 'mono', color: css(P.signal, a),
        });
      }

      // 主标语：逐字上浮，字距随时间收紧
      const tight = -6 + 10 * (1 - ease.outCubic(prog(t, 0.2, 2.2)));
      const size1 = 170;
      const x = W * 0.5;
      type.write(o.headline[0], x, H * 0.42, {
        size: size1, weight: 900, family: 'sans', tracking: tight, align: 'center',
        color: css(P.bone), stagger: 0.12, staggerDur: 0.8, from: 'up', dist: 90, t,
      });
      type.write(o.headline[1], x, H * 0.42 + size1 * 1.06, {
        size: size1, weight: 900, family: 'sans', tracking: tight, align: 'center',
        color: css(P.bone), stagger: 0.12, staggerDur: 0.8, from: 'up', dist: 90, t: t - 0.35,
      });

      // 副标：等宽，逐字擦出来
      const sub = o.sub;
      const typed = Math.floor(ease.outCubic(prog(t, 1.6, 3.2)) * sub.length);
      type.write(sub.slice(0, typed), x, H * 0.42 + size1 * 1.06 + 96, {
        size: 26, family: 'mono', tracking: 8, color: css(P.signal, 0.9), align: 'center',
      });

      // 四角的框线：入场时向外张开（做"取景框"感）
      const k = ease.outExpo(prog(t, 0.9, 2.0));
      const m = 70 + (1 - k) * 120;
      const arm = 90 * k;
      lines.begin();
      for (const [cx, cy, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
        lines.seg(cx, cy, cx + arm * sx, cy, 2.5, P.signal);
        lines.seg(cx, cy, cx, cy + arm * sy, 2.5, P.signal);
      }
      lines.flush(ctx.out);

      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });

      return {
        // 这个场景有大面积骨白粗体字。骨白的线性亮度约 0.85，正好卡在默认阈值上：
        // 阈值偏低 + 泛光偏强，字就会糊成一团白光（出过这个事故）。
        // 所以这里把阈值抬到 1 以上——只让真正过曝的东西发光。
        bloom: 0.34,
        bloomThreshold: 1.15,
        halation: 0.18,
        grain: 0.03,
        ca: 0.15 * Math.max(0, 1 - prog(t, 2.4, 3.6)),
        vignette: 0.42,
      };
    },
  };
}

kineticShot.defaults = DEFAULTS;
kineticShot.meta = {
  name: 'kinetic',
  summary: '动态大字 + GLSL 背景：两行主标（逐字上浮、字距随时间收紧）、逐字擦出的等宽副标、左下角滚动的计数器阵列、四角张开的取景框线。',
  notes: 'headline 必须正好两个元素（两行大字；第 2 行的入场比第 1 行晚 0.35 秒，多给或少给都会画错）。'
    + '左下角的计数器阵列是 cellCols × cellRows 个三位数字在滚，每个格子占 26×26 逻辑像素、'
    + '从 (60,60) 起算 —— 所以 cellCols/cellRows 调大就会铺满整个下半屏。'
    + '每个格子的相位来自 cellSeed 的确定性随机（绝不要换成 Math.random）。',
  // ⚠ params 的 name 集合必须与 DEFAULTS 的键集合**完全相等**（tools/test-shots.mjs 会断言）
  use: '一句短结论要砸出来（每行 ≤6 字），当全片最响的一拍',
  energy: '高',
  avoid: '长句、需要读懂的信息；它吃满整屏，不能和别的模板叠在同一段',
  params: [
    { name: 'id', type: 'string', desc: '段名（HUD / --only / 报错里用它）' },
    { name: 'headline', type: 'string[2]', desc: '两行大字，正好两个元素' },
    { name: 'sub', type: 'string', desc: '副标（等宽、逐字擦出来；擦出的进度按这个字符串的长度算）' },
    { name: 'cellCols', type: 'number', desc: '左下角计数器阵列的列数' },
    { name: 'cellRows', type: 'number', desc: '左下角计数器阵列的行数' },
    { name: 'cellSeed', type: 'number', desc: '计数器阵列的确定性随机种子' },
  ],
};

/**
 * 声明式 spec（`docs/ENGINE.md` §14.9；`anim shots --json` 与 `check` 的依赖前置校验读它）。
 *
 * `requires: []` 的依据：`render()` 只读 `f.lt` / `P` 与自带的 fbm 背景 Pass（`kinetic.js:60-66`），
 * 抖动相位来自 `rng(o.cellSeed)`（`kinetic.js:56`，确定性、不需要外部输入）。
 * `outputs.visual = 'full-frame'` 的依据是 `setup()` 里那张整帧背景 Pass（`kinetic.js:36-53`）。
 */
kineticShot.spec = {
  params: {
    id: 'string', headline: 'string[2]', sub: 'string',
    cellCols: 'number', cellRows: 'number', cellSeed: 'number',
  },
  requires: [],
  outputs: { visual: 'full-frame', handlesTransition: false },
};

/* 选型元数据（BACKLOG 1-62）：tags / w / fits 的契约在 ./pick.js 头注释；brief 缺省字段 = 不设限。
   改这里不改模板画面，只改 anim shots --pick 会抽到谁。 */
kineticShot.tags = ['title', 'pop', 'tech'];
kineticShot.w = 0.9;
kineticShot.fits = (q) => contentOk(q) && atMost(q?.chars, 12);
kineticShot.fitsNote = '两行 × ≤6 字（chars ≤12）；收尾位抽不到';
