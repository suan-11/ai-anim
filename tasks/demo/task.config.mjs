// 演示任务：无音频，纯代码动画。展示「一段小动画」也要用的全套东西：
// 文字逐字入场、矢量线段、GLSL 背景、图表、转场、后处理。
import { seq, cut } from '../../src/timeline.js';
import title from './scenes/title.js';
import chart from './scenes/chart.js';
import kinetic from './scenes/kinetic.js';
import whip from './scenes/whip.js';
import outro from './scenes/outro.js';

export default {
  title: 'anim 演示 · 16 秒',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,
  // ★ 运动人格（可选；docs/MOTION.md §7）。不写就完全不判 —— 这一层只给**参考区间**，不是模板。
  //   demo 是判据的参照样本，所以这里显式声明一档，让 lint-motion-persona 有得判。
  motion: { personality: 'corporate', emotion: 'clear' },
  palette: {
    // 不改也能跑：这里示范怎么换一套配色（键名会变成 GLSL 里的 C_XXX）
    signal: '#ff4d12',
    acid: '#d8ff3c',
  },

  // ★ 反 PPT 声明（docs/ANTI-PPT.md）：每一段回答两个问题 ——
  //   ① 这一镜的世界**变了什么**（state.diff，只动透明度/缩放不算）；
  //   ② 哪一个对象**活到了下一镜**（relayTo）。
  //   demo 是判据的参照样本：node tools/lint-anti-ppt.mjs demo 应全绿。
  timeline: seq([
    cut(title, {
      dur: 4.0, note: '标题：逐字入场 + 生长的线',
      state: { from: ['empty-frame'], to: ['title'], diff: ['visibility', 'light'] },
      relayTo: 'baseline',            // 标题下那条基线 → 下一段变成图表的 x 轴
    }),
    cut(chart, {
      dur: 5.0, note: '图表：逐段生长 + 数字跳动',
      state: { from: ['baseline'], to: ['bars', 'numbers'], diff: ['shape', 'text'] },
      relayTo: 'pen',                 // 落笔的点 → 下一段变成游标
    }),
    cut(kinetic, {
      dur: 4.0, note: '动态文字 + GLSL 背景',
      state: { from: ['pen'], to: ['headline'], diff: ['text', 'material'] },
      relayTo: 'whip-line',           // 大字被甩出去的那条线 → 下一段就是甩镜
    }),
    // overlap: 0.45 让 whip 和上一段重叠，whip 自己处理这个重叠（handlesTransition）
    cut(whip, {
      dur: 1.1, overlap: 0.45, handlesTransition: true, note: '甩镜转场',
      state: { from: ['whip-line'], to: ['empty-frame'], diff: ['position', 'space'] },
      relayTo: 'signature',           // 甩过去之后留下的那一笔 → 片尾署名
    }),
    cut(outro, {
      dur: 3.0, note: '片尾',
      state: { from: ['signature'], to: ['signature'], diff: ['light'] },
    }),
  ]),
};
