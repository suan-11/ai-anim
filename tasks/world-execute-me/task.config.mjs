// @ts-check
/** world.execute(me); — Mili · 代码美学·程序之爱 MV
 * 暗底终端 + 几何变形 + 故障美学。歌词关键词作为画面元素，不烧字幕。
 * 130BPM / 212s / 9段。音频踩拍驱动，rhythm.json 40块 R1-R8 合规。 */
import { seq, cut } from '../../src/timeline.js';
import { worldPass } from '../../src/kit/index.js';
import hook from './scenes/hook.js';
import verse1 from './scenes/verse1.js';
import chorus1 from './scenes/chorus1.js';
import verse2 from './scenes/verse2.js';
import chorus2 from './scenes/chorus2.js';
import bridge from './scenes/bridge.js';
import breakdown from './scenes/breakdown.js';
import chorus3 from './scenes/chorus3.js';
import close from './scenes/close.js';

// 全片共享背景：暗底 #0a0e14 + 扫描线 + CRT 微弧
export const world = (ctx) => worldPass(ctx, { motif: 'scanline', vignette: 0.4 });

const F = { x: 100, y: 80, w: 1720, h: 920 };

export default {
  title: 'world.execute(me);',
  // 全片时长 = 音频实长。实测本版 mp3 音乐内容到 207.3s 淡尽（后面是静音填充），
  // 画面在 207.3 黑屏收尾，总长取 207.5s 留 0.2s 黑场呼吸。
  duration: 207.5,
  width: 1920, height: 1080, fps: 24, scale: 1,
  palette: { ink: '#0a0e14', bone: '#c8d6e5', signal: '#ff3344', ash: '#5a6a7a', graphite: '#2a3a4a', cyan: '#00ffaa' },
  style: { name: 'print', grid: { pad: 100 } },
  captions: false,
  audio: './audio/track.mp3',
  lyrics: './lyrics.json',
  attentionProfile: 'bit',
  // ⚠ 段边界 = 真实歌词句边界（LRC 用户提供 + ASR 词级校准，lyrics.json schema/2）。
  // 旧 uniform-grid 是错的：hook 实际 14.8s 结束，14.8-29.4 是器奏；verse1 从 29.74 起。
  // 场景内部全部用绝对唱点驱动；at 显式钉死每段起点。
  timeline: seq([
    cut(hook,      { id: 'hook',      at: 0,      dur: 15.4,  handlesTransition: true, world: 'auto', focus: F, state: { diff: ['shape','light'] }, relayTo: 'particle-world' }),
    cut(verse1,    { id: 'verse1',    at: 14.8,   dur: 44.6,  handlesTransition: true, world: 'auto', focus: F, state: { diff: ['shape','position'] }, relayTo: 'sine-wave' }),
    cut(chorus1,   { id: 'chorus1',   at: 58.8,   dur: 15.24, handlesTransition: true, world: 'auto', focus: F, state: { diff: ['shape','light','material'] }, relayTo: 'trapped-grid' }),
    cut(verse2,    { id: 'verse2',    at: 73.44,  dur: 30.04, handlesTransition: true, world: 'auto', focus: F, state: { diff: ['shape','position'] }, relayTo: 'trance' }),
    cut(chorus2,   { id: 'chorus2',   at: 102.88, dur: 22.09, handlesTransition: true, world: 'auto', focus: F, state: { diff: ['shape','light'] }, relayTo: 'isolation' }),
    cut(bridge,    { id: 'bridge',    at: 124.37, dur: 21.23, handlesTransition: true, world: 'auto', focus: F, state: { diff: ['shape','light','material'] }, relayTo: 'error-stack' }),
    cut(breakdown, { id: 'breakdown', at: 145.0,  dur: 17.0,  handlesTransition: true, world: 'auto', focus: F, state: { diff: ['shape','light'] }, relayTo: 'white-flash' }),
    cut(chorus3,   { id: 'chorus3',   at: 161.4,  dur: 15.8,  handlesTransition: true, world: 'auto', focus: F, state: { diff: ['shape','position'] }, relayTo: 'stack-overflow' }),
    cut(close,     { id: 'close',     at: 176.6,  dur: 30.9,  handlesTransition: true, world: 'auto', focus: F, state: { diff: ['shape','light'] }, relayTo: '' }),
  ]),
};