// @ts-check
/**
 * _relay-lab 共用的世界（下）：**3D 对（makeThreeShot）的台架**。
 *
 * 3D 段的内容刻意简单（网格地板 + 几根柱）—— 这一对要验的是 relay 的
 * whip 运动曲线与 cameraPose 接入，不是 Three.js 本身（那是 _three-lab 的活）。
 * 两个段共用一个世界原点；背景 'over' + 时间线 world: 'auto'（引擎背景连续性）。
 *
 * 确定性：柱子的高度/位置全部来自 rng(seed)（AGENTS.md §4 铁律）。
 */
import { rng, lerp } from '../../../src/core/util.js';

/** 台架原点（两个 3D 段共用同一套世界坐标）。 */
export const ORIGIN = [0, 0, 0];

/** home 位姿（camera3 入参形状）：3D-A 低机位斜看，3D-B 高机位俯瞰。 */
export const HOME_3A = { pos: [3.4, 1.6, 5.2], target: [0, 1.0, 0], fov: 42, roll: 0 };
export const HOME_3B = { pos: [-5.0, 7.2, 6.8], target: [0, 0.6, -0.5], fov: 36, roll: 0 };

/**
 * home 位姿的"呼吸"（**t 的纯函数**，spec.cameraPose 每子帧调）：
 * A 段 fov 缓变、B 段 pos 缓移 —— 与 2D 对一样，给探针验"读到的是动态位姿"。
 */
export function drift3A(t) {
  return { ...HOME_3A, fov: HOME_3A.fov + 1.5 * Math.sin(t * 0.27 + 0.4) };
}
export function drift3B(t) {
  const s = Math.sin(t * 0.21 + 2.0);
  return { ...HOME_3B, pos: [HOME_3B.pos[0] + 0.5 * s, HOME_3B.pos[1], HOME_3B.pos[2] - 0.4 * s] };
}

/**
 * 台架几何：一圈柱子 + 地板参数。一个实例化网格（InstancedMesh），
 * 每根柱的高度/横向位置来自 rng(seed)。
 */
export function buildPillars({ count = 9, ring = 3.1, seed = 5 } = {}) {
  const rand = rng(seed);
  const list = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand() * 0.22;
    const r = ring * (0.82 + rand() * 0.36);
    list.push({
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      h: lerp(1.1, 3.2, rand()),
      w: lerp(0.16, 0.3, rand()),
    });
  }
  return list;
}

/** overlay 里"贴 3D 点"的标签目标：中央立柱的顶端（世界坐标）。 */
export const LABEL_ANCHOR = [0, 3.35, 0];
