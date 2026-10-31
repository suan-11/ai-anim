// @ts-check
/**
 * 自适应运动模糊的**判据**（纯函数，不碰 GPU、不碰 DOM）。
 *
 * ## 为什么这一层要单独抽出来
 *
 * 它原来整个藏在 `Engine.render()` 的一个循环里（`_sampleError()` + 三级三倍地加子帧），
 * 而那里同时有 GL 状态、RT、Pass、readPixels —— 所以**判据错了没人能测出来**。
 * 事实就是错的：`docs/HANDOFF-spectrum-friction.md` §1 记的是"静止画面上它一路加到 72 子帧"，
 * 2026-10-25 复核发现真相更糟 —— `_sampleError()` 用 `RGBA/UNSIGNED_BYTE` 去读一个
 * **RGBA16F** 的 `errRT`，WebGL2 对这种组合报 `INVALID_OPERATION`、缓冲保持全 0，
 * 于是误差**恒等于 0**（< 任何 tol）⇒ 每一帧都在第 1 级就"收敛"，8 → 24 之后直接停。
 * 这条判据从写下来那天起就没有工作过，而它不报错，只是**让所有片子少画了拖影**；
 * 同时它也让"为什么一直加子帧"变成一个查不出来的问题（它其实从来没加过）。
 *
 * 所以这里只做三件可以离线断言的事：
 *   ① **误差怎么量**：两组子帧的均值在显示空间里的**高分位**差异（不是最大值 —— 一个坏像素
 *      不该决定整帧要不要 216 个子帧；也不是平均值 —— 一条细线的拖影占的像素很少）；
 *   ② **什么时候停**：误差达标就停；连续两级都降不下去（停滞）也停，并把原因记下来；
 *   ③ **子帧档位**：8·3^L 的嵌套等距序列，与 `maxSamples` 只往下压的语义一致。
 *
 * 量具：`node tools/probe-sampling.mjs <任务>`（真 GPU，报每帧的子帧数 / 各级误差 / 停止原因）。
 * 离线回归：`tools/test-sampling.mjs`。
 */

/** 起始子帧数（`BASE_SAMPLES`）。 */
export const BASE_SAMPLES = 8;
/** 硬上限：8·3^3 = 216。 */
export const MAX_SAMPLES = 216;
/** 默认容差（显示空间 0..255 的级数）。与从前的 `DEFAULT_TOL` 同值。 */
export const DEFAULT_TOL = 2.5;

/**
 * 误差的**分位**：0.99。
 *
 * 为什么不是最大值：`errRT` 是 1/16 分辨率、每格是 16×16 像素里的最大值，一帧 8160 格里
 * 只要有一格抖 1 级，最大值就会被顶到 1 —— 而 1 级在显示空间里是**看不见**的（远低于 tol 2.5）。
 * 为什么不是平均：一条 2px 细线的拖影只占千分之几的像素，平均值会把它摊薄成 0，
 * 于是"细线甩过去"这种**最需要模糊**的画法反而被判定为收敛。
 * 99 分位刚好在两者之间：少数几格真正的运动带动读数，单个坏格子再也不能决定整帧。
 */
export const ERROR_QUANTILE = 0.99;

/**
 * 停滞熔断：连续 `STALL_LEVELS` 级里最新一级的误差**没有降到**上一级的 `STALL_RATIO` 以下，
 * 就停。
 *
 * 这条是给"加子帧根本没用"的画面兜底的：由 `f.idx` 播种的逐帧噪声、`f.t` 上连续的
 * 高频抖动、或者某个 shader 的 hash 在子帧之间跳变 —— 这些**永远收敛不了**，
 * 再加子帧只是把渲染时间乘以 3（`handoff` §1 那次 0.9 fps 就是这么来的，
 * 只不过当时真正的原因不是这条，而是判据读不出数）。
 */
export const STALL_LEVELS = 2;
export const STALL_RATIO = 0.7;

/**
 * 固定 N 个等距子帧（居中于帧时刻）。
 * @param {number} n @returns {number[]} 每个元素是"以帧长为单位"的偏移，范围 (-0.5, 0.5)
 */
export function fixedOffsets(n) {
  const u = new Array(n);
  for (let i = 0; i < n; i++) u[i] = (i + 0.5) / n - 0.5;
  return u;
}

/**
 * 自适应采样的嵌套序列：第 L 级是 8·3^L 个**等距**子帧，且**每一级都包含上一级那些位置**
 * （所以"把新样本并进总和"得到的仍是等距采样的均值）。
 *
 * ⚠ 旧实现是"把每个间隔三等分、在两侧各插一个新样本"，但对**最后一个间隔**没有右端点可用，
 * 它做了外推 —— 于是 24 子帧的位置是 [-0.4375 … +0.5486]：**第一格里少一个样本、末尾多出
 * 两个落在快门窗口之外**。整帧的采样窗因此右偏 0.05 帧，而且窗口外的两帧会把"下一帧"的
 * 内容混进来。这条从来没有被量过（因为判据本身是坏的，见文件头）。
 * 现在直接生成均匀网格：基位 `j = 3i+1` 恰好就是 8 个基样本 —— 集合关系可以断言
 * （`tools/test-sampling.mjs`）。
 *
 * @param {number} levels @returns {number[]} 升序，全部落在 (-0.5, 0.5)
 */
export function ternaryOffsets(levels) {
  const total = BASE_SAMPLES * 3 ** Math.max(0, Math.round(levels));
  const u = new Array(total);
  for (let j = 0; j < total; j++) u[j] = (j + 0.5) / total - 0.5;
  return u;
}

/**
 * 把 `maxSamples`（时间段上的上限）收成**合法档位**：8·3^L，且不小于 8。
 *
 * 语义是"只往下压"：36 会被收成 24（不是 36 —— 档位是嵌套的，插不进第三种密度），
 * 7 会被抬到 8（比 8 更少就等于关掉运动模糊，那该写 `samples: 1`）。
 * @param {number} [requested] 不传 = 不封顶
 * @returns {number} 8 / 24 / 72 / 216 之一
 */
export function snapMaxSamples(requested) {
  if (!(Number(requested) > 0)) return MAX_SAMPLES;
  let n = BASE_SAMPLES;
  while (n * 3 <= MAX_SAMPLES && n * 3 <= Number(requested)) n *= 3;
  return n;
}

/**
 * 一个时刻要跑几级（`0` = 只用 8 个子帧就收工）。
 * @param {number} maxSamples 已经过 {@link snapMaxSamples}
 */
export function levelsFor(maxSamples) {
  return Math.max(0, Math.round(Math.log(Math.max(BASE_SAMPLES, maxSamples) / BASE_SAMPLES) / Math.log(3)));
}

/**
 * 从误差直方图里取分位值（显示空间的级数，0..255）。
 *
 * 直方图是 GPU 侧归约的结果（`errRT` 1/16 分辨率、每格已经是一次 max），
 * 所以这里只是"在 8160 个格子里找第 99% 个"，代价是一次 8KB 的回读。
 *
 * @param {Uint8Array|Uint32Array|number[]} hist 256 个桶（下标 = 级数）
 * @param {number} [q] 0..1
 * @returns {number} 级数（0..255）。直方图为空 ⇒ 0（= 收敛）
 */
export function quantileFromHist(hist, q = ERROR_QUANTILE) {
  let total = 0;
  for (let i = 0; i < 256; i++) total += hist[i] ?? 0;
  if (!total) return 0;
  const goal = Math.max(1, Math.ceil(total * q));
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i] ?? 0;
    if (acc >= goal) return i;
  }
  return 255;
}

/**
 * **什么时候停**：把"还要不要加子帧"这件事变成一个纯函数，好离线断言。
 *
 * 输入是逐级的 `{ err, prevErr }`（err 已归一到 0..1 的显示空间，见 `_sampleError` 的注释），
 * 输出是这一帧的判决：
 *   · `stop: true` + `reason: 'tol'`   —— 误差已经小于容差（真正的收敛）
 *   · `stop: true` + `reason: 'stall'` —— 连续两级降不下去（加子帧没用，多半是逐帧噪声）
 *   · `stop: true` + `reason: 'cap'`   —— 到了这一段的上限
 *   · `stop: false`                    —— 还要再加一级
 *
 * ⚠ 三个理由都要能被打出来（`--json` 与 `perf` / `video` 的子帧分布会带上），
 *   否则作者只知道"子帧数多"，不知道**为什么**多、以及自己能不能改。
 *
 * ⚠ **单位**：`tol` 是**显示空间的级数**（0..255，与 `--tol` 的默认 2.5 一致），而传进来的
 * `err` 是 0..1 的归一化值。旧代码把两者直接比：`err(0..1) < tol(2.5)` —— 恒真，于是
 * "容差"这一档实际上等于"只要量到了误差就停"。这是第四个同时存在的 bug，它让
 * `--tol` 这个文档里写了、CLI 里接了、`renderFingerprint` 还专门记着的参数**完全无效**。
 * 现在换算只在这一个地方做，测试也钉住它。
 *
 * @param {{ err: number, prevErr?: number }[]} levels 已经跑过的各级（按先后顺序）
 * @param {{ tol?: number, maxSamples?: number, samples?: number, stallLevels?: number, stallRatio?: number }} [opts]
 *        `tol` = 显示空间级数（0..255）；`samples` = 当前已经累到的子帧数；
 *        `maxSamples` = 这一帧允许的上限
 * @returns {{ stop: boolean, reason: 'tol'|'stall'|'cap'|'more', err: number }}
 */
export function samplingVerdict(levels, opts = {}) {
  const tol = opts.tol ?? DEFAULT_TOL;
  const maxSamples = opts.maxSamples ?? MAX_SAMPLES;
  const samples = opts.samples ?? BASE_SAMPLES;
  const stallLevels = opts.stallLevels ?? STALL_LEVELS;
  const stallRatio = opts.stallRatio ?? STALL_RATIO;
  const last = levels[levels.length - 1];
  if (!last) return { stop: false, reason: 'more', err: NaN };
  const err = Number(last.err);
  // 非有限值（NaN / Inf）绝不能被当成"收敛得很好"：宁可多采一级也别静默停下。
  if (!Number.isFinite(err)) return { stop: false, reason: 'more', err };
  // err 是 0..1，tol 是 0..255 级 —— 在这里一次性换算（见函数头那段"单位"）
  if (err * 255 < tol) return { stop: true, reason: 'tol', err };
  if (samples >= maxSamples) return { stop: true, reason: 'cap', err };
  // 停滞：最近 stallLevels 级里，每一级都没有比前一级低到 stallRatio 以下
  if (levels.length > stallLevels) {
    let stalled = 0;
    for (let i = levels.length - stallLevels; i < levels.length; i++) {
      const a = Number(levels[i - 1]?.err);
      const b = Number(levels[i]?.err);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b > a * stallRatio) stalled++;
    }
    if (stalled >= stallLevels) return { stop: true, reason: 'stall', err };
  }
  return { stop: false, reason: 'more', err };
}

/**
 * 判决理由的词表（机器读者也用它，见 `anim perf --json` / `video` 收尾）。
 *
 * · `static` —— **第一级就判停**：快门窗口前后两半逐像素一致，这一帧没有运动。
 *   这是"画面主体静止"的片子能跑快的唯一原因（8 子帧而不是 24）。
 * · `tol`    —— 加到某一级之后误差小于容差（真正的收敛）。
 * · `stall`  —— 连续两级都降不下去（多半是逐帧噪声，再加只是烧时间）。
 * · `cap`    —— 到了这一段 `maxSamples`（或引擎顶档）。
 */
export const SAMPLE_REASONS = Object.freeze(['static', 'tol', 'stall', 'cap', 'more']);

/**
 * 人读的一行：`24 子帧（收敛，err 3.1/255）`。
 * 用在 `video` 收尾、`perf`、`--json` 里，让"为什么是这个数"当场可见。
 * @param {{ samples: number, reason?: string, err?: number }} v
 */
export function describeSampling(v) {
  const why = { static: '静止', tol: '收敛', stall: '停滞熔断', cap: '到上限', more: '更多' }[String(v.reason)] ?? String(v.reason ?? '?');
  const e = Number.isFinite(Number(v.err)) ? `err ${(Number(v.err) * 255).toFixed(1)}/255` : 'err 不可用';
  return `${v.samples} 子帧（${why}，${e}）`;
}

/* ------------------------------------------------------------------ 子像素抖动（超采样） */

/**
 * 子像素抖动的**旋转网格**：4 个位置，单位 = 像素，相对像素中心。
 *
 * ## 为什么要有它
 *
 * 引擎的注释一直写着"我们自己做 AA（逐像素 SDF + **多子帧**）"，但事实上静止画面的
 * 8 个子帧是**同一时刻、同一位置渲染 8 次** —— 求平均等于同一张图，多子帧只贡献运动模糊。
 * 也就是说"多子帧 AA"这件事从来没有真正发生过。
 *
 * 现在每个子帧把**整帧**按下面 4 个位置之一偏移再渲染（亚像素偏移由 `GL.jitter` 下发到
 * 全屏 Pass 的顶点着色器与 LineBatch），累加后就是 **4× 超采样**：线条、填充面、
 * shader 背景、raymarch 都免费拿到抗锯齿，而**渲染时间一分不多**（子帧本来就要渲）。
 *
 * ## 三条约束（写错不报错，只是"看起来没效果"或者"突然慢 27 倍"）
 *
 * 1. **均值必须是 0**：否则整帧内容会平移（半个像素的位移在 1080p 上看得见）。
 * 2. **全部落在 ±0.5 像素内**：超过就变成"重影"而不是"亚像素采样"。
 * 3. **周期必须是 4**（= 自适应采样第一级分成两半、每半 4 个子帧）：
 *    判据是「前半 4 帧与后半 4 帧长得一样吗」，两半的抖动位置序列必须**逐位相同**，
 *    否则静止画面也会被判成"有运动" ⇒ 一路加到 216 子帧。
 *    `tools/test-sampling.mjs` 钉着这三条。
 *
 * 用旋转网格而不是方正网格：4 个点落在 2×2 四个象限的中心并整体转 45°，
 * 对接近水平/竖直的边缘比方正网格更均匀（行业默认配方）。
 *
 * @type {readonly (readonly [number, number])[]}
 */
export const JITTER_GRID = Object.freeze([
  Object.freeze([0.125, -0.375]),
  Object.freeze([-0.375, -0.125]),
  Object.freeze([0.375, 0.125]),
  Object.freeze([-0.125, 0.375]),
]);

/** 抖动周期（见 `JITTER_GRID` 第 3 条约束）。 */
export const JITTER_PERIOD = JITTER_GRID.length;

/** 不抖（= 单子帧路径 / 引擎内部重采样 pass）。 */
export const NO_JITTER = Object.freeze([0, 0]);

/**
 * 第 `i` 个子帧的亚像素偏移（**物理像素，x 向右、y 向上**）。
 * @param {number} i 子帧序号（0 起；负数/非整数会被规整）
 * @returns {readonly [number, number]}
 */
export function jitterOffset(i) {
  const k = ((Math.round(Number(i)) || 0) % JITTER_PERIOD + JITTER_PERIOD) % JITTER_PERIOD;
  return JITTER_GRID[k];
}

