// @ts-check
/**
 * 镜头模板：`cel` —— 手绘逐帧 / 线条沸腾。
 *
 * 画面是纸（暖白 + 极轻斜纹 + 污渍），线条每 2 帧重描一次（每秒 12 次抖动）——
 * 圆永远不圆、直线微微起伏、下划线在呼吸，这就是手绘动画的那种活感。
 *
 * 抖动量来自 src/kit/boil.js 的 hash2(帧组, 线号)：确定性，可 seek，可并行子帧；
 * 成片在 12fps 的节奏上抖，不是每帧随机跳。
 *
 * ```js
 * export default shot('cel', { title: '手作', sub: '每一帧都是重画的' });
 * ```
 */


import { contentOk } from './pick.js';
import { Pass } from '../core/gl.js';
import { css, prog, sat, mixColor } from '../core/util.js';
import { boilSeg, boilCircle } from '../kit/boil.js';
import { resolveTypeSize } from '../style/tokens.js';

const DEFAULTS = {
  id: 'cel',
  kicker: 'CEL / 逐帧手绘',
  title: '手作',
  sub: '每一帧都是重画的',
  footer: '线条每 2 帧重描 —— 抖动来自 hash(帧组, 线号)，不是随机数',
  amp: 1.8,
};

const luma3 = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export function celShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    id: o.id,
    setup(ctx) {
      const Q = ctx.P;
      const lightBg = luma3(Q.ink) > luma3(Q.bone);
      this.paper = new Pass(ctx.gl, /* glsl */ `
        uniform vec3 cPaper, cStain;
        float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        void main() {
          vec2 p = vUv;
          float n = h(floor(FRAG_PX / 3.0)) * 0.5 + h(floor(FRAG_PX / 7.0)) * 0.5;
          vec3 col = cPaper * (0.97 + 0.03 * n);
          float stain = smoothstep(0.55, 1.1, length((p - vec2(0.28, 0.68)) * vec2(1.0, 1.3)));
          col = mix(col, cStain, stain * 0.10);
          col *= 1.0 - 0.20 * smoothstep(0.5, 1.25, length((p - 0.5) * vec2(1.02, 1.0)) * 1.5);
          fragColor = vec4(col, 1.0);
        }`, { cPaper: lightBg ? Q.ink : mixColor(Q.ink, [1, 1, 1], 0.35), cStain: Q.ember }, { key: 'shot_cel_paper', blend: false });
    },

    render(ctx) {
      const { f, gl, P: Q, lines, text, type, comp, W, H } = ctx;
      const t = f.lt;
      this.paper.render(gl, ctx.out, t, f.dt);

      const lightBg = luma3(Q.ink) > luma3(Q.bone);
      const ink = lightBg ? Q.bone : mixColor(Q.ink, [0, 0, 0], 0.55);
      const red = Q.signal;
      const inkC = [ink[0], ink[1], ink[2], 0.92];
      const k = sat(prog(t, 0.15, 1.2));
      const g = Math.floor(f.t * 12);   // 帧组用整片时间：切段不会重置抖动节奏

      lines.begin();
      const m = W * 0.055, mt = H * 0.10, mb = H * 0.90;
      boilSeg(lines, m, mt, m + (W - m * 2) * k, mt, 3, inkC, { t: f.t, seed: 1, amp: o.amp });
      boilSeg(lines, m, mb, m + (W - m * 2) * k, mb, 3, inkC, { t: f.t, seed: 2, amp: o.amp });
      boilSeg(lines, m, mt, m, mt + (mb - mt) * k, 3, inkC, { t: f.t, seed: 3, amp: o.amp });
      boilSeg(lines, W - m, mt, W - m, mt + (mb - mt) * k, 3, inkC, { t: f.t, seed: 4, amp: o.amp });
      boilCircle(lines, W * 0.74, H * 0.42, W * 0.15 * sat(prog(t, 0.3, 1.3)), 3.4, inkC, { t: f.t, seed: 9, amp: o.amp * 1.4 });
      boilCircle(lines, W * 0.74, H * 0.42, W * 0.105 * sat(prog(t, 0.5, 1.5)), 2.6, [red[0], red[1], red[2], 0.75], { t: f.t, seed: 21, amp: o.amp * 1.2 });
      const uy = H * 0.322;
      boilSeg(lines, W * 0.06, uy, W * 0.06 + W * 0.40 * sat(prog(t, 0.6, 1.6)), uy, 6, [red[0], red[1], red[2], 0.85], { t: f.t, seed: 33, amp: o.amp * 1.6 });
      for (let i = 0; i < 5; i++) {
        const sx = W * (0.60 + 0.085 * i) + (hashish(g, i) - 0.5) * 6;
        const sy = H * (0.66 - 0.05 * Math.sin(i * 1.7 + t * 0.6));
        const r = 7 + 3 * hashish(g, i + 50);
        boilSeg(lines, sx - r, sy, sx + r, sy, 2.4, inkC, { t: f.t, seed: 60 + i, amp: o.amp });
        boilSeg(lines, sx, sy - r, sx, sy + r, 2.4, inkC, { t: f.t, seed: 70 + i, amp: o.amp });
      }
      lines.flush(ctx.out);

      text.clear();
      const hero = resolveTypeSize('hero', ctx.style?.tokens ?? null) ?? 132;
      type.write(o.kicker, m + 6, mt - 26, { size: 22, weight: 700, family: 'mono', color: css(Q.ash), t: t - 0.1 });
      type.write(o.title, m + 18, H * 0.46, { size: Math.round(hero * 0.86), weight: 800, family: 'serif', color: css(ink), t: t - 0.25, stagger: 0.05, from: 'up', dist: 26 });
      type.write(o.sub, m + 20, H * 0.55, { size: 30, weight: 500, family: 'serif', color: css(Q.ash), t: t - 0.55 });
      type.write(o.footer, m + 6, mb + 34, { size: 19, weight: 500, family: 'mono', color: css(Q.graphite), t: t - 0.8 });
      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });
      return { bloom: 0.10, grain: 0.05, vignette: 0.22, saturation: 1.02 };
    },
  };
}

/** 内部确定性小数（只为星星位置，不引 util） */
function hashish(a, b) {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

celShot.defaults = DEFAULTS;
celShot.meta = {
  name: 'cel',
  summary: '逐帧手绘 · 线条沸腾：纸面 + 每 2 帧重描一次的线（圆不圆、线不直）',
  notes: '抖动量来自 hash(帧组, 线号)：确定性、可 seek、可并行子帧；成片在 12fps 的节奏上抖，不是每帧随机跳。',
  energy: '中低',
  use: '手作感 / 角色 / 讲这是画出来的',
  avoid: '需要精确读数的图表（抖动的坐标轴会读不准）',
  params: [
    { name: 'id', type: 'string', desc: '段名' },
    { name: 'kicker', type: 'string', desc: '左上眉标' },
    { name: 'title', type: 'string', desc: '手写体标题' },
    { name: 'sub', type: 'string', desc: '副标' },
    { name: 'footer', type: 'string', desc: '底部一行' },
    { name: 'amp', type: 'number', desc: '抖动幅度（像素，默认 1.8）' },
  ],
};

celShot.spec = {
  params: { id: 'string', kicker: 'string', title: 'string', sub: 'string', footer: 'string', amp: 'number' },
  requires: [],
  outputs: { visual: 'full-frame', handlesTransition: false },
};

/* 选型元数据（BACKLOG 1-62）：tags / w / fits 的契约在 ./pick.js 头注释；brief 缺省字段 = 不设限。
   改这里不改模板画面，只改 anim shots --pick 会抽到谁。 */
celShot.tags = ['handmade', 'emotional'];
celShot.w = 0.6;
celShot.fits = contentOk;
celShot.fitsNote = '手绘感，无硬条件；收尾位/转场位抽不到';
