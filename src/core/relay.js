// @ts-check
/**
 * **相机接力（relay）**：交叠窗里一台相机从 A 段位姿一路飞到 B 段位姿，内容中途换手。
 *
 * ## 机制（BACKLOG 1-12；只借参考的思路，代码全自己写）
 *
 * 出处 `docs/REFERENCE-world-execute.md` §4 ②：段与段交叠时不再"甩镜"，
 * 而是**一台相机**做插值飞行 —— 位姿在两段各自的"home 位姿"之间混合，
 * **画面内容在交叠窗的换手窗（HANDOVER）里 mixTo 换手**。
 * 参考实现里的 `blendPoses` 三件套照借：
 *
 *   · **look 直线插值** + 取景大小走**几何插值**（`exp(lerp(log a, log b))` ——
 *     推近/拉远的手感是匀速的，样式与 `src/core/cam.js` 的 `zoomLerp` 一致）；
 *   · **相机位置由 look + dist 反推**（`pos = look − fwd·dist`）—— 相机因此会
 *     **绕主体摆动**而不是切角；
 *   · yaw 走**最短路径**线性（恒定角速度）：170° → −170° 从 180° 那边过，不从 0° 兜圈。
 *
 * 只对两类镜头生效（它们的位姿能被**探**出来）：
 *   · 手写 `camera3` 场景 —— 场景对象声明 `relayPose(ctx)`（t 的纯函数，返回 Pose）；
 *   · `makeThreeShot` —— `spec.cameraPose(ctx)` 或回读当前相机状态。
 *
 * 接线在 `src/core/engine.js` 的 `composite()`（拦 `transition: 'relay'`）；
 * 场景侧的一行接入见 `src/kit/index.js` 的 `relayPose3()`。
 *
 * ## Pose 契约（两个子代理共用，字段名不许改）
 *
 * ```
 * Pose = { look: [x,y,z], dist: number>0, yaw: number, pitch: number, fov: number, roll: number }
 * ```
 *
 *   · `yaw` / `pitch` / `fov` 的单位是**度**，`roll` 是**弧度**（与 `camera3` 的
 *     `fov`/`roll` 惯例一致 —— `camera3({ fov: 34 })` 的 34 是度，`roll: 0.02` 是弧度）；
 *   · `yaw = 0` 朝 −z，`yaw` 增大朝 +x；`pitch` 向上为正；
 *   · `fwd = [sin(yaw)·cos(pitch), sin(pitch), −cos(yaw)·cos(pitch)]`，`pos = look − fwd·dist`。
 *
 * `Pose` 与 `camera3()` 的入参 `{ pos, target, fov, roll }` 恰好**同形不同义**：
 * `poseToCamera3()` 负责换算，别把 Pose 直接塞给 `camera3()`（字段名一样、含义不同 ——
 * `look` 是"看向哪"，`pos` 是"站在哪"）。
 *
 * ## v1 边界（刻意不做，写在这里防止"顺手"扩）
 *
 *   ① 文字层跟随所属段一起在换手窗内 crossfade —— 不做"文字整段交接"
 *      （那要把文字拆成两层独立 RT，另立项）；
 *   ② 三段以上重叠时最深的一层回落 push 并警告；
 *   ③ post 参数不逐字段插值 —— 交叠期用 B 段的 post；
 *   ④ ortho ↔ perspective 过渡不做（我们全是透视）。
 *
 * ## 确定性
 *
 * 本文件是**纯函数层**：零 GPU、零 ctx 依赖、没有 Math.random / Date.now、
 * 没有任何跨调用状态 —— 每个函数都是时间的纯函数（AGENTS.md §0 铁律）。
 */

import { sat } from './util.js';

/* ═══════════════ 位姿换算：camera3 形状 ⇄ Pose ═══════════════ */

/**
 * `camera3` 的入参形状 `{ pos, target, fov?, roll? }` → **Pose**。
 *
 *   · `dist = |target − pos|`；
 *   · `fwd = normalize(target − pos)`；
 *   · `pitch = asin(fwd.y)`（夹到 ±89.9° —— 顶到 ±90° 时 yaw 退化，基向量绕 fwd 转，
 *     参考实现同样不认正上方机位）；
 *   · `yaw = atan2(fwd.x, −fwd.z)`（转度；yaw = 0 朝 −z、增大朝 +x）。
 *
 * `fov` / `roll` 原样带走（缺省 fov 34 / roll 0，与 `camera3()` 的缺省一致）。
 * 与 `poseToCamera3()` 互逆：roundtrip 误差 ≤ 1e-9（pitch 顶格的机位除外 —— 那里
 * 本来就没有唯一的 yaw）。
 *
 * @param {{ pos: number[], target: number[], fov?: number, roll?: number }} c
 * @returns {import('./relay.js').Pose}
 */
export function poseFromCamera3(c) {
  if (!c || !Array.isArray(c.pos) || !Array.isArray(c.target)) {
    throw new TypeError('relay: poseFromCamera3 需要 { pos, target }，收到 ' + JSON.stringify(c));
  }
  const dx = c.target[0] - c.pos[0];
  const dy = c.target[1] - c.pos[1];
  const dz = c.target[2] - c.pos[2];
  const dist = Math.hypot(dx, dy, dz);
  if (!(dist > 0)) {
    throw new TypeError('relay: poseFromCamera3 的 pos 与 target 重合（dist = 0）—— 没有朝向可言');
  }
  const fx = dx / dist, fy = dy / dist, fz = dz / dist;
  const DEG = 180 / Math.PI;
  const PITCH_MAX = 89.9;
  const pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, Math.asin(Math.max(-1, Math.min(1, fy))) * DEG));
  const yaw = Math.atan2(fx, -fz) * DEG;
  return { look: [c.target[0], c.target[1], c.target[2]], dist, yaw, pitch, fov: c.fov ?? 34, roll: c.roll ?? 0 };
}

/**
 * **Pose** → `camera3` 的入参形状 `{ pos, target, fov, roll }`。
 *
 * `fwd = [sin(yaw)·cos(pitch), sin(pitch), −cos(yaw)·cos(pitch)]`，
 * `pos = look − fwd·dist`。与 `poseFromCamera3()` 互逆（roundtrip ≤ 1e-9）。
 *
 * @param {import('./relay.js').Pose} p
 * @returns {{ pos: number[], target: number[], fov: number, roll: number }}
 */
export function poseToCamera3(p) {
  if (!p || !Array.isArray(p.look) || !(p.dist > 0)) {
    throw new TypeError('relay: poseToCamera3 需要 { look, dist>0, … }，收到 ' + JSON.stringify(p));
  }
  const yawR = p.yaw * Math.PI / 180;
  const pitchR = p.pitch * Math.PI / 180;
  const cp = Math.cos(pitchR);
  const fx = Math.sin(yawR) * cp;
  const fy = Math.sin(pitchR);
  const fz = -Math.cos(yawR) * cp;
  return {
    pos: [p.look[0] - fx * p.dist, p.look[1] - fy * p.dist, p.look[2] - fz * p.dist],
    target: [p.look[0], p.look[1], p.look[2]],
    fov: p.fov,
    roll: p.roll,
  };
}

/* ═══════════════ 位姿混合 ═══════════════ */

/** ±180° 之间的最短角差（度）：170 → −170 走 −20（经 180），不是 +340。 */
function shortestYawDelta(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/**
 * 两个位姿混合成一个（`e`：0 = 全 a，1 = 全 b）。**这是 relay 的数学核心。**
 *
 *   · `e` 非有限（NaN / ±Inf / undefined…）⇒ **当场抛 TypeError**（报出收到的值）——
 *     非有限值传下去是"整帧画面没有意义，而且引擎不报错"（AGENTS.md §5.5 的老教训）；
 *   `e` 越界（<0 / >1）⇒ **sat 到 [0,1]**（与 `cam.js` 的 `mixCam` 同口径）；
 *   · `look`：三轴线性；
 *   · `dist` 与 `tan(fov/2)`：**几何插值** `exp(lerp(log a, log b))` —— 推近匀速，
 *     样式照抄 `src/core/cam.js` 的 `zoomLerp`（dist 1 → 4 的中点是 2，不是 2.5）；
 *   · `yaw`：**最短路径**线性 —— 170° → −170° 的中点是 180° 附近，不是 0°；
 *   · `pitch` / `roll`：线性（pitch 已被 poseFromCamera3 夹在 ±89.9°，两点之间
 *     不会绕远）。
 *
 * @param {import('./relay.js').Pose} a @param {import('./relay.js').Pose} b @param {number} e
 * @returns {import('./relay.js').Pose}
 */
export function blendPose(a, b, e) {
  if (typeof e !== 'number' || !Number.isFinite(e)) {
    throw new TypeError('relay: blendPose 的 e 必须是有限数，收到 ' + String(e)
      + ' —— NaN / ±Inf 混出的位姿是 NaN 相机 = 整屏白，而且引擎不会报错（AGENTS.md §5.5）。');
  }
  const k = sat(e);
  // 端点精确还原（mixCam 同一条纪律）：最短路径在 ±180° 平局处会把 e=1 落到 b 的
  // **等价角**上（170° → −170° 经 180° 走到 190° ≡ −170°）—— 朝向相同但数值不等，
  // 链式再混合会漂移。端点直接取原值，中途照走最短路径。
  const yaw = k === 0 ? a.yaw : k === 1 ? b.yaw : a.yaw + shortestYawDelta(a.yaw, b.yaw) * k;
  // 几何插值（zoomLerp 的样式）：倍率匀速。1e-6 下限挡 log(0)/log(负数)。
  const dist = Math.exp(lerpLog(a.dist, b.dist, k));
  const fov = 2 * Math.atan(Math.exp(lerpLog(Math.tan((a.fov * Math.PI) / 360), Math.tan((b.fov * Math.PI) / 360), k))) * 180 / Math.PI;
  return {
    look: [a.look[0] + (b.look[0] - a.look[0]) * k, a.look[1] + (b.look[1] - a.look[1]) * k, a.look[2] + (b.look[2] - a.look[2]) * k],
    dist,
    yaw,
    pitch: a.pitch + (b.pitch - a.pitch) * k,
    fov,
    roll: a.roll + (b.roll - a.roll) * k,
  };
}

/** `exp(lerp(log a, log b, k))` 的守卫版：非正数/非有限数退到 1e-6（zoomLerp 同款下限）。 */
function lerpLog(a, b, k) {
  const la = Math.log(Math.max(1e-6, a));
  const lb = Math.log(Math.max(1e-6, b));
  return la + (lb - la) * k;
}

/* ═══════════════ 换手窗与运动曲线 ═══════════════ */

/**
 * **换手窗**（glide 的默认）：交叠进度 tin 走到 0.35 之前画面还是 A、0.65 之后已是 B，
 * 中间 mixTo 交叉 —— 旧内容在被相机"带走"的过程中退场，不是硬切。
 * 参考值 `HANDOVER.glide = [.35, .65]`（docs/REFERENCE-world-execute.md §4 ②）。
 * @type {[number, number]}
 */
export const HANDOVER_GLIDE = [0.35, 0.65];

/**
 * **换手进度**：`k ≤ w0 → 0`（全 A），`k ≥ w1 → 1`（全 B），中间 **smoothstep**
 * （两端导数为 0，换手没有速度突变）。单调 —— k 变大内容只会单向从 A 换到 B。
 *
 * @param {number} k 交叠期归一化进度（`tin`，0..1；越界按 0/1 处理）
 * @param {readonly [number, number]} [window] 换手窗（默认 {@link HANDOVER_GLIDE}）
 * @returns {number} 0..1，mixTo 的权重（0 = 上一段 / 1 = 本段）
 */
export function relayHandover(k, window = HANDOVER_GLIDE) {
  const [w0, w1] = window;
  const x = sat((k - w0) / Math.max(1e-6, w1 - w0));
  return x * x * (3 - 2 * x);
}

/**
 * **运动曲线**（交叠期位姿插值的形状）。
 *
 *   · `glide`：`0.5 − 0.5·cos(π·sat(p))` —— inOutSine 的解析式，恒定角速度的
 *     缓入缓出（参考 `MOVES = { glide: ease.inOutSine, … }`；引擎的 `src/core/util.js`
 *     ease 表里没有 inOutSine，就地定义，不往 util.js 加函数）；
 *   · `whip`：`sat(p)^2.4` —— 前慢后快，甩鞭手感（参考同款指数）。
 *
 * @type {{ glide: (p: number) => number, whip: (p: number) => number }}
 */
export const MOVES = {
  glide: (p) => 0.5 - 0.5 * Math.cos(Math.PI * sat(p)),
  whip: (p) => Math.pow(sat(p), 2.4),
};

/** glide / whip 的清单（报错文案用）。 */
const RELAY_MOVES = Object.keys(MOVES);

/**
 * 校验接力运动曲线名。**未知名当场抛**并列出可用值 —— 与 `trans.js` 的
 * `resolveTransitionMode` 同一条纪律：一个打错的 `move: 'glid'` 静默回落成默认，
 * 画面照样出、check 照样绿，只把"我要的甩鞭怎么没出现"留给人。
 *
 * @param {unknown} name
 * @param {string} [where] 报错里点名的位置
 * @returns {(p: number) => number} MOVES 里的曲线
 */
export function resolveRelayMove(name, where = 'relay move') {
  if (name === undefined || name === null) return MOVES.glide;
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(MOVES, name)) {
    throw new TypeError(where + '：没有接力运动曲线 "' + String(name) + '"（大概是拼错了）。'
      + '可用：' + RELAY_MOVES.join(' / '));
  }
  return MOVES[name];
}
