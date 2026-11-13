// @ts-check
/**
 * tools/lib/diff-series.mjs —— **成片帧间差**的共享解码（C4：把两份重复合并成一次）。
 *
 * `lint-event-density`（事件密度）与 `lint-anti-ppt` 的 C7（匀速漂移）原来各自 spawn 一遍
 * 「ffmpeg → 4fps / 480×270 灰度 → 逐帧平均绝对差」，参数与采样完全一样。这里抽成一份：
 *   · `decodeDiffSeries(mp4)` 只负责解码 + 算帧间差序列；
 *   · `motionStats(diff, fps)` 从序列算 CV / 均值 / 最长静止（C7 用）；
 *   · 事件密度的 2s 窗口聚合仍留在它自己那里（那是它独有的判据）。
 *
 * ⚠ 改采样口径（FPS / 分辨率 / 每 5 像素取 1）会同时移动两条判据的读数 —— 要改就一起重测。
 */
import { spawnSync } from 'node:child_process';

export const DIFF_FPS = 4;
export const DIFF_W = 480;
export const DIFF_H = 270;
/** 帧间差低于它算「这一帧没动」（与两条判据的历史阈值一致） */
export const STATIC_DIFF = 0.30;

/**
 * 解码成片 → 逐帧平均绝对差序列。
 * @param {string} mp4 成片路径
 * @returns {{ diff: number[], fps: number, frames: number } | null} 失败 / 帧数太少返回 null
 */
export function decodeDiffSeries(mp4) {
  const r = spawnSync(process.env.ANIM_FFMPEG || 'ffmpeg',
    ['-v', 'error', '-i', mp4, '-vf', `fps=${DIFF_FPS},scale=${DIFF_W}:${DIFF_H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: 1 << 30 });
  if (r.status !== 0) return null;
  const raw = r.stdout, FS = DIFF_W * DIFF_H, n = Math.floor(raw.length / FS);
  if (n < 8) return null;
  const diff = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    let s = 0, c = 0;
    const a = (i - 1) * FS, b = i * FS;
    for (let k = 0; k < FS; k += 5) { s += Math.abs(raw[b + k] - raw[a + k]); c++; }
    diff[i] = s / c;
  }
  return { diff, fps: DIFF_FPS, frames: n };
}

/**
 * 从帧间差序列算 C7 要的统计：变异系数 / 均值 / 最长静止。
 * @param {number[]} diff 帧间差序列（decodeDiffSeries 的 diff）
 * @param {number} fps 采样帧率
 * @returns {{ cv: number, mean: number, staticSpan: number, frames: number }}
 */
export function motionStats(diff, fps) {
  const ds = diff.slice(1);   // 第 0 帧没有「前一帧」，差为 0，不参与统计
  const mean = ds.reduce((a, b) => a + b, 0) / Math.max(1, ds.length);
  const sd = Math.sqrt(ds.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, ds.length));
  let run = 0, worst = 0;
  for (const d of ds) { if (d < STATIC_DIFF) { run++; worst = Math.max(worst, run); } else run = 0; }
  return { cv: mean > 0 ? sd / mean : 0, mean, staticSpan: worst / fps, frames: diff.length };
}
