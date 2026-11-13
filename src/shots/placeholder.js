// @ts-check
/**
 * 镜头模板：`placeholder` —— **分镜占位卡**（C2 分镜三件套）。
 *
 * 写场景之前先把意图对齐：每一段先用一张占位卡说清「主体是什么 / 屏上写什么 / 怎么动 / 拟用哪个模板」。
 * 它**不是成片画面** —— 网格底 + 大字主体 + 三行小字 + 角标（段 id 与时长），一眼能认出是草稿。
 * 协作顺序（docs/SCENE-BRIEF-TEMPLATE.md §11）：分镜表 → placeholder 时间线 → `anim board` 确认 → 逐段换真镜头。
 *
 * ```js
 * export default shot('placeholder', { subject: '镜组', onscreen: '穿过镜头', motion: '一台摄影机向前穿', ref: 'makeThreeShot' });
 * ```
 *
 * ⚠ `check` 遇到时间线里仍有 placeholder 会 warn（--strict 进 errs）—— 它是「还没做完」的信号，不是交付画面。
 */
import { Pass } from '../core/gl.js';
import { css, prog, ease } from '../core/util.js';

const DEFAULTS = {
  id: 'placeholder',
  subject: '主体',
  onscreen: '',
  motion: '',
  ref: '',
};

/** @param {{ id?:string, subject?:string, onscreen?:string, motion?:string, ref?:string }} [opts] */
export function placeholderShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    id: o.id,
    isPlaceholder: true,   // check 靠它认出「时间线里还有占位卡」（C2）
    setup(ctx) {
      // 网格底：一眼是草稿。线宽用 fwidth ⇒ 4K 下同样细。
      this.bg = new Pass(ctx.gl, /* glsl */ `
        void main() {
          vec2 p = FRAG_PX;
          vec3 col = C_INK;
          vec2 g = abs(fract(p / 64.0) - 0.5) * 2.0;
          float w = fwidth(p.x / 64.0) * 1.4;
          float line = 1.0 - smoothstep(w, w * 3.0, min(g.x, g.y));
          col += C_GRAPHITE * line * 0.22;
          col += (hash12(p + fract(t) * 31.0) - 0.5) * 0.01;
          fragColor = vec4(col, 1.0);
        }`, {}, { key: 'shot_placeholder_bg', blend: false });
    },
    render(ctx) {
      const { f, gl, P, text, type, comp } = ctx;
      const { W, H } = gl;
      this.bg.render(gl, ctx.out, f.t, f.dt);
      const k = ease.outCubic(prog(f.lt, 0.1, 0.7));
      text.clear();
      // 大字主体（居中）
      type.writeLine(String(o.subject), W * 0.5, H * 0.40, {
        anchor: 'center', size: 110, weight: 800, family: 'sans', color: css(P.bone), alpha: k,
      });
      // 三行小字：屏上文字 / 运动 / 拟用模板
      const rows = [
        ['屏上', o.onscreen],
        ['运动', o.motion],
        ['拟用', o.ref],
      ].filter(([, v]) => String(v || '').length);
      let y = H * 0.56;
      for (const [label, v] of rows) {
        type.writeLine(label + ' · ' + String(v), W * 0.5, y, {
          anchor: 'center', size: 30, family: 'mono', color: css(P.ash), alpha: k,
        });
        y += 46;
      }
      // 角标：段 id + 时长（右上）
      const dur = Math.max(0, (f.end ?? 0) - (f.start ?? 0));
      type.writeLine(o.id + ' · ' + dur.toFixed(1) + 's', W - 40, 48, {
        anchor: 'right', size: 24, family: 'mono', color: css(P.signal), alpha: k,
      });
      // 左上「占位」标记
      type.writeLine('PLACEHOLDER · 分镜占位', 40, 48, {
        anchor: 'left', size: 24, family: 'mono', color: css(P.ash), alpha: k,
      });
      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });
      return { grain: 0.02 };
    },
  };
}

placeholderShot.defaults = DEFAULTS;
placeholderShot.meta = {
  name: 'placeholder',
  summary: '分镜占位卡：网格底 + 大字主体 + 屏上/运动/拟用三行小字 + 角标（段 id 与时长）。写场景前先对齐意图，不是成片画面。',
  notes: '协作顺序：分镜表 → placeholder 时间线 → anim board 确认 → 逐段替换为真镜头（docs/SCENE-BRIEF-TEMPLATE.md §11）。'
    + 'check 遇到时间线仍含 placeholder 会 warn（--strict 进 errs）。energy=none、fits 恒 false ⇒ 选型永远抽不到它。',
  use: '写场景前的分镜占位（对齐主体/屏上文字/运动/拟用模板）',
  energy: 'none',
  avoid: '成片（这是占位卡，交付前必须全部换成真镜头）',
  params: [
    { name: 'id', type: 'string', desc: '段名（HUD / --only / 报错里用它）' },
    { name: 'subject', type: 'string', desc: '画面主体名词（大字居中）' },
    { name: 'onscreen', type: 'string', desc: '屏上文字（小字行；空则不画）' },
    { name: 'motion', type: 'string', desc: '运动一句话（小字行；空则不画）' },
    { name: 'ref', type: 'string', desc: '拟用模板或 kit（小字行；空则不画）' },
  ],
};
placeholderShot.spec = {
  params: { id: 'string', subject: 'string', onscreen: 'string', motion: 'string', ref: 'string' },
  requires: [],
  outputs: { visual: 'full-frame', handlesTransition: false },
};
placeholderShot.tags = ['structure'];
placeholderShot.w = 0.4;
placeholderShot.fits = () => false;   // 占位卡永远不被选型抽到
placeholderShot.fitsNote = '分镜占位，不参与选型';
