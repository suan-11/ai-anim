import { seq, cut } from '../../src/timeline.js';
import a from './scenes/a.js';

export default {
  title: '_persona-probe（运动人格判据的红/绿证明夹具）',
  width: 1920, height: 1080, fps: 60, scale: 1,
  motion: { personality: 'premium', emotion: 'calm' },
  timeline: seq([cut(a, { dur: 4 })]),
};
