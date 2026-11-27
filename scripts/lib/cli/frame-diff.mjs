// @ts-check
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ffmpegCmd, runFfmpeg } from './media.mjs';

/**
 * 上下翻转一张 RGBA 图（行序反转：WebGL 自下而上 ↔ PNG/ffmpeg 自上而下）。
 * @param {Buffer} buf
 * @param {number} w
 * @param {number} h
 * @returns {Buffer}
 */
export function flipRows(buf, w, h) {
  const row = w * 4;
  const out = Buffer.allocUnsafe(buf.length);
  for (let y = 0; y < h; y++) buf.copy(out, y * row, (h - 1 - y) * row, (h - y) * row);
  return out;
}

/**
 * 两张 RGBA 缓冲的差异统计。
 * @param {Buffer|Uint8Array} a
 * @param {Buffer|Uint8Array} b
 */
export function pixelDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let max = 0, sum = 0, over16 = 0, over32 = 0, over64 = 0, count = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
    sum += d; count++;
    if (d > 16) over16++;
    if (d > 32) over32++;
    if (d > 64) over64++;
  }
  return {
    max,
    mean: sum / Math.max(1, count),
    over16: over16 / Math.max(1, count),
    over32: over32 / Math.max(1, count),
    over64: over64 / Math.max(1, count),
  };
}

/**
 * 计算 RGBA 图像（sRGB 8bit）的 Rec.709 亮度均值与标准差（归一化到 [0, 1]）。
 * @param {Buffer|Uint8Array} rgba
 * @returns {{ mean: number, stdDev: number }}
 */
export function frameLumaStats(rgba) {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels <= 0) return { mean: 0, stdDev: 0 };
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < pixels * 4; i += 4) {
    const l = (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255;
    sum += l;
    sumSq += l * l;
  }
  const mean = sum / pixels;
  const variance = Math.max(0, sumSq / pixels - mean * mean);
  return { mean, stdDev: Math.sqrt(variance) };
}

/**
 * 用 ffmpeg 从成片按精确帧号抽一帧 RGBA。
 * @param {string} file
 * @param {number} frameIdx
 * @param {number} w
 * @param {number} h
 * @param {{ flip?: boolean }} [opts]
 * @returns {Promise<Buffer|null>}
 */
export async function ffmpegFrame(file, frameIdx, w, h, { flip = true } = {}) {
  const [bin, ...prefix] = ffmpegCmd();
  const idx = Math.max(0, Math.round(frameIdx));
  const args = [
    ...prefix, '-v', 'error',
    '-i', file,
    '-vf', `select=eq(n\\,${idx})`,
    '-frames:v', '1', '-fps_mode', 'passthrough',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
  ];
  const buf = await new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    let n = 0;
    p.stdout.on('data', (d) => { chunks.push(d); n += d.length; });
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const b = Buffer.concat(chunks);
      resolve(n === w * h * 4 ? b : null);
    });
  });
  if (!buf) return null;
  return flip ? flipRows(buf, w, h) : buf;
}

/**
 * 通过 ffmpeg image2pipe 将内存 PNG Buffer 解码为 top-down RGBA Buffer（零外部包依赖）。
 * @param {Buffer} pngBuf
 * @param {number} w
 * @param {number} h
 * @returns {Promise<Buffer>}
 */
export async function decodePngRgba(pngBuf, w, h) {
  const [bin, ...prefix] = ffmpegCmd();
  const args = [
    ...prefix, '-v', 'error',
    '-f', 'image2pipe', '-vcodec', 'png', '-i', 'pipe:0',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ];
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    const errChunks = [];
    let n = 0;
    p.stdout.on('data', (d) => { chunks.push(d); n += d.length; });
    p.stderr.on('data', (d) => errChunks.push(d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) {
        const msg = Buffer.concat(errChunks).toString('utf8').trim();
        return reject(new Error(`ffmpeg 解码 PNG 失败（${code}）：${msg}`));
      }
      const out = Buffer.concat(chunks);
      const expected = w * h * 4;
      if (out.length !== expected) {
        return reject(new Error(`PNG 解码像素字节数不符：收到 ${out.length}，期望 ${expected}（${w}×${h}）`));
      }
      resolve(out);
    });
    p.stdin.on('error', () => {});
    p.stdin.end(pngBuf);
  });
}

/**
 * 用 ffmpeg concat+scale+tile 把多张 PNG 拼成接触表（不走 drawtext，避免 Windows 字体路径转义坑）。
 * @param {string[]} pngFiles
 * @param {string} outFile
 * @param {{ cols?: number, cellWidth?: number }} [opts]
 */
export async function makeTileSheet(pngFiles, outFile, { cols = 4, cellWidth = 420 } = {}) {
  if (!pngFiles.length) throw new Error('makeTileSheet 至少需要 1 张图片');
  mkdirSync(path.dirname(outFile), { recursive: true });
  const c = Math.max(1, Math.min(cols, pngFiles.length));
  const r = Math.max(1, Math.ceil(pngFiles.length / c));
  const inputs = pngFiles.flatMap((f) => ['-i', f]);
  const scaled = pngFiles.map((_, i) => `[${i}:v]scale=${cellWidth}:-2[s${i}]`).join(';');
  const refs = pngFiles.map((_, i) => `[s${i}]`).join('');
  const fc = `${scaled};${refs}concat=n=${pngFiles.length}:v=1:a=0,tile=${c}x${r}[out]`;
  await runFfmpeg([
    '-y', '-loglevel', 'error',
    ...inputs,
    '-filter_complex', fc,
    '-map', '[out]', '-frames:v', '1',
    outFile,
  ]);
}
