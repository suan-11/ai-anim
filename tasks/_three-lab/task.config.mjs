import { seq, cut } from '../../src/timeline.js';
import { worldPass } from '../../src/kit/index.js';
import stack from './scenes/stack.js';
import wire from './scenes/wire.js';
import lattice from './scenes/lattice.js';

/**
 * Three.js 沙盒（`docs/history/HANDOFF-THREEJS.md` 的 ① + ②）。
 *
 * 三段故意做成"同一个物体换了三种画法"：
 *   ① A 段 Three.js 画分层实体（真深度、真遮挡、标签贴在 3D 点上）
 *   ② B 段**完全由 anim 自己画**同一个盒子（解析投影 + 线段批 + 扫描线填充）
 *   ③ C 段 Three.js 把同一个盒子碎成 80 个实例化单元
 *
 * 三段用**同一个世界原点、同一台摄影机 `camAt(t)`、同一个 fov**，
 * 而且全片只有**一层背景**（`world` 具名导出 + 每段 `world: 'auto'`）——
 * 所以切点两侧背景是同一批像素，接缝应该只剩"物体自己在变"。
 *
 *   node scripts/anim.mjs check _three-lab
 *   node scripts/anim.mjs still _three-lab -t 3,8.7,13
 *   node scripts/anim.mjs shot  _three-lab --from 4 --to 12 --samples 4   # 看接缝
 *   node scripts/anim.mjs video _three-lab
 */
export const world = (ctx) => worldPass(ctx, { grid: 60, accent: ctx.P.signal });

export default {
  title: 'Three.js 沙盒',
  width: 1920, height: 1080, fps: 60, scale: 1,
  timeline: seq([
    cut(stack, { dur: 6, world: 'auto', note: 'Three.js：分层实体 + 3D 贴标签' }),
    cut(wire, { dur: 4, overlap: 0.7, world: 'auto', note: '引擎自绘过渡：线框长出实体' }),
    cut(lattice, { dur: 6, overlap: 0.7, world: 'auto', note: 'Three.js：80 个实例化单元' }),
  ]),
};
