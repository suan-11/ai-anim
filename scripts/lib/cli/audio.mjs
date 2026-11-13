// @ts-check
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { log, warn } from "./log.mjs";
import { checkFfmpeg, ffmpegCmd } from "./media.mjs";
import { ROOT } from "./paths.mjs";
function findAudio(task) {
  const dir = path.join(ROOT, 'tasks', task, 'audio');
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).filter((x) => /\.(mp3|wav|m4a|flac|ogg)$/i.test(x))[0];
  return f ? path.join(dir, f) : null;
}

/* ------------------------------------------------------------------ 音频分轨 */

/**
 * 把 `task.audio` 解析成**分轨**（`docs/history/IMPROVEMENTS-1-3.md` P1-4）。
 *
 * 为什么需要：做带旁白的片子时，交给引擎的只有**一条混音轨**（旁白 + 配乐）。
 * 于是 `analyze` 从混音里测 bpm —— **会被人声带偏**：beast 那轮实测出 136bpm，
 * 而配乐床实际是 96bpm。结果 `f.beat` 是错的，镜头对齐不了拍子，
 * 最后只能把"呼吸"的周期写死成 0.625s。这不是"精度不够"，是**测错了对象**。
 *
 * 现在 `task.audio` 允许三种写法：
 *   `audio: './audio/track.mp3'`                       （老写法：一条轨，分析与封装都用它）
 *   `audio: { music, vo, mix }`                        （分轨：**music 用来分析节拍**，mix 交给 ffmpeg）
 *   `audio: { music: '…' }` / `{ mix: '…' }` / `{ vo: '…' }`  （只给需要的）
 *
 * 缺省规则（尽量不让人写全）：
 *   · `mix`   没给 → 用 `vo`（有旁白就该听混音）或 `music`；
 *   · `music` 没给 → 用 `mix`（退回老行为，并**明确提示**"节拍是从混音里测的"）；
 *   · 分析的目标是 `music`，封装的目标是 `mix`。
 *
 * @param {any} task 任务配置对象（`task.config.mjs` 的 default）
 * @returns {{ music: string|null, vo: string|null, mix: string|null,
 *             analysisSource: string|null, packaging: string|null,
 *             isSplit: boolean, note: string }}
 *           路径都是**绝对路径**；不存在的文件会被判成 null。
 */
function resolveAudioTracks(task) {
  const dir = path.join(ROOT, 'tasks', task);
  const abs = (p) => {
    if (!p || typeof p !== 'string') return null;
    const f = path.isAbsolute(p) ? p : path.join(dir, p.replace(/^\.\//, ''));
    return existsSync(f) ? f : null;
  };
  // 从 task.config.mjs 里**文本读**出 audio 字段：CLI 侧没法直接 import 任务配置
  //（它是 Vite 模块，可能 import 图片/字体）。够用的解析：字符串或对象字面量。
  let spec = null;
  try {
    const src = readFileSync(path.join(dir, 'task.config.mjs'), 'utf8');
    const m = /(^|\n)\s*audio:\s*(\{[^}]*\}|'[^']*'|"[^"]*")/.exec(src);
    if (m) {
      const raw = m[2];
      if (raw.startsWith('{')) {
        spec = {};
        for (const kv of raw.slice(1, -1).split(',')) {
          const mm = /(\w+)\s*:\s*['"]([^'"]+)['"]/.exec(kv);
          if (mm) spec[mm[1]] = mm[2];
        }
      } else {
        spec = raw.slice(1, -1);
      }
    }
  } catch { /* 读不到就走"扫目录"那条老路 */ }

  let music = null, vo = null, mix = null;
  if (typeof spec === 'string') mix = abs(spec);
  else if (spec && typeof spec === 'object') {
    music = abs(spec.music); vo = abs(spec.vo); mix = abs(spec.mix);
  }
  const isSplit = !!(spec && typeof spec === 'object');

  // 老写法（或分轨但没写全）：从 audio/ 里扫第一个音频文件当"唯一那条轨"
  if (!music && !vo && !mix) mix = findAudio(task);
  // 补缺省
  if (!mix && !music && !vo) return { music: null, vo: null, mix: null, analysisSource: null, packaging: null, isSplit, note: '(没有音频)' };
  const analysisSource = music ?? mix ?? vo;
  const packaging = mix ?? music ?? vo;
  const note = music
    ? `节拍从 music 轨测（${path.basename(music)}），封装用 ${path.basename(packaging)}`
    : (vo || isSplit
      ? `⚠ 没有单独的 music 轨：节拍是从${vo ? '旁白' : '混音'}里测的，**会被人声带偏**。` +
        `建议在 task.config.mjs 里写 audio: { music: './audio/xxx.mp3', mix: './audio/yyy.mp3' } —— ` +
        `music 只用来分析节拍、mix 交给 ffmpeg。`
      : `单轨：分析与封装都用 ${path.basename(packaging)}`);
  return { music, vo, mix, analysisSource, packaging, isSplit, note };
}

/* ------------------------------------------------------------------ 音频分析 */

/** 读 16bit PCM wav（我们只用 ffmpeg 自己转出来的这种）。 */
function readWavMono(file) {
  const buf = readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${file} 不是 WAV`);
  }
  let pos = 12, fmt = null, dataOff = 0, dataLen = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataOff = body; dataLen = size;
    }
    pos = body + size + (size % 2);
  }
  if (!fmt || !dataOff) throw new Error(`${file} 缺 fmt/data 块`);
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`只支持 16bit PCM，收到 format=${fmt.format} bits=${fmt.bits}`);
  const frames = Math.floor(dataLen / 2 / fmt.channels);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) s += buf.readInt16LE(dataOff + (i * fmt.channels + c) * 2) / 32768;
    out[i] = s / fmt.channels;
  }
  return { pcm: out, sampleRate: fmt.sampleRate };
}

/**
 * 音频分析：ffmpeg 转 22k 单声道 wav -> 纯 JS 提特征 -> 存 analysis.json。
 * 全程在 Node 里跑，不需要浏览器/GPU，所以 check/analyze 在没有显卡的机器上也能用。
 *
 * ⚠ 分析的源轨是 **`music`**（不是混音）—— 见 `resolveAudioTracks()` 的注释：
 *   从带人声的混音里测 bpm 会被带偏（beast 实测 136 vs 实际 96）。
 *   没有独立 music 轨时会退回混音，但**明确警告**。
 */
async function analyzeTaskAudio(task) {
  const tracks = resolveAudioTracks(task);
  const audioFile = tracks.analysisSource;
  // 返回值从"裸 null / 路径"改成**可判定的结果**（BACKLOG 头部 ④，2026-10-16）：
  // 以前"没做成"只 warn 一句就返回 null，调用方（cmdVideo / ensureAnalysis）拿到 null
  // 分不清"任务没有音频"和"没 ffmpeg"，于是只能当没事发生 —— "少打一行"那一族的典型形态。
  // 现在三种结局各有名字：`no-audio` / `no-ffmpeg` / 成功（file 有值）。
  if (!audioFile) return { file: null, skipped: 'no-audio', message: '任务没有配 audio，没有可分析的轨' };
  const base = audioFile.replace(/\.[^.]+$/, '');
  const target = path.join(ROOT, 'tasks', task, 'audio', path.basename(base) + '.analysis.json');
  const wav = path.join(ROOT, 'out', task, `${path.basename(base)}.mono22k.wav`);
  mkdirSync(path.dirname(wav), { recursive: true });
  log(`· 分析源：${path.relative(ROOT, audioFile)}`);
  log(`  ${tracks.note}`);
  if (!tracks.music && tracks.analysisSource !== tracks.packaging) {
    warn(`  ⚠ 节拍是从人声轨/混音里测的，` +
      `\`f.beat\` 可能不准（这正是 docs/history/IMPROVEMENTS-1-3.md P1-4 那个坑）。`);
  }

  if (!(await checkFfmpeg())) {
    const message = '没有 ffmpeg（装一个，或用 ANIM_FFMPEG 指定一个包装器）';
    warn(`⚠ 音频分析**没做成**：${message} —— 跳过它，画面就不会踩拍子（f.beat / f.a 全是 0）`);
    return { file: null, skipped: 'no-ffmpeg', message };
  }
  const wavCmd = ffmpegCmd();
  await new Promise((resolve, reject) => {
    const p = spawn(wavCmd[0], [...wavCmd.slice(1), '-y', '-loglevel', 'error', '-i', audioFile, '-ac', '1', '-ar', '22050', '-c:a', 'pcm_s16le', wav], { stdio: 'inherit' });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve(null) : reject(new Error(`ffmpeg 转 wav 失败 (${c})`))));
  });

  const { analyzePCM } = await import("../../../src/core/audio-analysis.js");
  const { pcm, sampleRate } = readWavMono(wav);
  const t0 = Date.now();
  const a = analyzePCM(pcm, sampleRate);
  // 只存拍子/事件和降精度的包络，文件小、加载快
  const envKeys = ['rms', 'low', 'bass', 'mid', 'high', 'vocal', 'flux', 'centroid'];
  const out = {
    duration: a.duration, fps: a.fps, bpm: Math.round(a.bpm * 1000) / 1000,
    tempo: a.tempo,
    beats: a.beats, downbeats: a.downbeats, kicks: a.kicks, snares: a.snares, hats: a.hats, sections: a.sections,
  };
  for (const k of envKeys) out[k] = Array.from(a[k], (x) => Math.round(x * 1000) / 1000);
  writeFileSync(target, JSON.stringify(out));
  const mb = (statSync(target).size / 1048576).toFixed(2);
  log(`✓ 音频分析 ${path.relative(ROOT, target)}  bpm ${out.bpm.toFixed(1)}  ${out.beats.length} 拍  ${out.kicks.length} kick  ${out.snares.length} snare  (${mb} MB, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return { file: target, skipped: null, message: null };
}

/** 任务有音频但还没分析时，自动补一次。 */
async function ensureAnalysis(task) {
  const tracks = resolveAudioTracks(task);
  if (!tracks.analysisSource) return null;
  const base = tracks.analysisSource.replace(/\.[^.]+$/, '');
  const target = path.join(ROOT, 'tasks', task, 'audio', path.basename(base) + '.analysis.json');
  if (existsSync(target)) return target;
  log('· 首次渲染，先做一次音频分析（踩拍子要用）…');
  return (await analyzeTaskAudio(task)).file;
}

export { analyzeTaskAudio, resolveAudioTracks };
