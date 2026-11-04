// 小糯米 · 雷霆猫娘（自定义猫脸霓虹 + 闪电）
import { cut, seq } from '../../src/timeline.js';
import thunderCat from './scenes/thunder_cat.js';

export default {
  title: '雷霆猫娘',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,
  style: 'mg-hud',
  palette: { signal: '#00e5ff' },
  timeline: seq([
    cut(thunderCat, { id: 'storm', dur: 7.0, note: '雷霆猫娘 · 7 秒' }),
  ]),
};
