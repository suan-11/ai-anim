// @ts-check
/**
 * 音频 / 媒体文件 / 进程的小工具（**Node 侧共用**，不进浏览器、不进 Vite 模块图）。
 *
 * 为什么单独一份、而不是从 `scripts/anim.mjs` import：
 * `anim.mjs` 是**带副作用的脚本**（import 的那一刻就解析 argv、开始跑命令），
 * 任何模块 import 它都会把 CLI 执行一遍。所以这里的几个函数是**故意重复**的 ——
 * 它们的语义必须和 CLI 里那几个保持一致（尤其是 `ANIM_FFMPEG` / `ANIM_FFPROBE`
 * 这两个包装器环境变量：`tools/slow-ffmpeg.mjs` 这类测试就靠它）。
 *
 * 单位约定：时间是**秒**（浮点）；样本是 `Float32Array`（单声道）；
 * 响度是 **LUFS**（整合）/ **dBTP**（真峰，不是采样峰值）/ **LU**（LRA），判据见 `LOUDNESS_TARGET`。
 *
 * 音频那一层的数字守门也在这里：`measureLoudness()` / `formatLoudness()` / `assessLoudness()`
 * —— 画面有 `check` 亮度、`shake` 逐帧变化量、`verify` 逐像素、`video` 复核帧数，
 * **音频这一层以前只能靠耳朵**（"你听不见，就说出这一点并报数字"）。
 * ⚠ 这里**只测量、只报数字**，绝不做自动归一化：那会改动所有带旁白片子的音轨（等于已交付片子全部重出）。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { blankJsComments } from './js-source.mjs';

/** 把 `node tools/x.mjs --a` 这种命令行切成 argv（支持引号包住的路径）。 */
export function parseCmdline(s) {
  return String(s).match(/"[^"]+"|'[^']+'|\S+/g)?.map((x) => x.replace(/^["']|["']$/g, '')) ?? [];
}

/** 环境变量里那两条包装器的 argv（`ANIM_FFMPEG` / `ANIM_FFPROBE`）。 */
export function ffmpegArgv() {
  return parseCmdline(process.env.ANIM_FFMPEG || 'ffmpeg');
}
export function ffprobeArgv() {
  return parseCmdline(process.env.ANIM_FFPROBE || 'ffprobe');
}

/**
 * 跑一条外部命令。
 * @param {string[]} argv
 * @param {{ cwd?: string, input?: Buffer|string, inherit?: boolean, maxBuffer?: number, timeout?: number }} [opts]
 * @returns {{ status: number|null, stdout: string, stderr: string, stdoutBuf: Buffer, spawnError?: string }}
 */
export function run(argv, opts = {}) {
  const inherit = !!opts.inherit;
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd: opts.cwd,
    input: opts.input,
    encoding: inherit ? undefined : 'buffer',
    stdio: inherit ? 'inherit' : undefined,
    maxBuffer: opts.maxBuffer ?? (1 << 30),
    // 只有调用方显式给了才设超时（scanMediaFile 这种"可能跑几分钟"的整片扫描要它）。
    ...(opts.timeout ? { timeout: opts.timeout, killSignal: 'SIGKILL' } : {}),
  });
  if (r.error) throw new Error(`跑不起 ${argv.join(' ')}：${r.error.message}`);
  const stdoutBuf = inherit ? Buffer.alloc(0) : (r.stdout ?? Buffer.alloc(0));
  return {
    status: r.status,
    stdout: inherit ? '' : stdoutBuf.toString('utf8'),
    stderr: inherit ? '' : (r.stderr ? r.stderr.toString('utf8') : ''),
    stdoutBuf,
  };
}

/**
 * 跟 `run` 一样，但**命令不存在时返回 `spawnError` 而不是抛错** ——
 * 探测"这个可执行文件在不在 PATH 上"必须用这一条（`spawnSync` 在 ENOENT 时
 * 会把 `error` 填上、`status` 留 null，用 `run` 去探会直接把整条命令炸掉）。
 * @returns {{ status: number|null, stdout: string, stderr: string, stdoutBuf: Buffer, spawnError?: string }}
 */
export function tryRun(argv, opts = {}) {
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd: opts.cwd,
    input: opts.input,
    encoding: 'buffer',
    maxBuffer: opts.maxBuffer ?? (1 << 26),
  });
  return {
    status: r.status,
    stdout: (r.stdout ?? Buffer.alloc(0)).toString('utf8'),
    stderr: (r.stderr ?? Buffer.alloc(0)).toString('utf8'),
    stdoutBuf: r.stdout ?? Buffer.alloc(0),
    ...(r.error ? { spawnError: r.error.message } : {}),
  };
}

/** 跑一条命令，非零退出就抛错（错误里带最后几行 stderr —— 不然只看到 exit code）。 */
export function runChecked(argv, opts = {}) {
  const r = run(argv, opts);
  if (r.status !== 0) {
    const tail = (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-6).join('\n');
    throw new Error(`命令失败（exit ${r.status}）：${argv.join(' ')}\n${tail}`);
  }
  return r;
}

/** 用 ffprobe 量一个音频/视频文件的时长（秒）。量不出来就抛错，不返回 0。 */
export function probeDuration(file) {
  if (!existsSync(file)) throw new Error(`文件不存在：${file}`);
  const r = run([...ffprobeArgv(), '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const d = Number(String(r.stdout).trim());
  if (!Number.isFinite(d) || d <= 0) {
    throw new Error(`ffprobe 量不出时长：${file}（输出 "${String(r.stdout).trim()}" ${String(r.stderr).trim()}）`);
  }
  return d;
}

/**
 * 把一个音频文件解码成单声道 Float32。
 * ⚠ 逐句的旁白是一个文件一句，整句读进来最简单也最稳（不做"部分解码"优化）。
 */
export function decodeMono(file, sr = 44100) {
  return decodeChannels(file, sr, 1)[0];
}

/**
 * 解码成 `nch` 声道（缺的声道用最后一条补齐，多的丢掉）。
 * 单声道文件解成 2 声道时两边是同一份数据 —— 音乐床要保持立体声就用它。
 * @returns {Float32Array[]}
 */
export function decodeChannels(file, sr = 44100, nch = 1) {
  const r = run([...ffmpegArgv(), '-v', 'error', '-i', file, '-ac', String(nch), '-ar', String(sr), '-f', 'f32le', '-']);
  if (r.status !== 0 || !r.stdoutBuf.length) {
    throw new Error(`解码失败：${file}\n${r.stderr.trim().split(/\r?\n/).slice(-4).join('\n')}`);
  }
  const buf = r.stdoutBuf;
  const frames = Math.floor(buf.length / (4 * nch));
  const out = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) out[c][i] = buf.readFloatLE((i * nch + c) * 4);
  }
  return out;
}

/** 写一个 16bit PCM WAV（自己拼头，不依赖 ffmpeg —— 测试里要跑得飞快）。 */
export function writeWav16(file, channels, sr) {
  const nch = channels.length;
  const n = channels[0].length;
  mkdirSync(path.dirname(file), { recursive: true });
  const dataBytes = n * nch * 2;
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + dataBytes, 4);
  head.write('WAVE', 8, 'ascii');
  head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(nch, 22);
  head.writeUInt32LE(sr, 24);
  head.writeUInt32LE(sr * nch * 2, 28);
  head.writeUInt16LE(nch * 2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(dataBytes, 40);
  const data = Buffer.alloc(dataBytes);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i] ?? 0));
      data.writeInt16LE(Math.round(v * 32767), (i * nch + c) * 2);
    }
  }
  writeFileSync(file, Buffer.concat([head, data]));
  return file;
}

/** WAV → mp3（引擎只认浏览器能解码的东西，mp3 最稳）。 */
export function encodeMp3(wavPath, mp3Path, bitrate = '192k') {
  mkdirSync(path.dirname(mp3Path), { recursive: true });
  runChecked([...ffmpegArgv(), '-y', '-v', 'error', '-i', wavPath, '-b:a', bitrate, mp3Path]);
  if (!existsSync(mp3Path)) throw new Error(`ffmpeg 没写出 ${mp3Path}`);
  return mp3Path;
}

/**
 * 从 `task.config.mjs` 里**文本读**出 `audio` 字段。
 *
 * 与 `scripts/anim.mjs` 的 `resolveAudioTracks()` 同一个理由：任务配置是 Vite 模块
 * （可能 import 字体/图片/GLSL 场景），Node 侧直接 `import()` 会炸，所以只做够用的解析。
 * 解析不出来时返回 `null`，调用方必须自己决定"没读到怎么办"，不要瞎猜。
 *
 * @param {string} taskDir `tasks/<名字>`
 * @returns {string|{music?:string,vo?:string,mix?:string}|null} 原样的字面量（相对任务目录）
 */
export function readTaskAudioSpec(taskDir) {
  let src = '';
  try { src = readFileSync(path.join(taskDir, 'task.config.mjs'), 'utf8'); } catch { return null; }
  const code = blankJsComments(src);
  const m = /(^|[,{[\s])audio\s*:\s*(\{[^}]*\}|'[^']*'|"[^"]*")/.exec(code);
  if (!m) return null;
  const raw = m[2];
  if (raw.startsWith('{')) {
    /** @type {Record<string,string>} */
    const spec = {};
    for (const kv of raw.slice(1, -1).split(',')) {
      const mm = /(\w+)\s*:\s*['"]([^'"]+)['"]/.exec(kv);
      if (mm) spec[mm[1]] = mm[2];
    }
    return spec;
  }
  return raw.slice(1, -1);
}

/** 把任务配置里的相对路径解析成绝对路径（相对**任务目录**）。 */
export function taskRel(taskDir, p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.join(taskDir, String(p).replace(/^\.\//, ''));
}

/**
 * 量"这句话到底说到哪一秒"（**不是**文件时长）。
 *
 * 为什么必须区分：`edge-tts` 每条音频尾巴上都挂着约 **0.9 秒静音**（实测：1.87s 的文件里
 * 0.93–1.87s 全是静音）。`tasks/beast` 那版 `say.mjs` 直接用 ffprobe 的文件时长当"这句念了多久"，
 * 于是每句都白算进 0.9s —— `slot` 被静音撑大、叠句判据也跟着偏。
 * 这里用 `silencedetect` 找出**末尾那段静音**的起点，作为"说完了"的时刻。
 *
 * @param {string} file
 * @param {number} fileDur 文件时长（秒）
 * @param {{ noise?: string, minSilence?: number, tail?: number }} [opts]
 *        `noise` 静音门限、`minSilence` 多长才算一段静音、`tail` 说完之后再算多久（给辅音留个收尾）
 * @returns {{ speechEnd: number, trimmed: number, silences: [number, number][] }}
 */
export function probeSpeechEnd(file, fileDur, opts = {}) {
  const noise = opts.noise ?? '-45dB';
  const minSilence = opts.minSilence ?? 0.15;
  const tail = opts.tail ?? 0.12;
  const r = run([...ffmpegArgv(), '-v', 'info', '-i', file, '-af', `silencedetect=noise=${noise}:d=${minSilence}`, '-f', 'null', '-']);
  const text = `${r.stderr}`;
  /** @type {[number, number][]} */
  const silences = [];
  let open = null;
  for (const line of text.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) { open = Number(s[1]); continue; }
    const e = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (e && open != null) { silences.push([open, Number(e[1])]); open = null; }
  }
  if (open != null) silences.push([open, fileDur]); // 还没等到 silence_end 就 EOF 了
  // ⚠ 踩过的坑：ffmpeg **会**在文件结束时补一条 `silence_end`（第一条实现假设"末尾那段没有 end"，
  //   于是永远判不出尾巴静音 —— 实测 a.mp3 报的是 `silence_start: 0.934792 / silence_end: 1.872`）。
  //   所以判据改成"这段静音一直延续到文件末尾"。
  const last = silences[silences.length - 1];
  const trailingStart = last && last[1] >= fileDur - 0.08 ? last[0] : null;
  const speechEnd = trailingStart != null ? Math.min(fileDur, trailingStart + tail) : fileDur;
  return { speechEnd: Math.round(speechEnd * 1000) / 1000, trimmed: Math.max(0, fileDur - speechEnd), silences };
}
/**
 * 归一化 + 软削波（`tasks/beast/tools/mix.mjs` 里那套，实测听感可以）。
 * @param {Float32Array[]} chans
 */
export function normalize(chans, target = 0.89) {
  let peak = 0;
  for (const ch of chans) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  const gain = peak > 0 ? Math.min(4, target / peak) : 1;
  // tanh 软削波：宁可轻微染色，也不要硬削出咔哒声
  for (const ch of chans) for (let i = 0; i < ch.length; i++) ch[i] = Math.tanh(ch[i] * gain * 1.05);
  return { peak, gain };
}

/* ------------------------------------------------------------------ 响度（音频的数字守门） */

/**
 * 响度目标：**主流平台的归一化靶子**（YouTube / Instagram / TikTok / X / LinkedIn 都是这一组）。
 *
 * 为什么是这三个数：
 *   · `i` = −14 LUFS —— 平台会把更响的**压下来**、更轻的抬上去。做成 −14 上下，平台就不会再动它；
 *     比它响很多（例如 −9）会被平台削掉动态，比它轻很多（实测 sodium-mix 是 −20.9）观众就得自己拧音量。
 *   · `tp` = −1 dBTP —— **真峰**（true peak，考虑 DAC 重建后的采样间峰值）。留 1dB 余量，
 *     是因为有损编码（AAC/MP3）与平台转码都可能把采样间峰值顶上去；压到 0 就会削。
 *   · `lra` = 11 LU —— 响度范围。**超过它不算错误**（口播 + 音乐床天然就宽），只是提示"忽大忽小"。
 */
export const LOUDNESS_TARGET = { i: -14, tp: -1, lra: 11 };

/**
 * 从一段 stderr 里取出 **loudnorm 打印的那段 JSON**。
 *
 * ⚠ 为什么不能"从第一个 `{` 匹配到第一个 `}`"：`ANIM_FFMPEG` 允许是**包装器**
 * （`tools/slow-ffmpeg.mjs` 就是），它会往 stderr 里掺自己的输出；ffmpeg 自己也会先打
 * 一堆 `size=N/A time=…` 的进度行，最后才是这段 JSON。于是"第一个 JSON"可能根本不是它。
 *
 * 做法：**从后往前**扫描 `{`，用 `JSON.parse` 自己验 —— 取**最后一段能解析成对象**的花括号块
 * （最后一个 `{` 若是尾随的垃圾，会继续往前找）。字符串里的花括号与转义引号都会正确跳过。
 *
 * @param {string} stderr
 * @returns {Record<string, any>|null} 解析不出来返回 `null`（**不要**在这里抛错，调用方要能区分失败原因）
 */
export function parseLoudnormJson(stderr) {
  const s = String(stderr ?? '');
  for (let end = s.lastIndexOf('{'); end >= 0; end = s.lastIndexOf('{', end - 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = end; i < s.length; i++) {
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
            const o = JSON.parse(s.slice(end, i + 1));
            if (o && typeof o === 'object' && !Array.isArray(o)) return o;
          } catch { /* 不是 JSON，继续往前找 */ }
          break; // 这一块的配对已经结束，换下一个候选 `{`
        }
      }
    }
  }
  return null;
}

/** ffmpeg 的 `<数字>` 可能是 `-inf` / `inf` / `nan` / `-1.#IND` —— 一律变成 `Number`。 */
function num(x) {
  const s = String(x ?? '').trim();
  if (/^-?inf(inity)?$/i.test(s)) return s.startsWith('-') ? -Infinity : Infinity;
  if (/^(nan|-?1\.#ind)$/i.test(s)) return NaN;
  const n = Number(s);
  return s === '' ? NaN : n;
}

/**
 * 量一个音频/视频文件的响度：**LUFS（整合）/ true peak / LRA**。
 *
 * 走的是 `loudnorm` 两遍法的**第一遍**（`-f null -`，只量不改）——
 * 所以这个函数**永远不会改动文件**：它只报数字。"自动归一化"是另一件事（会改掉所有已交付片子的音轨）。
 *
 *   const m = measureLoudness('tasks/x/audio/x-mix.mp3');
 *   console.log(formatLoudness(m));                    // −13.8 LUFS / −1.2 dBTP / LRA 4.1
 *   if (!assessLoudness(m).ok) …                       // 判据（可被单测直接断言）
 *
 * @param {string} file
 * @param {{ stderr?: string, target?: { i?: number, tp?: number, lra?: number }, seconds?: number }} [opts]
 *        `stderr` 给定时**不跑 ffmpeg**，只解析这段文本（单测"最后一段完整 JSON"用）。
 *        `seconds` 给定时只量**前 N 秒**（`-t`，BACKLOG 头部 ⑤）：4 分钟的轨整条量要 12–14s，
 *        而 `check --quick` 只是想看一眼数字有没有离谱。⚠ 截断**会改变读数本身**
 *        （整合响度是整段的量），所以 `check` 必须把"只量了前 N 秒"一起打出来 ——
 *        绝不能拿一个截断读数当整段的结论。返回的 `seconds` 就是这件事的凭据（没截断时是 null）。
 * @returns {{ ok: true, file: string, i: number, tp: number, lra: number, thresh: number,
 *             targetOffset: number, target: { i: number, tp: number, lra: number },
 *             raw: Record<string, any>, argv: string[], seconds: number|null }}
 * @throws {Error} 失败是**可区分**的三种（`err.kind`），绝不返回 `null` 让上游以为"测过了"：
 *   · `no-input`  —— 文件不存在 / 读不到；
 *   · `no-ffmpeg` —— 没有 ffmpeg（或 `ANIM_FFMPEG` 指的东西跑不起来）；
 *   · `ffmpeg-error` —— ffmpeg 自己非零退出（解不开的格式等）；
 *   · `no-json`   —— 跑完了但 stderr 里没有可解析的 loudnorm JSON（包装器吃掉了？ffmpeg 太老？）。
 */
export function measureLoudness(file, opts = {}) {
  const target = { ...LOUDNESS_TARGET, ...(opts.target ?? {}) };

  // ① 只解析给定文本（单测用；不碰 ffmpeg、不碰磁盘）
  if (typeof opts.stderr === 'string') {
    const raw = parseLoudnormJson(opts.stderr);
    if (!raw) {
      const e = new Error('给定的 stderr 里没有可解析的 loudnorm JSON');
      e.kind = 'no-json';
      throw e;
    }
    return { ...packLoudness(String(file), raw, target, []), seconds: null };
  }

  const f = String(file ?? '');
  if (!f || !existsSync(f)) {
    const e = new Error(`文件不存在：${f || '(空路径)'}`);
    e.kind = 'no-input';
    throw e;
  }

  // `-t` **必须是输入侧选项**（放在 `-i` 之前）—— 这一条是量出来的，别凭直觉改：
  //   放在 `-i` 之后（输出侧）时，muxer 的确只写 1.5s（日志里 `time=00:00:01.50`），
  //   但**滤镜图仍然吃到了整条轨** ⇒ `loudnorm` 报的还是全片读数（实测：先静音后有声的夹具
  //   给出 -14.27 而不是静音的 -inf，与不截断的 -14.16 只差 0.11 LU —— 一个**看着像结论的错数字**）。
  //   输入侧 `-t` = "只读输入的前 N 秒"，这才是我们要的语义。
  //   判据：`tools/test-loudness.mjs` ⑦（拿"先静音、后有声"的夹具钉住"读数必须掉下去"）。
  const win = Number(opts.seconds) > 0 ? Number(opts.seconds) : null;
  const argv = [...ffmpegArgv(), '-hide_banner', '-nostdin', '-v', 'info',
    ...(win ? ['-t', String(win)] : []),
    '-i', f,
    '-af', `loudnorm=I=${target.i}:TP=${target.tp}:LRA=${target.lra}:print_format=json`,
    '-f', 'null', '-'];
  const r = tryRun(argv);

  if (r.spawnError) {
    const e = new Error(`跑不起 ffmpeg（${argv[0]}）：${r.spawnError}。装一个，或用 ANIM_FFMPEG 指定。`);
    e.kind = 'no-ffmpeg';
    throw e;
  }
  if (r.status !== 0) {
    const tail = (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-6).join('\n');
    const e = new Error(`ffmpeg 量响度失败（exit ${r.status}）：${f}\n${tail}`);
    e.kind = 'ffmpeg-error';
    e.exit = r.status;
    throw e;
  }
  const raw = parseLoudnormJson(r.stderr);
  if (!raw) {
    const tail = String(r.stderr).trim().split(/\r?\n/).slice(-6).join('\n');
    const e = new Error(
      `ffmpeg 跑完了但 stderr 里没有 loudnorm 的 JSON：${f}\n`
      + `（是这个 ffmpeg 太老、没有 loudnorm 滤镜？还是 ANIM_FFMPEG 包装器把 stderr 吃掉了？）\n${tail}`);
    e.kind = 'no-json';
    throw e;
  }
  return { ...packLoudness(f, raw, target, argv), seconds: win };
}

/** 把 loudnorm 那串字符串字段收成结构化对象（`i` / `tp` / `lra` 一律是 `Number`，可能是 ±Infinity / NaN）。 */
function packLoudness(file, raw, target, argv) {
  return {
    ok: true,
    file,
    i: num(raw.input_i),
    tp: num(raw.input_tp),
    lra: num(raw.input_lra),
    thresh: num(raw.input_thresh),
    targetOffset: num(raw.target_offset),
    target,
    raw,
    argv,
  };
}

/**
 * 判据：**离 `-14 / -1` 差多少、有没有越界**。纯函数，单测直接断言它。
 *
 * 越界分两档（照 `check` 的既有哲学：越界 ≠ 一律失败）：
 *   · `error`：不达标（`|i − target.i| > tolLu`）、超过真峰上限（`tp > target.tp`）、或者数字本身不是有限数；
 *   · `warn` ：LRA 超过上限（口播 + 音乐床天然就宽 —— 提示"忽大忽小"，不 gate）。
 *
 * @param {ReturnType<typeof measureLoudness>|{ i:number, tp:number, lra:number, target?:any }} m
 * @param {{ tolLu?: number, tpCeiling?: number, lraMax?: number }} [opts]
 * @returns {{ ok: boolean, tolLu: number, di: number, dtp: number, dlra: number,
 *             loudOk: boolean, peakOk: boolean, lraOk: boolean, tier: 'ok'|'warn'|'error',
 *             violations: { kind: 'loudness'|'true-peak'|'lra'|'nan', tier: 'error'|'warn', text: string }[],
 *             verdict: string }}
 */
export function assessLoudness(m, opts = {}) {
  const target = { ...LOUDNESS_TARGET, ...(m?.target ?? {}), ...(opts.target ?? {}) };
  const tolLu = opts.tolLu ?? 1.0;
  const tpCeiling = opts.tpCeiling ?? target.tp;
  const lraMax = opts.lraMax ?? target.lra;

  const i = Number(m?.i);
  const tp = Number(m?.tp);
  const lra = Number(m?.lra);
  const finite = Number.isFinite(i);
  const tpFinite = Number.isFinite(tp);

  const di = finite ? i - target.i : NaN;
  const dtp = tpFinite ? tp - tpCeiling : NaN;
  const dlra = Number.isFinite(lra) ? lra - lraMax : NaN;

  const loudOk = finite && Math.abs(di) <= tolLu;
  // 真峰是**上限**：只要不比上限响就算过（比目标轻不是问题；NaN 也算不达标）
  const peakOk = tpFinite && tp <= tpCeiling;
  const lraOk = !Number.isFinite(lra) || lra <= lraMax;

  /** @type {{ kind: string, tier: 'error'|'warn', text: string }[]} */
  const violations = [];
  if (!finite) {
    violations.push({ kind: 'nan', tier: 'error', text: `量不出整合响度（input_i = ${m?.i}）—— 文件是静音、或者根本不是音频` });
  } else if (!loudOk) {
    violations.push({
      kind: 'loudness', tier: 'error',
      text: `${i.toFixed(1)} LUFS 离目标 ${target.i} 差了 ${di > 0 ? '+' : ''}${di.toFixed(1)} LU`
        + `（容差 ±${tolLu.toFixed(1)}）—— ${di > 0 ? '平台会把它压下来，动态被削' : '比平台靶子轻，观众得自己拧音量'}`,
    });
  }
  if (!tpFinite) {
    violations.push({ kind: 'nan', tier: 'error', text: `量不出真峰（input_tp = ${m?.tp}）` });
  } else if (!peakOk) {
    violations.push({
      kind: 'true-peak', tier: 'error',
      text: `真峰 ${tp.toFixed(2)} dBTP 超过上限 ${tpCeiling} dBTP：平台/有损转码会削顶`,
    });
  }
  if (!lraOk) {
    violations.push({
      kind: 'lra', tier: 'warn',
      text: `LRA ${lra.toFixed(1)} LU 超过 ${lraMax}：这一段忽大忽小（口播 + 音乐床的片子天然就宽，只提示不 gate）`,
    });
  }

  const tier = violations.some((v) => v.tier === 'error') ? 'error'
    : (violations.length ? 'warn' : 'ok');
  const verdict = tier === 'ok' ? `达标（${target.i} LUFS / ${target.tp} dBTP）` : violations.map((v) => v.text).join('；');
  return { ok: tier !== 'error', tolLu, di, dtp, dlra, loudOk, peakOk, lraOk, tier, violations, verdict };
}

/**
 * 人读的一行：`−13.8 LUFS / −1.2 dBTP / LRA 4.1`（`peak` 是**真峰**，不是采样峰值）。
 * @param {{ i:number, tp:number, lra:number }} m
 * @param {{ verdict?: boolean, target?: any }} [opts] `verdict: true` 时会在后面接一句判据文字
 */
export function formatLoudness(m, opts = {}) {
  const one = (v, u = '') => (Number.isFinite(v) ? `${v.toFixed(1)}${u}` : (v === -Infinity ? '-∞' : 'NaN'));
  const line = `${one(Number(m?.i))} LUFS / ${Number.isFinite(Number(m?.tp)) ? Number(m.tp).toFixed(2) : (Number(m?.tp) === -Infinity ? '-∞' : 'NaN')} dBTP`
    + ` / LRA ${one(Number(m?.lra))}`;
  return opts.verdict ? `${line} —— ${assessLoudness(m, opts).verdict}` : line;
}

/* ================================================================== 成片级技术扫描（1-39）
 *
 * 和上面那一层（响度）的分工：响度只量**音轨**；这一层量**编码后的整个文件** ——
 * 解码是否干净、黑场在哪、静帧多长、音量有没有。它存在的理由是一个真实的盲区：
 *
 *   · `check` 每段只采 15% / 50% / 85% 三个点（AGENTS.md §10.1）—— **切点两侧 0.3s 的黑闪
 *     正好从三个采样点之间漏过去**；
 *   · `rhythm` 是重新渲染再差分（`scripts/anim.mjs` 的 cmdRhythm），`verify` 是若干时刻抽帧比像素
 *     —— 两条都在"渲染/重渲"这一侧，**没有任何一条读过成片文件的每一秒**。
 *
 * ⚠ 这一层**只报读数**，不自动修、不默认 gate。黑场与静帧都可能是**设计如此**：
 * 我们的 `outro` 结尾压黑 0.6s、hold 段本来就不动（`rhythm` 的标定样本就有一段 1s 死静）。
 * 所以分类器把"片头淡入 / 片尾淡出 / 短静帧"降成 info，只有**中段黑场**与**过长的静帧**
 * 才是 warn —— 再交给调用方决定 `--strict` 要不要拦（与 loudness 的"只报数字"同一条纪律）。
 */

/** 秒 → 两位小数的读数（扫描输出里到处都是这种数）。 */
const s2 = (x) => (Number.isFinite(Number(x)) ? Number(x).toFixed(2) : 'NaN');

/**
 * qa 期望值校验（BACKLOG 1-77）——「对标 hallmark 的 NOT CHECKED 极性」。
 * 纯函数：吃 scan（probeMediaInfo/scanMediaFile 的读数）+ 期望，逐项给 pass / fail / not-checked。
 * **没传的规格 = not-checked（不算通过）**；显式传了又不符 = fail（翻极性，当门）。
 * 默认 qa 仍只报读数：一个 --expect-* 都不传时，这里全 not-checked，不产生任何 error。
 */
export const QA_SPEC_LIST = ['size', 'fps', 'duration', 'audio'];

/** '1920x1080' / '1920×1080' → {w,h}；写法不对返回 null。 */
export function parseSizeSpec(s) {
  const m = String(s).trim().match(/^(\d+)\s*[x×*]\s*(\d+)$/i);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

/**
 * @param {{width?:number|null,height?:number|null,fps?:number,duration?:number,hasAudio?:boolean}} scan
 * @param {{size?:string,fps?:string|number,duration?:string|number,audio?:string,durTol?:number,fpsTol?:number}} expects
 * @returns {{spec:string,status:'pass'|'fail'|'not-checked',expected:string|null,actual:string,text:string}[]}
 */
export function assessExpectations(scan, expects = {}) {
  const durTol = expects.durTol ?? 0.5;
  const fpsTol = expects.fpsTol ?? 0.5;
  const sizeStr = `${scan.width ?? '?'}×${scan.height ?? '?'}`;
  const fpsStr = scan.fps ? scan.fps.toFixed(2) : '?';
  const durStr = Number.isFinite(scan.duration) ? scan.duration.toFixed(3) + 's' : '?';
  const audStr = scan.hasAudio ? '有音轨' : '无音轨';
  const results = [];
  const push = (spec, status, expected, actual, text) => results.push({ spec, status, expected, actual, text });
  const given = (v) => v != null && v !== '';

  if (given(expects.size)) {
    const want = parseSizeSpec(expects.size);
    if (!want) push('size', 'fail', String(expects.size), sizeStr, `--expect-size 写法不对：${expects.size}（要 宽x高，如 1920x1080）`);
    else {
      const ok = scan.width === want.w && scan.height === want.h;
      push('size', ok ? 'pass' : 'fail', `${want.w}×${want.h}`, sizeStr, ok ? `尺寸 ${want.w}×${want.h} ✓` : `尺寸要 ${want.w}×${want.h}，实际 ${sizeStr}`);
    }
  } else push('size', 'not-checked', null, sizeStr, `尺寸 NOT CHECKED（没传 --expect-size；读数 ${sizeStr}）`);

  if (given(expects.fps)) {
    const want = Number(expects.fps);
    if (!Number.isFinite(want) || want <= 0) push('fps', 'fail', String(expects.fps), fpsStr, `--expect-fps 要一个正数（收到 ${expects.fps}）`);
    else {
      const ok = Number.isFinite(scan.fps) && Math.abs(scan.fps - want) <= fpsTol;
      push('fps', ok ? 'pass' : 'fail', String(want), fpsStr, ok ? `帧率 ${want}fps ✓` : `帧率要 ${want}fps，实际 ${fpsStr}fps`);
    }
  } else push('fps', 'not-checked', null, fpsStr, `帧率 NOT CHECKED（没传 --expect-fps；读数 ${fpsStr}fps）`);

  if (given(expects.duration)) {
    const want = Number(expects.duration);
    if (!Number.isFinite(want) || want <= 0) push('duration', 'fail', String(expects.duration), durStr, `--expect-duration 要一个正秒数（收到 ${expects.duration}）`);
    else {
      const ok = Number.isFinite(scan.duration) && Math.abs(scan.duration - want) <= durTol;
      push('duration', ok ? 'pass' : 'fail', `${want}s`, durStr, ok ? `时长 ${want}s ✓（±${durTol}s）` : `时长要 ${want}s（±${durTol}s），实际 ${durStr}`);
    }
  } else push('duration', 'not-checked', null, durStr, `时长 NOT CHECKED（没传 --expect-duration；读数 ${durStr}）`);

  if (expects.audio === 'required' || expects.audio === 'none') {
    const want = expects.audio === 'required';
    const ok = Boolean(scan.hasAudio) === want;
    push('audio', ok ? 'pass' : 'fail', expects.audio, audStr, ok ? `音轨 ${expects.audio} ✓` : (want ? '要求有音轨（--audio required），实际无音轨' : '要求无音轨（--audio none），实际有音轨'));
  } else if (given(expects.audio)) {
    push('audio', 'fail', String(expects.audio), audStr, `--audio 只认 required / none（收到 ${expects.audio}）`);
  } else push('audio', 'not-checked', null, audStr, `音轨 NOT CHECKED（没传 --audio；读数 ${audStr}）`);

  return results;
}

/**
 * 扫描用的 ffmpeg 滤镜串，以及它**实际生效的两个阈值**。
 * ⚠ 滤镜和报告里的数字必须同源：改了滤镜不改这里，打印出来的判据就是假的
 * （`classifyMediaScan()` 的 `thresholds` 直接读这份常量）。
 */
export const MEDIA_SCAN_FILTER = 'blackdetect=d=0.25:pix_th=0.10,freezedetect=n=-50dB:d=1';
export const MEDIA_SCAN_THRESHOLDS = { blackDur: 0.25, freezeDur: 1 };

/**
 * 用 ffprobe 量一个**媒体文件**的基本盘（时长 / 帧率 / 尺寸 / 有哪几条流）。
 * 与 `probeDuration` 的分工：那个只量音频时长，这个要喂给整片扫描。
 *
 * @param {string} file
 * @returns {{ file: string, duration: number, fps: number, width: number|null, height: number|null,
 *             hasVideo: boolean, hasAudio: boolean, streams: any[], format: any }}
 */
export function probeMediaInfo(file) {
  if (!existsSync(file)) throw new Error(`文件不存在：${file}`);
  const r = run([...ffprobeArgv(), '-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffprobe 读不动 ${file}：${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' ')}`);
  let j;
  try { j = JSON.parse(r.stdout); } catch (e) { throw new Error(`ffprobe 的输出不是 JSON：${String(e.message)}`); }
  const streams = Array.isArray(j.streams) ? j.streams : [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  const [num, den] = String(v?.avg_frame_rate || v?.r_frame_rate || '0/1').split('/').map(Number);
  const durations = [j.format?.duration, ...streams.map((s) => s.duration)].map(Number).filter(Number.isFinite);
  return {
    file,
    duration: Math.max(0, ...durations),
    fps: den ? num / den : 0,
    width: v?.width ?? null,
    height: v?.height ?? null,
    hasVideo: Boolean(v),
    hasAudio: Boolean(a),
    streams,
    format: j.format ?? {},
  };
}

/**
 * 从 ffmpeg 的 stderr 里解析 `blackdetect` / `freezedetect` 的区间。
 *
 * 日志长这样（前缀是滤镜实例，不参与解析）：
 *   `[blackdetect @ …] black_start:1.03333 black_end:2.06667 black_duration:1.03333`
 *   `[freezedetect @ …] lavfi.freezedetect.freeze_start: 3.2`
 *   `[freezedetect @ …] lavfi.freezedetect.freeze_end: 5`
 *
 * ⚠ **收尾时只有 start 没有 end**（片尾一直黑/一直静到文件结束）：那种区间按"开到文件末尾"处理，
 * `end = null`，由分类器补上总时长 —— 直接丢弃会让"整片后半段全黑"这种最严重的情况**报不出来**。
 *
 * @param {string} stderr ffmpeg 的 stderr
 * @param {'black'|'freeze'} kind
 * @returns {{ start: number, end: number|null, duration: number|null }[]}
 */
export function parseDetectIntervals(stderr, kind) {
  const text = String(stderr ?? '');
  // `freeze_start` 的日志前缀里已经带了 `lavfi.freezedetect.`，所以直接找 `<kind>_start:`
  // 就能同时命中两种写法；数字允许负数与科学计数（ffmpeg 偶尔会打 `1e-05`）。
  const num = '-?\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?';
  const starts = [...text.matchAll(new RegExp(`${kind}_start:\\s*(${num})`, 'gi'))].map((m) => Number(m[1]));
  const ends = [...text.matchAll(new RegExp(`${kind}_end:\\s*(${num})`, 'gi'))].map((m) => Number(m[1]));
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i < ends.length ? ends[i] : null;
    if (!Number.isFinite(start)) continue;
    if (end !== null && (!Number.isFinite(end) || end < start)) continue;
    out.push({ start, end, duration: end === null ? null : end - start });
  }
  return out;
}

/**
 * 对**编码后的文件**做一遍技术扫描：解码校验 + 黑场 + 静帧 + 音量。
 *
 * 跑三条 ffmpeg（`-f null -`，不落文件）：
 *   ① 解码：`-v error -xerror` —— 半截流 / 坏帧在这里就红；
 *   ② 画面：`blackdetect=d=0.25:pix_th=0.10, freezedetect=n=-50dB:d=1`；
 *   ③ 音频：`volumedetect`（`mean_volume` / `max_volume`）。
 * ②③ 分开跑是**故意的**：没有音轨的文件上 `-map 0:a:0` 会让整条命令非零退出，
 * 合并成一条时"没有音频"会被误读成"扫描失败"。
 *
 * @param {string} file
 * @param {{ decode?: boolean, timeoutMs?: number }} [opts] `decode:false` 跳过解码那一条（大文件赶时间）
 * @returns {{ file: string, duration: number, fps: number, width: number|null, height: number|null,
 *             hasVideo: boolean, hasAudio: boolean,
 *             decode: { ok: boolean, error: string|null },
 *             black: { start: number, end: number|null, duration: number|null }[],
 *             freeze: { start: number, end: number|null, duration: number|null }[],
 *             audio: { meanDb: number|null, peakDb: number|null } | null }}
 */
export function scanMediaFile(file, opts = {}) {
  const info = probeMediaInfo(file);
  const timeout = opts.timeoutMs ?? 30 * 60 * 1000;
  const base = [...ffmpegArgv(), '-hide_banner', '-nostats', '-v', 'error', '-i', file];

  /** @type {{ ok: boolean, error: string|null }} */
  let decode = { ok: true, error: null };
  if (opts.decode !== false) {
    const r = run([...base, '-xerror', '-map', '0:v?', '-map', '0:a?', '-f', 'null', '-'], { timeout, maxBuffer: 1 << 26 });
    if (r.status !== 0) {
      const tail = (r.stderr || r.stdout).trim().split(/\r?\n/).filter(Boolean).slice(-3).join('；');
      decode = { ok: false, error: tail || `ffmpeg 退出码 ${r.status}` };
    }
  }

  let black = [];
  let freeze = [];
  if (info.hasVideo) {
    const r = run([
      ...ffmpegArgv(), '-hide_banner', '-nostats', '-v', 'info', '-i', file,
      '-map', '0:v:0', '-vf', MEDIA_SCAN_FILTER,
      '-f', 'null', '-',
    ], { timeout, maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error(`黑场/静帧扫描失败：${(r.stderr || '').trim().split(/\r?\n/).slice(-3).join(' ')}`);
    // ⚠ ffmpeg 在**文件结束时**经常会漏打 `freeze_end` / `black_end`（片尾一直在黑/静，
    //   没有"下一帧"来关门）。解析器保留 end=null 的诚实形状，扫描器在这里用实测总时长收口 ——
    //   不收口的话"整片后半段全黑/全静"这种最严重的情况反而算不出时长。
    const close = (list) => list.map((x) => (x.end === null && info.duration
      ? { start: x.start, end: info.duration, duration: Math.max(0, info.duration - x.start) }
      : x));
    black = close(parseDetectIntervals(r.stderr, 'black'));
    freeze = close(parseDetectIntervals(r.stderr, 'freeze'));
  }

  /** @type {{ meanDb: number|null, peakDb: number|null } | null} */
  let audio = null;
  if (info.hasAudio) {
    const r = run([...ffmpegArgv(), '-hide_banner', '-nostats', '-v', 'info', '-i', file,
      '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'], { timeout, maxBuffer: 1 << 24 });
    if (r.status === 0) {
      const grab = (key) => {
        const m = String(r.stderr).match(new RegExp(`${key}:\\s*(-?inf|-?[\\d.]+)\\s*dB`, 'i'));
        return m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : null;
      };
      audio = { meanDb: grab('mean_volume'), peakDb: grab('max_volume') };
    }
  }

  return {
    file, duration: info.duration, fps: info.fps, width: info.width, height: info.height,
    hasVideo: info.hasVideo, hasAudio: info.hasAudio,
    decode, black, freeze, audio,
  };
}

/** 把 `{ start, end }` 补成分类器要的形状（片尾开口的区间用总时长收口）。 */
function closeIntervals(list, duration) {
  return (list ?? []).map((x) => {
    const start = Math.max(0, Number(x.start));
    const end = x.end === null || x.end === undefined ? (duration || start) : Number(x.end);
    return { start, end, duration: Math.max(0, end - start) };
  });
}

/**
 * 把 `scanMediaFile()` 的读数分成 **error / warn / info** 三档 —— 这一步才是判据，也是唯一可单测的部分。
 *
 * 判据（阈值都在返回值里，打印时一起打出来）：
 *   · 解码失败 → **error**（文件坏了，什么都不用谈）；
 *   · 黑场：起点在片头 `head` 秒内 → info「淡入」；起点在片尾 `tail` 秒内 → info「淡出」；
 *     其余 → **warn**（切点黑闪、某段没画东西都在这一类）；
 *   · 静帧：时长 < `maxFreeze` → info「hold（设计如此）」；≥ `maxFreeze` → **warn**
 *     （多是我们自己的 hold，但 3 秒以上值得回去看一眼是不是忘了推进）；
 *   · 音量：峰值 ≤ -60 dB → **warn**「静音」；≥ -0.1 dB → info「贴满刻度」（平台会压）；
 *     中间 → info 读数。
 *
 * @param {ReturnType<typeof scanMediaFile>} scan
 * @param {{ head?: number, tail?: number, maxFreeze?: number }} [opts]
 * @returns {{ items: { kind: string, tier: 'error'|'warn'|'info', at: number|null, text: string }[],
 *             errors: any[], warnings: any[], infos: any[],
 *             thresholds: { head: number, tail: number, maxFreeze: number, blackDur: number, freezeDur: number } }}
 */
export function classifyMediaScan(scan, opts = {}) {
  const head = opts.head ?? 0.5;
  const tail = opts.tail ?? 1.2;
  const maxFreeze = opts.maxFreeze ?? 3.0;
  const duration = Number(scan?.duration) || 0;
  /** @type {{ kind: string, tier: 'error'|'warn'|'info', at: number|null, text: string }[]} */
  const items = [];

  if (scan?.decode && scan.decode.ok === false) {
    items.push({ kind: 'decode', tier: 'error', at: null, text: `解码失败：${scan.decode.error || '未知原因'}` });
  }

  for (const b of closeIntervals(scan?.black, duration)) {
    const at = b.start;
    if (at < head) {
      items.push({ kind: 'black', tier: 'info', at, text: `片头淡入 ${s2(b.start)}–${s2(b.end)}s（${s2(b.duration)}s，< --head ${head}s，算设计）` });
    } else if (duration && at >= duration - tail) {
      items.push({ kind: 'black', tier: 'info', at, text: `片尾淡出 ${s2(b.start)}–${s2(b.end)}s（${s2(b.duration)}s，收尾压黑）` });
    } else {
      items.push({ kind: 'black', tier: 'warn', at, text: `第 ${s2(b.start)}s 起黑场 ${s2(b.duration)}s（到 ${s2(b.end)}s）—— 切点黑闪，或这一段没画东西` });
    }
  }

  // 黑场天然也是"静帧"（整片静止）。不去重的话一段 1s 黑场会被报三条（黑场 + 两个静帧），
  // 读数淹没判据。规则：静帧有 ≥80% 落在某个黑场区间里就丢掉 —— 黑场那条已经说了。
  const blackRanges = closeIntervals(scan?.black, duration);
  const mostlyBlack = (f) => blackRanges.some((b) => {
    const overlap = Math.min(f.end, b.end) - Math.max(f.start, b.start);
    return overlap > 0 && overlap >= f.duration * 0.8;
  });

  for (const f of closeIntervals(scan?.freeze, duration)) {
    if (mostlyBlack(f)) continue;
    const tier = f.duration >= maxFreeze ? 'warn' : 'info';
    items.push({
      kind: 'freeze', tier, at: f.start,
      text: `第 ${s2(f.start)}s 起静帧 ${s2(f.duration)}s（到 ${s2(f.end)}s）`
        + (tier === 'warn' ? ` —— 超过 ${maxFreeze}s，先确认不是忘了推进` : ' —— hold 段正常'),
    });
  }

  if (scan?.audio) {
    const { meanDb, peakDb } = scan.audio;
    if (Number.isFinite(peakDb) && peakDb <= -60) {
      items.push({ kind: 'audio', tier: 'warn', at: null, text: `音轨几乎静音（峰值 ${peakDb.toFixed(1)} dB）—— 混音或旁白没接上？` });
    } else if (Number.isFinite(peakDb) && peakDb >= -0.1) {
      items.push({ kind: 'audio', tier: 'info', at: null, text: `音量贴满刻度（峰值 ${peakDb.toFixed(2)} dB）—— 平台/有损转码会削顶` });
    } else if (Number.isFinite(meanDb) || Number.isFinite(peakDb)) {
      items.push({ kind: 'audio', tier: 'info', at: null, text: `音量读数 mean ${Number.isFinite(meanDb) ? meanDb.toFixed(1) : 'NaN'} dB / peak ${Number.isFinite(peakDb) ? peakDb.toFixed(1) : 'NaN'} dB` });
    }
  }

  return {
    items,
    errors: items.filter((i) => i.tier === 'error'),
    warnings: items.filter((i) => i.tier === 'warn'),
    infos: items.filter((i) => i.tier === 'info'),
    thresholds: { head, tail, maxFreeze, ...MEDIA_SCAN_THRESHOLDS },
  };
}
