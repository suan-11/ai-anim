// _particles-lab —— 零状态 GPU 粒子的夹具（BACKLOG 1-14）。
// 三段三种预设（sparks / orbit / drift），每段手写场景：整帧背景（必铺）+ 粒子 + 标注。
// 验证：check 0 红 / still 看图（粒子可见、不是雪花、不是全黑）/ 同 t 渲两次 md5 一致。

import { seq, cut } from '../../src/timeline.js';
import sparks from './scenes/sparks.js';
import orbit from './scenes/orbit.js';
import drift from './scenes/drift.js';

export default {
  title: 'particles lab（零状态 GPU 粒子）',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,

  timeline: seq([
    cut(sparks, { id: 'sparks', dur: 4, world: 'auto', note: 'sparks：下落火花（加法混合发光）' }),
    cut(orbit,  { id: 'orbit',  dur: 4, world: 'auto', note: 'orbit：双环轨道' }),
    cut(drift,  { id: 'drift',  dur: 4, world: 'auto', note: 'drift：利萨如漂移场' }),
  ]),
};
