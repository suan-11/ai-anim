import { cut, seq } from '../../src/timeline.js';
import lensMove from './scenes/moves.js';

export default {
  title: '三种镜组运镜',
  width: 1920, height: 1080, fps: 60, captions: false,
  audio: './audio/moves.mp3',
  style: { name: 'noir', post: { grain: 0, bloom: .08, vignette: .12, ca: 0 } },
  palette: { ink: '#152a31', ink2: '#203b44', bone: '#f2ead8', signal: '#ee8053' },
  timeline: seq([
    cut(lensMove('orbit'), {
      id: 'orbit', dur: 6, world: false, focus: 'center', handlesTransition: false,
      maxSamples: 4, state: { from: ['lens-front'], to: ['lens-side'], diff: ['position', 'space'] },
      relayTo: 'lens-axis',
    }),
    cut(lensMove('offset'), {
      id: 'offset', dur: 15.1, world: false, focus: 'center', handlesTransition: false,
      maxSamples: 4, state: { from: ['lens-side'], to: ['sensor'], diff: ['position', 'visibility', 'material'] },
      relayTo: 'lens-axis', overlap: .35, transition: 'seam',
    }),
    cut(lensMove('reveal'), {
      id: 'reveal', dur: 6.5, world: false, focus: 'center', handlesTransition: false,
      maxSamples: 4, state: { from: ['sensor'], to: ['full-assembly'], diff: ['space', 'ownership', 'light'] },
      relayTo: 'lens-axis', overlap: .35, transition: 'corners',
    }),
  ]),
};
