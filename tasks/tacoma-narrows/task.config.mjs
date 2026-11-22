// @ts-check
/**
 * tacoma-narrows —— 塔科马海峡大桥 1940 颤振垮塌科普（5 段手写，见 brief.mjs / SCENE-BRIEF.md）。
 * 时间轴用 brief 固定 at/dur（硬切，切点依桥面状态衔接，不按 BPM）；节奏走 rhythm.json 事件轨。
 */
import { seq, cut } from '../../src/timeline.js';
import { worldPass } from '../../src/kit/index.js';
import hook from './scenes/hook.js';
import context from './scenes/context.js';
import mechanism from './scenes/mechanism.js';
import collapse from './scenes/collapse.js';
import close from './scenes/close.js';

export const world = (ctx) => worldPass(ctx, { motif: 'auto', vignette: 0.3 });

const F = { x: 160, y: 300, w: 1600, h: 560 };

export default {
  title: '一座钢桥，为什么会像布一样扭起来？',
  width: 1920, height: 1080, fps: 24, scale: 1,
  style: { name: 'blueprint', grid: { pad: 120 } },
  captions: true,
  timeline: seq([
    cut(hook,      { id: 'hook',      at: 0,  dur: 3,  handlesTransition: true, world: 'auto', focus: F, state: { diff: ['shape', 'position'] }, relayTo: 'deck-axis' }),
    cut(context,   { id: 'context',   at: 3,  dur: 6,  handlesTransition: true, world: 'auto', focus: F, state: { diff: ['shape', 'position'] }, relayTo: 'deck-axis' }),
    cut(mechanism, { id: 'mechanism', at: 9,  dur: 9,  handlesTransition: true, world: 'auto', focus: F, state: { diff: ['shape', 'light'] }, relayTo: 'deck-axis' }),
    cut(collapse,  { id: 'collapse',  at: 18, dur: 10, handlesTransition: true, world: 'auto', focus: F, state: { diff: ['shape', 'visibility'] }, relayTo: 'deck-axis' }),
    cut(close,     { id: 'close',     at: 28, dur: 7,  handlesTransition: true, world: 'auto', focus: F, state: { diff: ['shape', 'position'] }, relayTo: '' }),
  ]),
};
