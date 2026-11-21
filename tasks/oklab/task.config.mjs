// @ts-check
/**
 * oklab —— 标杆讲解片（风格帧阶段：hook / oklab_mech / close 为成片质量，其余 3 段 placeholder 占位）。
 */
import { seq, cut } from '../../src/timeline.js';
import { worldPass } from '../../src/kit/index.js';
import timing from './audio/timing.mjs';
import hook from './scenes/hook.js';
import oklab_mech from './scenes/oklab_mech.js';
import close from './scenes/close.js';

export const world = (ctx) => worldPass(ctx, { motif: 'auto', vignette: 0.45 });

const FOCUS_HOOK = { x: 150, y: 460, w: 1626, h: 408 };
const FOCUS_MECH = { x: 924, y: 212, w: 836, h: 640 };
const FOCUS_CLOSE = { x: 380, y: 214, w: 1390, h: 642 };
const S = (id) => {
  const s = timing.scenes.find((x) => x.id === id);
  if (!s) throw new Error(`timing.mjs 里没有 ${id} —— 先跑 anim say oklab`);
  return s;
};

const s0 = S('hook');
const s1 = S('gamma_trap');
const s2 = S('linear_limit');
const s3 = S('oklab_mech');
const s4 = S('css_bridge');
const s5 = S('close');

export default {
  title: '颜色存成什么数，和眼睛怎么看，是两件事',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,
  style: {
    name: 'flat',
    grid: { pad: 160 },
    post: { bloom: 0.06, halation: 0, grain: 0.010, vignette: 0.54, ca: 0 },
  },
  captions: true,
  narration: './audio/narration.json',
  audio: {
    vo: './audio/oklab-vo.mp3',
  },

  timeline: seq([
    cut(hook, {
      id: 'hook',
      at: s0.start,
      dur: s0.slot,
      handlesTransition: true,
      world: 'auto',
      focus: FOCUS_HOOK,
      state: { from: ['empty-studio'], to: ['srgb-vs-linear-strips', 'intensity-valley'], diff: ['visibility', 'shape', 'light'] },
      relayTo: 'spectrum-rail',
      params: { stretch: s0.stretch, slot: s0.slot, internal: s0.internal },
    }),
    {
      type: 'placeholder',
      id: 'gamma_trap',
      at: s1.start,
      dur: s1.slot,
      overlap: timing.overlap,
      world: 'auto',
      focus: 'center',
      subject: 'sRGB 2.2 传输曲线',
      onscreen: '02 · sRGB 编码 · γ ≈ 2.2 · 0.5 → 0.214',
      motion: '0.5 输入沿弯曲曲线投影到 0.214 物理输出',
      ref: 'custom (待风格帧确认后补)',
      state: { from: ['spectrum-rail'], to: ['gamma-curve'], diff: ['shape'] },
      relayTo: 'spectrum-rail',
    },
    {
      type: 'placeholder',
      id: 'linear_limit',
      at: s2.start,
      dur: s2.slot,
      overlap: timing.overlap,
      world: 'auto',
      focus: 'center',
      subject: '线性光感知限度',
      onscreen: '03 · (188,188,0) · 50%',
      motion: '均匀物理色带上浮现感知亮度跳变阶梯',
      ref: 'compare 模板',
      state: { from: ['gamma-curve'], to: ['perceptual-deviation'], diff: ['position', 'shape'] },
      relayTo: 'spectrum-rail',
    },
    cut(oklab_mech, {
      id: 'oklab_mech',
      at: s3.start,
      dur: s3.slot,
      overlap: timing.overlap,
      handlesTransition: true,
      world: 'auto',
      focus: FOCUS_MECH,
      state: { from: ['spectrum-rail'], to: ['oklab-pipeline', 'gamut-slice-L0747'], diff: ['space', 'shape', 'topology'] },
      relayTo: 'spectrum-rail',
      params: { stretch: s3.stretch, slot: s3.slot, internal: s3.internal },
    }),
    {
      type: 'placeholder',
      id: 'css_bridge',
      at: s4.start,
      dur: s4.slot,
      overlap: timing.overlap,
      world: 'auto',
      focus: 'center',
      subject: 'CIELAB 偏紫 vs CSS Color 4',
      onscreen: '05 · CSS Color 4 · oklab() / oklch()',
      motion: '蓝白对比带分叉并推向 CSS Color 4 坐标',
      ref: 'scan 模板',
      state: { from: ['gamut-slice-L0747'], to: ['blue-white-bridge'], diff: ['position', 'text'] },
      relayTo: 'spectrum-rail',
    },
    cut(close, {
      id: 'close',
      at: s5.start,
      dur: s5.slot,
      overlap: timing.overlap,
      handlesTransition: true,
      world: 'auto',
      focus: FOCUS_CLOSE,
      state: { from: ['spectrum-rail', 'intensity-valley'], to: ['calibrated-oklab-strip', 'flat-lightness-line'], diff: ['shape', 'light', 'state'] },
      relayTo: '',
      params: { stretch: s5.stretch, slot: s5.slot, internal: s5.internal },
    }),
  ]),
};
