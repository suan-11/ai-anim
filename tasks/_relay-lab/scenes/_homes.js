// @ts-check
/**
 * _relay-lab 共用的世界（上）：程序化"塔阵" + 两台相机的 home 位姿。
 *
 * 相机接力（BACKLOG 1-12）要的是**同一个世界的两台机位**：两个塔群放在同一片
 * 地面网格上，A 段低机位近景看塔 A、B 段高机位远景看塔 B —— 接力飞过去时
 * 观众应该能认出"还是那片塔阵，只是镜头换了地方站"。
 *
 * 确定性：塔的位置/宽高/相位全部来自 rng(seed)，模块加载期预计算一次
 * （AGENTS.md §4 铁律；不用 Math.random）。摆动/呼吸全是 f.t 的纯函数。
 *
 * home 位姿用 camera3 的入参形状写（pos/target 直观），夹具里经 poseFromCamera3()
 * 换成 Pose —— 刻意走一遍官方换算，顺便证明 poseFromCamera3 / poseToCamera3
 * 这对互逆函数在真实场景里能用。
 */
import { rng, lerp } from '../../../src/core/util.js';
import { poseFromCamera3, poseToCamera3 } from '../../../src/core/relay.js';

/**
 * 一个塔群：rows × cols 根柱子，位置/宽/高带 rng 抖动；phase 给每根柱一个
 * 错峰的摆动相位（幅度是几何参数，不是画面读数）。
 */
function buildCluster({ id, cz, rows, cols, spacing, seed, hMin, hMax, wMin, wMax }) {
  const rand = rng(seed);
  const list = [];
  let top = 0;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      const x = (i - (cols - 1) / 2) * spacing + (rand() - 0.5) * spacing * 0.24;
      const z = cz - r * spacing * 1.35 + (rand() - 0.5) * spacing * 0.2;
      const w = lerp(wMin, wMax, rand());
      const h = lerp(hMin, hMax, rand());
      list.push({ x, z, w, h, phase: rand() * Math.PI * 2 });
      if (h > list[top].h) top = list.length - 1;
    }
  }
  return { id, cz, cols: list, top };
}

/** 塔 A（近景塔）：矮一些、排得密，中心在 x=0。 */
export const TOWER_A = buildCluster({
  id: 'A', cz: -13, rows: 3, cols: 4, spacing: 1.9, seed: 11,
  hMin: 1.6, hMax: 4.2, wMin: 0.34, wMax: 0.7,
});

/** 塔 B（远景塔）：更高更大，摆在 A 的右后方。 */
export const TOWER_B = buildCluster({
  id: 'B', cz: -23.5, rows: 3, cols: 4, spacing: 2.2, seed: 47,
  hMin: 2.6, hMax: 6.4, wMin: 0.4, wMax: 0.9,
});

export const CLUSTERS = [TOWER_A, TOWER_B];

/** home 位姿 A：低机位近景看塔 A（camera3 入参形状）。 */
export const HOME_A_SRC = { pos: [-2.1, 1.05, -8.6], target: [0.1, 2.1, -13.2], fov: 47, roll: 0 };

/** home 位姿 B：高机位远景看塔 B（camera3 入参形状）。
 * 机位经过投影框选（塔 B 八角全在画内、留漂移余量），不是拍脑袋：
 * pos [-1.2, 8.8, -14.5] 那版塔 B 有一半出画（探针实测 top-near x = -93px）。 */
export const HOME_B_SRC = { pos: [-7.5, 8, -5], target: [0, 2.2, -26], fov: 40, roll: 0 };

/**
 * home 位姿的"呼吸"：fov 与 dist 随 t 微动（**t 的纯函数**）。
 *
 * 这几下微动是给探针看的：relay 每子帧现探现算两侧位姿，如果场景报的是
 * 静态位姿，"探针读到的是动态位姿"这件事就验不出来。幅度是几何参数
 * （度 / 世界单位），不是画面读数。
 */
export function driftPose(src, t) {
  // 在 Pose 空间做微动（fov/dist 几何直观），再用 poseToCamera3 换回
  // camera3 形状 {pos,target,fov,roll} —— relayPose(ctx) 的契约与 camera3 的入参
  // 都认这一形状（ENGINE §3.7.7）；直接返回 Pose 会让 camera3 读 pos[0] 崩、
  // 引擎探针的 poseFromCamera3 拒收（两种崩法 check 都抓到过）。
  const p = poseFromCamera3(src);
  return poseToCamera3({
    ...p,
    fov: p.fov + 1.2 * Math.sin(t * 0.23 + 1.7),
    dist: p.dist + 0.4 * Math.sin(t * 0.31 + 0.6),
  });
}
