import { cut, seq } from '../../src/timeline.js';
import lensMove from '../_lens-moves/scenes/moves.js';

export default {
  title: '甩入光轴 · 3D 运镜试镜',
  width: 1920, height: 1080, fps: 60, captions: false,
  style: { name: 'noir', post: { grain: 0, bloom: .08, vignette: .12, ca: 0 } },
  palette: { ink: '#152a31', ink2: '#203b44', bone: '#f2ead8', signal: '#ee8053' },
  timeline: seq([cut(lensMove('sling'), {
    id: 'sling', dur: 9, world: false, focus: 'center', handlesTransition: false,
    maxSamples: 4,
    state: { from: ['outer-orbit'], to: ['optical-axis'], diff: ['position', 'space', 'visibility'] },
    relayTo: 'lens-axis',
  })]),
};
