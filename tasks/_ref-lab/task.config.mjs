// _ref-lab —— 段间引用（BACKLOG 1-15）的夹具：B 段画面角落贴 A 段 t-2s 的画面（画中画）。
// A 段用配置档模板（一个会动的 title）；B 段手写场景调 ctx.renderShot('refa', f.t - 2)。
// 验证：check 0 红 / still 看图（画中画可见且是 A 段早期画面）/ 同 t 两次 md5 一致。

import { seq, cut } from '../../src/timeline.js';
import pip from './scenes/pip.js';

export default {
  title: 'ref lab（段间引用）',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,

  timeline: seq([
    // 配置节点直接放 seq 里（不包 cut）—— 包了就不走 isConfigNode 展开（tasks/_ref-lab 踩的）
    { type: 'outro', id: 'refa', title: '被引用的段', sub: 'refa · 静止收尾段（画中画的引用源）', dur: 8, world: 'auto' },
    cut(pip, { id: 'pip', dur: 6, world: 'auto', note: '画中画：左下角贴 refa 在 t-2s 的画面' }),
  ]),
};
