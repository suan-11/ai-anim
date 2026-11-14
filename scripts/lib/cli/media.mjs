// @ts-check
import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { die, warn } from "./log.mjs";
import { ROOT } from "./paths.mjs";
/* ------------------------------------------------------------------ ffmpeg */

/**
 * ffmpeg / ffprobe 的可执行命令（拆成 [bin, ...固定参数]）。
 *
 * 固定参数是为了支持**包装器**：测试里用 `ANIM_FFMPEG="node tools/slow-ffmpeg.mjs"`
 * 把 ffmpeg 的输入读慢，从而稳定复现「编码比渲染慢」的背压场景。
 * 环境变量里带空格没关系——这里自己做一次朴素拆分（够用：路径没有空格或已加引号）。
 */
function ffmpegCmd() {
  const raw = process.env.ANIM_FFMPEG || 'ffmpeg';
  const parts = raw.match(/"[^"]+"|\S+/g)?.map((s) => s.replace(/^"|"$/g, '')) ?? ['ffmpeg'];
  return parts.length ? parts : ['ffmpeg'];
}
/**
 * 这台 ffmpeg 有没有某个编码器（结果**缓存**，一次出片只跑一次探测）。
 *
 * 为什么要探：Windows 上最常见的发行包是 **LGPL 构建**（`--disable-libx264`），
 * 而引擎默认走 `libx264`。不探的后果不是"报错"，是**静默死**：ffmpeg 打一行
 * `Unrecognized option 'x264-params'` 就退出，CLI 还在等帧，看起来像"卡死"
 * （2026-10-25 实测挂 20 分钟）。这里把"有没有"变成可判定的事实。
 *
 * @param {string} name 编码器名（`libx264` / `h264_mf` / `libopenh264` …）
 * @returns {boolean}
 */
const encoderCache = new Map();
function ffmpegHasEncoder(name) {
  if (encoderCache.has(name)) return encoderCache.get(name);
  let ok = false;
  try {
    const cmd = ffmpegCmd();
    const r = spawnSync(cmd[0], [...cmd.slice(1), '-hide_banner', '-encoders'], {
      encoding: 'utf8', timeout: 20000, windowsHide: true,
    });
    const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    ok = new RegExp(`^\\s*[VAS][.\\w]{5}\\s+${name}\\s`, 'm').test(text);
  } catch { ok = false; }
  encoderCache.set(name, ok);
  return ok;
}

/**
 * 挑一个**这台 ffmpeg 真的有的**编码器。
 *
 * 默认仍是 `libx264`（质量最好、参数最全）。但这台机器上踩过：PATH 里的 ffmpeg 是
 * **LGPL 构建**（`--disable-libx264`），于是默认参数里的 `-x264-params` 直接把它打死，
 * 而 CLI 只表现为"卡住"。所以这里先探一次，缺了就退到能用的那个，并把原因**说出来** ——
 * 宁可画面参数不是最优，也不要静默出一支废片。
 *
 * 兜底顺序：`h264_mf`（Windows 自带的硬件编码，AMD/NVIDIA/Intel 都能吃）→
 * `libopenh264`（LGPL 构建常见）→ 报错（并告诉你去装 GPL 构建）。
 *
 * @param {string} requested
 * @returns {string}
 */
/**
 * 编码器**真的能跑起来**吗 —— 列在 -encoders 里不代表这台机器能用：
 * h264_nvenc 在没有 NVIDIA 卡的机器上照样出现在列表里，一 init 就失败、ffmpeg 打一行错退出，
 * 表现是「只渲染了 5/N 帧」（2026-11-02 全量回归：determinism / worktree-edit 两条都挂在这）。
 * 判据：真编一帧 64×64 黑，退出码 0 才算能跑。
 */
const encoderWorks = new Map();
function ffmpegEncoderWorks(name) {
  if (encoderWorks.has(name)) return encoderWorks.get(name);
  let ok = false;
  try {
    const cmd = ffmpegCmd();
    const r = spawnSync(cmd[0], [
      ...cmd.slice(1), '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.1',
      '-frames:v', '1', '-c:v', name, '-f', 'null', '-',
    ], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    ok = r.status === 0;
  } catch { ok = false; }
  encoderWorks.set(name, ok);
  return ok;
}

function pickVideoEncoder(requested) {
  // 先看「列没列出来」，再看「真能不能编一帧」——
  // 后者才是这次全量回归里两条 smoke 的真正死因（h264_nvenc 有列表项、没显卡）
  if (ffmpegHasEncoder(requested)) {
    if (ffmpegEncoderWorks(requested)) return requested;
    warn(`⚠ ${requested} 在这台机器上**用不了**（能列出但编不动一帧，多半是没有对应的硬件/驱动），改用兜底编码器。`);
  }
  const chain = process.platform === 'win32'
    ? ['h264_mf', 'libopenh264']
    : ['libopenh264'];
  const alt = chain.find((c) => c !== requested && ffmpegHasEncoder(c) && ffmpegEncoderWorks(c));
  if (!alt) {
    die(`这台 ffmpeg 既没有 ${requested}，也没有可用的兜底编码器（${chain.join(' / ')}）。\n`
      + `  装一个带 libx264 的 GPL 构建（例如 winget install Gyan.FFmpeg），\n`
      + `  或用 --vcodec 指定一个这台机器真有的编码器（看 ffmpeg -hide_banner -encoders）。`);
  }
  warn(`⚠ 这台 ffmpeg 没有 ${requested}（多半是 LGPL 构建），改用 ${alt}。`);
  warn(`  要原配方（crf16 + tune grain）就装 GPL 构建，或用 --vcodec / ANIM_VCODEC 显式指定。`);
  return alt;
}

function ffprobeCmd() {
  if (process.env.ANIM_FFPROBE) {
    const parts = process.env.ANIM_FFPROBE.match(/"[^"]+"|\S+/g)?.map((s) => s.replace(/^"|"$/g, '')) ?? [];
    if (parts.length) return parts;
  }
  // ⚠ 刻意**不**从 ANIM_FFMPEG 推导 ffprobe：
  //   ① 包装器路径里就有 "ffmpeg" 字样（tools/slow-ffmpeg.mjs），一改就成了不存在的文件；
  //   ② 包装器给 ffmpeg 的固定参数（`-y -loglevel error`）ffprobe 一个都不认识，
  //      会直接 "Unrecognized option" 退出，守门跟着误报（这两条都刚踩过）。
  //   ffprobe 在 PATH 里，独立用 ANIM_FFPROBE 指定即可。
  return ['ffprobe'];
}
function ffmpegPath() { return ffmpegCmd()[0]; }
function ffprobePath() { return ffprobeCmd()[0]; }

/**
 * 把 Windows 的**无符号**退出码转成有符号（`4294967274` → `-22`，即 EINVAL）。
 *
 * 为什么要转：编码器参数写错时 ffmpeg 退的是 `-22`，但 Node 在 Windows 上拿到的是
 * 4294967274 —— 报错里出现这个数字，读者第一反应是"这是什么天文数字"。
 * 转成负数之后，`-22` 至少能让人联想到"参数不对"。
 * @param {number|null|undefined} c
 */
function signedExitCode(c) {
  if (typeof c !== 'number') return c;
  return c > 0x7fffffff ? c - 0x100000000 : c;
}


function checkFfmpeg() {
  // 把固定的前缀参数一起带上（ANIM_FFMPEG 可能是个包装器，例如 `node tools/slow-ffmpeg.mjs`）
  const [bin, ...prefix] = ffmpegCmd();
  return new Promise((resolve) => {
    const p = spawn(bin, [...prefix, '-version'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

function checkFfprobe() {
  const [bin, ...prefix] = ffprobeCmd();
  return new Promise((resolve) => {
    const p = spawn(bin, [...prefix, '-version'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

/**
 * 跑一个子进程并捕获 stdout（ffprobe / ffmpeg 的读数用）。
 * stdio 走管道，绝不进 shell —— 参数里的 `>` 之类不会被解释成重定向。
 * @returns {Promise<{ code: number|null, out: string, err: string }>}
 */
function capture(cmd, args) {
  const [bin, ...prefix] = Array.isArray(cmd) ? cmd : [cmd];
  return new Promise((resolve) => {
    const p = spawn(bin, [...prefix, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.setEncoding('utf8');
    p.stderr.setEncoding('utf8');
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ code: -1, out, err: out + String(e && e.message ? e.message : e) }));
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

/**
 * 读一个媒体文件的视频流信息。
 *
 * ⚠ 这是**产物守门**的地基（P0-3）：CLI 自己数的帧数不能信 —— 曾经出现「收满了 330 帧、
 *   但 ffmpeg 拿到的是半截流、根本没写 moov」的情况，CLI 报 ✓、文件却打不开。
 *   只有让 ffprobe 去看**实际写出来的文件**，才骗不过去。
 *
 * `count: true` 走 `-count_frames`（逐帧解码数帧，几秒的片子约 0.1s 级，
 * 但**打不开的文件会在这里直接报错**，这正是我们要的）。默认走容器头里的 nb_frames，快得多。
 *
 * @param {string} file
 * @param {{ count?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, frames: number|null, duration: number|null, width: number|null,
 *                     height: number|null, fps: number|null, reasons: string[] }>}
 */
async function probeVideo(file, opts = {}) {
  const reasons = [];
  if (!existsSync(file)) {
    return { ok: false, frames: null, duration: null, width: null, height: null, fps: null, reasons: [`文件不存在：${file}`] };
  }
  let size = 0;
  try { size = statSync(file).size; } catch { /* 下面会当成读不出来 */ }
  if (!size) reasons.push('文件是 0 字节');
  const args = ['-v', 'error'];
  if (opts.count) args.push('-count_frames');
  args.push('-select_streams', 'v:0', '-show_entries',
    'stream=width,height,r_frame_rate,nb_read_frames,nb_frames,duration',
    '-of', 'json', file);
  const r = await capture(ffprobeCmd(), args);
  if (r.code !== 0) {
    // 最常见、也最贵的一种废品：ffmpeg 拿到半截流 -> 没写 moov -> 整个文件打不开
    if (/moov atom not found/i.test(r.err)) reasons.push('ffprobe 打不开：moov atom not found（流是半截的，ffmpeg 没 finalize）');
    else if (/Invalid data found/i.test(r.err)) reasons.push(`ffprobe 打不开：${r.err.trim().split('\n')[0]}`);
    else reasons.push(`ffprobe 退出码 ${r.code}：${r.err.trim().split('\n').slice(0, 2).join(' | ') || '(无输出)'}`);
    return { ok: false, frames: null, duration: null, width: null, height: null, fps: null, reasons };
  }
  let st = null;
  try { st = JSON.parse(r.out)?.streams?.[0] ?? null; } catch { /* 下面按缺失处理 */ }
  if (!st) {
    reasons.push('ffprobe 没有返回视频流（文件里没有可解码的画面）');
    return { ok: false, frames: null, duration: null, width: null, height: null, fps: null, reasons };
  }
  // -count_frames 给 nb_read_frames（比较慢但一定准）；不带它时容器头里可能有 nb_frames
  const rawFrames = st.nb_read_frames ?? st.nb_frames ?? null;
  const frames = rawFrames == null ? null : Number(rawFrames);
  const [rn, rd] = String(st.r_frame_rate ?? '0/1').split('/').map(Number);
  const fps = rd ? rn / rd : null;
  return {
    ok: reasons.length === 0,
    frames,
    duration: st.duration != null ? Number(st.duration) : null,
    width: st.width ?? null,
    height: st.height ?? null,
    fps,
    reasons,
  };
}

/**
 * 产物守门：检查一个刚写出来的 mp4 是否**真的**是完整的。
 * @param {string} file
 * @param {number} expect 期望帧数
 * @param {{ what?: string, count?: boolean, fps?: number }} [opts]
 * @returns {Promise<string[]>} 问题列表（空 = 通过）
 */
async function checkVideoFile(file, expect, opts = {}) {
  const what = opts.what ?? path.relative(ROOT, file);
  const p = await probeVideo(file, { count: opts.count });
  if (!p.ok) return p.reasons.map((s) => `${what}：${s}`);
  const bad = [];
  if (p.frames != null && p.frames !== expect) {
    bad.push(`${what}：ffprobe 数出 ${p.frames} 帧，期望 ${expect} 帧（差 ${p.frames - expect}）`);
  } else if (p.frames == null) {
    bad.push(`${what}：ffprobe 读不到帧数（容器里没有 nb_frames）`);
  }
  if (opts.fps && p.fps && Math.abs(p.fps - opts.fps) > 0.01) {
    bad.push(`${what}：帧率 ${p.fps} ≠ 期望 ${opts.fps}`);
  }
  return bad;
}


/**
 * 「拼好的视频 + 一条音轨」封装的**唯一参数表**（顺序路径与并行路径共用）。
 *
 * ⚠ `-af apad` 与 `-shortest` 必须成对：只有 `-shortest` 时它按容器记账时长取短的那一路，
 * AAC 的 priming/padding 会让音频记账时长比视频短几十毫秒 → **视频尾巴被切掉**
 * （详见 `renderSegments()` 里那段实测注释）。
 */
function audioMuxArgs(stitched, audioFile, from, out) {
  return [
    '-y', '-loglevel', 'error',
    '-i', stitched, '-ss', String(from), '-i', audioFile,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k',
    '-af', 'apad', '-shortest',
    '-movflags', '+faststart', out,
  ];
}

/** 跑一个 ffmpeg 子进程并等它结束；非零退出码直接报错。 */function runFfmpeg(args) {
  const [bin, ...prefix] = ffmpegCmd();
  return new Promise((resolve, reject) => {
    const p = spawn(bin, [...prefix, ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(null) : reject(new Error(`ffmpeg 退出码 ${code}（${args.slice(-1)[0]}）`))));
  });
}

/**
 * 时间戳守门：帧距与首帧 PTS 是否严格。
 *
 * 为什么帧数对了还要看这个（`docs/history/IMPROVEMENTS-1-3.md` P2-1）：拼接如果走了
 * "先转 MPEG-TS 再拼"，帧数可以是 720、`r_frame_rate` 也写 60，
 * 但 `avg_frame_rate` 变成 43200/719 ≈ 60.08、duration 11.983 —— 帧在时间轴上
 * 不是均匀铺开的（接缝处有半帧级空隙）。这种片子**帧数没错、能播、但节奏是歪的**，
 * 只有量时间戳才发现得了。
 *
 * @returns {Promise<string[]>} 问题列表（空 = 通过）
 */
async function checkTimestamps(file, fps, expectFrames) {
  const bad = [];
  // ⚠ 用 **packet** 而不是 frame：`ffprobe -show_frames` 是按**解码顺序**输出的，
  //   有 B 帧时前几个的 pts_time 不是单调的（实测第一项会是 0.016667 而不是 0），
  //   拿它判"首帧 PTS / 帧距"会误报。
  // ⚠ `-of default=nw=1` 只输出 `pts_time=0.000000`：csv 模式会把 packet 的多个字段
  //   塞进同一行（pts,dts,size,flags），只挑"看起来像数字"的行会把数据切碎成
  //   一堆重复的 0 —— 判据于是报出"第 1 帧差 16.67ms"这种假问题。
  //   （这条和下面那条 `\r` 一起，让我在 `-copyts` 上白折腾了一轮：判据自己把数据弄坏了。）
  const r = await capture(ffprobeCmd(), [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'packet=pts_time', '-of', 'default=nw=1',
    '-read_intervals', `%+#${Math.min(240, expectFrames)}`, file,
  ]);
  if (r.code !== 0) return [`读不出 ${path.basename(file)} 的时间戳：${r.err.trim().split('\n')[0]}`];
  // 取 `pts_time=` 后面的数，去重、再按**显示顺序**排（B 帧会让 packet 顺序非单调）。
  //
  // ⚠⚠ 去重是**必须**的：`-read_intervals %+#N` 在 N 超过文件剩余帧数时不会截断，
  //   而是把**第一帧重复吐 N 遍**。于是数组里会出现两个 `0.000000` 挨着，
  //   "帧距 = 0" 就被算成差了整整一帧 —— 判据于是报出
  //   「第 1 帧处差了 16.67ms」这种**完全假**的问题（我在 `-copyts` 上因此白折腾了一轮）。
  //   真实的视频不可能有两帧同一个 PTS，所以按值去重是安全的。
  const pts = [...new Set(r.out.split('\n')
    .map((s) => Number(s.trim().replace(/^[^=]*=/, '')))
    .filter(Number.isFinite))].sort((a, b) => a - b);
  if (pts.length < 3) return [`时间戳只读到 ${pts.length} 个（期望 ≥3）`];
  if (Math.abs(pts[0]) > 1e-6) bad.push(`首帧 PTS = ${pts[0].toFixed(6)}（期望 0.000000）—— 整条视频被推后了`);
  const step = 1 / fps;
  // ⚠ 只比**相邻两帧都有效**的区间：`-read_intervals %+#N` 在文件最后一帧之后会多出
  //   一个空行，被过滤后相邻项之间就"跳"了一大段，看起来像帧距爆炸。
  let worst = 0, worstAt = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i] - pts[i - 1]) - step);
    if (d > worst) { worst = d; worstAt = i; }
  }
  if (worst > step * 0.02) {
    bad.push(`帧距不齐：第 ${worstAt} 帧处差了 ${(worst * 1000).toFixed(2)}ms（期望 1/${fps}s = ${(step * 1000).toFixed(2)}ms）`);
  }
  const p = await probeVideo(file, { count: true });
  if (p.frames != null && expectFrames != null && p.frames !== expectFrames) {
    bad.push(`逐帧数出 ${p.frames} 帧，期望 ${expectFrames}`);
  }
  return bad;
}

export { audioMuxArgs, checkFfmpeg, checkTimestamps, checkVideoFile, ffmpegCmd, pickVideoEncoder, probeVideo, runFfmpeg, signedExitCode };
