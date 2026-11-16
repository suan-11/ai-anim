// @ts-check
/**
 * scripts/lib/ref-analysis.mjs —— 参考片拆解（BACKLOG 1-76）的**纯函数判据**。
 *
 * 输入是「帧间差序列 / 切点 / 网格单元差」这些**数**，不碰 ffmpeg / GPU / DOM —— 所以能离线回归
 * （tools/test-ref.mjs 用合成序列测）。解码抽帧在 scripts/cmd/ref.mjs（复用 diff-series 的帧差口径）。
 *
 * 四个读数：①场景切点表 detectCuts ②BPM 候选 bpmCandidates ③每段运动量 segmentMotion ④运动热图 motionHeat / aggregateCellHeat。
 * 设计依据 docs/REFERENCE-garden-skills.md §3.2：不造新算法，只把「对标」从形容词变成可量的数。
 */

/** 帧间差低于它算「没动」（与 tools/lib/diff-series.mjs 的 STATIC_DIFF 同口径） */
export const REF_STATIC_DIFF = 0.30;

/**
 * ① 场景切点：硬切会让整帧大部分像素突变 ⇒ 帧间差**尖峰**（远高于正常运动）。
 * 判据：diff[i] ≥ max(absMin, 中位数×spikeRatio)，且是局部极大；相邻太近的切点合并取最强。
 * @param {number[]} diff 帧间差序列（0..255 量纲）
 * @param {number} fps 采样帧率
 * @param {{ absMin?:number, spikeRatio?:number, minGapSec?:number }} [opts]
 * @returns {{ frame:number, t:number, strength:number }[]}
 */
export function detectCuts(diff, fps, opts = {}) {
  const absMin = opts.absMin ?? 22;
  const spikeRatio = opts.spikeRatio ?? 3;
  const minGap = Math.max(1, Math.round((opts.minGapSec ?? 0.4) * fps));
  const sorted = [...diff].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const thresh = Math.max(absMin, median * spikeRatio);
  /** @type {{frame:number,t:number,strength:number}[]} */ const cuts = [];
  for (let i = 1; i < diff.length - 1; i++) {
    const d = diff[i];
    if (d < thresh) continue;
    // 硬切 = **孤立尖峰**（低-高-低）：前后两帧都回落到阈值下。
    // 持续高运动的平台（边缘也是高差）不是硬切，排除 —— 否则会把「一段快动作」误报成切点。
    if ((diff[i - 1] || 0) >= thresh || (diff[i + 1] || 0) >= thresh) continue;
    const last = cuts[cuts.length - 1];
    if (!last || i - last.frame >= minGap) cuts.push({ frame: i, t: i / fps, strength: d });
    else if (d > last.strength) cuts[cuts.length - 1] = { frame: i, t: i / fps, strength: d };
  }
  return cuts;
}

/**
 * ② BPM 候选：切点落在节拍网格上 ⇒ 网格拟合。对每个候选 BPM，数有多少切点贴近周期整数倍。
 * 容差取**周期的比例**（tolFrac），让不同 BPM 的「随机命中率」一致（≈2×tolFrac），分数才可跨 BPM 比较。
 * 另给切点间隔的直方图（60/间隔）作粗参照。
 * @param {number[]} cutTimes 切点时刻（秒）
 * @param {number} duration 片长（秒）
 * @param {{ minBpm?:number, maxBpm?:number, tolFrac?:number, top?:number }} [opts]
 */
export function bpmCandidates(cutTimes, duration, opts = {}) {
  const minBpm = opts.minBpm ?? 60, maxBpm = opts.maxBpm ?? 200;
  const tolFrac = opts.tolFrac ?? 0.12;
  const cuts = cutTimes.filter((t) => t > 0.001 && t < duration);
  const intervals = [];
  for (let i = 1; i < cuts.length; i++) intervals.push(cuts[i] - cuts[i - 1]);
  const hist = new Map();
  for (const iv of intervals) {
    if (iv <= 0) continue;
    const bpm = Math.round(60 / iv);
    if (bpm >= minBpm && bpm <= maxBpm) hist.set(bpm, (hist.get(bpm) || 0) + 1);
  }
  const results = [];
  for (let bpm = minBpm; bpm <= maxBpm; bpm++) {
    const period = 60 / bpm;
    const tol = period * tolFrac;
    let on = 0, dev = 0;
    for (const t of cuts) {
      const nearest = Math.round(t / period) * period;
      const d = Math.abs(t - nearest);
      if (d <= tol) { on++; dev += d; }
    }
    results.push({ bpm, onGrid: on, total: cuts.length, score: cuts.length ? on / cuts.length : 0, dev });
  }
  // 同分时取**贴网格最准**的（总偏差最小）—— 容差窗内相邻 BPM 会同分，精确的那个才是真节拍
  results.sort((a, b) => b.score - a.score || a.dev - b.dev || b.onGrid - a.onGrid || a.bpm - b.bpm);
  return {
    candidates: results.slice(0, opts.top ?? 5),
    randomBaseline: 2 * tolFrac,
    intervals,
    histogram: [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
  };
}

/**
 * ③ 每段运动量：以切点为界分段，报每段平均/峰值帧间差与「静帧占比」。
 * @param {number[]} diff 帧间差序列
 * @param {number[]} cutFrames 切点帧号（detectCuts 的 frame）
 * @param {number} fps
 * @param {{ stillTh?:number }} [opts]
 */
export function segmentMotion(diff, cutFrames, fps, opts = {}) {
  const stillTh = opts.stillTh ?? REF_STATIC_DIFF;
  const bounds = [0, ...cutFrames, diff.length];
  const segs = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const a = bounds[k], b = bounds[k + 1];
    if (b <= a) continue;
    let sum = 0, mx = 0, still = 0, cnt = 0;
    for (let i = a; i < b; i++) { const d = diff[i] || 0; sum += d; if (d > mx) mx = d; if (d < stillTh) still++; cnt++; }
    segs.push({ index: k, start: a / fps, end: b / fps, dur: (b - a) / fps,
      meanMotion: cnt ? sum / cnt : 0, peak: mx, stillRatio: cnt ? still / cnt : 0 });
  }
  return segs;
}

/**
 * ④a 时间热图：把帧间差按时间分桶，归一到 0..1（最热桶=1），供 ASCII/JSON 渲染。
 * @param {number[]} diff @param {number} fps @param {number} [buckets]
 */
export function motionHeat(diff, fps, buckets = 40) {
  const n = diff.length;
  const per = n / buckets;
  const bins = [];
  let max = 0;
  for (let b = 0; b < buckets; b++) {
    const a = Math.floor(b * per), c = Math.floor((b + 1) * per);
    let s = 0, cnt = 0;
    for (let i = a; i < c; i++) { s += diff[i] || 0; cnt++; }
    const v = cnt ? s / cnt : 0;
    if (v > max) max = v;
    bins.push({ t: a / fps, v });
  }
  return bins.map((x) => ({ t: x.t, v: x.v, level: max > 0 ? x.v / max : 0 }));
}

/**
 * ④b 空间热图：把每帧的网格单元差按段聚合 ⇒ 每段「哪里在动」。
 * @param {number[][]} cellDiffs 每帧一个长度为 cols*rows 的数组
 * @param {number[]} cutFrames 切点帧号
 * @param {{ cols:number, rows:number }} grid
 */
export function aggregateCellHeat(cellDiffs, cutFrames, grid) {
  const bounds = [0, ...cutFrames, cellDiffs.length];
  const ncell = grid.cols * grid.rows;
  const segs = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const a = bounds[k], b = bounds[k + 1];
    if (b <= a) continue;
    const cells = new Array(ncell).fill(0);
    let cnt = 0;
    for (let i = a; i < b; i++) {
      const cd = cellDiffs[i];
      if (!cd) continue;
      for (let c = 0; c < ncell; c++) cells[c] += cd[c] || 0;
      cnt++;
    }
    segs.push({ index: k, start: a, end: b, cells: cells.map((v) => (cnt ? v / cnt : 0)) });
  }
  return segs;
}
