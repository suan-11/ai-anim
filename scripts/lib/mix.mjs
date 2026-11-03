// @ts-check
/**
 * 把旁白 + 音乐床混成**一条**交给引擎的音轨（`anim mix`）。
 *
 * ## 为什么这一步必须存在
 *
 * 引擎只有**一条音轨**的抽象（`task.audio`），没有 sidechain、没有多轨混音
 * —— 这是 `docs/NARRATION.md` 记的能力缺口。缺了它，"说话时把音乐压下去"（闪避）
 * 就只能在引擎外面手搓。做 `tasks/beast` 时那一版手搓的脚本在
 * `tasks/beast/tools/mix.mjs`（86 行），每支带旁白的片子都要重写一遍；
 * 这里把它收进引擎，参数化了。
 *
 * 做三件事（与 beast 那版一致，数值也是那版实测调出来的）：
 *   ① 按 `audio/timing.json` 把每句旁白摆到它的**绝对时刻**上；
 *   ② 用旁白自己的包络做闪避（说话时音乐压到约 −13 dB，说完慢慢恢复）；
 *   ③ 输出一条混音轨（mp3）+ 一份 wav 备查，并打印说话占比。
 *
 * ⚠ 这一层**不进浏览器**：`anim mix` 是 CLI 侧的一次性构建步骤，产物是文件。
 * 引擎照旧只认一条轨（`audio: { music, vo, mix }` 里的 `mix`）。
 */

import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOUDNESS_TARGET, assessLoudness, decodeChannels, decodeMono, encodeMp3, ffmpegArgv, formatLoudness,
  measureLoudness, normalize, parseLoudnormJson, probeDuration, readTaskAudioSpec, runChecked, taskRel, writeWav16,
} from './media.mjs';

/** beast 那一版实测的默认值 —— 改这些之前先听一遍，别凭感觉调。 */
export const DEFAULT_DUCK = {
  /** 语音门限（包络峰值）：低于它算"没人说话" */
  gate: 0.02,
  /** 起音系数（越大压得越快）：说话时音乐要**马上**让路 */
  attack: 0.35,
  /** 释放系数（越小恢复越慢）：说完不要"啪"地弹回来 */
  release: 0.06,
  /** 压多深：gain = 1 - depth * lvl，0.78 ≈ 音乐只剩 22%（−13 dB） */
  depth: 0.78,
  /** 音乐床总增益 */
  bedGain: 0.78,
  /** 旁白总增益 */
  voGain: 1.9,
};

/**
 * 把 timing 表里的每句旁白摆到绝对时刻上，得到一条纯旁白轨。
 *
 * 时刻的算法与 `anim say` 写表时**完全一致**：`scene.start + line.offset`
 * （`offset` 已经是"内部 cue × stretch"折算过的整片时间），所以这里不重算节奏。
 *
 * @param {any} timing `audio/timing.json` 的内容
 * @param {string} taskDir 任务目录（`file` 字段相对它）
 * @param {{ sr?: number, total?: number, onLine?: (line: any, i: number) => void }} [opts]
 * @returns {{ vo: Float32Array, sr: number, total: number, voiced: number }}
 */
/* ------------------------------------------------------------------ 音效（sfx） */

/**
 * 共享音效库的根：`assets/sfx/`（`tools/sfx-fetch.mjs` 拉下来的东西都在这）。
 * 单支片子专用的小素材可以放 `tasks/<任务>/audio/sfx/`。
 */
export const SFX_LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'sfx');

/**
 * 按**类别前缀**在库里找第一条音效（`whoosh` → `whoosh-transition__73722__Sound16.mp3`）。
 * 找不到就抛，并列出库里有哪些类别 —— 静默跳过等于"我加的音效没响"。
 */
export function findSfx(kind, libDir = SFX_LIB) {
  if (!existsSync(libDir)) throw new Error('没有音效库 ' + libDir + ' —— 先跑 node tools/sfx-fetch.mjs --get … --dir assets/sfx');
  const files = readdirSync(libDir).filter((f) => /\.mp3$/i.test(f));
  const hit = files.find((f) => f.startsWith(kind + '__')) ?? files.find((f) => f.includes(kind));
  if (!hit) {
    const kinds = [...new Set(files.map((f) => f.split('__')[0]))];
    throw new Error('库里没有 "' + kind + '" 这类音效。现有：' + (kinds.join(' / ') || '（空）'));
  }
  return path.join(libDir, hit);
}

/**
 * **自动音效设计**：每个切点砸一记 whoosh（第一条段除外 —— 片子开头不需要"推门声"）。
 *
 * 为什么是 whoosh：切镜头在视觉上是"画面被甩走"，观众耳朵里本来就该有一声风；
 * 没有它，切点会显得"干"。这类声音**不需要**按拍子对，长 0.29s，砸在切点上就成立。
 *
 * @param {Array<{start:number}>} segments `build()` 出来的段表
 * @param {{ kind?: string, gain?: number, skipFirst?: boolean, libDir?: string }} [opts]
 */
export function autoSfx(segments, opts = {}) {
  const kind = opts.kind ?? 'whoosh';
  // 增益是相对**峰归一后的 0.7** 的倍数：1.6 ⇒ 峰值约 1.12，明显高过音乐床（实测床峰 ~0.78）。
  // 早先默认 0.5 的结果是「切点上只比音乐高 17% RMS」，等于没做 —— 数字上在，耳朵里不在。
  const gain = opts.gain ?? 1.6;
  const skipFirst = opts.skipFirst !== false;
  let file;
  try { file = findSfx(kind, opts.libDir); } catch { return []; }
  return segments
    .filter((s, i) => !(skipFirst && i === 0))
    .map((s) => ({ file, at: Number(s.start), gain, fadeIn: 0.005, fadeOut: 0.06 }))
    .filter((x) => x.at > 0);
}

/**
 * 把一批评位好的音效叠进已经混好的 L/R（就地改）。
 *
 * 每条：解码成单声道 → 乘增益 → 从 at 秒开始相加。越界部分裁掉。
 * @returns {{ placed: number, skipped: Array<{file:string, why:string}> }}
 */
export function mixSfx(L, R, items, opts = {}) {
  const sr = opts.sr ?? 44100;
  const n = L.length;
  let placed = 0;
  const skipped = [];
  for (const it of items ?? []) {
    const file = it.file;
    if (!file || !existsSync(file)) { skipped.push({ file: String(file), why: '文件不存在' }); continue; }
    const at = Math.round(Number(it.at ?? 0) * sr);
    if (!(at >= 0) || at >= n) { skipped.push({ file, why: 'at 落在片子外（' + it.at + 's）' }); continue; }
    let mono;
    try { mono = decodeMono(file, sr); } catch (e) { skipped.push({ file, why: '解码失败：' + String(e.message).slice(0, 40) }); continue; }
    // 每个音效**先峰归一到 0.7** 再乘 gain —— 不同来源音量能差两三个数量级，
    // 不归一就会出现「有的根本没听见、有的一下盖住整条轨」。gain 因而是可预测的比例（0.75 ≈ 与音乐同量级）。
    let pk = 0;
    for (let i = 0; i < mono.length; i++) { const v = Math.abs(mono[i]); if (v > pk) pk = v; }
    const nrm = pk > 1e-4 ? 0.7 / pk : 1;
    const g = Number(it.gain ?? 0.75) * nrm;
    // **给音效让路**：在它出现的前 220ms 里把已混好的音乐压下去一点（−6 dB 左右），
    // 出来再恢复。实测：不压的话切点 whoosh 只比音乐高 17% RMS —— 数字上在，耳朵里不在。
    // 这是"轻侧链"，不是全片闪避：窗口短、深度浅，听不出音乐在呼吸，但 whoosh 立刻清楚了。
    const duckDepth = Number(it.duck ?? 0.5);
    const duckLen = Math.round(Math.max(0.15, Number(it.duckLen ?? 0.22)) * sr);
    if (duckDepth > 0) {
      for (let i = 0; i < duckLen; i++) {
        const idx = at + i;
        if (idx >= n) break;
        // 余弦形：0 → 1 → 0，峰值在开头
        const k = i / duckLen;
        const dip = 1 - duckDepth * Math.sin(Math.PI * k) ** 1.5;
        L[idx] *= dip;
        R[idx] *= dip;
      }
    }
    const fadeIn = Math.max(0, Number(it.fadeIn ?? 0.004)) * sr;
    const fadeOut = Math.max(0, Number(it.fadeOut ?? 0.04)) * sr;
    const len = Math.min(mono.length, n - at);
    for (let i = 0; i < len; i++) {
      let env = 1;
      if (fadeIn > 0 && i < fadeIn) env *= i / fadeIn;
      if (fadeOut > 0 && i > len - fadeOut) env *= Math.max(0, (len - i) / fadeOut);
      const v = mono[i] * g * env;
      L[at + i] += v;
      R[at + i] += v;
    }
    placed++;
  }
  return { placed, skipped };
}

export function placeVo(timing, taskDir, opts = {}) {
  const sr = opts.sr ?? 44100;
  const total = opts.total ?? Number(timing.total);
  if (!(total > 0)) throw new Error('timing.total 不是正数 —— timing.json 坏了，重跑 anim say');
  const n = Math.ceil(total * sr);
  const vo = new Float32Array(n);
  let voiced = 0;
  for (const sc of timing.scenes ?? []) {
    for (const line of sc.lines ?? []) {
      const file = path.join(taskDir, line.file);
      const samples = decodeMono(file, sr);
      const at = Math.round((sc.start + line.offset) * sr);
      for (let i = 0; i < samples.length; i++) {
        const idx = at + i;
        if (idx >= 0 && idx < n) vo[idx] += samples[i];
      }
      voiced += samples.length / sr;
      opts.onLine?.(line, sc);
    }
  }
  return { vo, sr, total, voiced };
}

/**
 * 旁白包络 → 闪避增益曲线（每个采样点一个增益）。
 *
 * 15ms 取包（峰值）→ 单极点平滑（起音快、释放慢）。
 * 用**峰值**而不是 RMS：齿音和爆破音也要让路，RMS 会漏掉它们。
 *
 * @param {Float32Array} vo
 * @param {number} sr
 * @param {typeof DEFAULT_DUCK} [params]
 * @returns {{ gain: Float32Array, duckedRatio: number }}
 */
export function duckGain(vo, sr, params = DEFAULT_DUCK) {
  const p = { ...DEFAULT_DUCK, ...params };
  const hop = Math.round(0.015 * sr);
  const frames = Math.ceil(vo.length / hop);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let peak = 0;
    const i0 = f * hop;
    for (let i = i0; i < Math.min(i0 + hop, vo.length); i++) peak = Math.max(peak, Math.abs(vo[i]));
    env[f] = peak;
  }
  const gain = new Float32Array(vo.length);
  let lvl = 0;
  let duckedFrames = 0;
  for (let f = 0; f < frames; f++) {
    const target = env[f] > p.gate ? 1 : 0;
    const k = target > lvl ? p.attack : p.release;
    lvl += (target - lvl) * k;
    if (lvl > 0.5) duckedFrames++;
    const g = 1 - p.depth * lvl;
    const i0 = f * hop;
    for (let i = i0; i < Math.min(i0 + hop, gain.length); i++) gain[i] = g;
  }
  return { gain, duckedRatio: frames ? duckedFrames / frames : 0 };
}

/**
 * 混音。旁白居中（两边同相），音乐按闪避增益走。
 * @param {{ vo: Float32Array, musicL: Float32Array, musicR: Float32Array, gain: Float32Array,
 *           voGain?: number, bedGain?: number }} a
 * @returns {{ L: Float32Array, R: Float32Array, peakRaw: number }}
 */
export function mixTracks({ vo, musicL, musicR, gain, voGain = DEFAULT_DUCK.voGain, bedGain = DEFAULT_DUCK.bedGain }) {
  const n = vo.length;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let peakRaw = 0;
  for (let i = 0; i < n; i++) {
    const g = gain[i] * bedGain;
    const v = vo[i] * voGain;
    const l = (musicL[i] ?? 0) * g + v;
    const r = (musicR[i] ?? 0) * g + v;
    L[i] = l; R[i] = r;
    peakRaw = Math.max(peakRaw, Math.abs(l), Math.abs(r));
  }
  return { L, R, peakRaw };
}

/** 只出旁白轨（没有音乐时也至少有一条能听的轨；`anim say` 收尾时调它）。 */
export function renderVo({ timing, taskDir, out, sr = 44100, bitrate = '192k' }) {
  const { vo, total, voiced } = placeVo(timing, taskDir, { sr });
  const wav = out.replace(/\.mp3$/i, '.wav');
  const chans = [vo, vo];
  normalize(chans, 0.89);
  writeWav16(wav, chans, sr);
  encodeMp3(wav, out, bitrate);
  return { file: out, wav, total, voiced, duration: probeDuration(out) };
}

/** 找一个能当音乐床的音轨：显式 --music > task.audio.music > task.audio.mix > 任务目录里第一个音频。 */
export function resolveMusic(taskDir, explicit) {
  if (explicit) {
    const f = taskRel(taskDir, explicit);
    if (!existsSync(f)) throw new Error(`--music 指的文件不存在：${f}`);
    return f;
  }
  const spec = readTaskAudioSpec(taskDir);
  if (spec && typeof spec === 'object') {
    for (const key of ['music', 'mix']) {
      const f = taskRel(taskDir, spec[key]);
      if (f && existsSync(f)) return f;
    }
  } else if (typeof spec === 'string') {
    const f = taskRel(taskDir, spec);
    if (f && existsSync(f)) return f;
  }
  throw new Error(
    '找不到音乐床。用 --music <文件> 指定，或在 task.config.mjs 里写 '
    + "audio: { music: './audio/xxx.mp3', vo: './audio/……-vo.mp3', mix: './audio/……-mix.mp3' }。",
  );
}

/* ---------------------------------------------------------------- 响度归一化（显式开启）

 * 为什么这一段存在、为什么**默认关**：
 * `anim mix` 从第一天起就只报响度、不归一化（`scripts/lib/media.mjs` 顶部那条纪律）——
 * 归一化会让**所有已交付片子的音轨**逐字节变掉，等于全部重出。但"贴平台靶子"是
 * **每支新片子都要做一遍**的动作：实测《把信号拆开》混出来是 −21.2 LUFS，离 −14 差 7.2 LU，
 * 于是仓库里长出了 5 个 `scripts/make-*-audio.mjs` 和一个 `scripts/master-spectrum-audio.mjs`，
 * 每个都在手抄同一段两遍式 loudnorm。这里的做法是把它收进引擎，但**必须显式**：
 * 不传 `--target` 时一个字节都不动（`tools/test-mix-loudnorm.mjs` ③ 钉着这一条）。
 */

/**
 * 平台预设。`streaming` **直接用** `media.mjs` 的 `LOUDNESS_TARGET` —— 同一组数字
 * 在两处各写一遍，迟早会漂成"报告说达标、混音按另一个靶子做"。
 *
 * `cinema` = 广播/影厅的那一组（EBU R128 的 −23 LUFS，真峰再留一档余量）。
 * 这两个预设不是"哪个更好"，是**两种交付面**：上传平台走 streaming，投展/送广播走 cinema。
 */
export const LOUDNESS_PRESETS = {
  streaming: { ...LOUDNESS_TARGET },
  cinema: { i: -23, tp: -2, lra: 15 },
  /** 显式关掉（`--target off`）：与"不传"等价，但写出来能让人一眼看见"这里**故意**不归一化" */
  off: null,
};

/** loudnorm 滤镜接受的取值范围（超了它直接非零退出，报错还很难懂 —— 在这里先拦住）。 */
const LOUDNORM_RANGE = { i: [-70, -5], tp: [-9, 0], lra: [1, 50] };

/** 两位小数：ffmpeg 参数与读数都用这个精度（`-14` 与 `-14.00` 都收，统一成后者便于 diff）。 */
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));

/**
 * 把 `--target` 的三种写法收成一个靶子对象。**纯函数**（不碰磁盘、不跑 ffmpeg）。
 *
 * 数字写法（`-14`）= "整合响度贴到 −14，真峰与 LRA 仍用 streaming 那一组" ——
 * 作者提这个需求时的原话就是这一句，没必要逼他记住三个数。
 *
 * @param {string|number|{i?:number,tp?:number,lra?:number}|null|undefined} target
 * @param {number} [lra] 只覆盖 LRA（`--lra`）：想保住动态、又不想动靶子时用它
 * @returns {{ i:number, tp:number, lra:number } | null} null = 不归一化
 * @throws {Error} 名字写错 / 数字超范围 —— **不许静默回落到默认靶子**（那会让人以为归一化过了）
 */
export function resolveLoudnessTarget(target, lra) {
  let base;
  if (target === undefined || target === null || target === 'off') {
    base = null;
  } else if (typeof target === 'string') {
    const key = target.trim().toLowerCase();
    // 命令行上 `--target -14` 拿到的是**字符串** "−14"，不是数字 —— 不认它的话
    // 作者得写 `--target=-14`（我们的 argv 解析不认那种写法）。所以这里先试数字。
    if (/^-?\d+(?:\.\d+)?$/.test(key)) {
      base = { i: Number(key), tp: LOUDNESS_TARGET.tp, lra: LOUDNESS_TARGET.lra };
    } else if (key in LOUDNESS_PRESETS) {
      base = LOUDNESS_PRESETS[key] ? { ...LOUDNESS_PRESETS[key] } : null;
    } else {
      throw new Error('不认识的 --target "' + target + '"。可用：'
        + Object.keys(LOUDNESS_PRESETS).join(' / ') + '，或者一个数字（如 -14）。');
    }
  } else if (typeof target === 'number' || (typeof target === 'object' && target)) {
    const src = typeof target === 'number' ? { i: target } : target;
    base = {
      i: src.i ?? LOUDNESS_TARGET.i,
      tp: src.tp ?? LOUDNESS_TARGET.tp,
      lra: src.lra ?? LOUDNESS_TARGET.lra,
    };
  } else {
    throw new Error('--target 的类型不对（' + typeof target + '）：给预设名、数字或 { i, tp, lra }。');
  }
  // `--lra` 只在开了 target 时才有意义：单独给一个 LRA 什么都说明不了（没有靶子时
  // "压到 LRA 8" 是句空话）。宁可抛，也不要吞掉一个参数让人以为它生效了。
  if (lra !== undefined && lra !== null && !base) {
    throw new Error('给了 LRA（' + lra + '）却没给 target —— LRA 只在归一化时才有意义，'
      + '请同时给 --target（如 --target streaming --lra 8）。');
  }
  if (base && Number.isFinite(Number(lra))) base.lra = Number(lra);
  if (!base) return null;
  for (const k of ['i', 'tp', 'lra']) {
    const v = Number(base[k]);
    const range = LOUDNORM_RANGE[k];
    if (!Number.isFinite(v) || v < range[0] || v > range[1]) {
      throw new Error('靶子的 ' + k + ' = ' + base[k] + ' 超出 loudnorm 的合法范围 '
        + range[0] + '..' + range[1] + '（ffmpeg 会直接非零退出）。');
    }
    base[k] = v;
  }
  return base;
}

/**
 * **纯函数**：给第一遍量到的读数与目标，算出第二遍 ffmpeg 的 `-af` 参数串，并说清这一遍会发生什么。
 *
 * 为什么必须两遍：loudnorm 的第一遍是**测量**（`-f null -`），第二遍要靠第一遍的
 * `measured_*` 才算得出增益。不带 `measured_*` 就只能边看边压 —— 那是**压动态换响度**。
 *
 * 为什么坚持 `linear=true`：两遍 + linear 时 loudnorm 只乘一个**常数增益**，动态一点不动；
 * 让它退回 dynamic 就会压动态，口播 + 音乐床的片子会听到"音乐被推来推去"。
 * ⚠ 但 `linear=true` 只是**请求**：目标增益超出真峰余量（或 LRA 超靶子）时 ffmpeg 会**静默**
 *   改走 dynamic（实测：−13.99 LUFS / −0.89 dBTP 的 spectrum 混音要"贴 −14"其实只差 −0.11 dB，
 *   它自己判 `normalization_type: "dynamic"`、真峰按 −1 削）。所以这里先**预测**一遍 ——
 *   预测不成立就在 reason 里说清楚，实际结果再由第二遍的 normalization_type 复核（见 runMix 的打印）。
 *
 * 分支（每一条都在 `reason` 里说人话，**没有静默路径**）：
 *   · `skip`        —— 量不出响度（静音/非音频），或本来就已经达标 → 不动音轨；
 *   · `single-pass` —— 读数不完整（真峰/LRA/门限拿不到，或门限是 −70 那个"没量到"哨兵值）
 *                          → 退回单遍，并**明说**"这一遍是压动态换响度"；
 *   · `linear`      —— 两遍 + 常数增益，动态不变（预期）；
 *   · `dynamic`     —— 两遍，但增益放不进真峰余量（或 LRA 超靶子）→ 会压动态，同样明说。
 *
 * @param {{ i:number, tp:number, lra:number, thresh?:number, targetOffset?:number }} measured
 *        `measureLoudness()` 的读数（i/tp/lra 可能是 ±Infinity / NaN，这个函数必须容得下）
 * @param {{ i:number, tp:number, lra:number } | string | number} target 靶子（预设名、数字、或对象）
 * @param {{ tolLu?: number }} [opts] tolLu = "算达标"的容差（默认 1.0 LU，与 assessLoudness 同口径）
 * @returns {{ mode: 'skip'|'single-pass'|'linear'|'dynamic', af: string|null,
 *             target: { i:number, tp:number, lra:number } | null,
 *             gainDb: number, linearExpected: boolean, reason: string, notes: string[] }}
 */
export function planLoudnorm(measured, target, opts = {}) {
  const t = resolveLoudnessTarget(target);
  const tolLu = Number(opts.tolLu ?? 1.0);
  /** @type {string[]} */
  const notes = [];
  if (!t) {
    return {
      mode: 'skip', af: null, target: null, gainDb: 0, linearExpected: false,
      reason: '没有给靶子（--target 没开）—— 不归一化', notes,
    };
  }
  const i = Number(measured?.i);
  const tp = Number(measured?.tp);
  const lra = Number(measured?.lra);
  const thresh = Number(measured?.thresh);
  const offset = Number(measured?.targetOffset);
  const base = { target: t, notes };

  // ① 量不出整合响度：静音 / 不是音频 / loudnorm 没跑成。归一化无从下手 —— 明说，不假装做了。
  if (!Number.isFinite(i) || i === -Infinity) {
    return {
      ...base, mode: 'skip', af: null, gainDb: 0, linearExpected: false,
      reason: '量不出整合响度（input_i = ' + measured?.i + '）—— 文件是静音或不是音频，归一化跳过',
    };
  }

  // ② 已经达标：一个字节都不动。硬塞一遍 loudnorm 只多一代有损编码，什么也不改善。
  const di = i - t.i;
  if (Math.abs(di) <= tolLu && Number.isFinite(tp) && tp <= t.tp) {
    return {
      ...base, mode: 'skip', af: null, gainDb: 0, linearExpected: true,
      reason: '已经达标（' + i.toFixed(1) + ' LUFS / ' + tp.toFixed(2) + ' dBTP，靶子 '
        + t.i + ' / ' + t.tp + '，容差 ±' + tolLu + ' LU）—— 不动音轨',
    };
  }

  // ③ 读数不完整 → 只能单遍。门限 −70 是 loudnorm 的"没量到"哨兵值（拿它当真实门限会算出错的增益）。
  const missing = [
    !Number.isFinite(tp) && '真峰',
    !Number.isFinite(lra) && 'LRA',
    (!Number.isFinite(thresh) || thresh <= -70) && '门限',
  ].filter(Boolean);
  if (missing.length) {
    return {
      ...base, mode: 'single-pass', gainDb: di, linearExpected: false,
      af: 'loudnorm=I=' + f2(t.i) + ':TP=' + f2(t.tp) + ':LRA=' + f2(t.lra) + ':print_format=json',
      reason: '读数不完整（' + missing.join(' / ') + ' 拿不到，tp=' + measured?.tp
        + ' lra=' + measured?.lra + ' thresh=' + measured?.thresh
        + '）—— 退回单遍 loudnorm：这一遍是**压动态换响度**，动态会被削',
    };
  }

  // ④ 两遍式。增益是纯数学：目标 − 现状；真峰会跟着一起抬。
  const gainDb = t.i - i;
  const predictedPeak = tp + gainDb;
  const headroomOk = predictedPeak <= t.tp + 1e-6;
  const lraOk = lra <= t.lra;
  /**
   * ⚠ 实测出来的第三条隐藏分支：**measured_LRA = 0 时 ffmpeg 一定退回 dynamic**。
   * 判据是量出来的（同一段 −20 dBFS 正弦、其余参数不变，只改 measured_LRA）：
   *   measured_LRA 0 → dynamic；0.001 / 0.01 / 0.1 / 0.5 → 全是 linear。
   * 它咬人的地方正是**恒定电平**的材料（纯测试音、压得很平的配乐床）—— 那种材料本来
   * 就没有动态可压，效果与常数增益一模一样；但"计划说 linear、实际说 dynamic"如果不解释，
   * 读日志的人会以为动态被削了。所以先记账，由下面的 reason / runMix 的打印按已知原因讲清。
   */
  const zeroLra = Number.isFinite(lra) && lra <= 0;
  const af = 'loudnorm='
    + 'I=' + f2(t.i) + ':TP=' + f2(t.tp) + ':LRA=' + f2(t.lra)
    + ':measured_I=' + f2(i) + ':measured_TP=' + f2(tp) + ':measured_LRA=' + f2(lra)
    + ':measured_thresh=' + f2(thresh) + ':offset=' + f2(Number.isFinite(offset) ? offset : 0)
    + ':linear=true:print_format=json';
  // 措辞用"提/压 + dB"：增益就是 dB，不是 LU（LU 是**响度差**的单位，两个数在这里虽然同值，
  // 但混着写会让人以为 loudnorm 的 offset 与 measured_I 是两个量纲）。
  const direction = gainDb < 0
    ? '压 ' + Math.abs(gainDb).toFixed(2) + ' dB'
    : '提 ' + gainDb.toFixed(2) + ' dB';

  if (headroomOk && lraOk && zeroLra) {
    notes.push('measured_LRA = 0 ⇒ ffmpeg 会自己退回 dynamic（没有动态范围可测）。'
      + '恒定电平的材料本来就没有动态可压，听感与常数增益相同 —— 不是"动态被削了"。');
    return {
      ...base, mode: 'linear', af, gainDb, linearExpected: false,
      reason: '两遍 loudnorm（' + direction + '）：真峰余量够，但 measured_LRA = 0，ffmpeg 会退回 dynamic'
        + '（这段材料没有可测的动态，效果与常数增益相同）',
    };
  }
  if (headroomOk && lraOk) {
    return {
      ...base, mode: 'linear', af, gainDb, linearExpected: true,
      reason: '两遍 loudnorm + linear（' + direction + '，纯常数增益，动态不变）：真峰 '
        + tp.toFixed(2) + ' → ' + predictedPeak.toFixed(2) + ' dBTP，余量够',
    };
  }
  const why = [
    headroomOk ? null : '线性要' + direction + ' ⇒ 真峰 ' + tp.toFixed(2) + ' → ' + predictedPeak.toFixed(2)
      + ' dBTP，超过上限 ' + t.tp,
    lraOk ? null : 'LRA ' + lra.toFixed(1) + ' LU 超过靶子 ' + t.lra,
    zeroLra ? 'measured_LRA = 0（ffmpeg 会退回 dynamic）' : null,
  ].filter(Boolean).join('；');
  notes.push('ffmpeg 在增益放不进真峰余量时会**自己**从 linear 退回 dynamic，linear=true 只是请求');
  return {
    ...base, mode: 'dynamic', af, gainDb, linearExpected: false,
    reason: '两遍 loudnorm，但线性放不下：' + why + ' —— 这一遍会压动态换响度（音乐会被推来推去）',
  };
}

/**
 * 跑第二遍：把 plan.af 套到文件上，**原地覆写**（先写同目录临时文件再改名）。
 *
 * 为什么要临时文件：loudnorm 中途失败时原文件必须还是完整的那一份 —— 混音轨被
 * `task.config.mjs` 直接引用，写坏一个字节就等于片子打不开。
 *
 * @param {string} file 要处理的音频（会被覆写）
 * @param {ReturnType<typeof planLoudnorm>} plan
 * @param {{ bitrate?: string }} [opts]
 * @returns {{ file: string, output: Record<string, any>|null, normalizationType: string|null }}
 *          第二遍 loudnorm 自己打印的 JSON（output_i / output_tp / normalization_type）
 */
export function applyLoudnorm(file, plan, opts = {}) {
  if (!plan || !plan.af || plan.mode === 'skip') {
    throw new Error('applyLoudnorm 收到一个不需要执行的计划（mode = skip 或没有 af）');
  }
  const tmp = file + '.loudnorm.tmp.mp3';
  try {
    // ⚠ -v info 而不是 -v error：第二遍的 loudnorm JSON 走 stderr，error 级别会把它吞掉，
    //   于是"到底走了 linear 还是 dynamic"就无从核对（tools/test-mix-loudnorm.mjs ② 靠它断言）。
    // 不给 -ar：保持源采样率，多一次重采样就多一次听不见的损失。
    const r = runChecked([
      ...ffmpegArgv(), '-y', '-v', 'info', '-i', file,
      '-af', plan.af,
      '-codec:a', 'libmp3lame', '-b:a', opts.bitrate ?? '192k', tmp,
    ]);
    const output = parseLoudnormJson(r.stderr);
    renameSync(tmp, file);
    return { file, output, normalizationType: output?.normalization_type ?? null };
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* 没写出来就算了 */ }
    throw e;
  }
}

/**
 * `anim mix` 的实现。
 *
 * ## `opts.target`：**默认 undefined = 一个字节都不变**
 *
 * 这条是硬约束，不是客套：`out/` 里的成片有一条已交付的混音轨，`tasks/<任务>/audio/<任务>-mix.mp3`
 * 又被 `task.config.mjs` 直接引用 —— 让默认路径多跑一遍 ffmpeg，已交付片子的音轨就会
 * 重新编码、多一代有损、读数也变。所以归一化只有**显式点名**才会发生：
 *
 *   · `undefined` / `'off'` / `null` ⇒ 走老路径（混 → 量 → 打印），与改动前逐字节相同；
 *   · `'streaming'` / `'cinema'` / 数字 / `{ i, tp, lra }` ⇒ 混 → **两遍 loudnorm** →
 *     覆写同一个 mp3 → **重新量一遍**，打印 `before → after` 与"是否达标"。
 *
 * 为什么是"覆写同一个 mp3"而不是另出一个 `-mastered` 文件：`task.config.mjs` 里那行
 * `audio.mix` 指向的是一个路径，多出一个文件等于每次都要人手动改配置；而 `--out` 已经
 * 让人能把产物写到别处（`out/_staging/`）。
 *
 * @param {string} task 任务名
 * @param {{ taskDir: string, music?: string, out?: string, duck?: Partial<typeof DEFAULT_DUCK>,
 *           sr?: number, bitrate?: string, voOnly?: boolean, log?: (...a:any[])=>void,
 *           target?: string|number|{i?:number,tp?:number,lra?:number}|null,
 *           lra?: number }} opts
 *        `target` 见上；`lra` 只覆盖 LRA（`--target cinema --lra 8` 这种）。
 */
export function runMix(task, opts) {
  const log = opts.log ?? console.log;
  const taskDir = opts.taskDir;
  const sr = opts.sr ?? 44100;
  // 多语言/多变体（1-23③）：给了 table 就读 <table>.timing.json，读 VO 与写出也都带前缀
  const table = opts.table ? String(opts.table).replace(/[^\w.-]/g, '') : '';
  const stem = table || task;
  const timingFile = path.join(taskDir, 'audio', table ? `${table}.timing.json` : 'timing.json');
  // 有旁白表就走老路；**没有**旁白表、但又给了音效（纯音乐片子）时，允许只做「音乐 + 音效」。
  // 以前这里一律抛错，于是 `anim mix` 对 PV 这类没有旁白的片子根本用不了 —— 而音效恰恰最缺在这种片子上。
  const hasTiming = existsSync(timingFile);
  if (!hasTiming && opts.sfx === undefined) {
    throw new Error(`没有 ${path.relative(process.cwd(), timingFile)} —— 先跑 anim say ${task}（它才会算出每段的起点与时长）。`
      + '\n  纯音乐片子可以只做音乐 + 音效：加 --sfx auto（按切点自动摆 whoosh）。');
  }
  const timing = hasTiming ? JSON.parse(readFileSync(timingFile, 'utf8')) : null;
  const duck = { ...DEFAULT_DUCK, ...(opts.duck ?? {}) };

  let vo, total, voiced = 0;
  if (timing) {
    ({ vo, total, voiced } = placeVo(timing, taskDir, { sr }));
  } else {
    // 没有旁白：先拿音乐床，用它的长度当整条音轨的长度
    const m0 = resolveMusic(taskDir, opts.music);
    total = probeDuration(m0);
    vo = new Float32Array(Math.ceil(total * sr));
  }
  const { gain, duckedRatio } = duckGain(vo, sr, duck);

  if (opts.voOnly) {
    const out = opts.out ? path.resolve(opts.out) : path.join(taskDir, 'audio', `${task}-vo.mp3`);
    const r = renderVo({ timing, taskDir, out, sr, bitrate: opts.bitrate });
    log(`✓ ${path.relative(process.cwd(), r.file)}  ${r.duration.toFixed(2)}s（只有旁白）`);
    return { ok: true, file: r.file, timing };
  }

  const music = resolveMusic(taskDir, opts.music);
  const musicDur = probeDuration(music);
  if (musicDur + 0.05 < total) {
    log(`⚠ 音乐床 ${path.basename(music)} 只有 ${musicDur.toFixed(2)}s，片子 ${total.toFixed(2)}s —— 后面 ${(total - musicDur).toFixed(2)}s 会没有音乐（引擎不会自动循环）。`);
  } else if (musicDur > total + 0.05) {
    log(`· 音乐床 ${musicDur.toFixed(2)}s 比片子 ${total.toFixed(2)}s 长，按片子长度裁掉尾巴。`);
  }
  const [musicL, musicR] = decodeChannels(music, sr, 2);
  const { L, R, peakRaw } = mixTracks({ vo, musicL, musicR, gain, voGain: duck.voGain, bedGain: duck.bedGain });
  // 音效最后叠：它是最「点」的一层，先过闪避会被旁白压掉
  let sfxReport = null;
  if (opts.sfx && opts.sfx.length) {
    sfxReport = mixSfx(L, R, opts.sfx, { sr });
    log(`  音效 ${sfxReport.placed} 条` + (sfxReport.skipped.length ? `（跳过 ${sfxReport.skipped.length} 条）` : ''));
    for (const s of sfxReport.skipped.slice(0, 4)) log(`    · 跳过 ${path.basename(s.file)}：${s.why}`);
  }
  const { gain: norm } = normalize([L, R], 0.89);

  const target = resolveLoudnessTarget(opts.target, opts.lra);
  const wav = path.join(taskDir, 'audio', `${stem}-mix.wav`);
  const mp3 = opts.out ? path.resolve(opts.out) : path.join(taskDir, 'audio', `${stem}-mix.mp3`);
  writeWav16(wav, [L, R], sr);
  encodeMp3(wav, mp3, opts.bitrate);
  let dur = probeDuration(mp3);

  /**
   * 音频的**数字守门**（BACKLOG 1-20）——「你听不见，就报数字」。
   * 只报，**不 gate**；归一化只有 `--target` 显式点名时才发生（默认路径一个字节都不动）。
   *
   * ⚠ 默认分支的那几行输出是**契约**：已交付片子的日志、回归里 `test-say` 的断言
   *   （`/闪避最深/`、`/说话/`）都按它读。开 target 时走另一条打印，别去改老的那条。
   */
  let before = null;
  const t0 = Date.now();
  if (!target) {
    try {
      before = measureLoudness(mp3);
      const a = assessLoudness(before);
      log(`  响度 ${formatLoudness(before)}  ${a.tier === 'ok' ? '✓' : a.tier === 'warn' ? '⚠' : '✗'} ${a.verdict}`);
      if (a.tier === 'error') {
        log(`    靶子是 ${before.target.i} LUFS / ${before.target.tp} dBTP（主流平台归一化目标）—— 只报数字，不动音轨。`);
      }
      log(`    （量了 ${((Date.now() - t0) / 1000).toFixed(1)}s；4 分钟的轨约 12s）`);
    } catch (e) {
      log(`  ⚠ 响度没量成（${e.kind}）：${String(e.message).split('\n')[0]}`);
    }
  } else {
    // 归一化要先**量**（两遍法的第一遍就是测量）。量不出读数就不许猜增益：跳过并明说。
    try {
      before = measureLoudness(mp3);
      log(`  归一化前 ${formatLoudness(before)}  （靶子 ${target.i} LUFS / ${target.tp} dBTP / LRA ${target.lra}）`);
    } catch (e) {
      log(`  ⚠ 归一化前量不成（${e.kind}）：${String(e.message).split('\n')[0]} —— 没有读数就不知道增益，归一化跳过`);
    }
  }

  /**
   * 显式归一化：两遍式 loudnorm（第一遍=上面的测量，第二遍=applyLoudnorm），覆写同一个 mp3，
   * 然后**重新量一遍**再打印 before → after。为什么非要重测：loudnorm 自己会把 linear 请求
   * 悄悄换成 dynamic（真实案例见 planLoudnorm 的注释），"计划说 linear"不等于"真的没压动态"。
   */
  let after = null;
  let normalized = false;
  let plan = null;
  if (target) {
    plan = planLoudnorm(before ?? { i: NaN, tp: NaN, lra: NaN, thresh: NaN }, target);
    if (plan.mode === 'skip') {
      log(`  · 归一化：跳过 —— ${plan.reason}`);
    } else {
      log(`  · 归一化计划：${plan.reason}`);
      const brief = (m) => (Number.isFinite(Number(m?.i))
        ? `${Number(m.i).toFixed(1)} LUFS / ${Number(m.tp).toFixed(2)} dBTP`
        : `量不出（${m?.i} LUFS）`);
      try {
        const applied = applyLoudnorm(mp3, plan, { bitrate: opts.bitrate });
        normalized = true;
        dur = probeDuration(mp3);
        after = measureLoudness(mp3);
        const actual = applied.normalizationType;
        if (plan.mode === 'single-pass') {
          log(`  · 归一化：${brief(before)} → ${brief(after)}（单遍 loudnorm，${actual ?? '没报告'} —— 压动态换响度）`);
        } else {
          log(`  · 归一化：${brief(before)} → ${brief(after)}（两遍 loudnorm，${actual ?? '没报告'}）`);
        }
        // 计划与实际不一致时必须点名：`linear=true` 只是**请求**，ffmpeg 会按真峰余量 / LRA 自己改判。
        // 两种原因分开说 —— 把"measured_LRA=0 的恒定电平材料"也报成"动态被削"，会让人白查一轮。
        if (plan.mode === 'linear' && actual && actual !== 'linear') {
          if (plan.linearExpected === false) {
            log(`    · 计划里已经预告过：measured_LRA = 0，ffmpeg 退回 ${actual} —— 这段材料没有可测的动态，`
              + `效果与常数增益相同（不是动态被削）。`);
          } else {
            log(`    ⚠ 计划是 linear、ffmpeg 实际走了 ${actual} —— 增益放不进真峰余量时它会自己压动态`
              + `（linear=true 只是请求）。动态被削了一点，音乐床值得重听一遍。`);
          }
        }
        const afterA = assessLoudness(after, { target });
        const tierText = afterA.tier === 'ok' ? '✓ 达标'
          : afterA.tier === 'warn' ? '⚠ 达标（LRA 超靶子，不 gate）' : '✗ 没达标';
        log(`    靶子 ${target.i} LUFS / ${target.tp} dBTP / LRA ${target.lra} → ${tierText}：${afterA.verdict}`);
      } catch (e) {
        log(`  ⚠ 归一化没成：${String(e.message).split('\n')[0].slice(0, 200)}`);
        log(`    音轨保持混音后的原样（${brief(before)}），没有半成品。`);
      }
    }
  }

  const rel = (f) => path.relative(taskDir, f).replace(/\\/g, '/');
  log(`✓ ${path.relative(process.cwd(), mp3)}  ${dur.toFixed(2)}s  ${timing ? (timing.scenes?.length ?? 0) + " 段" : "无旁白（纯音乐 + 音效）"}`);
  if (voiced > 0) log(`  说话 ${voiced.toFixed(1)}s / ${total.toFixed(1)}s = ${((voiced / total) * 100).toFixed(0)}%（其余是留白与呼吸）`);
  log(`  峰值 ${peakRaw.toFixed(2)} → 归一 ${norm.toFixed(2)}×，音乐 ×${duck.bedGain}，旁白 ×${duck.voGain}`
    + `，闪避最深 −${(20 * Math.log10(1 / Math.max(1e-6, 1 - duck.depth))).toFixed(0)} dB`
    + `（有 ${(duckedRatio * 100).toFixed(0)}% 的时间压着）`);
  log(`  在 task.config.mjs 里写：audio: { music: './${rel(music)}', vo: './${rel(path.join(taskDir, 'audio', `${task}-vo.mp3`))}', mix: './${rel(mp3)}' }`);
  return {
    ok: true, file: mp3, wav, music, timing, voiced, total, norm, peakRaw,
    // 归一化这一层的读数（CLI / 单测都从这里读；没开 target 时 target=null、after=null、normalized=false）
    target, before, after, normalized, plan,
  };
}
