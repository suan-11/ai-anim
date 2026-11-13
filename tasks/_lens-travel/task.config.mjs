import { cut, seq } from '../../src/timeline.js';
import lensTravel from './scenes/travel.js';

export default {
  title: '穿过镜头 · 空间运动试镜',
  width: 1920, height: 1080, fps: 60, captions: false,
  style: { name: 'noir', post: { grain: 0, bloom: .08, vignette: .12, ca: 0 } },
  palette: { ink: '#152a31', ink2: '#203b44', bone: '#f2ead8', signal: '#ee8053' },
  timeline: seq([
    cut(lensTravel(), {
      id: 'travel', dur: 9, world: false, focus: 'center', handlesTransition: false,
      maxSamples: 4,
      state: { from: ['lens-assembly'], to: ['sensor-closeup'], diff: ['space', 'visibility', 'position'] },
      relayTo: 'optical-axis',
    }),
  ]),
};
