// @ts-check
/**
 * R5 跨 GPU / 驱动环境复现对照包工具（Machine A 建基线，Machine B 一键复跑并生成对比报告）。
 *
 * 用法：
 *   node tools/cross-gpu-repro.mjs --init-baseline            # 在 Machine A 生成基准固定帧、代表草稿与 manifest.json
 *   node tools/cross-gpu-repro.mjs                            # 默认 --run：按 manifest.json 独立渲染并对比（写入 runs/<id>/）
 *   node tools/cross-gpu-repro.mjs --skip-video               # 仅跑固定帧对照（跳过代表性草稿 MP4，视频项记 SKIPPED）
 *   node tools/cross-gpu-repro.mjs --verify-only --out-dir …  # 不重渲，仅对已有 run 目录重跑比对与报告生成
 *
 * 容差参数：
 *   --tol 8 --png-mean-tol 3.0 --png-over-tol 2.0 --video-mean-tol 6.0 --video-over16-tol 5.0
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePngRgba, ffmpegFrame } from '../scripts/lib/cli/frame-diff.mjs';
import { ffmpegCmd } from '../scripts/lib/cli/media.mjs';
import { openRemotionSession } from '../scripts/lib/cli/remotion-api.mjs';
import { localBrowser } from '../scripts/lib/cli/remotion.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BUNDLE = path.join(ROOT, 'out', '_remotion-migration', 'acceptance', 'cross-gpu-bundle');
const DEFAULT_TMP = path.join(ROOT, 'out', '_remotion-migration', 'acceptance', 'tmp');

export const DEFAULT_TOLERANCES = Object.freeze({
  tol: 8,
  pngMeanTol: 3.0,
  pngOverTolPct: 2.0,
  videoMeanTol: 6.0,
  videoOver16Pct: 5.0,
});

export const CASES = [
  {
    id: 'native-example-config-only',
    task: 'example-config-only',
    compositionId: 'ExampleConfigOnly',
    kind: 'native',
    width: 1920,
    height: 1080,
    fps: 60,
    inputProps: {},
    frameSequence: [60, 209, 210, 474, 684, 708, 739, 810],
    note: '原生 config-only（含 R1 outro 11.40/11.80/12.32s 与切点前后关键帧）',
  },
  {
    id: 'paperfold-s1',
    task: 'paperfold',
    compositionId: 'PaperfoldBridgeMB',
    kind: 'custom-bridge',
    width: 1920,
    height: 1080,
    fps: 24,
    inputProps: { samples: 1 },
    frameSequence: [48, 200, 204, 228, 384, 204, 48],
    note: '复杂桥接 samples=1 + 乱序重复帧 [204, 48] 同帧稳定性',
  },
  {
    id: 'paperfold-s4',
    task: 'paperfold',
    compositionId: 'PaperfoldBridgeMB',
    kind: 'custom-bridge',
    width: 1920,
    height: 1080,
    fps: 24,
    inputProps: { samples: 4 },
    frameSequence: [48, 200, 204, 228, 384],
    note: '复杂桥接 samples=4 多子帧运动模糊',
  },
  {
    id: 'three-lab-s1',
    task: '_three-lab',
    compositionId: 'Task-three-lab',
    kind: 'bridge',
    width: 1920,
    height: 1080,
    fps: 60,
    inputProps: { samples: 1 },
    frameSequence: [120, 339, 450, 537, 720, 339, 120],
    note: 'Three.js 桥接 samples=1 + 乱序重复帧 [339, 120] 同帧稳定性',
  },
  {
    id: 'three-lab-s4',
    task: '_three-lab',
    compositionId: 'Task-three-lab',
    kind: 'bridge',
    width: 1920,
    height: 1080,
    fps: 60,
    inputProps: { samples: 4 },
    frameSequence: [120, 339, 450, 537, 720, 339, 120],
    note: 'Three.js 桥接 samples=4（InstancedMesh + 快门平均）+ 乱序重复帧',
  },
];

export const VIDEOS = [
  {
    id: 'example-config-only-draft',
    task: 'example-config-only',
    args: ['video', 'example-config-only', '--renderer', 'remotion', '--draft', '--segments', '4'],
    checkFrames: [60, 210, 474, 684, 739, 810],
    audioExpected: false,
    note: '原生 config-only 整片草稿（960x540, 60fps, 834f）',
  },
  {
    id: 'paperfold-overlap-draft',
    task: 'paperfold',
    args: ['video', 'paperfold', '--renderer', 'remotion', '--from', '8', '--to', '9.5', '--draft', '--samples', '1', '--noaudio'],
    checkFrames: [0, 12, 24, 35],
    audioExpected: false,
    note: 'paperfold 交叠窗无声草稿（--noaudio；R2 真实音画因缺 paperfold-vo.mp3/paperfold-mix.mp3 仍保持阻塞）',
  },
  {
    id: 'three-lab-draft',
    task: '_three-lab',
    args: ['video', '_three-lab', '--renderer', 'remotion', '--draft', '--segments', '5'],
    checkFrames: [120, 339, 450, 537, 720],
    audioExpected: false,
    note: 'Three.js 桥接整片草稿（960x540, 60fps, 876f）',
  },
];

/** 解析 ffprobe 命令数组，遵循 ANIM_FFPROBE。 */
export function ffprobeCmd() {
  if (process.env.ANIM_FFPROBE) {
    const parts = process.env.ANIM_FFPROBE.match(/"[^"]+"|\S+/g)?.map((s) => s.replace(/^"|"$/g, '')) ?? [];
    if (parts.length) return parts;
  }
  return ['ffprobe'];
}

/** 计算 Buffer / 文件的十六进制 SHA-256。 */
export function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** 计算文件 SHA-256。 */
export function sha256File(filePath) {
  return sha256Buffer(readFileSync(filePath));
}

/**
 * 校验 manifest.json 结构与必填字段。
 * @param {any} manifest
 */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('manifest 必须是对象');
  }
  if (manifest.schema !== 'cross-gpu-bundle/1') {
    throw new Error(`不支持的 manifest.schema：${String(manifest.schema)}（期望 cross-gpu-bundle/1）`);
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    throw new Error('manifest.cases 不能为空');
  }
  for (const c of manifest.cases) {
    if (!c || typeof c.id !== 'string' || typeof c.compositionId !== 'string') {
      throw new Error('manifest.cases 条目缺少 id 或 compositionId');
    }
    if (!Number.isInteger(c.width) || !Number.isInteger(c.height) || c.width <= 0 || c.height <= 0) {
      throw new Error(`case ${c.id} 宽高非法`);
    }
    if (!Array.isArray(c.frameSequence) || c.frameSequence.length === 0) {
      throw new Error(`case ${c.id} 缺少 frameSequence`);
    }
    if (!c.baselines || typeof c.baselines !== 'object') {
      throw new Error(`case ${c.id} 缺少 baselines`);
    }
    for (const f of new Set(c.frameSequence)) {
      const b = c.baselines[String(f)];
      if (!b || typeof b.baselinePath !== 'string' || typeof b.sha256 !== 'string') {
        throw new Error(`case ${c.id} 帧 ${f} 缺少基准记录`);
      }
    }
  }
  if (!Array.isArray(manifest.videos)) {
    throw new Error('manifest.videos 必须是数组');
  }
  for (const v of manifest.videos) {
    if (!v || typeof v.id !== 'string' || typeof v.baselinePath !== 'string' || !Array.isArray(v.args)) {
      throw new Error(`video 条目 ${String(v?.id)} 缺少必填字段`);
    }
    if (!v.ffprobe || !Number.isInteger(v.ffprobe.width) || !Number.isInteger(v.ffprobe.height)) {
      throw new Error(`video 条目 ${v.id} 缺少合法 ffprobe 规格`);
    }
  }
  return manifest;
}

/**
 * 解析并保护 run 输出目录：绝不允许覆盖 bundle 根目录或 baseline/ 目录。
 * @param {string} bundleDir
 * @param {string|null|undefined} outDirOpt
 * @param {string} [gpuLabel]
 * @param {string} [stamp]
 */
export function resolveSafeRunDir(bundleDir, outDirOpt, gpuLabel = 'local', stamp = null) {
  const normBundle = path.resolve(bundleDir);
  const normBaseline = path.resolve(normBundle, 'baseline');
  const safeSlug = String(gpuLabel || 'local')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'local';
  const utcStamp = stamp || new Date().toISOString().replace(/[:.]/g, '-');
  const candidate = outDirOpt
    ? path.resolve(outDirOpt)
    : path.join(normBundle, 'runs', `${utcStamp}-${safeSlug}`);

  const isSameOrInside = (parent, child) => {
    const rel = path.relative(parent, child);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };

  if (candidate === normBundle) {
    throw new Error(`拒绝使用 bundle 根目录作为 --out-dir（会混写基线目录）：${candidate}`);
  }
  if (isSameOrInside(normBaseline, candidate)) {
    throw new Error(`拒绝将 --out-dir 指向 baseline 目录内（禁止覆写 Machine A 基线）：${candidate}`);
  }
  if (isSameOrInside(candidate, normBaseline)) {
    throw new Error(`拒绝使用包含 baseline/ 的父目录作为 --out-dir：${candidate}`);
  }
  for (const protectedFile of [path.join(normBundle, 'manifest.json'), path.join(normBundle, 'README.md')]) {
    if (candidate === protectedFile) {
      throw new Error(`拒绝覆盖受保护文件：${candidate}`);
    }
  }
  return candidate;
}

/** 解析 bundle 内相对路径并阻止越界路径逃逸。 */
export function resolveBundleRelPath(bundleDir, relPath) {
  const normBundle = path.resolve(bundleDir);
  const target = path.resolve(normBundle, relPath);
  const rel = path.relative(normBundle, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`非法 bundle 相对路径：${relPath}`);
  }
  return target;
}

/**
 * 计算两张等长 RGBA 缓冲的字节差分及超阈值百分比（与 pixelDiff 同口径）。
 * @param {Buffer|Uint8Array} bufA
 * @param {Buffer|Uint8Array} bufB
 * @param {number} [tol]
 */
export function computeRgbaDiffWithTol(bufA, bufB, tol = DEFAULT_TOLERANCES.tol) {
  if (!bufA || !bufB || bufA.length === 0 || bufA.length !== bufB.length) {
    throw new Error(`RGBA 缓冲长度不匹配：${bufA?.length ?? 0} vs ${bufB?.length ?? 0}`);
  }
  let max = 0;
  let sum = 0;
  let overTol = 0;
  let over16 = 0;
  let over32 = 0;
  let over64 = 0;
  const n = bufA.length;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(bufA[i] - bufB[i]);
    if (d > max) max = d;
    sum += d;
    if (d > tol) overTol++;
    if (d > 16) over16++;
    if (d > 32) over32++;
    if (d > 64) over64++;
  }
  return {
    max,
    mean: sum / n,
    overTolPct: (overTol * 100) / n,
    over16Pct: (over16 * 100) / n,
    over32Pct: (over32 * 100) / n,
    over64Pct: (over64 * 100) / n,
  };
}

/**
 * 判定单张 PNG 相对 Machine A 基线是否通过。
 * @param {{ sha256Match: boolean, diff: { max: number, mean: number, overTolPct: number } | null }} input
 * @param {{ pngMeanTol?: number, pngOverTolPct?: number }} [tolerances]
 */
export function classifyPngComparison({ sha256Match, diff }, tolerances = {}) {
  const meanTol = tolerances.pngMeanTol ?? DEFAULT_TOLERANCES.pngMeanTol;
  const overTol = tolerances.pngOverTolPct ?? DEFAULT_TOLERANCES.pngOverTolPct;
  if (sha256Match) {
    return { status: 'exact', pass: true, reason: 'SHA-256 逐字节一致' };
  }
  if (!diff) {
    return { status: 'diverged', pass: false, reason: 'SHA-256 不一致且缺少像素差分数据' };
  }
  const pass = diff.mean <= meanTol && diff.overTolPct <= overTol;
  return {
    status: pass ? 'within-tolerance' : 'diverged',
    pass,
    reason: pass
      ? `mean=${diff.mean.toFixed(4)} <= ${meanTol}, overTol=${diff.overTolPct.toFixed(4)}% <= ${overTol}%`
      : `超阈值: mean=${diff.mean.toFixed(4)} (<= ${meanTol}), overTol=${diff.overTolPct.toFixed(4)}% (<= ${overTol}%)`,
  };
}

/**
 * 判定 MP4 关键帧对比是否通过。
 * @param {{ sha256Match?: boolean, diff: { max: number, mean: number, over16Pct: number } | null }} input
 * @param {{ videoMeanTol?: number, videoOver16Pct?: number }} [tolerances]
 */
export function classifyVideoComparison({ sha256Match = false, diff }, tolerances = {}) {
  const meanTol = tolerances.videoMeanTol ?? DEFAULT_TOLERANCES.videoMeanTol;
  const over16Tol = tolerances.videoOver16Pct ?? DEFAULT_TOLERANCES.videoOver16Pct;
  if (sha256Match) {
    return { status: 'exact', pass: true, reason: '关键帧像素完全一致' };
  }
  if (!diff) {
    return { status: 'diverged', pass: false, reason: '无法提取视频帧' };
  }
  const pass = diff.mean <= meanTol && diff.over16Pct <= over16Tol;
  return {
    status: pass ? 'within-tolerance' : 'diverged',
    pass,
    reason: pass
      ? `mean=${diff.mean.toFixed(4)} <= ${meanTol}, over16=${diff.over16Pct.toFixed(4)}% <= ${over16Tol}%`
      : `超阈值: mean=${diff.mean.toFixed(4)} (<= ${meanTol}), over16=${diff.over16Pct.toFixed(4)}% (<= ${over16Tol}%)`,
  };
}

/**
 * 对比两侧 ffprobe 摘要规格。
 * @param {any} expected
 * @param {any} actual
 */
export function compareFfprobeSpecs(expected, actual) {
  const mismatches = [];
  if (!expected || !actual) return { ok: false, mismatches: ['ffprobe 数据缺失'] };
  if (actual.width !== expected.width || actual.height !== expected.height) {
    mismatches.push(`尺寸不符: ${actual.width}x${actual.height} vs ${expected.width}x${expected.height}`);
  }
  if (Math.abs((actual.fps ?? 0) - (expected.fps ?? 0)) > 0.05) {
    mismatches.push(`帧率不符: ${actual.fps} vs ${expected.fps}`);
  }
  if (actual.nbFrames !== expected.nbFrames) {
    mismatches.push(`帧数不符: ${actual.nbFrames} vs ${expected.nbFrames}`);
  }
  if (Math.abs((actual.duration ?? 0) - (expected.duration ?? 0)) > 0.05) {
    mismatches.push(`时长不符: ${actual.duration} vs ${expected.duration}`);
  }
  if (actual.audioStreamCount !== expected.audioStreamCount) {
    mismatches.push(`音轨数不符: ${actual.audioStreamCount} vs ${expected.audioStreamCount}`);
  }
  if (expected.codecName && actual.codecName !== expected.codecName) {
    mismatches.push(`编码不符: ${actual.codecName} vs ${expected.codecName}`);
  }
  return { ok: mismatches.length === 0, mismatches };
}

function extractFirstJsonObject(text) {
  const s = String(text ?? '');
  for (let start = s.indexOf('{'); start >= 0; start = s.indexOf('{', start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (c === '\\') { esc = true; continue; }
        if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try {
            const obj = JSON.parse(s.slice(start, i + 1));
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
          } catch { /* 继续找下一段 */ }
          break;
        }
      }
    }
  }
  return null;
}

/** 采集当前环境的 OS / Node / npm / Remotion / Chrome / ffmpeg / GPU / WebGL 版本信息。 */
export function collectEnvironment(root = ROOT) {
  let npmVersion = null;
  if (process.platform === 'win32') {
    const r = spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm -v'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (r.status === 0) npmVersion = String(r.stdout ?? '').trim();
  } else {
    const r = spawnSync('npm', ['-v'], { encoding: 'utf8', timeout: 10000 });
    if (r.status === 0) npmVersion = String(r.stdout ?? '').trim();
  }

  const remotionPkgs = [
    'remotion', '@remotion/cli', '@remotion/renderer', '@remotion/bundler',
    '@remotion/media', '@remotion/media-utils', '@remotion/transitions',
  ];
  const remotion = {};
  for (const pkg of remotionPkgs) {
    try {
      remotion[pkg] = require(`${pkg}/package.json`).version;
    } catch {
      remotion[pkg] = null;
    }
  }

  const browserExe = localBrowser() ?? null;
  let browserVersion = null;
  if (browserExe) {
    if (process.platform === 'win32') {
      const r = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        '(Get-Item -LiteralPath $env:ANIM_CHROME_PATH).VersionInfo.ProductVersion',
      ], {
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
        env: { ...process.env, ANIM_CHROME_PATH: browserExe },
      });
      if (r.status === 0) browserVersion = String(r.stdout ?? '').trim() || null;
    } else {
      const r = spawnSync(browserExe, ['--version'], { encoding: 'utf8', timeout: 10000 });
      if (r.status === 0) browserVersion = String(r.stdout ?? '').trim() || null;
    }
  }

  const [ffBin, ...ffArgs] = ffmpegCmd();
  const ffRes = spawnSync(ffBin, [...ffArgs, '-version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  const ffmpegLine = ffRes.status === 0 ? String(ffRes.stdout ?? '').split(/\r?\n/)[0]?.trim() ?? null : null;

  const [fpBin, ...fpArgs] = ffprobeCmd();
  const fpRes = spawnSync(fpBin, [...fpArgs, '-version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  const ffprobeLine = fpRes.status === 0 ? String(fpRes.stdout ?? '').split(/\r?\n/)[0]?.trim() ?? null : null;

  let windowsOs = null;
  let windowsGpus = [];
  if (process.platform === 'win32') {
    const osRes = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber | ConvertTo-Json -Compress',
    ], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (osRes.status === 0) {
      try { windowsOs = JSON.parse(String(osRes.stdout ?? '').trim()); } catch { windowsOs = null; }
    }
    const gpuRes = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,DriverDate,AdapterRAM,VideoProcessor | ConvertTo-Json -Compress',
    ], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (gpuRes.status === 0) {
      try {
        const parsed = JSON.parse(String(gpuRes.stdout ?? '').trim());
        windowsGpus = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
      } catch { windowsGpus = []; }
    }
  }

  let chromeWebgl = null;
  const webglRes = spawnSync(process.execPath, [path.join(root, 'scripts', 'anim.mjs'), 'gpu', '_calib'], {
    cwd: root, encoding: 'utf8', timeout: 60000, windowsHide: true,
  });
  if (webglRes.status === 0) {
    chromeWebgl = extractFirstJsonObject(webglRes.stdout);
  }

  return {
    capturedAt: new Date().toISOString(),
    hostname: os.hostname(),
    os: {
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      version: os.version(),
      windowsOs,
    },
    node: process.version,
    npm: npmVersion,
    remotion,
    chrome: {
      executable: browserExe,
      version: browserVersion,
    },
    ffmpeg: ffmpegLine,
    ffprobe: ffprobeLine,
    windowsGpus,
    chromeWebgl,
  };
}

/** 用 ffprobe 提取完整视频/音频流基线规格。 */
export function probeMp4Spec(mp4Path) {
  const [fpBin, ...fpArgs] = ffprobeCmd();
  const r = spawnSync(fpBin, [
    ...fpArgs, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', mp4Path,
  ], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (r.status !== 0) {
    throw new Error(`ffprobe 失败（${mp4Path}）：${(r.stderr || r.stdout || '').trim()}`);
  }
  const j = JSON.parse(r.stdout);
  const streams = Array.isArray(j.streams) ? j.streams : [];
  const v = streams.find((s) => s.codec_type === 'video');
  const audioStreams = streams.filter((s) => s.codec_type === 'audio');
  if (!v) throw new Error(`${mp4Path} 缺少视频流`);
  const [rn, rd] = String(v.r_frame_rate || v.avg_frame_rate || '0/1').split('/').map(Number);
  const fps = rd ? rn / rd : 0;
  return {
    width: v.width,
    height: v.height,
    fps,
    rFrameRate: v.r_frame_rate,
    nbFrames: v.nb_frames != null ? Number(v.nb_frames) : null,
    duration: Number(v.duration ?? j.format?.duration ?? 0),
    codecName: v.codec_name ?? null,
    pixFmt: v.pix_fmt ?? null,
    audioStreamCount: audioStreams.length,
    formatName: j.format?.format_name ?? null,
    sizeBytes: statSync(mp4Path).size,
  };
}

function buildBundleReadme(manifest) {
  const gpuStr = manifest.machineA?.chromeWebgl?.renderer || '未知 WebGL 渲染器';
  return [
    '# R5 跨 GPU / 驱动环境复现对照包',
    '',
    `- **生成时间**：\`${manifest.createdAt}\``,
    `- **Machine A WebGL**：\`${gpuStr}\``,
    `- **Machine A Chrome**：\`${manifest.machineA?.chrome?.version ?? 'unknown'}\``,
    `- **Machine A Node / Remotion**：\`${manifest.machineA?.node}\` / \`remotion@${manifest.machineA?.remotion?.remotion ?? 'unknown'}\``,
    '',
    '## 在第二台机器（Machine B）上运行',
    '',
    '1. 检出相同仓库提交并安装依赖：',
    '   ```sh',
    '   npm install',
    '   ```',
    '2. 确认本机已安装 Chrome / Edge 与 `ffmpeg` / `ffprobe`（Windows 下若无全局 PATH 可设 `ANIM_FFMPEG` / `ANIM_FFPROBE`）。',
    '3. 将本目录放在 `out/_remotion-migration/acceptance/cross-gpu-bundle/`（或通过 `--bundle <路径>` 指定），然后执行一键复跑：',
    '   ```sh',
    '   node tools/cross-gpu-repro.mjs',
    '   ```',
    '   可选参数：',
    '   - `--skip-video`：仅复核固定帧 PNG（跳过代表性草稿 MP4，视频项记为 `SKIPPED`）。',
    '   - `--out-dir <目录>`：指定独立输出目录（不可指向本目录或 `baseline/`）。',
    '4. 运行完成后将生成的 `runs/<run-id>/repro-report.json` 与 `runs/<run-id>/repro-report.md` 回传即可。',
    '',
    '## 判定说明',
    '',
    '- **同机同会话乱序重复帧**：同一会话内重复渲染的同帧（如 `paperfold` `[204, 48]`、`_three-lab` `[339, 120]`）必须 **SHA-256 逐字节一致**。',
    '- **跨驱动对比**：允许不同 GPU / ANGLE 驱动存在微小栅格化四舍五入差异（PNG 容差默认 `mean <= 3.0` 且 `d > 8` 占比 `<= 2.0%`；草稿 MP4 关键帧容差 `mean <= 6.0` 且 `d > 16` 占比 `<= 5.0%`），同时校验 `ffprobe` 流参数一致。',
    '- **R2 音频说明**：`paperfold` 代表性草稿固定携带 `--noaudio`（`audioStreams: 0`），因为真实 `paperfold-vo.mp3` / `paperfold-mix.mp3` 仍保持阻塞。',
    '',
  ].join('\n');
}

function renderReportMarkdown(report) {
  const lines = [
    '# R5 跨 GPU / 驱动对比报告',
    '',
    `- **运行 ID**：\`${report.runId}\``,
    `- **时间**：\`${report.createdAt}\``,
    `- **结论**：**${report.summary.passed ? 'PASS' : 'FAIL'}**`,
    `- **Machine A WebGL**：\`${report.machineA?.chromeWebgl?.renderer ?? 'unknown'}\``,
    `- **Machine B WebGL**：\`${report.machineB?.chromeWebgl?.renderer ?? 'unknown'}\``,
    `- **Machine B Chrome / Node**：\`${report.machineB?.chrome?.version ?? 'unknown'}\` / \`${report.machineB?.node}\``,
    '',
    '## 汇总',
    '',
    `- 固定帧总数：${report.summary.totalFrames}（\`exact\`: ${report.summary.exactFrames}, \`within-tolerance\`: ${report.summary.withinToleranceFrames}, \`diverged\`: ${report.summary.divergedFrames}, 同会话乱序稳定性失败: ${report.summary.determinismFailures}）`,
    `- 代表性草稿视频：${report.summary.totalVideos}（通过: ${report.summary.passedVideos}, 失败: ${report.summary.failedVideos}, SKIPPED: ${report.summary.skippedVideos}）`,
    '',
    '## 固定帧对照明细',
    '',
    '| Case | 帧号 | 状态 | 同会话重复一致 | 像素差分 | 备注 |',
    '|---|---:|---|---|---|---|',
  ];
  for (const c of report.cases) {
    for (const f of c.frames) {
      const diffTxt = f.diff
        ? `max=${f.diff.max}, mean=${f.diff.mean.toFixed(3)}, overTol=${f.diff.overTolPct.toFixed(3)}%`
        : '—';
      lines.push(`| ${c.id} | ${f.frame} | ${f.status} | ${f.determinismOk ? '✓' : '✗'} | ${diffTxt} | ${f.reason} |`);
    }
  }
  lines.push('', '## 代表性草稿 MP4 明细', '', '| Video | 状态 | ffprobe 一致 | 关键帧状态 | 备注 |', '|---|---|---|---|---|');
  for (const v of report.videos) {
    if (v.status === 'SKIPPED') {
      lines.push(`| ${v.id} | SKIPPED | — | — | ${v.note} |`);
      continue;
    }
    const kfSummary = (v.keyframes || []).map((k) => `f${k.frame}:${k.status}(mean=${k.diff ? k.diff.mean.toFixed(2) : '?'})`).join(', ');
    lines.push(`| ${v.id} | ${v.status} | ${v.ffprobeMatch?.ok ? '✓' : '✗ ' + (v.ffprobeMatch?.mismatches ?? []).join('; ')} | ${kfSummary || '—'} | ${v.note} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function parseCliArgs(argv) {
  const opts = new Map();
  const flags = new Set(['init-baseline', 'run', 'skip-video', 'verify-only', 'strict-video']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`未知位置参数：${a}`);
    const [rawKey, inline] = a.slice(2).split(/=(.*)/s, 2);
    if (flags.has(rawKey) && inline === undefined) {
      opts.set(rawKey, true);
    } else {
      const val = inline ?? argv[++i];
      if (val == null || val.startsWith('--')) throw new Error(`--${rawKey} 需要参数值`);
      opts.set(rawKey, val);
    }
  }
  return opts;
}

function setupWorkspaceTemp(tmpOpt) {
  const tmpDir = path.resolve(ROOT, tmpOpt ?? DEFAULT_TMP);
  mkdirSync(tmpDir, { recursive: true });
  process.env.TEMP = tmpDir;
  process.env.TMP = tmpDir;
  process.env.TMPDIR = tmpDir;
  return tmpDir;
}

async function initBaseline(bundleDir, tolerances) {
  mkdirSync(path.join(bundleDir, 'baseline', 'frames'), { recursive: true });
  mkdirSync(path.join(bundleDir, 'baseline', 'videos'), { recursive: true });

  console.log('· 采集 Machine A 环境与 GPU / WebGL 信息…');
  const machineA = collectEnvironment(ROOT);

  const manifestCases = [];
  for (const c of CASES) {
    console.log(`· 渲染基准固定帧 [${c.id}] (${c.compositionId}, props=${JSON.stringify(c.inputProps)})…`);
    const caseDir = path.join(bundleDir, 'baseline', 'frames', c.id);
    mkdirSync(caseDir, { recursive: true });
    const session = await openRemotionSession({ compositionId: c.compositionId, inputProps: c.inputProps });
    const baselines = {};
    const takes = [];
    try {
      for (let i = 0; i < c.frameSequence.length; i++) {
        const frame = c.frameSequence[i];
        const key = String(frame);
        if (!baselines[key]) {
          const outFile = path.join(caseDir, `f_${frame}.png`);
          await session.renderFrame({ frame, scale: 1, output: outFile });
          const sha256 = sha256File(outFile);
          baselines[key] = {
            frame,
            baselinePath: path.relative(bundleDir, outFile).split(path.sep).join('/'),
            sha256,
            sizeBytes: statSync(outFile).size,
          };
          takes.push({ idx: i, frame, sha256, determinismOk: true });
        } else {
          const repeatOut = path.join(caseDir, `_verify_repeat_${i}_f_${frame}.png`);
          await session.renderFrame({ frame, scale: 1, output: repeatOut });
          const sha256 = sha256File(repeatOut);
          const determinismOk = sha256 === baselines[key].sha256;
          if (!determinismOk) {
            throw new Error(`Machine A 基准同会话乱序重复帧不一致：${c.id} frame=${frame}`);
          }
          takes.push({ idx: i, frame, sha256, determinismOk });
        }
      }
    } finally {
      await session.close();
    }
    // 清理临时重复校验 PNG，仅保留正式基准 PNG
    for (let i = 0; i < c.frameSequence.length; i++) {
      const f = c.frameSequence[i];
      const repeatOut = path.join(caseDir, `_verify_repeat_${i}_f_${f}.png`);
      if (existsSync(repeatOut)) {
        const { rmSync } = await import('node:fs');
        rmSync(repeatOut, { force: true });
      }
    }
    manifestCases.push({
      id: c.id,
      task: c.task,
      compositionId: c.compositionId,
      kind: c.kind,
      width: c.width,
      height: c.height,
      fps: c.fps,
      inputProps: c.inputProps,
      frameSequence: c.frameSequence,
      note: c.note,
      baselines,
      initRepeatChecks: takes,
    });
  }

  const manifestVideos = [];
  for (const v of VIDEOS) {
    const outPath = path.join(bundleDir, 'baseline', 'videos', `${v.id}.mp4`);
    console.log(`· 渲染基准代表性草稿 [${v.id}]…`);
    const res = spawnSync(process.execPath, [
      path.join(ROOT, 'scripts', 'anim.mjs'), ...v.args, '--out', outPath,
    ], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
    if (res.status !== 0) {
      throw new Error(`基准草稿渲染失败：${v.id} (exit ${res.status})`);
    }
    const ffprobe = probeMp4Spec(outPath);
    if (v.audioExpected === false && ffprobe.audioStreamCount !== 0) {
      throw new Error(`安全门失败：${v.id} 期望无音轨，实际探测到 ${ffprobe.audioStreamCount} 条音轨`);
    }
    manifestVideos.push({
      id: v.id,
      task: v.task,
      args: v.args,
      checkFrames: v.checkFrames,
      audioExpected: v.audioExpected,
      note: v.note,
      baselinePath: path.relative(bundleDir, outPath).split(path.sep).join('/'),
      sha256: sha256File(outPath),
      ffprobe,
    });
  }

  const manifest = {
    schema: 'cross-gpu-bundle/1',
    createdAt: new Date().toISOString(),
    machineA,
    tolerances,
    cases: manifestCases,
    videos: manifestVideos,
  };
  validateManifest(manifest);
  writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  writeFileSync(path.join(bundleDir, 'README.md'), buildBundleReadme(manifest), 'utf8');
  console.log(`✓ 已生成 R5 基准对照包：${bundleDir}`);
}

async function runComparison(bundleDir, { outDirOpt, skipVideo, verifyOnly, strictVideo, tolerances }) {
  const manifestPath = path.join(bundleDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`找不到基准清单：${manifestPath}（请先运行 --init-baseline 或确认 --bundle 路径）`);
  }
  const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const machineB = collectEnvironment(ROOT);
  const gpuSlug = machineB.chromeWebgl?.renderer || machineB.windowsGpus?.[0]?.Name || os.hostname();
  const runDir = resolveSafeRunDir(bundleDir, outDirOpt, gpuSlug);
  mkdirSync(path.join(runDir, 'frames'), { recursive: true });
  mkdirSync(path.join(runDir, 'videos'), { recursive: true });

  const caseReports = [];
  const frameRecordsByCase = new Map();

  if (!verifyOnly) {
    for (const c of manifest.cases) {
      console.log(`· 复跑固定帧 [${c.id}] (${c.compositionId})…`);
      const caseOutDir = path.join(runDir, 'frames', c.id);
      mkdirSync(caseOutDir, { recursive: true });
      const session = await openRemotionSession({ compositionId: c.compositionId, inputProps: c.inputProps ?? {} });
      const firstTakeByFrame = new Map();
      const takes = [];
      try {
        for (let i = 0; i < c.frameSequence.length; i++) {
          const frame = c.frameSequence[i];
          const key = String(frame);
          const isRepeat = firstTakeByFrame.has(key);
          const outFile = path.join(caseOutDir, isRepeat ? `f_${frame}_take${i}.png` : `f_${frame}.png`);
          await session.renderFrame({ frame, scale: 1, output: outFile });
          const sha256 = sha256File(outFile);
          if (!isRepeat) {
            firstTakeByFrame.set(key, { frame, outFile, sha256 });
            takes.push({ take: i, frame, sha256, repeatOf: null, determinismOk: true });
          } else {
            const first = firstTakeByFrame.get(key);
            takes.push({
              take: i,
              frame,
              sha256,
              repeatOf: 0,
              determinismOk: sha256 === first.sha256,
            });
          }
        }
      } finally {
        await session.close();
      }
      frameRecordsByCase.set(c.id, { firstTakeByFrame, takes });
    }
  } else {
    for (const c of manifest.cases) {
      const caseOutDir = path.join(runDir, 'frames', c.id);
      const firstTakeByFrame = new Map();
      const takes = [];
      for (let i = 0; i < c.frameSequence.length; i++) {
        const frame = c.frameSequence[i];
        const key = String(frame);
        const isRepeat = firstTakeByFrame.has(key);
        const outFile = path.join(caseOutDir, isRepeat ? `f_${frame}_take${i}.png` : `f_${frame}.png`);
        if (!existsSync(outFile)) throw new Error(`--verify-only 缺少帧文件：${outFile}`);
        const sha256 = sha256File(outFile);
        if (!isRepeat) {
          firstTakeByFrame.set(key, { frame, outFile, sha256 });
          takes.push({ take: i, frame, sha256, repeatOf: null, determinismOk: true });
        } else {
          const first = firstTakeByFrame.get(key);
          takes.push({ take: i, frame, sha256, repeatOf: 0, determinismOk: sha256 === first.sha256 });
        }
      }
      frameRecordsByCase.set(c.id, { firstTakeByFrame, takes });
    }
  }

  let totalFrames = 0;
  let exactFrames = 0;
  let withinToleranceFrames = 0;
  let divergedFrames = 0;
  let determinismFailures = 0;

  for (const c of manifest.cases) {
    const rec = frameRecordsByCase.get(c.id);
    const uniqueFrames = [...new Set(c.frameSequence)];
    const frameResults = [];
    for (const frame of uniqueFrames) {
      totalFrames++;
      const baseMeta = c.baselines[String(frame)];
      const basePath = resolveBundleRelPath(bundleDir, baseMeta.baselinePath);
      const curTake = rec.firstTakeByFrame.get(String(frame));
      const repeatFailures = rec.takes.filter((t) => t.frame === frame && !t.determinismOk);
      const determinismOk = repeatFailures.length === 0;
      if (!determinismOk) determinismFailures += repeatFailures.length;

      const sha256Match = curTake.sha256 === baseMeta.sha256;
      let diff = { max: 0, mean: 0, overTolPct: 0, over16Pct: 0, over32Pct: 0, over64Pct: 0 };
      if (!sha256Match) {
        const [baseRgba, curRgba] = await Promise.all([
          decodePngRgba(readFileSync(basePath), c.width, c.height),
          decodePngRgba(readFileSync(curTake.outFile), c.width, c.height),
        ]);
        diff = computeRgbaDiffWithTol(baseRgba, curRgba, tolerances.tol);
      }
      const cls = classifyPngComparison({ sha256Match, diff }, tolerances);
      if (cls.status === 'exact') exactFrames++;
      else if (cls.status === 'within-tolerance') withinToleranceFrames++;
      else divergedFrames++;

      frameResults.push({
        frame,
        baselineSha256: baseMeta.sha256,
        actualSha256: curTake.sha256,
        sha256Match,
        determinismOk,
        diff,
        status: cls.status,
        pass: cls.pass && determinismOk,
        reason: cls.reason,
      });
    }
    caseReports.push({
      id: c.id,
      compositionId: c.compositionId,
      inputProps: c.inputProps ?? {},
      takes: rec.takes,
      frames: frameResults,
    });
  }

  const videoReports = [];
  let passedVideos = 0;
  let failedVideos = 0;
  let skippedVideos = 0;

  for (const v of manifest.videos) {
    if (skipVideo) {
      skippedVideos++;
      videoReports.push({ id: v.id, status: 'SKIPPED', pass: !strictVideo, note: `--skip-video 跳过（${v.note}）` });
      continue;
    }
    const curVideoPath = path.join(runDir, 'videos', `${v.id}.mp4`);
    if (!verifyOnly) {
      console.log(`· 复跑代表性草稿 [${v.id}]…`);
      const res = spawnSync(process.execPath, [
        path.join(ROOT, 'scripts', 'anim.mjs'), ...v.args, '--out', curVideoPath,
      ], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
      if (res.status !== 0) {
        failedVideos++;
        videoReports.push({ id: v.id, status: 'FAILED', pass: false, note: `渲染退出码 ${res.status}`, keyframes: [] });
        continue;
      }
    } else if (!existsSync(curVideoPath)) {
      failedVideos++;
      videoReports.push({ id: v.id, status: 'FAILED', pass: false, note: `缺少视频 ${curVideoPath}`, keyframes: [] });
      continue;
    }

    const baseVideoPath = resolveBundleRelPath(bundleDir, v.baselinePath);
    const actualProbe = probeMp4Spec(curVideoPath);
    const ffprobeMatch = compareFfprobeSpecs(v.ffprobe, actualProbe);
    const keyframes = [];
    let kfAllPass = true;
    for (const frameIdx of v.checkFrames) {
      const [baseRgba, curRgba] = await Promise.all([
        ffmpegFrame(baseVideoPath, frameIdx, v.ffprobe.width, v.ffprobe.height, { flip: false }),
        ffmpegFrame(curVideoPath, frameIdx, v.ffprobe.width, v.ffprobe.height, { flip: false }),
      ]);
      const diff = baseRgba && curRgba ? computeRgbaDiffWithTol(baseRgba, curRgba, tolerances.tol) : null;
      const sha256Match = Boolean(diff && diff.max === 0);
      const cls = classifyVideoComparison({ sha256Match, diff }, tolerances);
      if (!cls.pass) kfAllPass = false;
      keyframes.push({ frame: frameIdx, ...cls, diff });
    }
    const pass = ffprobeMatch.ok && kfAllPass;
    if (pass) passedVideos++;
    else failedVideos++;
    videoReports.push({
      id: v.id,
      status: pass ? 'PASS' : 'FAIL',
      pass,
      note: v.note,
      baselineSha256: v.sha256,
      actualSha256: sha256File(curVideoPath),
      ffprobeExpected: v.ffprobe,
      ffprobeActual: actualProbe,
      ffprobeMatch,
      keyframes,
    });
  }

  const passed = divergedFrames === 0
    && determinismFailures === 0
    && failedVideos === 0
    && (!strictVideo || skippedVideos === 0);

  const report = {
    schema: 'cross-gpu-report/1',
    runId: path.basename(runDir),
    createdAt: new Date().toISOString(),
    bundleDir,
    runDir,
    tolerances,
    machineA: manifest.machineA,
    machineB,
    summary: {
      passed,
      totalFrames,
      exactFrames,
      withinToleranceFrames,
      divergedFrames,
      determinismFailures,
      totalVideos: manifest.videos.length,
      passedVideos,
      failedVideos,
      skippedVideos,
    },
    cases: caseReports,
    videos: videoReports,
  };

  writeFileSync(path.join(runDir, 'repro-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeFileSync(path.join(runDir, 'repro-report.md'), renderReportMarkdown(report), 'utf8');
  console.log(`· 报告已写入：${runDir}`);
  console.log(`  结论：${passed ? 'PASS' : 'FAIL'}（exact=${exactFrames}/${totalFrames}, withinTol=${withinToleranceFrames}, diverged=${divergedFrames}, detFail=${determinismFailures}, videos=${passedVideos}/${manifest.videos.length}, skipped=${skippedVideos}）`);
  if (!passed) process.exitCode = 1;
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const bundleDir = path.resolve(opts.get('bundle') ?? DEFAULT_BUNDLE);
  setupWorkspaceTemp(opts.get('tmp-dir'));
  const tolerances = {
    tol: Number(opts.get('tol') ?? DEFAULT_TOLERANCES.tol),
    pngMeanTol: Number(opts.get('png-mean-tol') ?? DEFAULT_TOLERANCES.pngMeanTol),
    pngOverTolPct: Number(opts.get('png-over-tol') ?? DEFAULT_TOLERANCES.pngOverTolPct),
    videoMeanTol: Number(opts.get('video-mean-tol') ?? DEFAULT_TOLERANCES.videoMeanTol),
    videoOver16Pct: Number(opts.get('video-over16-tol') ?? DEFAULT_TOLERANCES.videoOver16Pct),
  };

  if (opts.has('init-baseline')) {
    await initBaseline(bundleDir, tolerances);
    return;
  }
  await runComparison(bundleDir, {
    outDirOpt: opts.get('out-dir') ?? null,
    skipVideo: opts.has('skip-video'),
    verifyOnly: opts.has('verify-only'),
    strictVideo: opts.has('strict-video'),
    tolerances,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exit(1);
  });
}
