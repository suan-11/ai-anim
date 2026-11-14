import { seq } from '../../src/timeline.js';
import { dynamicTimeline } from './scenes/dynamic.js';

// Two restrained geometric transitions around the same deconstruction shot.
export default {
  title: '结构转场 · 中心扩散 / 角度扫描',
  width: 1920, height: 1080, fps: 60, captions: false,
  style: { name: 'noir', post: { grain: 0, vignette: .12, ca: 0, bloom: .12 } },
  palette: { ink:'#17212b', ink2:'#202e3a', bone:'#eeeae2', ash:'#a6abb0', signal:'#fa783d' },
  timeline: seq(dynamicTimeline()),
};
