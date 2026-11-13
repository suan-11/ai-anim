import { cut, seq } from '../../src/timeline.js';
import { fishPrintScene } from './scenes/print.js';

export default {
  title: '鱼印 · 版与纸',
  width: 1920, height: 1080, fps: 60, captions: false,
  audio: './audio/press.mp3',
  style: { name: 'paper', post: { grain: 0, bloom: 0, ca: 0, vignette: 0 } },
  timeline: seq([
    cut(fishPrintScene(), { id: 'block', dur: 1.2, world: false, relayTo: 'fish', state: { from: ['block'], to: ['approaching-paper'], diff: ['position'] } }),
    cut(fishPrintScene(), { id: 'open', dur: 3.4, world: false, relayTo: 'fish', state: { from: ['approaching-paper'], to: ['tiles'], diff: ['topology', 'space'] } }),
    cut(fishPrintScene(), { id: 'register', dur: 3.85, world: false, relayTo: 'fish', state: { from: ['tiles'], to: ['poised-tiles'], diff: ['position'] } }),
    cut(fishPrintScene(), { id: 'press', dur: 1.93, world: false, relayTo: 'fish', state: { from: ['poised-tiles'], to: ['face-down-block'], diff: ['topology', 'position'] } }),
    cut(fishPrintScene(), { id: 'impression', dur: 2.02, world: false, relayTo: 'fish', state: { from: ['face-down-block'], to: ['printed-paper'], diff: ['material', 'visibility'] } }),
  ]),
};
