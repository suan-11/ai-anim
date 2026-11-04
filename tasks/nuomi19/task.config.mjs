// 小糯米 · 雷霆渡劫（自定义闪电场景）
import { cut, seq } from '../../src/timeline.js';
import lightning from './scenes/lightning.js';

export default {
  title: '小糯米渡劫',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,
  style: 'mg-hud',
  palette: { signal: '#00e5ff' },
  timeline: seq([
    cut(lightning, { id: 'thunder', dur: 6.0, note: '雷霆特效 · 6 秒' }),
  ]),
};
