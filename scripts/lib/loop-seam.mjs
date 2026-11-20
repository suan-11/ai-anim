// @ts-check
/**
 * scripts/lib/loop-seam.mjs —— 循环片接缝判据（BACKLOG 1-78）。
 * 循环片（bumper / 直播待机 / 官网 hero）播完回到第一帧：**末帧与首帧差**就是接缝会不会「跳一下」。
 * 这是唯一能完全机器化的循环判据 —— 不需要人眼，量首末帧像素差即可。
 *
 * 纯函数 meanAbsDiff / assessLoopSeam 可离线测；decodeLoopEnds 走 ffmpeg（复用 media 的包装器）。
 */
import { ffmpegArgv, run } from './media.mjs';

/** 首末帧平均绝对差 ≤ 它算无缝（0..255 灰度；留一点编码噪声余量） */
export const LOOP_SEAM_THRESHOLD = 2.0;

/** 两个等长像素缓冲的平均绝对差（每 stride 像素取 1，与 diff-series 同口径）。纯函数。 */
export function meanAbsDiff(a, b, stride = 5) {
  const n = Math.min(a.length, b.length);
  let s = 0, c = 0;
  for (let i = 0; i < n; i += stride) { s += Math.abs(a[i] - b[i]); c++; }
  return c ? s / c : 0;
}

/** 接缝判定。纯函数。 */
export function assessLoopSeam(diff, threshold = LOOP_SEAM_THRESHOLD) {
  const seamless = Number.isFinite(diff) && diff <= threshold;
  return {
    diff, threshold, seamless,
    text: seamless
      ? `接缝 ✓ 首末帧差 ${diff.toFixed(2)} ≤ ${threshold}（循环无缝）`
      : `接缝 ✗ 首末帧差 ${diff.toFixed(2)} > ${threshold}（循环回到开头会跳一下）`,
  };
}

/**
 * 解码成片 → 首帧与末帧（小尺寸灰度，原生帧率，取真正的第 0 帧与最后一帧）。
 * @returns {{ first: Buffer, last: Buffer, frames: number, w: number, h: number } | null}
 */
export function decodeLoopEnds(mp4, opts = {}) {
  const W = opts.w ?? 480, H = opts.h ?? 270;
  const r = run([...ffmpegArgv(), '-v', 'error', '-i', mp4, '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) return null;
  const raw = r.stdoutBuf, FS = W * H, n = Math.floor(raw.length / FS);
  if (n < 2) return null;
  return { first: raw.subarray(0, FS), last: raw.subarray((n - 1) * FS, n * FS), frames: n, w: W, h: H };
}

/** 一步到位：量某 mp4 的循环接缝。解码失败返回 null。 */
export function loopSeam(mp4, opts = {}) {
  const ends = decodeLoopEnds(mp4, opts);
  if (!ends) return null;
  return assessLoopSeam(meanAbsDiff(ends.first, ends.last), opts.threshold);
}
