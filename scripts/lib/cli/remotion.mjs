import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { engineSig, sigOf, stampPath, taskSig, writeStamp } from '../render-stamp.mjs';
import { evaluateRegisteredTask, readRegistry } from '../remotion-registry.mjs';
import { log, warn } from './log.mjs';
import { checkTimestamps, checkVideoFile, ffmpegCmd, runFfmpeg } from './media.mjs';
import { ROOT, taskOut } from './paths.mjs';
import { extractRenderer, REMOTION_SUPPORTED_CMDS } from './renderer.mjs';
import { children } from './session.mjs';

const require = createRequire(import.meta.url);
// Remotion 子包：入口与 remotion.config.ts 都在 packages/remotion/，CLI 以该目录为 cwd 起进程。
const RM_PKG = path.join(ROOT, 'packages', 'remotion');
const entry = path.join(RM_PKG, 'index.ts');

export { extractRenderer };

export function getRegisteredTask(task) {
  const reg = readRegistry(ROOT);
  const meta = task ? reg.tasks[task] : null;
  if (!meta) {
    throw new Error(`任务 ${task ?? '（未指定）'} 未验证 Remotion 出片。当前支持 ${Object.keys(reg.tasks).join('、')}，旧任务使用 --renderer legacy。`);
  }
  return { meta, reg };
}

export function remotionCommand(command, renderer, args = []) {
  if (renderer !== 'remotion' || command === 'queue') return false;
  if (command === 'qa') {
    return true;
  }
  if (REMOTION_SUPPORTED_CMDS.has(command)) return true;
  throw new Error(`${command} 暂不支持 --renderer remotion`);
}

function parseArgs(command, args) {
  const still = command === 'still';
  const values = new Set(still ? ['t', 'out', 'scale', 'samples'] : ['from', 'to', 'out', 'scale', 'crf', 'samples', 'fps', 'vcodec']);
  const flags = new Set(still ? [] : ['draft', 'noaudio']);
  if (command === 'video') { flags.add('force'); flags.add('dry-run'); }
  const options = new Map();
  let task;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) {
      if (task) throw new Error(`多余参数 ${arg}`);
      task = arg;
      continue;
    }
    const [flag, inline] = arg.split(/=(.*)/s, 2);
    const name = flag === '-o' ? 'out' : flag === '-t' ? 't' : flag.startsWith('--') ? flag.slice(2) : flag;
    if (options.has(name)) throw new Error(`${flag} 只能指定一次`);
    if (command === 'video' && name === 'segments') {
      const value = args[i + 1];
      options.set(name, inline ?? (value && !value.startsWith('-') ? args[++i] : '15'));
    } else if (flags.has(name) && inline === undefined) {
      options.set(name, true);
    } else if (values.has(name)) {
      const value = inline ?? args[++i];
      if (value == null || value.trim() === '' || value.startsWith('--')) {
        throw new Error(`${flag} 需要一个值`);
      }
      options.set(name, value);
    } else {
      throw new Error(`Remotion 的 ${command} 暂不支持 ${flag}。可使用 --renderer legacy 运行原有命令。`);
    }
  }
  const { meta } = getRegisteredTask(task);
  return { task, id: meta.composition, meta, options };
}

/** Remotion 的帧区间含末帧，CLI 参数表示秒的左闭右开区间。 */
export function videoFrameRange(from, to, fps, total) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to > total / fps) {
    throw new Error(`--from/--to 要指定影片内的非空时段（可用 0 到 ${total / fps}s）`);
  }
  const start = Math.round(from * fps);
  const end = Math.round(to * fps) - 1;
  if (start > end) throw new Error('指定的时间段不足一帧');
  return [start, end];
}

export function remotionVideoName(task, { short, draft, from, to, duration }) {
  const stem = short ? `shot_${from}-${to}` : task;
  const range = !short && (from !== 0 || to !== duration) ? `.${from}-${to}` : '';
  return `${stem}.remotion${draft ? '.draft' : ''}${range}.mp4`;
}

/** Remotion's resumable chunks live beside the output, without an extra `.remotion` suffix. */
export function remotionPartsDirectory(output) {
  const stem = path.basename(output).replace(/\.mp4$/i, '');
  return path.join(path.dirname(output), `${stem}.parts`);
}

/** Apply render-mode defaults while preserving an explicit --samples value. */
export function resolveSamples(meta, { draft = false, samplesOpt } = {}) {
  const defaultSamples = meta.samples ?? (meta.eval === 'config-only' ? 1 : 'auto');
  if (samplesOpt === undefined && draft && meta.eval !== 'config-only') return 1;
  return samplesOpt !== undefined ? (samplesOpt === 'auto' ? 'auto' : Number(samplesOpt)) : defaultSamples;
}

/** EngineBridge renders logical dimensions then scales the resulting bitmap. */
export function remotionScaleWarning(meta, scale) {
  return scale > 1 && meta.eval !== 'config-only'
    ? `Remotion 下 --scale ${scale} 只是放大位图，不是真 4K；要真 4K 用 --renderer legacy --scale ${scale}`
    : null;
}

/** 原生样片是硬切。长镜头也可切，遇到镜头边界则提前结束当前块。 */
export function nativeChunkRanges(first, last, framesPerChunk, segments) {
  const boundaries = segments.map((segment) => segment.startFrame).filter((frame) => frame > first && frame <= last);
  boundaries.push(last + 1);
  const chunks = [];
  let start = first;
  for (const boundary of boundaries) {
    while (start < boundary) {
      const next = Math.min(start + framesPerChunk, boundary);
      chunks.push([start, next - 1]);
      start = next;
    }
  }
  return chunks;
}

/**
 * 交叠感知的分块：切点只落在**硬切边界**（上一段 end == 下一段 start），
 * 交叠窗（overlap > 0）内部不许切 —— 转场帧依赖前后两段同帧合成，拆开就黑闪/丢转场。
 * 若窗口内没有硬切边界，整段作为一块（不强行按 framesPerChunk 切进交叠区）。
 * segments 需带 startFrame/endFrame。返回 [start, end] 含末帧的块列表。
 */
export function overlapAwareChunkRanges(first, last, framesPerChunk, segments) {
  const sorted = [...segments].sort((a, b) => a.startFrame - b.startFrame);
  // 交叠窗 [ovStart, ovEnd)：切点不许落在窗内（ovStart < cut < ovEnd）
  const overlapWindows = [];
  const hardCuts = new Set();
  for (let i = 1; i < sorted.length; i++) {
    const ovStart = sorted[i].startFrame, ovEnd = sorted[i - 1].endFrame;
    if (ovStart < ovEnd) overlapWindows.push([ovStart, ovEnd]);
    else if (ovStart === ovEnd) hardCuts.add(ovStart);
  }
  const inOverlap = (cut) => overlapWindows.some(([os, oe]) => cut > os && cut < oe);
  // 把候选切点移出交叠窗：优先拉到窗前（整窗进下一块）
  const safeCut = (cut) => {
    for (const [os, oe] of overlapWindows) {
      if (cut > os && cut < oe) return os;
    }
    return cut;
  };
  const boundaries = [...hardCuts].filter((f) => f > first && f <= last).sort((a, b) => a - b);
  boundaries.push(last + 1);
  const chunks = [];
  let start = first;
  for (const boundary of boundaries) {
    while (start < boundary) {
      let next = Math.min(start + framesPerChunk, boundary);
      next = safeCut(next);
      if (next <= start) {
        // 窗前拉回导致不前进：整窗吞进当前块（跳到窗尾）
        const win = overlapWindows.find(([os, oe]) => start >= os && start < oe);
        next = win ? Math.min(win[1], boundary) : Math.min(start + framesPerChunk, boundary);
      }
      chunks.push([start, next - 1]);
      start = next;
    }
  }
  return chunks;
}

export function localBrowser() {
  if (process.env.ANIM_REMOTION_BROWSER_EXECUTABLE) return process.env.ANIM_REMOTION_BROWSER_EXECUTABLE;
  if (process.platform !== 'win32') return undefined;
  const edge = process.env.ANIM_CHANNEL === 'msedge';
  const relative = edge ? 'Microsoft/Edge/Application/msedge.exe' : 'Google/Chrome/Application/chrome.exe';
  return [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map((root) => path.join(root, relative)).find(existsSync);
}

let cachedBinariesDir;

function findSystemBinary(cmdName, explicitPath) {
  if (explicitPath && existsSync(explicitPath)) {
    try { return realpathSync(explicitPath); } catch { return explicitPath; }
  }
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const r = spawnSync(locator, [cmdName], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (r.status !== 0) return null;
  for (const rawLine of String(r.stdout ?? '').split(/\r?\n/)) {
    const p = rawLine.trim();
    if (p && existsSync(p)) {
      try { return realpathSync(p); } catch { return p; }
    }
  }
  return null;
}

/**
 * 探测 Remotion 内置 ffmpeg 是否可用；不可用时把系统 ffmpeg/ffprobe 同步到临时目录并返回。
 * 健康环境返回 null（零开销）。
 */
export function resolveRemotionBinariesDir() {
  if (cachedBinariesDir !== undefined) return cachedBinariesDir;
  const exe = (n) => (process.platform === 'win32' ? `${n}.exe` : n);
  const pkgCandidates = process.platform === 'win32'
    ? ['@remotion/compositor-win32-x64-msvc']
    : process.platform === 'darwin'
      ? (process.arch === 'arm64' ? ['@remotion/compositor-darwin-arm64'] : ['@remotion/compositor-darwin-x64'])
      : (process.arch === 'arm64'
        ? ['@remotion/compositor-linux-arm64-gnu', '@remotion/compositor-linux-arm64-musl']
        : ['@remotion/compositor-linux-x64-gnu', '@remotion/compositor-linux-x64-musl']);

  let bundledDir = null;
  for (const pkg of pkgCandidates) {
    try {
      const d = require(pkg)?.dir;
      if (d && existsSync(d)) { bundledDir = d; break; }
    } catch { /* 忽略未安装的平台包 */ }
  }
  if (!bundledDir) { cachedBinariesDir = null; return null; }

  const bundledFfmpeg = path.join(bundledDir, exe('ffmpeg'));
  if (existsSync(bundledFfmpeg)) {
    const probe = spawnSync(bundledFfmpeg, ['-version'], { cwd: bundledDir, timeout: 5000, windowsHide: true });
    if (probe.status === 0) { cachedBinariesDir = null; return null; }
  }

  const ffParts = ffmpegCmd();
  const explicitFfmpeg = ffParts.length === 1 && path.isAbsolute(ffParts[0]) ? ffParts[0] : null;
  const sysFfmpeg = findSystemBinary(exe('ffmpeg'), explicitFfmpeg);
  if (!sysFfmpeg) { cachedBinariesDir = null; return null; }
  const sysProbe = spawnSync(sysFfmpeg, ['-version'], { timeout: 5000, windowsHide: true });
  if (sysProbe.status !== 0) { cachedBinariesDir = null; return null; }

  const explicitProbe = process.env.ANIM_FFPROBE && existsSync(process.env.ANIM_FFPROBE) ? process.env.ANIM_FFPROBE : null;
  const sysFfprobe = findSystemBinary(exe('ffprobe'), explicitProbe);

  const dir = path.join(os.tmpdir(), 'ai-anim-remotion-bin');
  mkdirSync(dir, { recursive: true });
  const syncBin = (src, dstName) => {
    if (!src || !existsSync(src)) return;
    const dst = path.join(dir, dstName);
    const srcSize = statSync(src).size;
    if (existsSync(dst) && statSync(dst).size === srcSize) return;
    rmSync(dst, { force: true });
    try { linkSync(src, dst); } catch { copyFileSync(src, dst); }
  };
  syncBin(sysFfmpeg, exe('ffmpeg'));
  syncBin(sysFfprobe, exe('ffprobe'));
  syncBin(path.join(bundledDir, exe('remotion')), exe('remotion'));

  log(`ℹ Remotion 内置 ffmpeg 不可用，已切换系统 ffmpeg（${dir}）`);
  cachedBinariesDir = dir;
  return cachedBinariesDir;
}

function runCli(args, onFrame = () => {}) {
  const manifest = require.resolve('@remotion/cli/package.json');
  const { bin } = require(manifest);
  const env = { ...process.env, CI: '1', FORCE_COLOR: '0' };
  const browser = localBrowser();
  const browserArgs = browser ? [`--browser-executable=${browser}`] : [];
  const binDir = args[0] === 'render' ? resolveRemotionBinariesDir() : null;
  const binArgs = binDir ? [`--binaries-directory=${binDir}`] : [];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.resolve(path.dirname(manifest), bin.remotion), ...args, ...browserArgs, ...binArgs, '--log=warn',
    ], { cwd: RM_PKG, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    children.add(child);
    const recent = [];
    const lines = [child.stdout, child.stderr].map((input) => createInterface({ input }));
    for (const stream of lines) stream.on('line', (line) => {
      const rendered = /\bRendered\s+([\d,]+)\/[\d,]+/.exec(line);
      if (rendered) onFrame(Number(rendered[1].replaceAll(',', '')));
      else if (line.trim() && !/^(?:Encoded|Bundling|Copying)\b/.test(line.trim())) {
        recent.push(line);
        if (recent.length > 15) recent.shift();
      }
    });
    child.once('error', (err) => {
      children.delete(child);
      reject(err);
    });
    child.once('close', (code, signal) => {
      children.delete(child);
      for (const stream of lines) stream.close();
      if (code === 0) resolve();
      else reject(new Error(`Remotion 出片失败（${signal ?? code}）\n${recent.join('\n')}`));
    });
  });
}

async function renderFile(output, render) {
  mkdirSync(path.dirname(output), { recursive: true });
  // AstrBot 跳过 _staging…，并在出片与验证结束后才读正式路径。
  const staging = mkdtempSync(path.join(path.dirname(output), '_staging-remotion-'));
  const pending = path.join(staging, path.basename(output));
  try {
    await render(pending);
    renameSync(pending, output);
  } finally {
    try {
      rmSync(pending, { force: true });
      rmdirSync(staging);
    } catch (err) {
      warn(`无法清理 Remotion 临时文件 ${staging}：${err.message}`);
    }
  }
}

function frameProgress(total) {
  let last = -1;
  let at = 0;
  return (done) => {
    if (done <= last || done > total) return;
    const now = Date.now();
    if (last < 0 || done === total || now - at >= 1000) {
      log(`渲染中 ${done}/${total} 帧`);
      last = done;
      at = now;
    }
  };
}

function sourceFingerprint(task) {
  // 子包目录（packages/remotion）是渲染源；public/ 只留 fonts 等静态件。
  const directory = path.join(ROOT, 'packages', 'remotion');
  const publicDir = path.join(ROOT, 'public');
  const code = readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((rel) => /\.(tsx?|m?js|css|json)$/.test(rel) && !rel.includes('node_modules'))
    .map((rel) => path.join(directory, rel));
  const assets = readdirSync(publicDir, { recursive: true, encoding: 'utf8' })
    .map((rel) => path.join(publicDir, rel)).filter((file) => statSync(file).isFile());
  const files = [...code, ...assets, path.join(ROOT, 'package-lock.json')];
  return [engineSig(ROOT), taskSig(ROOT, task), sigOf(ROOT, files)];
}

async function renderParts(output, { task, id, ranges, fps, scale, crf, samples, force, progress, verify, render, publish }) {
  const sources = sourceFingerprint(task).join(':');
  const browser = localBrowser();
  const browserInfo = browser && existsSync(browser) ? [browser, statSync(browser).mtimeMs] : [browser ?? 'auto'];
  const key = createHash('sha256').update(JSON.stringify([
    1, process.platform, process.arch, sources, browserInfo, id, ranges, fps, scale, crf, samples,
  ])).digest('hex').slice(0, 20);
  const cache = path.join(remotionPartsDirectory(output), key);
  const files = [];
  let completed = 0;
  log(`分 ${ranges.length} 块渲染（Remotion，已验证分块可续跑）`);
  for (const [start, end] of ranges) {
    const frames = end - start + 1;
    const part = path.join(cache, `f${start}-${end}.mp4`);
    if (!force && existsSync(part) && (await verify(part, frames, true)).length === 0) {
      log(`  复用分块 ${start}–${end}`);
    } else {
      await renderFile(part, async (pending) => {
        await render(pending, start, end, (done) => progress(completed + done));
        const issues = await verify(pending, frames, true);
        if (issues.length) throw new Error(issues.join('\n'));
        if (sourceFingerprint(task).join(':') !== sources) throw new Error('渲染期间源文件改动，分块未发布');
      });
    }
    files.push({ part, frames });
    completed += frames;
    progress(completed);
  }

  await renderFile(output, (pending) => publish(
    pending,
    async (target) => {
      const list = path.join(path.dirname(pending), 'concat.txt');
      const escape = (file) => file.split(path.sep).join('/').replaceAll("'", "'\\''");
      try {
        writeFileSync(list, files.map(({ part, frames }) => `file '${escape(part)}'\nduration ${(frames / fps).toFixed(9)}`).join('\n') + '\n');
        await runFfmpeg(['-y', '-loglevel', 'error', '-copyts', '-f', 'concat', '-safe', '0', '-i', list,
          '-c', 'copy', '-movflags', '+faststart', target]);
      } finally {
        rmSync(list, { force: true });
      }
    },
    async (target) => {
      const issues = await verify(target, completed, true);
      if (issues.length) throw new Error(issues.join('\n'));
      if (sourceFingerprint(task).join(':') !== sources) throw new Error('渲染期间源文件改动，成片未发布');
    },
  ));
}

export async function runRemotion(command, args) {
  const { task, id, meta, options } = parseArgs(command, args);
  const { fps, width, height, durationInFrames, segments, audio: parsedAudio } = await evaluateRegisteredTask(task, meta);
  const still = command === 'still';
  const draft = options.has('draft');
  const scale = Number(options.get('scale') ?? (draft ? 0.5 : 1));
  if (!Number.isFinite(scale) || scale < 0.25 || scale > 4) throw new Error('--scale 只接受 0.25 到 4');
  const scaleWarning = remotionScaleWarning(meta, scale);
  if (scaleWarning) warn(scaleWarning);
  // samples：config-only 固定 1；task-eval 任务默认 auto，草稿未显式指定时降到 1 以便快速预览。
  const samplesOpt = options.get('samples');
  const samples = resolveSamples(meta, { draft, samplesOpt });
  if (samples !== 'auto' && (!Number.isInteger(samples) || samples < 1)) throw new Error('--samples 要给正整数或 auto');
  if (meta.eval === 'config-only' && samples !== 1) throw new Error('该 Remotion 任务只支持 --samples 1');
  if (options.has('fps') && Number(options.get('fps')) !== fps) throw new Error(`该 Remotion 任务固定为 ${fps} fps`);
  if (options.has('vcodec') && options.get('vcodec') !== 'libx264') throw new Error('该 Remotion 任务只支持 libx264');
  const duration = durationInFrames / fps;
  const argsBase = [entry, id];
  const out = (...parts) => path.resolve(ROOT, options.get('out') ?? taskOut(task, ...parts));
  if (still) {
    const values = String(options.get('t') ?? '1').split(',');
    const times = values.map(Number);
    if (values.some((t) => t.trim() === '') || times.some((t) => !Number.isFinite(t) || t < 0 || t > duration)) {
      throw new Error(`-t 需要给影片内（0 到 ${duration}s）的时刻，例如 -t 0,1.5,3`);
    }
    const outDir = out('stills');
    const progress = frameProgress(times.length);
    progress(0);
    const stillProps = meta.eval !== 'config-only' && samples !== 'auto'
      ? [`--props=${JSON.stringify({ samples })}`]
      : [];
    for (const [index, time] of times.entries()) {
      const frame = Math.min(durationInFrames - 1, Math.round(time * fps));
      const suffix = options.has('out') ? '' : '.remotion';
      const output = path.join(outDir, `f_${time.toFixed(3).padStart(8, '0')}${suffix}.png`);
      await renderFile(output, async (pending) => {
        await runCli(['still', ...argsBase, pending, `--frame=${frame}`, `--scale=${scale}`, '--image-format=png', ...stillProps]);
        if (statSync(pending).size === 0) throw new Error('Remotion 生成了空 PNG');
      });
      progress(index + 1);
      log(`  t=${time.toFixed(3)}s  帧 ${frame}  ${path.relative(ROOT, output)}`);
    }
    return;
  }

  const short = command === 'shot';
  const from = Number(options.get('from') ?? 0);
  const to = Number(options.get('to') ?? (short ? Math.min(duration, from + 4) : duration));
  const [first, last] = videoFrameRange(from, to, fps, durationInFrames);
  const total = last - first + 1;
  const crf = Number(options.get('crf') ?? (draft || short ? 20 : 16));
  if (!Number.isInteger(crf) || crf < 0 || crf > 51) throw new Error('--crf 只接受 0 到 51 的整数');
  const output = out(remotionVideoName(task, { short, draft, from, to, duration }));
  if (path.extname(output).toLowerCase() !== '.mp4') throw new Error('--out 必须指定 .mp4 文件');
  const segmentSeconds = options.get('segments');
  if (options.has('force') && segmentSeconds === undefined) throw new Error('--force 必须与 --segments 一起使用');
  const segmentSize = Math.round(Number(segmentSeconds) * fps);
  if (segmentSeconds !== undefined && (!Number.isSafeInteger(segmentSize) || segmentSize < 1)) {
    throw new Error('--segments 要给至少一帧的正数秒数');
  }
  const progress = frameProgress(total);
  const size = [Math.floor(width * scale), Math.floor(height * scale)];
  if (size.some((n) => n % 2 !== 0)) throw new Error(`H.264 输出宽高必须为偶数（收到 ${size.join('×')}）`);

  // --dry-run：渲 10 帧测速，估全片时间，不出片
  if (options.has('dry-run')) {
    const probeFrames = Math.min(10, total);
    const probeEnd = first + probeFrames - 1;
    const tmpOut = path.join(ROOT, 'out', '_remotion-migration', '.tmp', `dryrun-${task}.mp4`);
    mkdirSync(path.dirname(tmpOut), { recursive: true });
    log(`dry-run：测 ${probeFrames} 帧（${first}–${probeEnd}）…`);
    const t0 = Date.now();
    await runCli(['render', ...argsBase, tmpOut, `--frames=${first}-${probeEnd}`, `--scale=${scale}`, '--codec=h264', `--crf=${crf}`, '--muted']);
    const sec = (Date.now() - t0) / 1000;
    const fpsRate = probeFrames / sec;
    const estMin = (total / fpsRate) / 60;
    log(`  测速 ${fpsRate.toFixed(2)} fps（${sec.toFixed(1)}s / ${probeFrames} 帧）`);
    log(`  全片 ${total} 帧 ≈ ${estMin.toFixed(1)} 分钟（${size.join('×')} @${fps}fps crf${crf}）`);
    rmSync(tmpOut, { force: true });
    return;
  }

  let audioTrack = null;
  let audioMuxArgs = null;
  if (!short && (meta.audio || parsedAudio?.packaging) && !options.has('noaudio')) {
    const { resolveAudioTracks } = await import('./audio.mjs');
    const tracks = resolveAudioTracks(task);
    if (tracks.packaging) {
      audioTrack = tracks.packaging;
      ({ audioMuxArgs } = await import('./media.mjs'));
    } else if (meta.audio) {
      warn('· 任务声明了音频但找不到 mix 轨 —— 成片无声。检查 tasks/' + task + '/audio/');
    }
  }

  log(`Remotion ${draft ? '草稿 ' : ''}${from}→${to}s，${size.join('×')} @${fps}fps，共 ${total} 帧`);
  progress(0);
  const render = (pending, start, end, onFrame) => runCli([
    'render', ...argsBase, pending, `--frames=${start}-${end}`, `--scale=${scale}`,
    '--codec=h264', `--crf=${crf}`, '--muted',
    ...(samples !== 'auto' ? [`--props={"samples":${samples}}`] : []),
  ], onFrame);
  const verify = async (file, count, timestamps = false) => {
    const issues = await checkVideoFile(file, count, { what: 'Remotion 出片', count: true, fps, width: size[0], height: size[1] });
    return issues.length || !timestamps ? issues : checkTimestamps(file, fps, count, { all: true });
  };
  // 音轨在暂存目录内封装完再原子发布到 output，失败时不破坏旧成片、也不留 .silent.mp4。
  const publish = async (pending, produceSilent, verifySilent) => {
    if (!audioTrack) {
      await produceSilent(pending);
      await verifySilent(pending);
      return;
    }
    const silent = path.join(path.dirname(pending), 'silent.mp4');
    try {
      await produceSilent(silent);
      await verifySilent(silent);
      await runFfmpeg(audioMuxArgs(silent, audioTrack, from, pending));
    } finally {
      rmSync(silent, { force: true });
    }
  };
  if (segmentSeconds !== undefined) {
    // config-only 硬切用 nativeChunkRanges；task-eval 任务有交叠 → 避开转场窗
    const ranges = meta.eval === 'config-only'
      ? nativeChunkRanges(first, last, segmentSize, segments)
      : overlapAwareChunkRanges(first, last, segmentSize, segments);
    await renderParts(output, { task, id, ranges, fps, scale, crf, samples, force: options.has('force'), progress, verify, render, publish });
  } else {
    await renderFile(output, (pending) => publish(
      pending,
      (target) => render(target, first, last, progress),
      async (target) => {
        const issues = await verify(target, total);
        if (issues.length) throw new Error(issues.join('\n'));
      },
    ));
  }
  if (audioTrack) {
    log(`音轨：${path.basename(audioTrack)}（mix）→ ${path.relative(ROOT, output)}`);
  }
  progress(total);
  log(`成片 → ${path.relative(ROOT, output).split(path.sep).join('/')}`);

  // 版本戳只代表完整正式成片；草稿、shot 与显式 --from/--to 截段不能覆盖交付记录。
  if (command === 'video' && !draft && !options.has('from') && !options.has('to')) {
    try {
      const stamp = writeStamp(ROOT, task, {
        engine: engineSig(ROOT),
        scene: taskSig(ROOT, task),
        video: path.relative(ROOT, output).split(path.sep).join('/'),
        frames: total,
        fps: Number(fps),
        draft: false,
        scale,
        samples: String(samples),
        files: statSync(output).size,
        renderer: 'remotion',
      });
      log(`  版本戳 ${path.relative(ROOT, stampPath(ROOT, task)).split(path.sep).join('/')}（引擎 ${stamp.engine} · 场景 ${stamp.scene}）`);
    } catch (e) {
      warn(`  ⚠ 版本戳没写成（${e && e.message ? e.message : e}）—— 不影响出片`);
    }
  }
}
