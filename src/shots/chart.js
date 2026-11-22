// @ts-check
/**
 * 镜头模板：`chart` —— 柱状图逐条生长。
 * 原型参考 `tasks/demo/scenes/chart.js`，支持深/浅底色风格自适应。
 *
 * ```js
 * export default shot('chart', { values: [0.3, 0.7, 0.95], title: '这一轮的成绩' });
 * ```
 */


import { contentOk, within } from './pick.js';
import { Pass } from '../core/gl.js';
import { css, ease, prog, clamp } from '../core/util.js';

/** 全部参数 = "什么都不传时的画面"（demo 用的就是这一套）。 */
const DEFAULTS = {
  id: 'chart',
  // 固定数据（确定性！不要在这里用 Math.random）
  values: [0.18, 0.34, 0.27, 0.52, 0.44, 0.71, 0.63, 0.88, 0.79, 0.95, 0.86, 1.0],
  title: '每次迭代的最高准确率',
  sub: 'PER-RUN  ·  n = 12  ·  纯代码绘制，无图片素材',
  footer: '确定性渲染 → 任意时刻可重放，任意精度可重渲',
  peak: 0.95,
};

const luma3 = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * @param {{ id?: string, values?: number[], title?: string, sub?: string,
 *           footer?: string, peak?: number }} [opts]
 *   每个参数都可选；不传就用 `DEFAULTS`（= demo 的画面）。
 * @returns {any} 场景对象（`{ id, setup, render }`，可以直接放进时间线）
 */
export function chartShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    id: o.id,

    setup(ctx) {
      const P = ctx.P;
      const lightBg = luma3(P.ink) > luma3(P.bone);
      const paperCol = lightBg ? P.ink : P.bone;
      // 纸面：暗底风格用骨白纸 + 墨字；浅底风格直接用 P.ink 当纸 + P.bone 当墨，避免图表整屏变黑且与顶部字幕反色
      this.paper = new Pass(ctx.gl, /* glsl */ `
        uniform vec3 paper, rule;
        void main() {
          vec2 p = FRAG_PX / RES_LOGICAL;
          vec3 col = paper * (0.94 + 0.06 * vnoise(FRAG_PX * 0.02));
          float l = abs(fract(p.y * 28.0) - 0.5) * 2.0;
          float w = fwidth(p.y * 28.0) * 1.5;
          col = mix(col, rule, (1.0 - smoothstep(w, w * 3.0, l)) * 0.25);
          col *= 1.0 - 0.35 * smoothstep(0.55, 1.2, length((p - 0.5) * vec2(1.1, 1.0)));
          fragColor = vec4(col, 1.0);
        }`, { paper: paperCol, rule: P.ash }, { key: 'demo_chart_paper', blend: false });
    },

    render(ctx) {
      const { f, gl, P, text, type, comp, lines } = ctx;
      const { W, H } = gl;
      const t = f.lt;
      const lightBg = luma3(P.ink) > luma3(P.bone);
      const paperCol = lightBg ? P.ink : P.bone;
      const inkCol = lightBg ? P.bone : P.ink;

      this.paper.render(gl, ctx.out, f.t, f.dt);

      const L = W * 0.12, R = W * 0.92, B = H * 0.80, T = H * 0.24;
      const n = o.values.length;
      const slot = (R - L) / n;
      const bw = slot * 0.55;

      lines.begin();

      // 坐标轴
      lines.seg(L, T, L, B, 2, inkCol);
      lines.seg(L, B, R, B, 2, inkCol);

      // 水平刻度线
      for (let i = 0; i <= 4; i++) {
        const k = i / 4;
        const y = B - (B - T) * k;
        lines.seg(L - 14, y, R, y, 1, inkCol);
      }

      // 柱子：逐条生长
      for (let i = 0; i < n; i++) {
        const x = L + slot * (i + 0.5) - bw / 2;
        const start = 0.35 + i * 0.13;
        const k = ease.outCubic(prog(t, start, start + 0.9));
        const hh = (B - T) * o.values[i] * k;
        const y = B - hh;
        const isMax = o.values[i] >= o.peak;
        const col = isMax ? P.signal : inkCol;
        lines.rect(x, y, bw, hh, isMax ? 3 : 2, col);
        // 内部排线：越高的柱排线越密（版画感）
        const nl = Math.max(1, Math.round(o.values[i] * 7));
        for (let j = 1; j <= nl; j++) {
          const yy = y + (hh * j) / (nl + 1);
          lines.seg(x + 3, yy, x + bw - 3, yy, 1, [col[0] * 0.5, col[1] * 0.5, col[2] * 0.5]);
        }
        // 顶端小帽：到位的瞬间弹一下
        const pop = 1 + 0.5 * Math.exp(-Math.max(0, t - (start + 0.9)) * 6);
        if (k > 0.98) lines.seg(x - 6 * pop, y, x + bw + 6 * pop, y, 3, isMax ? P.signal : paperCol);
        lines.seg(L + slot * (i + 0.5), B, L + slot * (i + 0.5), B + 8, 1, inkCol);
      }

      // 扫描线：随时间从左扫到右
      const scan = prog(t, 1.6, 4.4);
      const sx = L + (R - L) * scan;
      lines.seg(sx, T - 10, sx, B + 14, 2, P.signal);

      lines.flush(ctx.out);

      // 文字层
      text.clear();
      type.write(o.title, L, T - 46, {
        size: 44, weight: 700, family: 'sans', color: css(inkCol),
        stagger: 0.03, from: 'none', t: t - 0.1,
      });
      type.write(o.sub, L, T - 14, {
        size: 20, family: 'mono', tracking: 4, color: css(inkCol, 0.55),
      });

      // 读数：跟随扫描线位置
      const idx = clamp(Math.floor(scan * n), 0, n - 1);
      type.write(`${(o.values[idx] * 100).toFixed(1)}%`, R, T - 46, {
        size: 58, weight: 800, family: 'mono', color: css(P.signal), align: 'right',
      });

      // y 轴百分比
      for (let i = 0; i <= 4; i++) {
        const k = i / 4;
        const y = B - (B - T) * k;
        type.write(`${Math.round(k * 100)}`, L - 26, y + 6, {
          size: 19, family: 'mono', color: css(inkCol, 0.5), align: 'right',
        });
      }

      // 底部结论：最后才淡入
      type.write(o.footer, W / 2, H * 0.92, {
        size: 30, weight: 500, family: 'sans', color: css(inkCol, 0.8), align: 'center',
        alpha: [0, 1], t: t - 3.2,
      });

      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });

      // 纸面场景：泛光要压住，否则白纸会糊
      return {
        bloom: 0.22,
        bloomThreshold: 1.0,
        halation: 0.12,
        grain: 0.045,
        vignette: 0.28,
        saturation: 0.96,
        contrast: 1.04,
      };
    },
  };
}

chartShot.defaults = DEFAULTS;
chartShot.meta = {
  name: 'chart',
  summary: '柱状图逐条生长：坐标轴 + 刻度 + 排线柱体 + 扫描线与跟随读数',
  notes: '背景是本模板自带的整帧纸面 Pass（key `demo_chart_paper`），所以它自己铺满整帧，'
    + '既不需要时间线的 world，也不能和别的模板叠在同一段。'
    + 'values 改长度后 `sub` 里的 "n = 12" 不会跟着变（它是纯文本参数）；'
    + '`peak` 是判"最高那根"的阈值（上信号色 + 顶端小帽用信号色）。',
  use: '一屏一组可比的量（3–8 根柱），让观众看出谁高谁低',
  energy: '中',
  avoid: '超过 8 个值、或需要精确读小数时改 counter；没有出处的数字不要画',
  params: [
    { name: 'id', type: 'string', desc: '段名（出现在 HUD、--only、报错里）' },
    { name: 'values', type: 'number[]', desc: '每根柱子的值（0..1；默认 12 个，与 demo 一致）' },
    { name: 'title', type: 'string', desc: '图上方的主标题（逐字入场）' },
    { name: 'sub', type: 'string', desc: '标题下的等宽副标题（默认文案里的双空格是刻意的）' },
    { name: 'footer', type: 'string', desc: '底部结论（最后才淡入）' },
    { name: 'peak', type: 'number', desc: '判"最高"的阈值：>= peak 的柱子用信号色' },
  ],
};

/**
 * 声明式 spec（`docs/ENGINE.md` §14.9；`anim shots --json` 与 `check` 的依赖前置校验读它）。
 *
 * `requires: []` 的依据：`render()` 只读 `f.lt` / `P` / `o.values`（`chart.js:55-58`），
 * 数据全部来自参数（`values` 的默认值就是写死的那 12 个数）—— 不读 `ctx.music` / `ctx.under`。
 * `outputs.visual = 'full-frame'` 的依据是 `setup()` 里那张纸面 Pass（`chart.js:42-52`）。
 */
chartShot.spec = {
  params: {
    id: 'string', values: 'number[]', title: 'string', sub: 'string', footer: 'string', peak: 'number',
  },
  requires: [],
  outputs: { visual: 'full-frame', handlesTransition: false },
};

/* 选型元数据（BACKLOG 1-62）：tags / w / fits 的契约在 ./pick.js 头注释；brief 缺省字段 = 不设限。
   改这里不改模板画面，只改 anim shots --pick 会抽到谁。 */
chartShot.tags = ['data', 'editorial', 'graphic'];
chartShot.w = 1.4;
chartShot.fits = (q) => contentOk(q) && within(q?.points, 3, 8);
chartShot.fitsNote = '3–8 个值（points）；收尾位/转场位抽不到';
