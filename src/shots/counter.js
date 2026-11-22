// @ts-check
/**
 * 镜头模板：`counter` —— 大数字计数镜头（从 from 滚到 to，配环形刻度盘与进度弧）。
 *
 * 与原有的 8 个模板不同：这一支是照 `src/shots/title.js` 的形状**新写**的（BACKLOG 0-5），
 * 没有"逐像素不变"的 hashes 基线可对。验收：`node tools/test-shots.mjs` + 出图看图。
 *
 * ```js
 * export default shot('counter', { from: 0, to: 128, unit: 'ms', label: '单帧耗时' });
 * ```
 */


import { contentOk } from './pick.js';
import { Pass } from '../core/gl.js';
import { css, ease, prog, clamp, TAU } from '../core/util.js';

/** 全部参数 = "什么都不传时的画面"。 */
const DEFAULTS = {
  id: 'counter',
  from: 0,
  to: 96,
  decimals: 0,
  unit: 'fps',
  label: '单帧渲染吞吐',
  sub: 'COUNTER / 从零滚到目标值',
  footer: '数字是模板的默认值 —— 换成真数据之前不要当结论',
};

/**
 * 千分位 + 固定小数位。
 * ⚠ 刻意不用 toLocaleString：它依赖 ICU 的版本，同一份参数在不同机器上可能给出不同分组
 *   —— 那就破了"每帧是 t 的纯函数、到哪都逐像素一样"这条底线。
 */
function fmt(v, decimals) {
  const d = Math.max(0, Math.min(6, Math.round(Number(decimals) || 0)));
  const s = Math.abs(Number(v) || 0).toFixed(d);
  const parts = s.split('.');
  const grouped = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '-' : '') + grouped + (parts[1] ? '.' + parts[1] : '');
}

/**
 * @param {{ id?: string, from?: number, to?: number, decimals?: number, unit?: string,
 *           label?: string, sub?: string, footer?: string }} [opts]
 *   每个参数都可选；不传就用 `DEFAULTS`。
 * @returns {any} 场景对象（`{ id, setup, render }`，可以直接放进时间线）
 */
export function counterShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    id: o.id,

    setup(ctx) {
      // 整帧背景：墨底 + 缓慢向外流的同心细环 + 十字准线（"仪器"感）
      this.bg = new Pass(ctx.gl, /* glsl */ `
        void main() {
          vec2 p = (FRAG_PX - 0.5 * RES_LOGICAL) / RES_LOGICAL.y * 2.0;
          float r = length(p);
          vec3 col = mix(C_INK2, C_INK, smoothstep(0.15, 1.15, r));
          float ring = abs(fract(r * 5.0 - t * 0.05) - 0.5) * 2.0;
          float w = fwidth(r * 5.0) * 1.5;
          float cross = max(1.0 - smoothstep(0.0, 1.5, abs(FRAG_PX.x - 0.5 * RES_LOGICAL.x)),
                            1.0 - smoothstep(0.0, 1.5, abs(FRAG_PX.y - 0.5 * RES_LOGICAL.y)));
          if (luma(C_INK) > 0.25) {
            col = mix(col, C_GRAPHITE, (1.0 - smoothstep(w, w * 3.0, ring)) * 0.28);
            col = mix(col, C_SIGNAL, cross * 0.12);
            col = mix(col, C_SIGNAL, 0.04 * exp(-r * r * 3.0));
          } else {
            col += C_GRAPHITE * (1.0 - smoothstep(w, w * 3.0, ring)) * 0.20;
            col += C_SIGNAL * cross * 0.02;
            col += C_SIGNAL * 0.05 * exp(-r * r * 3.0);
          }
          col += (hash12(FRAG_PX + fract(t) * 53.0) - 0.5) * 0.012;
          fragColor = vec4(col, 1.0);
        }`, {}, { key: 'shot_counter_bg', blend: false });
    },

    render(ctx) {
      const { f, gl, P, text, type, comp, lines } = ctx;
      const { W, H } = gl;
      const t = f.lt;

      this.bg.render(gl, ctx.out, f.t, f.dt);

      const cx = W * 0.5;
      const cy = H * 0.5;
      const R = Math.min(W, H) * 0.30;

      // 进度：t=0.35 起步、2.3 到位。outExpo ⇒ 起步快、最后慢慢贴住目标值。
      const k = ease.outExpo(prog(t, 0.35, 2.3));
      const value = Number(o.from) + (Number(o.to) - Number(o.from)) * k;

      // 1) 矢量：外圈刻度（每 6 度一根、每 30 度一根长的）+ 从正上方顺时针扫 86% 的进度弧
      lines.begin();
      for (let i = 0; i < 60; i++) {
        const a = -Math.PI / 2 + (TAU * i) / 60;
        const major = i % 5 === 0;
        const r0 = R + 18;
        const r1 = R + (major ? 34 : 25);
        const lit = i / 60 <= k * 0.86;
        lines.seg(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0,
          cx + Math.cos(a) * r1, cy + Math.sin(a) * r1,
          major ? 2.4 : 1.4, lit ? P.signal : P.graphite);
      }
      const span = TAU * 0.86;
      const seg = 120;
      for (let i = 0; i < seg; i++) {
        const a0 = -Math.PI / 2 + span * (i / seg);
        const a1 = -Math.PI / 2 + span * ((i + 1) / seg);
        const on = (i + 1) / seg <= k;
        lines.seg(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R,
          cx + Math.cos(a1) * R, cy + Math.sin(a1) * R,
          on ? 5 : 1.5, on ? P.signal : P.graphite);
      }
      lines.flush(ctx.out);

      // 2) 文字层
      text.clear();

      // 眉标：页眉保留带内（不计入"一屏几块字"，docs/LAYOUT.md）
      const sub = String(o.sub == null ? '' : o.sub);
      if (sub) {
        const typed = Math.floor(ease.outCubic(prog(t, 0.15, 1.3)) * sub.length);
        type.write(sub.slice(0, typed), W * 0.10, H * 0.105, {
          size: 24, family: 'mono', tracking: 6, color: css(P.signal, 0.9),
        });
      }

      // 大数字：宽度按**目标值**预留（slot），数字自己左对齐 —— 于是 unit 的位置
      // 不会随帧抖动（等宽字体 + 固定小数位 + 千分位，位数一变就会跳）。
      // 数字按**目标值**的宽度自动收缩：'1,234.57' 这种长读数在默认字号下会顶到两侧
      // （2026-10-16 出图量到：205px 字号下 9 个字符 ≈ 1100px，再加单位就快占满一屏）。
      const target = fmt(Number(o.to), o.decimals);
      let numSize = Math.min(W, H) * 0.19;
      const probeW = type.measure(target, { size: numSize, weight: 800, family: 'mono' });
      if (probeW > W * 0.62) numSize *= (W * 0.62) / probeW;
      const numY = cy + numSize * 0.20;
      const slot = type.measure(target, { size: numSize, weight: 800, family: 'mono' });
      const x0 = cx - slot * 0.5;
      type.writeLine(fmt(value, o.decimals), x0, numY, {
        size: numSize, weight: 800, family: 'mono', color: css(P.bone),
      });
      const unit = String(o.unit == null ? '' : o.unit);
      if (unit) {
        type.writeLine(unit, x0 + slot + 18, numY - numSize * 0.06, {
          size: numSize * 0.34, weight: 600, family: 'mono', color: css(P.signal),
          alpha: [0, 1], t: t - 1.0,
        });
      }

      const label = String(o.label == null ? '' : o.label);
      if (label) {
        type.writeLine(label, cx, numY + numSize * 0.60, {
          size: Math.min(W, H) * 0.030, weight: 500, family: 'sans',
          color: css(P.ash), anchor: 'center', alpha: [0, 1], t: t - 1.35,
        });
      }

      const footer = String(o.footer == null ? '' : o.footer);
      if (footer) {
        type.writeLine(footer, cx, H * 0.93, {
          size: 22, family: 'mono', tracking: 2, color: css(P.ash, 0.75),
          anchor: 'center', alpha: [0, 1], t: t - 2.4,
        });
      }

      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });

      return {
        bloom: 0.36,
        bloomThreshold: 1.15,
        halation: 0.18,
        grain: 0.03,
        vignette: 0.42,
        exposure: 1 + 0.02 * Math.sin(t * 1.4),
      };
    },
  };
}

counterShot.defaults = DEFAULTS;
counterShot.meta = {
  name: 'counter',
  summary: '计数器镜头：环形刻度盘 + 从正上方扫过的进度弧 + 一个从 from 滚到 to 的大数字'
    + '（等宽、千分位、固定小数位），下面跟 label、右上跟 unit、底部跟 footer。',
  notes: '数字在段内 t=0.35 起步、2.3 秒到位（outExpo）；段长不足约 2.6 秒会看到"没滚完就切了"。'
    + 'unit 的位置按**目标值**的宽度预留（slot），所以数字位数变化时 unit 不会左右跳。'
    + '千分位是手写的正则，刻意不用 toLocaleString（它随 ICU 版本变，会破坏跨机器一致性）。'
    + '⚠ 这个模板画的是"算出来的数"：写任务时画面上的数字要有出处（docs/FACTS-TEMPLATE.md ★）。'
    + '背景是本模板自带的整帧 Pass（key shot_counter_bg），不需要时间线的 world。',
  // ⚠ params 的 name 集合必须与 DEFAULTS 的键集合**完全相等**（tools/test-shots.mjs 会断言）
  use: '一个数字从 A 滚到 B，让这个读数当画面主角',
  energy: '中',
  avoid: '多个数字并列；数字没有出处（先登记 FACTS.md）',
  params: [
    { name: 'id', type: 'string', desc: '段名（HUD / --only / 报错里用它）' },
    { name: 'from', type: 'number', desc: '起始值（滚动从这里开始）' },
    { name: 'to', type: 'number', desc: '目标值（滚动到这里停住）' },
    { name: 'decimals', type: 'number', desc: '小数位数（0..6）' },
    { name: 'unit', type: 'string', desc: '单位后缀，画在数字右上（空串则不画）' },
    { name: 'label', type: 'string', desc: '数字下方的一行说明（空串则不画）' },
    { name: 'sub', type: 'string', desc: '左上眉标（等宽小字、逐字打出；空串则不画）' },
    { name: 'footer', type: 'string', desc: '底部一行（脚注带里，最后淡入；空串则不画）' },
  ],
};

/**
 * 声明式 spec（docs/ENGINE.md §14.9；anim shots --json 与 check 的依赖前置校验读它）。
 *
 * requires: [] 的依据：render() 只读 f.lt / P / 参数与自带的背景 Pass ——
 * 数字是 t 的纯函数（outExpo 的缓动），不读 ctx.music、不读 ctx.under。
 * outputs.visual = 'full-frame' 的依据是 setup() 里那张整帧背景 Pass。
 */
counterShot.spec = {
  params: {
    id: 'string', from: 'number', to: 'number', decimals: 'number', unit: 'string',
    label: 'string', sub: 'string', footer: 'string',
  },
  requires: [],
  outputs: { visual: 'full-frame', handlesTransition: false },
};

/* 选型元数据（BACKLOG 1-62）：tags / w / fits 的契约在 ./pick.js 头注释；brief 缺省字段 = 不设限。
   改这里不改模板画面，只改 anim shots --pick 会抽到谁。 */
counterShot.tags = ['data', 'pop'];
counterShot.w = 1.2;
counterShot.fits = contentOk;
counterShot.fitsNote = '单个读数；收尾位/转场位抽不到';
