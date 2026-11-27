// 音乐任务：用 rhythm.json 编排波形、脉冲和频谱两个释放点，拍号保留作读数。
// 音频是 scripts/make-demo-audio.mjs 生成的 120bpm 循环（无版权问题）。
// 首次渲染时 CLI 会自动分析音频，生成 audio/demo-loop.analysis.json（拍子/段落/包络）。
import { seq, cut } from '../../src/timeline.js';
import intro from './scenes/intro.js';
import pulse from './scenes/pulse.js';
import grid from './scenes/grid.js';
import rhythm from './rhythm.json' with { type: 'json' };

const [firstRelease, secondRelease] = rhythm.filter((block) => block.beat_role === 'release');
const pulseAt = firstRelease.t_start;
const gridAt = secondRelease.t_start;
const duration = 32;

export default {
  title: 'beat · 节奏双轨演示',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,
  duration,
  audio: './audio/demo-loop.mp3',
  style: { name: 'print', post: { grain: 0, dither: 'off', vignette: 0 } },
  palette: { ink: '#25272c', bg: '#25272c' },

  // 两次 release 同时是转场，不依赖 BPM 或音频起音的相位。
  timeline: seq([
    cut(intro, { dur: pulseAt, focus: { x: 0, y: 270, w: 1920, h: 540 },
      note: '信号核心撑开波形，进入蓄势和持压', params: { openingHook: '把声音变成形状' },
      state: { diff: ['light'] }, relayTo: 'signal' }),
    cut(pulse, { at: pulseAt, dur: gridAt - pulseAt, focus: 'center',
      note: '信号扩散、回落，再向中枢聚拢', state: { diff: ['shape', 'light'] }, relayTo: 'signal' }),
    cut(grid, { at: gridAt, dur: duration - gridAt, focus: { x: 0, y: 108, w: 1920, h: 735 },
      note: '频谱释放、减密收尾', state: { diff: ['shape', 'light'] } }),
  ]),
};
