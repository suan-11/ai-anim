import { cut, seq } from '../../src/timeline.js';
import { fishPrintScene } from './scenes/print.js';

export default {
  title: '鱼印 · 版与纸',
  width: 1920, height: 1080, fps: 60, captions: false,
  audio: './audio/press.mp3',
  style: { name: 'paper', post: { grain: 0, bloom: 0, ca: 0, vignette: 0 } },
  timeline: seq([
    cut(fishPrintScene(), { id: 'block', dur: 1.6, world: false, relayTo: 'fish', state: { from: ['block'], to: ['inked-block'], diff: ['material'] } }),
    cut(fishPrintScene(), { id: 'open', dur: 3, world: false, relayTo: 'fish', state: { from: ['inked-block'], to: ['tiles'], diff: ['distance'] } }),
    cut(fishPrintScene(), { id: 'register', dur: 4.05, world: false, relayTo: 'fish', state: { from: ['tiles'], to: ['poised-tiles'], diff: ['angle', 'rest'] } }),
    cut(fishPrintScene(), { id: 'impress', dur: 3.75, world: false, relayTo: 'fish', state: { from: ['poised-tiles'], to: ['impression'], diff: ['orientation', 'material'] } }),
  ]),
};
