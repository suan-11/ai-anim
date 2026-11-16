import { cut, seq } from '../../src/timeline.js';
import descent from './scenes/descent.js';
export default {
  title: '深渊下潜', width: 1920, height: 1080, fps: 30, scale: 1,
  style: 'mg-aurora',
  timeline: seq([
    cut(descent, { id: 'descent', dur: 26, world: false }),
  ]),
};
