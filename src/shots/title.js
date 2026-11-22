// @ts-check
/**
 * 镜头模板：`title` —— 大标题入场。
 * 原型参考 `tasks/demo/scenes/title.js`，按视觉效果持续优化。
 *
 * ```js
 * export default shot('title', { title: '写代码，就是做动画' });
 * ```
 */


import { atMost } from './pick.js';
import { Pass } from '../core/gl.js';
import { css, ease, prog, pulse } from '../core/util.js';

/** 全部参数 = "什么都不传时的画面"（demo 用的就是这一套）。 */
const DEFAULTS = {
  id: 'title',
  eyebrow: 'ANIM / CODE-RENDERED MOTION',
  title: '写代码，就是做动画',
  sub: 'deterministic · seekable · motion-blurred by averaging sub-frames',
  readout: true,
  blur: 0,
};

/**
 * @param {{ id?: string, eyebrow?: string, title?: string, sub?: string, readout?: boolean, blur?: number }} [opts]
 *   每个参数都可选；不传就用 `DEFAULTS`（= demo 的画面）。
 * @returns {any} 场景对象（`{ id, setup, render }`，可以直接放进时间线）
 */
export function titleShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    id: o.id,

    setup(ctx) {
      const P = ctx.P;
      // 全屏 GLSL 背景：极缓的径向渐变 + 细网格 + 一点暖光
      this.bg = new Pass(ctx.gl, /* glsl */ `
        uniform vec3 ink, ink2, grid;
        void main() {
          vec2 p = FRAG_PX / RES_LOGICAL;          // 0..1，y 向下
          vec2 c = p - vec2(0.5, 0.52);
          float r = length(c * vec2(RES_LOGICAL.x / RES_LOGICAL.y, 1.0));
          vec3 col = mix(ink2, ink, smoothstep(0.15, 0.95, r));
          // 细网格：距离用逻辑像素表示，线宽用 fwidth 单位（这样 4K 下依然是一根细线）
          vec2 d = abs(fract(FRAG_PX / 60.0) - 0.5) * 60.0;
          vec2 w = vec2(fwidth(FRAG_PX.x), fwidth(FRAG_PX.y));
          float gridMask = 1.0 - smoothstep(w.x, w.x * 2.0, min(d.x, d.y));
          if (luma(ink) > 0.25) {
            col = mix(col, grid * 2.0, gridMask * 0.28 * smoothstep(1.1, 0.2, r));
            col = mix(col, C_SIGNAL, 0.04 * exp(-r * r * 6.0));
          } else {
            col += grid * gridMask * 1.4 * smoothstep(1.1, 0.2, r);
            // 中心一点暖光，让画面不平
            col += C_SIGNAL * 0.05 * exp(-r * r * 6.0);
          }
          fragColor = vec4(col, 1.0);
        }`, {
        ink: P.ink, ink2: P.ink2, grid: P.graphite.map((x) => x * 0.5),
      }, { key: 'demo_title_bg', blend: false });
    },

    render(ctx) {
      const { f, gl, P, text, type, comp, lines } = ctx;
      const { W, H } = gl;
      const t = f.lt;

      // 1) 背景 pass 整帧覆盖
      this.bg.render(gl, ctx.out, f.t, f.dt);

      // 2) 矢量：一条横线从左生长出来，底下挂一串刻度
      const y = H * 0.62;
      const x0 = W * 0.12, x1 = W * 0.88;
      const grow = ease.outExpo(prog(t, 0.35, 1.9));
      const breath = 1 + 0.004 * Math.sin(t * 2.4);

      lines.begin();
      lines.seg(x0, y, x0 + (x1 - x0) * grow, y, 3.5, P.signal);
      const N = 24;
      for (let i = 0; i <= N; i++) {
        const k = i / N;
        const x = x0 + (x1 - x0) * k;
        const lit = Math.min(1, Math.max(0, (grow - k) * 30));
        const hh = (i % 4 === 0 ? 22 : 11) * lit;
        lines.seg(x, y - hh, x, y + hh, i % 4 === 0 ? 2.4 : 1.4, [P.bone[0] * lit, P.bone[1] * lit, P.bone[2] * lit]);
      }
      lines.flush(ctx.out);

      // 3) 文字层
      text.clear();

      // 眉标（等宽小字，逐字打出来）
      const eyebrow = o.eyebrow;
      const typed = Math.floor(prog(t, 0.15, 1.4) * eyebrow.length);
      type.write(eyebrow.slice(0, typed), x0, H * 0.30, {
        size: 26, family: 'mono', tracking: 6, color: css(P.signal, 0.95),
      });

      // 主标题：逐字上浮入场
      type.write(o.title, x0, H * 0.46 * breath, {
        size: 128, weight: 800, family: 'sans', color: css(P.bone),
        stagger: 0.075, staggerDur: 0.7, from: 'up', dist: 70, t: t - 0.5,
        // 虚焦收敛（1-41）：与上浮共用同一条缓动 —— 0 时 type.write 完全不碰 filter，像素不变。
        ...(o.blur > 0 ? { blur: [o.blur, 0] } : {}),
      });

      // 副标题：等主标题基本进场后淡入
      type.write(o.sub, x0, y + 96, {
        size: 30, family: 'mono', color: css(P.ash), tracking: 1,
        alpha: [0, 1], t: t - 1.6,
      });

      // 右下角：一个随时间走的读数
      if (o.readout) {
        const pct = Math.round(prog(t, 0.4, 3.4) * 100);
        type.write(`${String(pct).padStart(3, ' ')}%`, W - 90, H - 90, {
          size: 34, family: 'mono', color: css(P.signal, 0.8), align: 'right',
        });
      }

      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });

      return {
        bloom: 0.42,
        halation: 0.22,
        grain: 0.032,
        vignette: 0.4,
        flash: pulse(t, 4, 0.05) * 0.06,
        exposure: 1 + 0.05 * Math.sin(t * 1.3),
      };
    },
  };
}

titleShot.defaults = DEFAULTS;
titleShot.meta = {
  name: 'title',
  summary: '大标题入场：眉标逐字打出 + 主标题逐字上浮 + 一条生长的横线与刻度',
  notes: '背景是本模板自带的整帧 Pass（key `demo_title_bg`），所以它自己铺满整帧，'
    + '既不需要时间线的 world，也不能和别的模板叠在同一段。readout: false 时不画右下角读数。'
    + 'blur: 18 左右是"从虚焦里浮出来"（外部配方的默认标题解）；0 = 不碰 Canvas2D 的 filter。',
  use: '全片第一镜或一章的开头：先让观众读到一句主标题',
  energy: '低',
  avoid: '正文段落、或同屏还要读别的信息时；一支片里连用两次像回了片头',
  params: [
    { name: 'id', type: 'string', desc: '段名（出现在 HUD、--only、报错里）' },
    { name: 'eyebrow', type: 'string', desc: '左上眉标（等宽小字，逐字打出；长度决定打字时长）' },
    { name: 'title', type: 'string', desc: '主标题（逐字上浮入场）' },
    { name: 'sub', type: 'string', desc: '副标题（等主标题基本进场后淡入）' },
    { name: 'readout', type: 'boolean', desc: '是否画右下角随时间走的百分比读数' },
    { name: 'blur', type: 'number', desc: '主标题入场的虚焦量（px）：字从 blur 收到 0，与上浮共用缓动；0 = 不糊' },
  ],
};

/**
 * 声明式 spec（`docs/ENGINE.md` §14.9；`anim shots --json` 与 `check` 的依赖前置校验读它）。
 *
 * `requires: []` 的依据：`render()` 只读 `f.lt` / `P` / `type` / `lines` 与自带的背景 Pass
 * （`title.js:59-126`，`t = f.lt`）—— 不读 `ctx.music`、不读 `ctx.under`，所以没有任何外部依赖：
 * 省掉它不会让画面变黑。`outputs.visual = 'full-frame'` 的依据是 `setup()` 里那张整帧背景
 * Pass（`title.js:39-56`）⇒ 它自己铺满整帧（§14.4）。
 */
titleShot.spec = {
  params: {
    id: 'string', eyebrow: 'string', title: 'string', sub: 'string', readout: 'boolean', blur: 'number',
  },
  requires: [],
  outputs: { visual: 'full-frame', handlesTransition: false },
};

/* 选型元数据（BACKLOG 1-62）：tags / w / fits 的契约在 ./pick.js 头注释；brief 缺省字段 = 不设限。
   改这里不改模板画面，只改 anim shots --pick 会抽到谁。 */
titleShot.tags = ['title', 'calm', 'editorial'];
titleShot.w = 1.2;
titleShot.fits = (q) => (q?.slot == null || q?.slot === 'opening') && atMost(q?.chars, 18);
titleShot.fitsNote = '片头/章首（slot: opening）；主标 ≤18 字';
