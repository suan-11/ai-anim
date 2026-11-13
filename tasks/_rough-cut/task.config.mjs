import { cut, seq } from '../../src/timeline.js';
import { roughShapeScene } from './scenes/shape.js';

export default {
  title: '黑白粗剪 · 一个形状写完整句子',
  width: 1920, height: 1080, fps: 60, captions: false,
  style: { name: 'noir', post: { grain: 0, vignette: .12, ca: 0, bloom: 0 } },
  palette: { ink: '#07090c', bone: '#ebe8df' },
  timeline: seq([
    cut(roughShapeScene(), {
      id: 'seed', dur: 1.6, world: false, focus: 'center',
      state: { from: ['single-shape'], to: ['single-shape'], diff: ['light', 'rest'] },
      relayTo: 'single-shape', handlesTransition: false,
    }),
    cut(roughShapeScene(), {
      id: 'split', dur: 3.0, world: false, focus: 'center',
      state: { from: ['single-shape'], to: ['modules'], diff: ['topology', 'distance'] },
      relayTo: 'modules', handlesTransition: false,
    }),
    cut(roughShapeScene(), {
      id: 'suspend', dur: 5.4, world: false, focus: 'center',
      state: { from: ['modules'], to: ['modules'], diff: ['topology', 'distance', 'rest'] },
      relayTo: 'modules', handlesTransition: false,
    }),
    cut(roughShapeScene(), {
      id: 'return', dur: 2.4, world: false, focus: 'center',
      state: { from: ['modules'], to: ['single-shape'], diff: ['topology', 'material'] },
      relayTo: 'single-shape', handlesTransition: false,
    }),
  ]),
};
