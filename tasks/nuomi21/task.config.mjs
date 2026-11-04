// 小糯米 · 门铃摄像头短剧（AI 角色图 + 代码运镜 + 配音）
import { cut, seq } from '../../src/timeline.js';
import doorSkit from './scenes/door_skit.js';

export default {
  title: 'Trick or Treat',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,
  style: 'mg-hud',
  palette: { signal: '#f59e0b' },
  audio: './audio/voice.mp3',
  timeline: seq([
    cut(doorSkit, { id: 'door', dur: 12.0, note: '门铃摄像头 · 12 秒' }),
  ]),
};
