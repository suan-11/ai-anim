// @ts-check
/**
 * oklab —— 标杆讲解片（全片 6 段均为独立手写场景）。
 */
import { seq, cut } from '../../src/timeline.js';
import { worldPass } from '../../src/kit/index.js';
import timing from './audio/timing.mjs';
import hook from './scenes/hook.js';
import gamma_trap from './scenes/gamma_trap.js';
import linear_limit from './scenes/linear_limit.js';
import oklab_mech from './scenes/oklab_mech.js';
import css_bridge from './scenes/css_bridge.js';
import close from './scenes/close.js';

export const world = (ctx) => worldPass(ctx, { motif: 'auto', vignette: 0.32 });

const FOCUS_HOOK = { x: 150, y: 460, w: 1626, h: 408 };
const FOCUS_GAMMA = { x: 160, y: 330, w: 1600, h: 530 };
const FOCUS_LINEAR = { x: 160, y: 430, w: 1600, h: 400 };
const FOCUS_MECH = { x: 960, y: 212, w: 800, h: 640 };
const FOCUS_CSS = { x: 940, y: 272, w: 820, h: 580 };
const FOCUS_CLOSE = { x: 320, y: 214, w: 1450, h: 642 };
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
    post: { bloom: 0.06, halation: 0, grain: 0.010, vignette: 0.30, ca: 0 },
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
    cut(gamma_trap, {
      id: 'gamma_trap',
      at: s1.start,
      dur: s1.slot,
      overlap: timing.overlap,
      handlesTransition: true,
      world: 'auto',
      focus: FOCUS_GAMMA,
      state: { from: ['spectrum-rail'], to: ['gamma-curve'], diff: ['shape', 'light'] },
      relayTo: 'spectrum-rail',
      params: { stretch: s1.stretch, slot: s1.slot, internal: s1.internal },
    }),
    cut(linear_limit, {
      id: 'linear_limit',
      at: s2.start,
      dur: s2.slot,
      overlap: timing.overlap,
      handlesTransition: true,
      world: 'auto',
      focus: FOCUS_LINEAR,
      state: { from: ['gamma-curve'], to: ['perceptual-deviation'], diff: ['position', 'shape'] },
      relayTo: 'spectrum-rail',
      params: { stretch: s2.stretch, slot: s2.slot, internal: s2.internal },
    }),
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
    cut(css_bridge, {
      id: 'css_bridge',
      at: s4.start,
      dur: s4.slot,
      overlap: timing.overlap,
      handlesTransition: true,
      world: 'auto',
      focus: FOCUS_CSS,
      state: { from: ['gamut-slice-L0747'], to: ['blue-white-bridge'], diff: ['position', 'space', 'text'] },
      relayTo: 'spectrum-rail',
      params: { stretch: s4.stretch, slot: s4.slot, internal: s4.internal },
    }),
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
