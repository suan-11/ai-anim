#!/usr/bin/env node
// @ts-check
/**
 * anim CLI —— agent 和人都用这一个入口。
 *
 * 【出片】
 *   node scripts/anim.mjs tasks                          列出任务
 *   node scripts/anim.mjs new <名字>                      新建任务骨架
 *   node scripts/anim.mjs shots [名字] [--json]           列出镜头模板（A 档镜头库 src/shots/）与参数；
 *                                                         --json = 机器可读的参数表（字段契约 docs/ENGINE.md §14.9）
 *   node scripts/anim.mjs styles                          列出风格包（task.config.mjs 里写 style: '名字'，
 *                                                         一行换掉整片观感；docs/STYLE.md）
 *   ── 只写配置出片（B 档）：timeline 里直接写 { type: 'title', … }，连 scenes/ 都不需要；
 *      节点字段、11 个模板、排错表见 docs/CONFIG-ONLY.md，可跑的完整示例见 tasks/example-config-only/
 *   node scripts/anim.mjs still <task> -t 1.5,2,3 [-o dir] 出单帧 PNG（agent 用它看图）
 *   node scripts/anim.mjs cover <task> -t 12 --title "…" [--sub "…"] [--scale 2]
 *                                                        出封面：那一帧 + 压字（底部渐变压暗 → 主标题 →
 *                                                        信号色短线 → 副标）。字用引擎那套字体，
 *                                                        不是 ffmpeg drawtext 另找一份（BACKLOG 1-53）
 *   node scripts/anim.mjs chapters <task> [--min 4] [--json]
 *                                                        章节时间码（`mm:ss 段名`）→ out/<task>/chapters.txt
 *                                                        首段必是 00:00；短于 --min 的段并进上一章
 *   node scripts/anim.mjs sheet <task> --from 0 --to 10 -n 12  出接触表（一张图看一段）
 *   node scripts/anim.mjs cuts <task> [--window 1.5] [--n 7]   切点两侧各 ±1.5s 出一张接触表
 *                                                        （三点采样不落在切点上，切点要单独看；
 *                                                         画方框的那一格就是切点 = 后一段第一帧）
 *   node scripts/anim.mjs video <task> [--from 1 --to 5]  逐帧渲染 + ffmpeg 出 mp4（收尾自动 ffprobe 复核）
 *   node scripts/anim.mjs shot  <task> --from 0 --to 4    出无音轨的短预览 mp4（快）
 *   node scripts/anim.mjs queue <taskA> <taskB> […选项]    睡前排队渲几支：顺序渲完（并行实测更慢）、
 *                                                          每支结束响一声、全部结束响三声、某支失败不中断后续；
 *                                                          选项原样转发给 video（如 --segments 10 --gpu high）
 *   node scripts/anim.mjs video <task> --dry-run          按档预估：草稿档/成片档各测 10 帧，给两条分钟数，不出片
 *   node scripts/anim.mjs video <task> --draft            草稿档：半分辨率（960×540）+ samples=1，
 *                                                         只用来审节奏与信息密度（**不是成片**；定稿去掉）
 *   node scripts/anim.mjs analyze <task>                  分析音频（拍子/小节/段落/包络）
 *
 * 【口播/旁白】（docs/NARRATION.md；这两条都不渲染画面，改旁白/换音色不用动场景代码）
 *   node scripts/anim.mjs say <task> [--voice X] [--rate X] [--script 文件] [--bpm N]
 *                                  [--tail 1.2] [--max-stretch 1.9] [--tts "<命令>"]
 *                                  [--force] [--dry-run] [--no-vo] [--pin-timing]
 *                                                        读 tasks/<任务>/narration.mjs（找不到就看 tools/narration.mjs）
 *                                                        → 逐句 TTS → 量真实时长 → 反推每段 stretch/slot →
 *                                                        写 audio/timing.{json,mjs} + narration.json + <任务>-vo.mp3
 *                                                        （叠句、放慢到 MAX_STRETCH、节拍源缺失都会报警；
 *                                                          --dry-run **不写** timing/narration/旁白轨，
 *                                                          但仍会合成或复用音频来量真实时长；--force 全部重合成）
 *   node scripts/anim.mjs mix <task> [--music x.mp3] [--out y.mp3] [--vo-only] [--bitrate 192k]
 *                                  [--target streaming|cinema|off|<数字>] [--lra N]
 *                                                        旁白摆到绝对时刻 + 用旁白包络给音乐**闪避** →
 *                                                        audio/<任务>-mix.mp3（引擎只认一条音轨，见 NARRATION.md）
 *                                                        --music 不给就从 task.audio 里取；
 *                                                        收尾会报一次响度数字（LUFS / true peak / LRA）；
 *                                                        --target **默认关**（只报不动），开了才用两遍式
 *                                                        loudnorm 归一化，并打印 before → after 与是否达标
 *                                                        （数字 = 整合响度贴到它，真峰仍取 -1；见 NARRATION.md §7）
 *   node scripts/anim.mjs subs <task> [--out dir] [--name x] [--per 16]
 *                                                         从旁白表导出 .srt / .ass（给**视频平台上传**用的软字幕；
 *                                                         Netflix 简体中文：每行 ≤16 字、最多 2 行）
 *                                                         ⚠ task.config.mjs 里开了 captions: true 就别再烧一遍
 *                                                         —— 那是两层字幕（docs/CAPTIONS.md）
 *
 * 【评论（NOTES.json）】——「第 12.5 秒这里字幕太小」这类反馈的落点（BACKLOG 1-29）。
 *   评论是**普通项目文件**：读写都走文件、不轮询、不重编译 —— 记一条评论**不需要**跑渲染。
 *   落在 `out/<任务>/NOTES.json`（utf8）；半截 / 损坏的 JSON 会报到行列，不当成"还没有评论"、
 *   也**不会**被覆盖（那句话是反馈的唯一落点，宁可停下来让人修）。
 *   ⚠ `anim clean` **绝不**删它（评论不是中间产物）；但 `out/` 在 .gitignore 里 —— 评论不进版本控制。
 *   node scripts/anim.mjs note <任务> "第 12.5 秒这里字幕太小" --at 12.5  记一条（--at 是秒，可省）
 *   node scripts/anim.mjs note <任务> --list [--json]     列出（○ 未解决 / ✓ 已解决）
 *   node scripts/anim.mjs note <任务> --resolve n1        把某条标记成已解决
 *
 * 【验收与诊断】——改完先跑这几条，比人眼看图可靠
 *   node scripts/anim.mjs check <task> [--sheet] [--quick] [--strict]
 *                                                       三点采样 + 多子帧比对 + 背景守门 + 场景异常；
 *                                                       任何**没跑成 / 被跳过**的审计都会列进输出末尾的
 *                                                       `skipped:` 段（"空 ≠ 干净"，见 BACKLOG 1-19）。
 *                                                       ⚠ skipped **默认不影响退出码**（回归清单依赖它）；
 *                                                       --strict 才把"有跳过"也算成失败（退出码 1）
 *   node scripts/anim.mjs verify <task> [--file x.mp4 --from 1 --samples 2 --tol 18]
 *                                                        成片抽帧 vs 同 t 重渲，按**帧号**逐像素比
 *                                                        （--from 是成片在任务时间轴上的起点）
 *   node scripts/anim.mjs qa <task> [--file x.mp4 --strict --freeze 3]
 *                                                        成片级技术扫描（纯 ffmpeg，不起浏览器）：
 *                                                        解码 / 黑场 / 静帧 / 音量，报区间。
 *                                                        默认只报读数，--strict 才把 warn 当失败
 *   node scripts/anim.mjs hashes <task> --save            存画面基线（第一次；**已存在时拒绝覆盖**）
 *   node scripts/anim.mjs hashes <task> --baseline        与基线逐像素比（变了 ⇒ 退出码 1）
 *   node scripts/anim.mjs hashes <task> --accept --note "为什么"
 *                                                        有意改画面：先比一遍 + 落前后对比图，再存新基线
 *                                                        （note 写进基线，下次比对失败会打出来）
 *   node scripts/anim.mjs probe <task> --times 4,12       渲染顺序会不会改变结果（确定性）
 *   node scripts/anim.mjs diff <task> --times 12          同一时刻渲两次，差了多少
 *   node scripts/anim.mjs audit <task> [--debug]          每个交叠段在交叠期到底画了什么
 *   node scripts/anim.mjs probe-alpha <task>              整行淡入（alpha）到底生效没有
 *   node scripts/anim.mjs determinism <task> --from 0 --frames 40
 *                                                        顺向/反向/单次 seek 三种序列是否一致
 *   node scripts/anim.mjs carry <task> [--at 12,30] [--strict]
 *                                                        连贯度审计：每个镜头边界两侧各渲一帧、
 *                                                        块匹配判 carried/anchored/bare，汇总 carry score
 *                                                        （<0.5 像 PPT、<0.7 有缝；默认只报读数，
 *                                                          --strict 才 gate。判据与豁免见
 *                                                          docs/REFERENCE-onetake.md §2）
 *   node scripts/anim.mjs rhythm <task> [--step 0.5] [--strict]
 *                                                        静/动分段：降采样渲帧 → 相邻帧差 →
 *                                                        死静帧占比（≥25%）与最长静段（≥1s）
 *                                                        （「停顿才让动作落得下来」；标定样本
 *                                                          tasks/_carry-lab 的 rhythm 段）
 *   node scripts/anim.mjs dumppx <task> --times 1.5 --out x.raw   导出浏览器那一帧的裸像素
 *   node scripts/anim.mjs dumpframe <task> -t 0.5 --run-up        落一张裸帧 + 引擎内部量
 *   node scripts/anim.mjs dumpframes <task> --from 0 --to 1       顺着渲一串裸帧（对照实验用）
 *   node scripts/anim.mjs perf  <task> [--from 0 --to 5]  性能测量（每帧毫秒 / 子帧数）
 *   node scripts/anim.mjs shake <task> [--from 0 --to 48] [--json]
 *                                                        抖动体检：整片 post.shake 的幅度 / 逐帧变化量，
 *                                                        判定「平滑手持」还是「逐帧白噪声（60fps 下是振动）」，
 *                                                        以及收尾有没有"停住了还在晃"；有问题退出码 1
 *                                                        （判据见 docs/history/IMPROVEMENTS-1-3.md 第三轮）
 *   node scripts/anim.mjs gpu [<task>]                    打印 GPU 信息
 *   node scripts/anim.mjs clean <task> [--all] [--dry-run] 清中间产物（默认不动成片与 stills，
 *                                                         也**绝不**动 NOTES.json —— 那是评论，不是中间产物）
 *
 * 常用参数：
 *   -t/--t 时刻（逗号分隔）      --from/--to 区间（秒）
 *   -o/--out 输出路径（still/sheet 是目录、video/shot 是 mp4 文件；默认 out/<任务>/…）
 *   --samples N|auto            运动模糊子帧数（默认 still=1，video=auto）
 *   --shutter 0.2               快门宽度（帧长的比例）
 *   --scale 2                   2 倍分辨率输出（真 4K；1..4）
 *   --segments 10               分块渲染的目标块时长（秒）；切点只落在段边界、避开转场；
 *                               已渲好的块自动复用，但**渲染参数或源文件变了就全部重渲**
 *                               （指纹在 <任务>.parts/params.json，见 docs/history/IMPROVEMENTS-1-3.md P1-1）
 *   --parallel 3                切成 3 段**并行**渲染再自己拼（实测 2 进程 1.81×、3 进程 2.3×；
 *                               每个进程一个无头 Chrome，别超过物理核数。切点自动避开转场，
 *                               拼接走 MPEG-TS，不受 `-copyts` 那个坑影响）
 *   --force                     配合 --segments：忽略已存在的分块，全部重渲
 *   --scan-nf[=N]               出片时每 N 帧扫一次**浮点缓冲**里的 NaN / ±Inf（默认 30；0 = 关掉）
 *                               —— 「整屏白 / 单帧白多帧黑」那一类事故的唯一可靠判据（check 也在用它）：
 *                               CLI 收到的是 NV12（8bit），帧里已经没有浮点信息，所以扫描挂在页面里、
 *                               由 render 顺带做（**不额外渲一帧**，只多一次 1080p ≈ 8MB 的浮点回读）。
 *                               实测代价：**一次扫描 ≈ 40ms**（1080p，与子帧数无关 —— 回读 + 扫 2M 像素）；
 *                               每 30 帧一次 = +1.3ms/帧，demo 上实测 28.2s → 28.3s（+0.35%）
 *   --nf-stop                   扫到非有限值就停下（默认只报告 —— "画面已经错了"和"要不要停"是两件事）
 *   --keep-raw x.nv12           把推给 ffmpeg 的原始 **NV12** 另存（绕开编码器做对照实验）
 *   --idle 300                  看门狗：「一直没有进展」多少秒才算卡死（等 ffmpeg 排水不算）
 *   --finalize 180              收尾时等 ffmpeg 写完 moov 的上限（秒）
 *   --crf 16 --preset slow      x264 质量
 *   --vcodec h264_nvenc         换硬件编码器（libx264 默认；nvenc 用 --cq 控质量、--preset p1..p7）
 *                               实测 1080p60 带颗粒：libx264 slow 11.8 fps → h264_nvenc 166 fps，
 *                               而且不抢 CPU，浏览器那一侧也跟着快
 *   --gpu high                  强制用独显跑无头 Chrome（默认 auto = 系统挑，笔记本上通常是核显）
 *                               实测：raymarch 这类**填充重**的段 2.15×，轻场景会略慢 14%
 *                               （`anim perf <任务> --gpu high` 先量再定；见 docs/PERF.md §2①）
 *   --only a,b                  只加载这些段，**并把它们平移到时间轴开头**（-t 就是段内时间）
 *   --url http://…              用已经跑着的 Vite 服务
 *
 * 环境变量：ANIM_FFMPEG / ANIM_FFPROBE（可指向包装器，见 tools/slow-ffmpeg.mjs）。
 *
 * 离屏渲染全程无头 Chrome + 同一条渲染代码路径，所以「预览看到什么，成片就是什么」。
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright-core';
// 抖动统计（纯函数，无依赖）：`anim shake` 与 `video` 收尾的守门共用同一套判据
import { analyzeShake, shakeSummary } from './lib/shake.mjs';
import { blankJsComments as sharedBlankJsComments } from './lib/js-source.mjs';
// 分块增量重渲的判据（BACKLOG 1-45）：纯函数，`tools/test-block-sig.mjs` 直接测
import { sceneFileIndex, blockSignature } from './lib/blocksig.mjs';
import { DRAFT_SCALE, DRAFT_ENCODE_MS, planTiers, estimateTier } from './lib/tier-estimate.mjs';
import { layoutReport, layoutSummary } from '../src/layout.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/**
 * 页面推回来的每帧的帧头长度（字节）：`子帧数 | shake.dx | shake.dy`（三个 float32）。
 * **改这里必须同时改 `src/app.js` 的 `stream().step()`** —— 两边是同一个协议。
 */
const FRAME_HEADER = 12;
/**
 * `--scan-nf` 的默认值：**出片时每 N 帧扫一次浮点缓冲里的 NaN / ±Inf**（BACKLOG 1-4）。
 *
 * 30 这个数是**实测定的**（1080p / demo / 本机核显，2026-10-10）：
 *   · 一次扫描的代价 = **40ms**，与这一帧有几个子帧无关（整屏 8MB 浮点回读 + JS 扫 2M 像素）：
 *       samples=1：91.3 → 130.8 ms/帧（每帧都扫）；8 子帧：313 → 353 ms/帧（每帧都扫）
 *   · 每 30 帧扫一次 ⇒ 平均 +1.3ms/帧。实测同一段 90 帧：28.2s → 28.3s（**+0.35%**）
 *   · demo 整片 999 帧 / 14.3 分钟 ⇒ 34 次扫描 = 1.4s（+0.16%）
 * 远低于「代价可观（>5%）」，所以**默认开着**：这一类事故以前只有 `check` 才发现得了，
 * 而成片路径一旦写坏就是整段白/黑（实测夹具：NaN 段 `check` 报 3,110,400 像素）。
 * 想让出片完全不受影响就 `--scan-nf 0`；想扫得更密就 `--scan-nf 1`（≈ +44% 帧时间，只适合短片段）。
 *
 * ⚠ 代价随**像素数**线性涨 —— **2026-10-16 实测了 4K**（BACKLOG 头部 ⑧；夹具
 *   `tasks/_style-sampler`、`shot --from 0 --to 2 --samples 1`、120 帧、同一台机器）：
 *     · 1080p：`--scan-nf 0` 12.1 fps（82.6 ms/帧）→ `--scan-nf 1` 8.3 fps（120.5 ms/帧）⇒ 一次 **+38ms**
 *     · 4K（`--scale 2`）：3.6 fps（279 ms/帧）→ 2.3 fps（431 ms/帧）⇒ 一次 **+152ms**
 *     · 比值 **4.0×**（与像素数 ×4 一致）。摊到默认档（每 30 帧一次）：4K **+5.1ms/帧 = +1.8%**
 *   ⇒ 默认开着在 4K 下依然划算；`--scan-nf 1` 在 4K 是 **+55%**，只适合几秒的片段。
 *   极高帧率/极廉价场景下占比会更高，那时用 `--scan-nf 0` 关掉或加大 N。全文见 `docs/PERF.md` §7.1。
 */
const DEFAULT_SCAN_NF = 30;
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help';
const rest = cmd === 'help' ? argv : argv.slice(1);

/* ------------------------------------------------------------------ 参数解析 */

function opt(name, def) {
  const i = rest.indexOf(`--${name}`);
  if (i >= 0) return rest[i + 1];
  // 单字母短选项：-t 2.5 / -o dir / -n 12
  if (name.length === 1) {
    const j = rest.indexOf(`-${name}`);
    if (j >= 0) return rest[j + 1];
  }
  return def;
}
function flag(name) { return rest.includes(`--${name}`); }

/**
 * 产物目录：`out/<任务>`，带 `--variant` 时是 `out/<任务>/<变体>`（BACKLOG 1-23）。
 *
 * **为什么必须分目录**：同一支片子的两个变体，成片、分块缓存、stills、hashes 基线全都不同；
 * 挤在一个目录里会互相覆盖/串味（最隐蔽的是 `video --segments` 的块缓存：改了两句词却
 * 复用了另一个变体的块，画面对不上还查不出来）。
 */
function taskOut(task, ...parts) {
  const v = opt('variant', '');
  // ⚠ 这里刻意写成 String(task)：这条 helper 是被一次全局替换生成出来的，
  //    用 path.join('out', task, …) 的字面形状会被替换脚本连自己一起改掉（踩过一次，自递归爆栈）。
  const root = path.join('out', String(task));
  return v ? path.join(root, v, ...parts) : path.join(root, ...parts);
}
function positional(i = 0) { return rest.filter((a) => !a.startsWith('-'))[i]; }

const log = (...a) => console.log(...a);
const warn = (...a) => console.error(...a);
function die(msg, code = 1) { warn(`✗ ${msg}`); process.exit(code); }

/**
 * 本进程直接拉起的子进程（Vite），退出时统一收掉。
 * 注意：**只收自己拉的**。绝不要按进程名去 kill 系统里别的 node——
 * 这个 CLI 自己就跑在 node 上，按名字清理会把宿主一起带走（踩过，很痛）。
 */
const children = new Set();
let cleaned = false;
function cleanupChildren() {
  if (cleaned) return;
  cleaned = true;
  for (const c of children) { try { c.kill(); } catch { /* 已经没了 */ } }
  children.clear();
}
process.on('exit', cleanupChildren);
process.on('SIGINT', () => { cleanupChildren(); process.exit(130); });
process.on('SIGTERM', () => { cleanupChildren(); process.exit(143); });

/**
 * 这个文件是不是**直接被 node 跑**的？（而不是被 import 进来做单测）
 *
 * 为什么需要它：下面那些纯函数（`formatSkipped` / `decideGateFailure`）必须能**离线单测**
 * （不需要 GPU、不需要浏览器），而本模块末尾带着顶层 await 的 CLI 派发 —— 一旦被 import
 * 就会当场执行一条命令。有了这道门，import 本文件只拿到函数，不会跑任何东西。
 *
 * Windows 上 `process.argv[1]` 是 `D:\…\anim.mjs` 这种反斜杠路径，必须过 `pathToFileURL`
 * 再比，否则永远不相等（CLI 会静默什么都不做 —— 这是最难查的一种坏法）。
 */
const IS_MAIN = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const canon = (u) => {
    try { return decodeURIComponent(u).replace(/\\/g, '/').toLowerCase(); } catch { return String(u).toLowerCase(); }
  };
  try {
    const self = canon(fileURLToPath(import.meta.url));
    const run = canon(path.resolve(entry));
    if (self === run) return true;
    // Windows 的路径大小写不敏感，盘符/目录大小写不一致也算同一个文件
    return canon(pathToFileURL(path.resolve(entry)).href) === canon(import.meta.url);
  } catch { return false; }
})();

/* ------------------------------ 空 ≠ 干净（BACKLOG 1-19）与守门措辞（1-3）：纯函数 */

/**
 * 「空 ≠ 干净」的收集器（`docs/BACKLOG.md` 1-19）。
 *
 * 三个外部参考项目独立指向同一个失败模式：**浏览器没跑起来时那几个 section 是空的**，
 * 而空输出「读起来像一份干净的报告，其实什么都没跑」（对方原话：*empty, not clean —
 * which reads like a clean file but means nothing ran*）。
 *
 * 这条在本 CLI 里有四个真实落点，以前每一个都只是**少打一行**（背景守门 catch、
 * `lint-narration-dup` 没跑成、多子帧路径失败、非有限值扫不出来）：
 * 读输出的 agent 看到的是「这次 check 没报错」＝ 通过。现在它们一律进这个列表。
 *
 * ⚠ **`skipped` 不许改变退出码**：`tools/regress-all.mjs` 里有 10 个 `check:*` 项依赖
 *   `check` 的退出码语义（"零退出 = 这次体检没发现问题"）。想把它当门用只能显式加
 *   `--strict`（默认关）。
 *
 * @typedef {{ what: string, why: string }} SkippedAudit
 * @param {SkippedAudit[]} list
 * @param {string} what 是什么没跑（一句话，读的人据此判断"这块地方没验过"）
 * @param {unknown} why 为什么没跑（原始原因：异常 / 退出码 / 页面能力缺失）
 * @returns {SkippedAudit[]} 同一个数组（便于 `skipped = pushSkipped(skipped, …)` 一行写）
 */
function pushSkipped(list, what, why) {
  list.push({ what: String(what), why: firstLine(why) });
  return list;
}

/** 取一句话（多行异常的堆栈不带进报告里）。 */
function firstLine(x) {
  const s = String(x == null ? '' : (x.message ? x.message : x));
  const line = s.split(/\r?\n/).find((l) => l.trim()) ?? '';
  return line.trim() || '(没有说明)';
}

/**
 * 版面守门那一行里的「主体区 …」怎么写（**纯函数**，离线单测钉住 —— 见 `tools/test-layout.mjs`）。
 *
 * 为什么不是一句 `${w.inFocus} 块`：一段的主体是**图形**（方波 / 格阵 / 波形，文字只是标注）时，
 * 主体区里天然一个字块都没有 —— 而"主体是图形"与"这一段什么都没画"在读数上原本长得一样，
 * 简报里那条「主体区 0 块看起来像没画东西」说的就是它（交接单 F）。
 *
 * 所以分这几种写法，**判据一个字都没放松**（判据 ② 在 0 块时本来就恒成立）：
 *   · 主体区有字          → `N 块`（照旧）；
 *   · 0 块 + 画了图形     → `0 块字（这一帧的主体是图形：N 次非文字绘制）`；
 *   · 0 块 + 一笔都没有   → `0 块字，而且**一笔非文字绘制都没有**`（比原来的措辞更明确）；
 *   · 没声明 focus        → `未声明`（判据没跑，不许说成通过）。
 *
 * @param {any} w `layoutReport()` 的那一行（读 `focus` / `inFocus` / `focusNote` / `nonTextDraws`）
 * @returns {string}
 */
function focusReading(w) {
  if (!w?.focus) return '未声明';
  const n = Number.isFinite(w.inFocus) ? w.inFocus : 0;
  if (n > 0) return `${n} 块`;
  const draws = Number.isFinite(w.nonTextDraws) ? w.nonTextDraws : 0;
  switch (w.focusNote) {
    case 'graphics': {
      // 拆开报"矢量批次 / 全屏 Pass"：`lines.flush()` **一次**里可以有几百条线段，
      // 只说一个总数会让人以为"只画了 3 个东西"（hook 那条整条方波就是 1 个批次）。
      const lns = Number.isFinite(w.nonTextLines) ? w.nonTextLines : 0;
      const ps = Number.isFinite(w.nonTextPasses) ? w.nonTextPasses : 0;
      return `0 块字（这一帧的主体是图形：${draws} 次非文字绘制`
        + `（矢量批次 ${lns} · 全屏 Pass ${ps}）；${w.blocks} 块字全是标注）`;
    }
    case 'empty':
      return '0 块字，而且**一笔非文字绘制都没有**（这一屏看起来确实没画东西）';
    default:
      // `unjudged`（拿不到绘制账 / 错帧卡片）：宁可说"没判"，也不说 0
      return '0 块字（这一帧的绘制账没读到 —— 主体是图形还是空屏**没判**）';
  }
}

/**
 * 把 `skipped` 列表渲染成输出里的那一段（纯函数，可离线单测）。
 *
 * 三条刻意的设计：
 *   ① 标题就是 `skipped:` —— 与外部三份参考报告的用词对齐，读的人一眼知道这是"没跑"；
 *   ② 每一条既有 **what**（是什么没跑）也有 **why**（为什么），缺一个就又会退化成"少打一行"；
 *   ③ 这一段**永远出现**（哪怕是 `skipped: 无`）—— 否则"确实全跑了"与"这段整个没执行"
 *      在输出里长得一样，那正是 1-19 要消灭的东西。
 *
 * @param {SkippedAudit[]} skipped
 * @returns {string[]} 要打印的行（不带缩进；调用方决定 warn 还是 log）
 */
function formatSkipped(skipped) {
  const list = Array.isArray(skipped) ? skipped : [];
  if (!list.length) return ['skipped: 无（这次体检的每一项审计都真的跑了）'];
  /**
   * 按 **what** 聚合（同一件事失败 N 次只占一行，写出 ×N）。
   * 为什么必须聚合：多子帧路径与非有限值扫描是**每个采样点**各一次 —— 页面一崩就是
   * 「13 段 × 3 点 × 2 项」几十条，一段 60 行的 skipped 没人会读，等于又变回"少打一行"。
   * 聚合只动显示，不动收集（`why` 保留第一次的原文，多行内联提示照旧带着时刻）。
   */
  const groups = new Map();
  for (const s of list) {
    const key = String(s?.what ?? '?');
    const g = groups.get(key);
    if (g) g.n++;
    else groups.set(key, { n: 1, why: String(s?.why ?? '(没有说明)') });
  }
  const lines = [`skipped: ${list.length} 项没跑 —— 这些地方**没有验过**，不要当成通过：`];
  for (const [what, g] of groups) lines.push(`  · ${what}${g.n > 1 ? ` ×${g.n}` : ''}：${g.why}`);
  lines.push('  （想让"有跳过"变成非零退出：加 --strict —— 默认不改退出码，见 docs/BACKLOG.md 1-19）');
  return lines;
}

/**
 * 结论行（纯函数，可离线单测）：**必须把"跳过了 N 项"写进去**。
 *
 * 1-19 的判据就是这个：结论行里只要没有 skipped 的身影，"N 项没跑"和"全跑过了"
 * 在收尾处就长得一模一样。
 *
 * @param {{ problems?: number, skipped?: number, quick?: boolean }} o
 */
function checkVerdictLine(o = {}) {
  const problems = Number(o.problems ?? 0);
  const skipped = Number(o.skipped ?? 0);
  const tail = skipped
    ? `（另有 ${skipped} 项**没跑**，见上面的 skipped）`
    : '（skipped: 无）';
  if (problems) return `✗ 有 ${problems} 个问题${tail}`;
  return `✓ 没有发现问题${tail}`;
}

/**
 * 产物守门失败 → 「这是哪一类失败 + 下一步该做什么」（纯函数，可离线单测）。
 *
 * `docs/BACKLOG.md` 1-3：以前守门失败一律补一句"重跑即可"。但**拼接 / 封装那一步是确定性的**
 * —— 同一份输入、同一条命令，跑一千次还是同样的帧数差，重跑只是白等（上一轮就照着重跑了
 * 一次，白等 30 秒，帧数一模一样）。反过来，分块渲染那一步**确实**能靠重跑恢复（已渲好的块
 * 会跳过），所以也不能一刀切删掉"重跑"。正确的做法是按「已知原因（确定性、重跑无意义） /
 * 未知原因（可能是瞬时、重跑有意义）」分开说，并且各自给出**下一步做什么**。
 *
 * 判据只吃**已经算好的事实**（`problems` 就是 `checkVideoFile()` 返回的那个字符串数组），
 * 所以这里不会与 ffprobe 的调用时机耦合。
 *
 * @param {{
 *   problems: string[],        // checkVideoFile() 的问题列表（原样，别改写）
 *   expected?: number|null,    // 期望帧数
 *   got?: number|null,         // 渲染侧/ffprobe 给的帧数（拿不到就不传）
 *   phase: string,             // 'chunk' | 'stitch' | 'final' | 'parallel' | 'render'
 *   step?: string,             // 人话的"哪一步"（默认按 phase 取）
 *   chunk?: { i: number, n: number, range?: string },  // 分块路径才有
 *   reusable?: boolean,        // 分块路径：已渲好的块会被复用（= 重跑真的能只补没渲完的块）
 *   retryable?: boolean,       // 调用方**已判定**能靠重跑恢复（例如纯渲染帧数不足）
 * }} o
 * @returns {{ kind: 'input'|'transient'|'encode'|'stitch'|'scene'|'unknown',
 *             known: boolean, retryWorthwhile: boolean,
 *             headline: string, next: string[], retryLine: string }}
 */
function decideGateFailure(o) {
  const problems = (o?.problems ?? []).map((s) => String(s));
  const phase = String(o?.phase ?? 'final');
  const text = problems.join('\n');

  /** 已知的确定性根因是否命中？（命中则与"可能是瞬时的"互斥） */
  const empty = /0 字节/.test(text);
  const noFrames = /读不到帧数|没有可解码的画面/.test(text);
  const fpsBad = /帧率 .* ≠ 期望/.test(text);
  const noMoov = /moov atom not found|没 finalize/.test(text);
  const unreadable = /打不开|读不出/.test(text);
  // ⚠ "ffprobe 退出码 N" 单独拿出来判：它既可能是文件坏了（确定性），
  //   也可能是 ffprobe 不在 PATH / 起不来（环境问题，属于**瞬时**那一类，
  //   说成"已知原因"就会把人指偏）。只有环境那类才走 unknown。
  const probeEnv = /ENOENT|不是内部或外部命令|command not found|not recognized/i.test(text);
  const probeExit = /退出码/.test(text) && !probeEnv;
  const frameDiff = /数出 (\d+) 帧，期望 (\d+) 帧/.exec(text);
  const expected = o?.expected ?? (frameDiff ? Number(frameDiff[2]) : null);
  const got = o?.got ?? (frameDiff ? Number(frameDiff[1]) : null);
  const diff = frameDiff ? Number(frameDiff[1]) - Number(frameDiff[2]) : null;

  /**
   * 分块路径**默认**是"重跑有意义"的（已渲好的块会跳过，重跑只补这一块）；
   * 其余调用方必须自己声明 `retryable` —— 默认 false，因为守门失败的第一嫌疑
   * 永远是**确定性的**（同样的输入 ⇒ 同样的结果），说成"重跑就好"会把人指偏。
   */
  const chunkRetry = phase === 'chunk' && o?.reusable !== false;
  const retryable = o?.retryable === true || chunkRetry;

  let kind = 'unknown';
  if (empty || noFrames || noMoov || unreadable || probeExit) {
    // 「文件根本读不出来」这一类：ffmpeg 没把文件写完（半截流 / 没写 moov），
    // 或者根本读不到流。它**不是**"渲染少渲了几帧"。
    kind = 'encode';
  } else if (fpsBad) {
    // 帧数对、帧率/时间戳不对 = 拼接时的 `-copyts` 那类问题，与容器记账有关
    kind = 'stitch';
  } else if (frameDiff) {
    if (phase === 'chunk' && (o?.reusable !== false)) kind = 'scene';
    else if (phase === 'stitch' || phase === 'final' || phase === 'parallel') kind = 'stitch';
    else if (Math.abs(diff) >= 1 && Math.abs(diff) <= 60) kind = 'stitch';   // 差几帧 ⇒ 音轨记账切尾
    else kind = 'unknown';
  } else {
    kind = 'unknown';
  }
  // 调用方**确知**是哪一类时可以直接指定（例如 checkTimestamps 的报错文案里没有上面那些
  // 关键词，但"帧数对、时间戳不齐"在语义上就是拼接这一步的问题）。
  if (!o?.hint && text && /帧距不齐|首帧 PTS|时间戳/.test(text) && !frameDiff) kind = 'stitch';
  if (o?.hint) kind = String(o.hint);

  const STEP = {
    chunk: '分块渲染（这一块）', stitch: '拼接 / 封装', final: '产物守门', parallel: '并行渲染',
    render: '渲染',
  };
  const step = o?.step ?? STEP[phase] ?? '产物守门';
  const chunkTag = o?.chunk ? `第 ${o.chunk.i}/${o.chunk.n} 块${o.chunk.range ? `（${o.chunk.range}）` : ''}` : '';
  const nExp = expected != null ? `${expected} 帧` : '期望帧数';
  const nGot = got != null ? `${got} 帧` : '实际帧数';

  /** 已知原因：确定性、重跑无意义 —— 给出**该做什么**，不给"重跑"。 */
  const knownNext = {
    encode: [
      `已知原因（确定性）：${chunkTag ? chunkTag + '的' : ''}这个文件 ffmpeg 没写完 —— 半截流 / 没写 moov / 0 字节，渲染进程还没 finalize 就被结束了。`,
      '下一步：① 先把预期帧数与实际帧数对一遍（差几帧 ⇒ 尾部被切；差很多 ⇒ 中途断流）；',
      '        ② 帧数差在个位数且这条命令带音轨 ⇒ 看封装参数是不是 -af apad 与 -shortest 成对（AAC 的记账时长比视频短几十毫秒，会把视频尾巴切掉）；',
      '        ③ 差几十上百帧 ⇒ 是渲染中途断流：渲染期间不要写仓库里任何文件（改一次就 HMR 重载 → 断流），渲染时也别让别的进程清理 out/；',
      '        ④ 修完再跑 —— 这一步的结果由文件与参数决定，**不修任何东西的重跑一定是同一个错**。',
    ],
    stitch: [
      `已知原因（确定性）：拼接 / 封装这一步出错，画面本身没问题（各块都已经单独通过守门）。`,
      frameDiff && diff != null && Math.abs(diff) <= 60
        ? `  上面这条「${nGot} ≠ ${nExp}（差 ${diff > 0 ? '+' : ''}${diff}）」是**尾部被切掉**的典型签名：音轨封装用了 -shortest 却没有 -af apad —— AAC 有 priming/padding，音频流的记账时长比视频短几十毫秒，于是视频尾巴被当成"多余"切掉几帧。`
        : '  先看上面那条 ffprobe 到底差了几帧、差在哪个方向，再对号入座。',
      '下一步：① 核对封装参数：`-af apad` 与 `-shortest` 必须**成对**出现（apad 让音轨变无限长，-shortest 才会停在视频最后一帧）；',
      '        ② 核对拼接参数：concat 必须带 `-copyts`（否则帧数对、时间戳不均匀，帧率会变成 60.08 那种）；',
      '        ③ 改完再跑同一条命令 —— 已渲好的块会跳过，不需要重渲画面。',
    ],
    scene: [
      chunkTag
        ? `已知原因（确定性）：这一块**自己**少渲了 ${Math.abs(diff ?? 0)} 帧 —— 画面停在半路，多半是场景在某个时刻抛异常 / 页面在渲染途中崩了（HMR 重载也走这条路）。`
        : '已知原因（确定性）：渲染侧没有收满帧 —— 画面停在半路。',
      '下一步：① 先定位是哪一段、哪个时刻：node scripts/anim.mjs check <任务>（会点名段与时刻）；',
      '        ② 出那一帧的图看：node scripts/anim.mjs still <任务> -t <时刻> --only <段>；',
      '        ③ 渲染期间**一个文件都别写**（连 docs/*.md 也不行：编辑器的原子写挡不住 watch，撞 EBUSY 会让 Vite 崩）；',
      '        ④ 改完再跑同一条命令 —— 已渲好的块会跳过，重跑只补没渲完的块。',
    ],
    input: [
      `已知原因（确定性）：ffprobe 在这个文件里读不到视频流（帧数 / 分辨率都拿不到），所以"帧数对不对"这件事**根本没有验过** —— 它不等于"验过了、没问题"。`,
      '下一步：① 确认产物真的被写出来了（文件大小 > 0）、路径就是命令行里那一条；',
      '        ② 若是从别处拷来的文件，重新跑一遍出片命令（分块路径下已渲好的块会跳过）。',
    ],
  };

  /** 未知原因：可能是瞬时 —— 重跑**可能**好，但要先做一件比重跑便宜的事。 */
  const unknownNext = [
    '这条不匹配任何已知的确定性根因，所以**可能是瞬时的**（磁盘满 / 内存或句柄耗尽 / 杀软或同步盘锁住了文件 / GPU 掉线 / 被外部进程中断）。',
    '下一步（按这个顺序）：① 先看那条原始报错本身（上面的 · 行），别跳过它去重跑；',
    '                      ② 确认磁盘还有空间、out/ 没被别的进程（清理 / 同步盘）碰过；',
    retryable
      ? '                      ③ 再重跑同一条命令：已渲好的部分会跳过，代价只是没渲完的那部分。'
      : '                      ③ 确认上面两条之后可以重跑一次；若**同样**的错再来一次，它就属于确定性失败，别再重跑，按 check → still 的顺序定位。',
  ];

  const next = knownNext[kind] ?? unknownNext;
  const where = chunkTag ? `${chunkTag} ` : '';
  const what = kind === 'stitch' ? '拼接 / 封装出错'
    : kind === 'encode' ? '文件没写完（半截流 / 没写 moov）'
      : kind === 'scene' ? '画面没渲完'
        : kind === 'input' ? '产物读不出视频流'
          : '产物读不出来';
  const headline = kind === 'unknown'
    ? `${step}失败：原因未知（可能是瞬时，也可能是没被识别出来的确定性根因）。`
    : `${step}失败：${where}${what} —— 这是**已知原因**（确定性），重跑不会有不同结果。`;
  // ⚠ 收尾那句必须与 `kind` 一致：未知原因那一档**不能**说"重跑一定得到同样的结果"
  //   （那正好和它自己的 "可能是瞬时的" 打架 —— 样例输出就是这么发现这处矛盾的）。
  const retryLine = retryable && kind !== 'unknown'
    ? '  重跑有意义（已渲好的部分会跳过）：但先按上面的「下一步」做一件事再跑，别原地空转。'
    : kind === 'unknown'
      ? '  重跑**可能**有用（这类失败不保证可复现）；但先把上面那几件事查一遍再跑，别拿重跑当诊断。'
      : '  ⚠ 不要直接重跑同一条命令：这一步是确定性的，不修任何东西的重跑会得到**同样的**结果。';

  return {
    kind, known: kind !== 'unknown', retryWorthwhile: retryable, headline, next, retryLine,
    expected, got, diff,
  };
}

/**
 * 守门失败的报告正文（纯函数，可离线单测）：问题列表 + 分类 + 下一步。
 * @param {{ problems: string[], title?: string }} o
 * @param {Parameters<typeof decideGateFailure>[0]} ctx
 * @returns {string[]}
 */
function gateFailureLines(o, ctx) {
  const d = decideGateFailure({ ...ctx, problems: o.problems });
  const lines = [o.title ?? '产物验收不通过：', ...(o.problems ?? []).map((b) => `  · ${b}`)];
  if (ctx && ctx.note) lines.push(`  （${ctx.note}）`);
  lines.push('', `  ${d.headline}`, ...d.next.map((l) => `  ${l}`), d.retryLine);
  return lines;
}

/* --------------------------------------- 评论文件（out/<任务>/NOTES.json，BACKLOG 1-29）：纯函数区 */

/**
 * `out/<任务>/NOTES.json` 的**规范形状**（`anim note` 读写的那份文件）。
 *
 * 为什么评论要是一个**普通项目文件**（而不是某个 UI 的数据库）：外部参考项目
 * （`docs/REFERENCE-hypit.md` §5.5 的 `FEEDBACK.json`、`docs/REFERENCE-agent-video-projects.md`）
 * 的 Studio 就是这么做的 —— 读写都走文件、不轮询、不重编译。于是：
 * agent 和你都能用一条命令往里写"第 12.5 秒这里字幕太小"，而**不需要**跑一次渲染。
 *
 * ```json
 * { "schema": "anim.notes/1", "task": "demo",
 *   "notes": [ { "id": "n1", "at": 12.5, "text": "这里字幕太小",
 *                "createdAt": "2026-10-10T14:10:00.000Z", "resolved": false, "resolvedAt": null } ] }
 * ```
 *
 * ⚠ **BACKLOG 1-29 原文里写的是 `{id, run, at, text, resolved}`** —— 其中的 `run`
 * （"这条评论是对哪一次渲染说的"）**这一版没有实现**：渲染产物目前没有 run id。
 * 读进来时它会作为"未知字段"**原样保留**（`parseNotesJson` 的 `extra` / 条目上的未知键），
 * 所以将来加它不会抹掉已经手写进去的值。
 */
const NOTES_SCHEMA = 'anim.notes/1';

/**
 * `anim clean` **永远不许删**的 `out/` 文件名（评论是项目文件，不是渲染中间产物）。
 * 判据放在这里、`cmdClean` 每个分支都过一遍 —— 而不是"靠它没被写进白名单"。
 */
const PROTECTED_OUT_FILES = new Set(['NOTES.json']);

/**
 * @typedef {{ id: string, at: number|null, text: string, createdAt: string|null,
 *             resolved: boolean, resolvedAt: string|null }} Note
 */

/** 造一个带 `kind` 的错（调用方靠 `kind` 分档，不解析文案）。 */
function notesErr(kind, msg) {
  const e = new Error(msg);
  /** @type {any} */ (e).kind = kind;
  return e;
}

/** 给人看的类型名（报错用：`undefined` / `null` / 数组 / 对象 / 字符串 …）。 */
function shapeOf(x) {
  if (x === null) return 'null';
  if (Array.isArray(x)) return '数组';
  return { undefined: 'undefined', string: '字符串', number: '数字', boolean: '布尔值', object: '对象' }[typeof x] ?? typeof x;
}

/**
 * JSON 解析失败 → 能直接定位的一句（`第 4 行第 5 列：Unexpected token }`）。
 *
 * 为什么要自己算行列：V8 的报错文案这些年换过好几版（有的给 `at position 12`、
 * 有的给 `(line 1 column 6)`、回车的半截文件只给 `Unexpected end of JSON input`），
 * 而"文件被写了一半"这件事**必须让读的人一眼看出来**（评论的唯一落点，不能静默丢）。
 */
function jsonErrorWhere(text, err) {
  const msg = String((err && err.message) || err).replace(/^JSON\.parse:\s*/, '');
  const lc = /line (\d+) column (\d+)/.exec(msg);
  if (lc) return `第 ${lc[1]} 行第 ${lc[2]} 列：${msg.replace(/\s*\(line \d+ column \d+\)/, '')}`;
  const pos = /position (\d+)/.exec(msg);
  if (pos) {
    const before = String(text).slice(0, Number(pos[1]));
    const line = before.split('\n').length;
    const col = Number(pos[1]) - before.lastIndexOf('\n');
    return `第 ${line} 行第 ${col} 列：${msg.replace(/\s*at position \d+/, '')}`;
  }
  return msg;
}

/**
 * 读一份 `NOTES.json` 文本 → 结构化评论表（**纯函数**：不碰磁盘、不看时钟，可离线断言）。
 *
 * 三条刻意的设计（都是为了"评论不能悄悄消失"）：
 *   ① **坏文件必须报得出来，而且报到行列**：空文件 / 半截 JSON / 形状不对 / 某条没正文，
 *      一律抛**自己写的** `Error`（`err.kind` ∈ `empty|bad-json|bad-shape|bad-entry`），
 *      绝不把 V8 的 `SyntaxError` 原样丢出去。把它们读成"还没有评论"就是静默丢反馈
 *      —— 和 BACKLOG 1-19 的「空 ≠ 干净」是同一条纪律。
 *   ② **能修的字段就修，修了什么要说**（`warnings`）：条目没有 `id` 自动补一个、
 *      `id` 重复自动改名、`at` 不是 ≥0 的秒数就按"没有时刻"算。都比"这一条不显示了"好。
 *   ③ **认得出两种形状**：信封 `{ schema, task, notes: [...] }` 与**裸数组** `[...]`
 *      （手写的文件常常只有数组）。写回去时一定是信封（见 `serializeNotes`）。
 *
 * @param {string} text 文件内容（调用方用 utf8 读进来）
 * @param {{ file?: string }} [opts] `file` 只用于报错文案（给相对路径更好读）
 * @returns {{ schema: string, task: string|null, notes: Note[],
 *             extra: Record<string, any>, warnings: string[] }}
 * @throws {Error} `err.kind` 见上
 */
function parseNotesJson(text, opts = {}) {
  const file = opts.file ?? 'NOTES.json';
  const raw = String(text ?? '');
  if (!raw.trim()) {
    throw notesErr('empty', `${file} 是空的（0 字节）—— 半截写入或被清空过。\n`
      + `  它不是"还没有评论"（空 ≠ 干净）：要么把它修回来，要么删掉它（评论会一起丢）再重来。`);
  }
  let data;
  try { data = JSON.parse(raw); } catch (err) {
    throw notesErr('bad-json', `${file} 不是合法 JSON —— ${jsonErrorWhere(raw, err)}\n`
      + `  文件可能被写了一半。修好它，或删掉它（评论会一起丢）再重来。`);
  }
  const envelope = !!data && typeof data === 'object' && !Array.isArray(data);
  const list = envelope ? data.notes : data;
  if (!Array.isArray(list)) {
    throw notesErr('bad-shape', `${file} 的形状不对：`
      + (envelope ? '`notes` 必须是数组' : '顶层必须是数组，或 `{ schema, task, notes: [...] }`')
      + `（实际是${shapeOf(list)}）。`);
  }

  const warnings = [];
  /** @type {Note[]} */
  const notes = [];
  /**
   * ① **先把显式、不重复的 id 占住**（两遍走）。
   * 为什么：手写进文件的 id 是"人已经引用过的名字"（`--resolve n1` 指的就是它），
   * 不能被上面自动补的挤走 —— 一遍走的话，"第 1 条忘写 id"就会顺手占掉 `n1`，
   * 把第 2 条真正写着 `n1` 的那条改名成 `n2`。
   */
  const taken = new Set();
  for (const n of list) {
    const id = n && typeof n === 'object' && !Array.isArray(n) && typeof n.id === 'string' ? n.id.trim() : '';
    if (id && !taken.has(id)) taken.add(id);
  }
  /** 从最小的空闲编号里取一个（`nextNoteId` 是给"追加"用的：单调往上，永不回收旧号）。 */
  const allocId = () => {
    let i = 1;
    while (taken.has(`n${i}`)) i++;
    const id = `n${i}`;
    taken.add(id);
    return id;
  };
  const seen = new Set();
  list.forEach((n, i) => {
    const where = `第 ${i + 1} 条`;
    if (!n || typeof n !== 'object' || Array.isArray(n)) {
      throw notesErr('bad-entry', `${file} 的${where}不是对象（实际是${shapeOf(n)}）。`);
    }
    const body = typeof n.text === 'string' ? n.text.trim() : '';
    if (!body) {
      throw notesErr('bad-entry', `${file} 的${where}没有正文（\`text\` 必须是非空字符串）——`
        + `评论的正文不能丢：补上它，或者删掉这一条。`);
    }
    let id = typeof n.id === 'string' ? n.id.trim() : '';
    if (!id || seen.has(id)) {
      const fixed = allocId();
      warnings.push(id
        ? `${where}的 id "${id}" 与前面重复 → 自动改名为 ${fixed}（--resolve 时按新的来）`
        : `${where}没有 id → 自动补一个 ${fixed}`);
      id = fixed;
    }
    seen.add(id);
    let at = null;
    if (n.at !== null && n.at !== undefined && n.at !== '') {
      const v = Number(n.at);
      if (Number.isFinite(v) && v >= 0) at = v;
      else warnings.push(`${where}的 at=${JSON.stringify(n.at)} 不是 ≥0 的秒数 → 按"没有时刻"处理`);
    }
    notes.push({
      ...n,
      id,
      at,
      text: body,
      createdAt: typeof n.createdAt === 'string' && n.createdAt ? n.createdAt : null,
      resolved: !!n.resolved,
      resolvedAt: typeof n.resolvedAt === 'string' && n.resolvedAt ? n.resolvedAt : null,
    });
  });

  const schema = envelope && typeof data.schema === 'string' && data.schema ? data.schema : NOTES_SCHEMA;
  if (schema !== NOTES_SCHEMA) {
    warnings.push(`schema="${schema}" 不是 ${NOTES_SCHEMA} —— 照当前形状读（未知字段原样留着，含义不保证）`);
  }
  /** 信封上不认识的键（例如将来 1-29 想加的 `run`）：原样带着走，别抹掉别人写的字段。 */
  const extra = {};
  if (envelope) {
    for (const k of Object.keys(data)) if (k !== 'schema' && k !== 'task' && k !== 'notes') extra[k] = data[k];
  }
  const task = envelope && typeof data.task === 'string' && data.task ? data.task : null;
  return { schema: NOTES_SCHEMA, task, notes, extra, warnings };
}

/**
 * 评论表 → `NOTES.json` 的文本（**纯函数**）。写回去时**一定是信封**（裸数组只被读、不被写）。
 * 2 空格缩进 + 末尾换行 —— 这个文件是给人手改的，diff 要干净。
 * @param {{ task?: string|null, notes?: Note[], extra?: Record<string, any> }} o
 */
function serializeNotes(o = {}) {
  const env = {
    ...(o.extra ?? {}),
    schema: NOTES_SCHEMA,
    task: o.task ?? null,
    notes: (o.notes ?? []).map((n) => ({
      ...n,
      id: String(n.id),
      at: Number.isFinite(n.at) ? n.at : null,
      text: String(n.text),
      createdAt: n.createdAt ?? null,
      resolved: !!n.resolved,
      resolvedAt: n.resolvedAt ?? null,
    })),
  };
  return `${JSON.stringify(env, null, 2)}\n`;
}

/** 下一个没被用过的 id（`n1` `n2` …；只认自己发的这种形状，别人写的 id 一律不碰）。 */
function nextNoteId(notes) {
  let max = 0;
  for (const n of notes ?? []) {
    const m = /^n(\d+)$/.exec(String(n?.id ?? ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `n${max + 1}`;
}

/**
 * 追加一条评论（**纯函数**，可离线断言：`now` 从外面传进来）。
 * @param {Note[]} notes
 * @param {{ text?: string, at?: any, now?: string }} o
 * @returns {{ notes: Note[], note: Note }}
 * @throws {Error} `kind` ∈ `'empty-text' | 'bad-at'`
 */
function addNote(notes, o = {}) {
  const list = Array.isArray(notes) ? notes : [];
  const text = String(o.text ?? '').trim();
  if (!text) throw notesErr('empty-text', '评论正文是空的 —— 给一句话，例如 "第 12.5 秒这里字幕太小"。');
  let at = null;
  if (o.at !== undefined && o.at !== null && o.at !== '') {
    const v = Number(o.at);
    if (!Number.isFinite(v) || v < 0) {
      throw notesErr('bad-at', `--at 要一个 ≥0 的秒数（例如 --at 12.5），给的是 "${o.at}"。`);
    }
    at = v;
  }
  const note = {
    id: nextNoteId(list),
    at,
    text,
    createdAt: o.now ?? new Date().toISOString(),
    resolved: false,
    resolvedAt: null,
  };
  return { notes: [...list, note], note };
}

/**
 * 把某条标记成已解决（**纯函数**）。已经解决过的**不重写 `resolvedAt`**（幂等，不churn 文件）。
 * @param {Note[]} notes
 * @param {string} id
 * @param {{ now?: string }} [o]
 * @returns {{ notes: Note[], note: Note, changed: boolean }}
 * @throws {Error} `kind === 'no-such-id'`（文案里列出所有可用 id —— 否则只能靠 `--list` 再跑一次）
 */
function resolveNote(notes, id, o = {}) {
  const list = Array.isArray(notes) ? notes : [];
  const want = String(id ?? '').trim();
  const i = list.findIndex((n) => String(n?.id) === want);
  if (i < 0) {
    const have = list.length
      ? list.map((n) => `${n.id}${n.resolved ? '(已解决)' : ''}`).join(' / ')
      : '(一条都没有)';
    throw notesErr('no-such-id', `没有 id 为 "${want}" 的评论。现有的：${have}`);
  }
  const cur = list[i];
  const changed = !cur.resolved;
  const note = changed
    ? { ...cur, resolved: true, resolvedAt: o.now ?? new Date().toISOString() }
    : { ...cur };
  const out = list.slice();
  out[i] = note;
  return { notes: out, note, changed };
}

/** 评论表的计数（纯函数）：`{ total, open, resolved }`。 */
function notesSummary(notes) {
  const list = Array.isArray(notes) ? notes : [];
  let open = 0;
  for (const n of list) if (!n?.resolved) open++;
  return { total: list.length, open, resolved: list.length - open };
}

/** ISO 时间戳 → `2026-10-10 22:10`（本机时区；读不动就原样返回）。 */
function fmtStamp(iso) {
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 评论表 → `--list` 的那几行（**纯函数**）。顺序 = 写入顺序（先记的在上面）。
 * @param {Note[]} notes
 * @returns {string[]}
 */
function formatNoteLines(notes) {
  const list = Array.isArray(notes) ? notes : [];
  if (!list.length) return ['  （还没有评论）'];
  const w = Math.max(...list.map((n) => String(n.id).length));
  return list.map((n) => {
    const at = Number.isFinite(n.at) ? `${n.at.toFixed(2)}s`.padStart(8) : '       —';
    const mark = n.resolved ? '✓ 已解决' : '○ 未解决';
    const when = n.createdAt ? `  ${fmtStamp(n.createdAt)}` : '';
    const done = n.resolved && n.resolvedAt ? ` → ${fmtStamp(n.resolvedAt)}` : '';
    return `  ${String(n.id).padEnd(w)}  ${at}  ${mark}  ${n.text}${when}${done}`;
  });
}

/** 这个 `out/<任务>/` 里的文件名**永远不许被 clean 删**吗？（纯函数；判据的唯一来源） */
function isProtectedOutFile(name) {
  return PROTECTED_OUT_FILES.has(String(name));
}

/* ------------------------------------------------------------------ 任务发现 */

function taskNames() {
  const dir = path.join(ROOT, 'tasks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, 'task.config.mjs')))
    .map((d) => d.name)
    .sort();
}

function pickTask() {
  const t = positional(0) ?? opt('task');
  const names = taskNames();
  if (t) {
    if (!names.includes(t)) die(`没有任务 "${t}"。现有：${names.join(', ') || '(空)'}`);
    return t;
  }
  if (names.length === 1) return names[0];
  if (!names.length) die('还没有任何任务。先跑：node scripts/anim.mjs new 我的第一个动画');
  die(`有多个任务，请指定一个：${names.join(', ')}`);
}

/* ------------------------------------------------------------------ 浏览器会话 */

let session = null;
/**
 * 会话开始时的源文件 mtime 快照（`docs/history/IMPROVEMENTS-4-5.md` §3）。
 *
 * 为什么要它：渲染期写了仓库里的文件 → 私有 Vite 触发 HMR → 整页重载 → 页面里的引擎状态没了
 * → 下一次 `page.evaluate` 抛 `Cannot read properties of undefined (reading 'stats')`。
 * **报错里没有一个字提到"文件被改了"**，为此白跑过一轮 40 秒的 check，还差点误判成"场景写出了 NaN"。
 * 有了这份快照，失联时就能直接点名是哪个文件在几点被改的。
 */
let sessionWatch = null;

async function portReady(url, timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1200) });
      if (res.ok) return true;
    } catch { /* 还没起来 */ }
    await sleep(180);
  }
  return false;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 起一个无头 Chrome，打开 app，等它就绪。
 * @param {{ task: string, scale?: number, only?: string, offline?: boolean }} o
 */
async function openSession(o) {
  // 先留一份源文件 mtime 基线：页面中途失联时用它点名"是谁在渲染期间写了文件"（docs/history/IMPROVEMENTS-4-5.md §3）
  sessionWatch = sourceMtimes();
  // scale > 1 = 真 4K。曾经因为 LineBatch 在 SCALE>1 下不出图而被整体拒绝；
  // 根因已定位并修好（顶点着色器用物理分辨率换算裁剪空间，见 gl.js 的 LineBatch VS），
  // 现在 scale 1..4 都可用。
  if (o.scale && (Number(o.scale) < 0.25 || Number(o.scale) > 4)) {
    die(`--scale 只接受 0.25..4（收到 ${o.scale}）。1 = 1080p，2 = 真 4K，0.5 = 草稿档（--draft 用的就是这个）。`);
  }
  const wantUrl = opt('url', '');
  let url = wantUrl;
  let vite = null;
  if (!url) {
    const candidate = 'http://127.0.0.1:5173';
    if (await portReady(candidate, 1200)) {
      url = candidate;
      log('· 复用已在运行的 Vite 服务 (5173)');
    } else {
      // 自己起一个，关掉热重载（渲染途中保存文件不能让页面刷新）
      const port = 5300 + Math.floor(Math.random() * 500);
      // 直接用当前 node 跑 vite 的 JS 入口：不进 shell、不产生中间 cmd 进程，
      // 这样 vite.kill() 真的能杀掉它（Windows 上 shell:true + npx 会留下一棵杀不掉的进程树）
      const viteEntry = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
      const viteArgs = [viteEntry, '--port', String(port), '--strictPort', '--host', '127.0.0.1'];
      vite = spawn(process.execPath, viteArgs, {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ANIM_NO_HMR: '1' },
      });
      children.add(vite);
      vite.stdout.on('data', () => {});
      vite.stderr.on('data', (d) => { const s = String(d); if (/error/i.test(s)) warn('vite:', s.trim()); });
      url = `http://127.0.0.1:${port}`;
      if (!(await portReady(url))) { vite.kill(); die('Vite 启动失败，试试手动 npm run dev 再带 --url'); }
      log(`· 已启动私有 Vite 服务 ${url}`);
    }
  }

  const browser = await chromium.launch({
    /**
     * 浏览器通道。默认 `chrome`（官方 Chrome，`channel: 'chrome'` 是 **playwright-core 的
     * 硬要求**：它不会替你下载浏览器，见 AGENTS.md §1 前置条件）。
     *
     * `ANIM_CHANNEL` 是给"Chrome 装坏了/没有 Chrome"的机器留的后门：
     * `ANIM_CHANNEL=msedge` 用系统里的 Edge（同 Chromium，渲染路径一致）。
     * 本机实测踩过：Chrome 的 `Application\` 里只剩 `chrome.exe` 壳、没有 `chrome.dll`，
     * 启动报「并行配置不正确」，playwright 只会说 `spawn UNKNOWN` —— 报错位置在 `launch`，
     * 看不出是浏览器装坏了。有了这个环境变量就不必改源码。
     */
    channel: process.env.ANIM_CHANNEL || 'chrome',
    headless: !flag('headed'),
    args: [
      '--use-angle=default',
      '--enable-gpu-rasterization',
      '--ignore-gpu-blocklist',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--hide-scrollbars',
      '--mute-audio',
      // 让无头 Chrome 也拿到真 GPU（否则 WebGL 可能退化成软件渲染）
      '--enable-unsafe-swiftshader',
      // ⚠ `--force_high_performance_gpu`：**默认不加**，用 `--gpu high` 显式开。
      //
      // 历史结论（`docs/PERF.md` §2①）曾经是「独显更慢」（核显 420ms/帧 vs 独显 520ms）。
      // **那条已经作废**：它量在 readPixels 要 195ms/帧 的年代，而当时的成本大头正是
      // 「整帧回读 + 跨适配器拷贝」，不是填充率。2026-10 重测（readPixels 降到 ~6ms 之后，
      // 同一个 promo、同一台 5800H + RTX 3070 Laptop、1080p、samples=1、连续 40 帧）：
      //   · raymarch 大厅段：核显 125.4ms/帧 → 独显 58.3ms/帧（**2.15×**）
      //   · 走廊段（轻）：  核显  45.0ms/帧 → 独显 51.4ms/帧（慢 14%）
      // 也就是「GPU 填充越重，独显越划算；轻场景付跨适配器拷贝的钱」。
      // 所以做成开关，别替用户预设 —— 拿不准就先 `anim perf <任务> --gpu high` 量。
      ...(opt('gpu', 'auto') === 'high' || flag('force-gpu') ? ['--force_high_performance_gpu'] : []),
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const consoleLog = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleLog.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));

  const params = new URLSearchParams({ task: o.task, offline: o.offline === false ? '0' : '1' });
  if (o.scale) params.set('scale', String(o.scale));
  if (o.only) params.set('only', o.only);
  // `--style paper`：临时换风格出图/预览（不改任务文件）。
  // 用途就一个 —— **一眼对比**："同一段画面在几套风格下各长什么样"（docs/STYLE.md）。
  if (opt('style', '')) params.set('style', String(opt('style')));
  // 变体（BACKLOG 1-23）：把名字交给页面，深合并在那边的 loadTask 里做（报错也带任务名）。
  if (opt('variant', '')) params.set('variant', String(opt('variant')));
  params.set('hud', '0');

  await page.goto(`${url}/?${params}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // 等就绪或失败
  const status = await page.waitForFunction(
    () => { const a = /** @type {any} */ (window).__anim; return a && a.status && (a.status().state === 'ready' || a.status().state === 'error') ? a.status() : null; },
    null, { timeout: 240000 },
  ).then((h) => h.jsonValue());

  if (status.state === 'error') {
    await browser.close();
    vite?.kill();
    die(`页面初始化失败：\n${status.error}`);
  }
  const info = await page.evaluate(() => /** @type {any} */ (window).__anim.info());
  session = { browser, page, vite, url, consoleLog, info, task: o.task };
  return session;
}

async function closeSession() {
  if (!session) return;
  try { await session.browser.close(); } catch { /* ignore */ }
  try { if (session.vite) { children.delete(session.vite); session.vite.kill(); } } catch { /* ignore */ }
  session = null;
}

function reportErrors(info) {
  const errs = [...(info.timelineProblems ?? [])];
  for (const e of info.errors ?? []) errs.push(e);
  if (errs.length) {
    warn('\n⚠ 有错误：');
    for (const e of errs.slice(0, 20)) warn('  ' + e);
  }
  if (info.gaps?.length) {
    warn('\n⚠ 时间线有空档（这些时间段会渲染成黑色）：');
    for (const g of info.gaps) warn('  ' + g);
  }
  return errs;
}

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
function pickVideoEncoder(requested) {
  if (ffmpegHasEncoder(requested)) return requested;
  const chain = process.platform === 'win32'
    ? ['h264_mf', 'libopenh264']
    : ['libopenh264'];
  const alt = chain.find((c) => c !== requested && ffmpegHasEncoder(c));
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

/* ------------------------------------------------------------------ 分块复用指纹 */

/**
 * 分块的**渲染参数指纹**（`docs/history/IMPROVEMENTS-1-3.md` P1-1）。
 *
 * 为什么必须要有：`out/<任务>/<任务>.parts/` 里的分块只按时间区间命名，
 * 复用时不看任何参数。于是做了 x264 vs NVENC 对照实验时，第二次运行**秒完成**
 * 并报「✓ 出片成功」—— 其实那些块是上一次渲的，看起来像"NVENC 快得离谱"。
 * 这个坑差点让我得出错误结论。
 *
 * 指纹由**两半**组成，缺一不可：
 *   · 渲染参数：fps / samples / shutter / scale / vcodec / crf|cq / preset / x264-params；
 *   · 场景与引擎的 mtime 签名：tasks/<任务>/ 下所有源文件 + 引擎的 .js 文件。
 * 后一半是"改了场景但忘了 --force"这种更常见的情况。
 *
 * @returns {{ params: Record<string, any>, scene: string, text: string }}
 */
function renderFingerprint(task, { fps, samples, shutter }) {
  const vcodec = opt('vcodec', 'libx264');
  const isNvenc = vcodec.endsWith('_nvenc');
  const params = {
    fps: Number(fps),
    samples: String(samples),
    shutter: Number(shutter),
    scale: Number(opt('scale', '0')) || 'task',
    vcodec,
    crf: vcodec.startsWith('libx264') ? String(opt('crf', '16')) : null,
    cq: isNvenc ? String(opt('cq', '19')) : null,
    preset: String(opt('preset', '')),
    x264: String(opt('x264', 'aq-mode=3')),
    tol: opt('tol', null),
  };
  const text = `fps=${params.fps} samples=${params.samples} shutter=${params.shutter} scale=${params.scale} `
    + `vcodec=${params.vcodec} crf=${params.crf} cq=${params.cq} preset=${params.preset} x264=${params.x264}`;
  return { params, scene: sceneSignature(task), text };
}

/** 这些目录改了**不会**影响画面（音频/字体是运行时素材，out 是产物） */
const SKIP_DIRS = new Set(['node_modules', 'out', '.git', 'audio', 'fonts']);
/** mtime 快照关心的源文件（只看会进模块图的那几类） */
const MTIME_EXT = /\.(js|mjs|css|html|json)$/i;
/** 场景签名关心的文件（多算了字体：字体换了画面就变） */
const SOURCE_EXT = /\.(js|mjs|json|css|woff2?|ttf|otf)$/i;

/**
 * 递归收集目录下匹配 `accept` 的文件，跳过产物/素材目录。
 * `sourceMtimes()` 与 `sourceFiles()` 共用这一份 —— 以前两处各写一个 walk，
 * 排除表已经差点漂移（一个排 audio，另一个也排，但扩展名表不同步）。
 *
 * @param {string} dir
 * @param {RegExp} accept
 * @param {string[]} [out]
 * @returns {string[]}
 */
function walkSourceTree(dir, accept, out = []) {
  let ents = [];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkSourceTree(p, accept, out);
    } else if (accept.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * 模块图内文件的 mtime 快照（`路径 -> mtimeMs`）。渲染前后各取一次，
 * 用来把"渲染期间改了文件"从"静默断流"变成一句点名的话（P2-2）。
 * @returns {Map<string, number>}
 */
function sourceMtimes() {
  const map = new Map();
  for (const dir of [path.join(ROOT, 'tasks'), path.join(ROOT, 'src')]) {
    for (const p of walkSourceTree(dir, MTIME_EXT)) {
      try { map.set(p, statSync(p).mtimeMs); } catch { /* ignore */ }
    }
  }
  const vite = path.join(ROOT, 'vite.config.mjs');
  try { map.set(vite, statSync(vite).mtimeMs); } catch { /* ignore */ }
  return map;
}

/**
 * 对比渲染前后的 mtime 快照，返回变化过的文件（相对路径 + 方向）。
 * @returns {string[]}
 */
function changedSources(before, after) {
  if (!before || !after) return [];
  const out = [];
  for (const [f, t] of after) {
    const b = before.get(f);
    if (b === undefined) out.push(`${path.relative(ROOT, f)}（新增）`);
    else if (Math.abs(b - t) > 1) out.push(`${path.relative(ROOT, f)}（改动）`);
  }
  for (const [f] of before) if (!after.has(f)) out.push(`${path.relative(ROOT, f)}（删除）`);
  return out;
}

/**
 * 包一层 `page.evaluate`：页面失联时给一条**可读诊断**，并点名渲染期间被改过的源文件。
 *
 * 背景（`docs/history/IMPROVEMENTS-4-5.md` §3）：渲染期写文件 → Vite HMR 整页重载 → 页面里那个装着引擎
 * 状态的全局对象没了 → 下一次 `page.evaluate` 抛的是
 * `TypeError: Cannot read properties of undefined (reading 'stats')`。
 * 这句话指向"stats 读不到"，让人往"场景写出了 NaN / 段名写错"上查 —— 方向完全错。
 *
 * 现在：失败时对比 mtime 快照，直接列出"最近被改过的源文件"，并说明规则
 * （**只要有一场渲染在跑，仓库里一个文件都别写**；并发子代理的产出先落 `out/_staging/`）。
 * 没检测到改动时也会说清楚 —— 那就是页面自己崩了，去看控制台。
 *
 * @param {Function} fn 传给 page.evaluate 的函数
 * @param {any} [arg]
 * @param {string} [what] 出错时显示"在做什么"（默认就是 page.evaluate）
 */
async function evaluateSafe(fn, arg, what = 'page.evaluate') {
  try {
    return await session.page.evaluate(fn, arg);
  } catch (err) {
    const head = String(err && err.message ? err.message : err).split('\n')[0];
    const changed = changedSources(sessionWatch, sourceMtimes());
    const lines = [`页面在 ${what} 时失联：${head}`];
    if (changed.length) {
      lines.push('  ⚠ 渲染期间有源文件被改动 —— 私有 Vite 会因此 HMR 整页重载，页面里的引擎状态就没了。');
      lines.push('     （规则：只要有一场渲染在跑，仓库里**一个文件都别写**；并发子代理的产出先落 out/_staging/。）');
      for (const c of changed.slice(0, 8)) lines.push(`     · ${c}`);
      if (changed.length > 8) lines.push(`     · …另有 ${changed.length - 8} 个`);
      lines.push('  → 让所有写文件的动作停手，然后重跑这条命令。');
    } else {
      lines.push('  没有检测到源文件改动 —— 更像页面自己崩了（GPU 掉线 / shader 编译超时 / OOM）。');
      lines.push('  先看上面打印的浏览器控制台错误，必要时用 --url 挂到手动 npm run dev 的页面上复现。');
    }
    const e = new Error(lines.join('\n'));
    e.readable = true;
    throw e;
  }
}

/**
 * 列出会影响画面的源文件：任务目录 + 引擎 src/（排除 out/ 之类）。
 */
function sourceFiles(task) {
  return [
    ...walkSourceTree(path.join(ROOT, 'tasks', task), SOURCE_EXT),
    ...walkSourceTree(path.join(ROOT, 'src'), SOURCE_EXT),
  ];
}

/**
 * 场景签名 = 所有源文件的 `相对路径:大小:mtime`。任何一个变了就变。
 * 用 mtime + size 而不是内容哈希：几千个文件读一遍内容太慢，而
 * "改了文件 → mtime 变"对这里的用途（判断"这一块是不是拿旧代码渲的"）已经够。
 */
function sceneSignature(task) {
  const parts = [];
  for (const f of sourceFiles(task)) {
    try {
      const st = statSync(f);
      parts.push(`${path.relative(ROOT, f)}:${st.size}:${Math.round(st.mtimeMs)}`);
    } catch { /* 读不到就跳过 */ }
  }
  parts.sort();
  return parts.join('|');
}

/**
 * 引擎签名 = `src/` 下所有源文件的 `相对路径:大小:mtime`（排序后拼起来）。
 *
 * 为什么要单独算：**分块增量重渲（BACKLOG 1-45）**需要知道"这次改动影响的是哪一块"。
 * `tasks/` 下的改动只影响用到它的那几块；`src/` 下的改动（引擎）**任何一块都可能变** ——
 * 所以引擎签名一变化就整批失效，这是保守但正确的方向。
 */
function engineSignature() {
  const files = [];
  walkSourceTree(path.join(ROOT, 'src'), SOURCE_EXT, files);
  files.sort();
  const parts = [];
  for (const f of files) {
    try {
      const st = statSync(f);
      parts.push(`${path.relative(ROOT, f)}:${st.size}:${Math.round(st.mtimeMs)}`);
    } catch { /* 读不到就跳过 */ }
  }
  return parts.join('|');
}

/**
 * 读/写分块目录旁的指纹文件。返回 `{ changed: string[], fingerprint }`。
 * @returns {{ changed: string[], fp: ReturnType<typeof renderFingerprint> }}
 */
function segmentManifest(segDir, task, optsNow) {
  const fp = renderFingerprint(task, optsNow);
  const file = path.join(segDir, 'params.json');
  let prev = null;
  try { prev = JSON.parse(readFileSync(file, 'utf8')); } catch { /* 第一次跑 */ }
  const changed = [];
  if (!prev) changed.push('首次渲染（没有参数记录）');
  else {
    for (const k of Object.keys(fp.params)) {
      if (JSON.stringify(prev.params?.[k]) !== JSON.stringify(fp.params[k])) {
        changed.push(`${k}: ${JSON.stringify(prev.params?.[k])} → ${JSON.stringify(fp.params[k])}`);
      }
    }
    if (prev.scene !== fp.scene) changed.push('tasks/ 或 src/ 下的源文件变了（改了场景或引擎）');
  }
  return { changed, fp, file, prev };
}

/* ------------------------------------------------------------------ 命令：new */

function cmdNew() {
  const name = positional(0);
  if (!name) die('用法：node scripts/anim.mjs new <任务名>');
  if (!/^[\w.-]+$/.test(name)) die('任务名只能用字母数字下划线短横线点');
  const dir = path.join(ROOT, 'tasks', name);
  if (existsSync(dir)) die(`${dir} 已经存在`);
  mkdirSync(path.join(dir, 'scenes'), { recursive: true });
  mkdirSync(path.join(dir, 'audio'), { recursive: true });

  writeFileSync(path.join(dir, 'task.config.mjs'), `// 任务：${name}
// 一个任务 = 一支片子（或一段小动画）。改这里就够了，引擎不用动。
//
// 想要「零代码出片」（推荐先试）：把下面的 timeline 换成**配置档** —— 时间线里直接写镜头模板，
// 连 scenes/ 都不需要：
//   timeline: [ { type: 'title', title: '标题', sub: '副标题', dur: 4 },
//               { type: 'chart', values: [0.3, 0.7, 0.95], title: '成绩', dur: 5 } ]
// 11 个模板与它们的参数：node scripts/anim.mjs shots [名字]    ·    说明：docs/CONFIG-ONLY.md
import { seq, cut } from '../../src/timeline.js';
import title from './scenes/title.js';
import shapes from './scenes/shapes.js';
// 可选：全片共用的背景（时间线里写 { world: 'auto' } 的段由引擎每帧先铺它）。
// import { worldPass } from '../../src/kit/index.js';
// export const world = (ctx) => worldPass(ctx, { grid: 60 });

export default {
  title: '${name}',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,              // 1..4；2 = 真 4K（矢量/文字/后处理在 4K 下都验过）
  palette: {},           // 覆盖调色板，例如 { signal: '#00e0ff' }
  // audio: './audio/track.mp3',   // 有音乐就打开，画面就能踩拍子
  // lyrics: './lyrics.json',      // 词级时间戳（可选）
  // fonts: './fonts/brand.css',   // 任务自带字体（不必去改全局 public/fonts/）

  timeline: seq([
    cut(title, { dur: 4 }),
    cut(shapes, { dur: 6, params: { variant: 'grid' } }),
  ], { start: 0 }),
};
`);

  writeFileSync(path.join(dir, 'scenes', 'title.js'), `// 一段最简单的场景：标题 + 逐字入场 + 生长的矢量线。
// 场景 = { id, setup(ctx), render(ctx) }，render 必须把整帧画进 ctx.out。
// 想要现成的整镜头（标题 / 图表 / 大字 / 甩镜 / 片尾 / 波形 / 网格）就先别写这些：
//   node scripts/anim.mjs shots            ← 列出模板与参数
//   import { shot } from '../../../src/shots/index.js';
//   export default shot('title', { title: '我的片子', sub: '副标题' });
// 下面这份手写场景留着当“从零写一个镜头”的样板，两者可以混在同一条时间线里。
import { css } from '../../../src/core/util.js';

export default {
  id: 'title',

  setup(ctx) {
    // 只调用一次：着色器、几何、预计算都放这里
  },

  render(ctx) {
    const { f, gl, P, text, type, comp, lines } = ctx;
    const { W, H } = gl;

    // 1) 背景：清一层底色（要更复杂的底就上 shader Pass，见 docs/COOKBOOK.md）
    gl.clear(ctx.out, [P.ink[0] * 0.6, P.ink[1] * 0.6, P.ink[2] * 0.6]);

    // 2) 一条从左到右生长的细线，带刻度
    lines.begin();
    const y = H * 0.58;
    const grow = Math.min(1, f.lt / 1.6);
    const x0 = W * 0.18, x1 = W * 0.82;
    lines.seg(x0, y, x0 + (x1 - x0) * grow, y, 3, P.signal);
    for (let i = 0; i < 16; i++) {
      const x = x0 + ((x1 - x0) * i) / 15;
      const on = i / 15 <= grow;
      lines.seg(x, y - (on ? 16 : 8), x, y + (on ? 16 : 8), on ? 2 : 1.2, on ? P.bone : P.graphite);
    }
    lines.flush(ctx.out);

    // 3) 文字：逐字入场
    text.clear();
    type.write('动画，是代码', W * 0.18, H * 0.42, {
      size: 132, weight: 800, family: 'sans', color: css(P.bone),
      stagger: 0.07, from: 'up', dist: 60, t: f.lt,
    });
    // 按锚点写整行：writeLine 会先量宽度再偏移（type.write 的 align 是逐字生效的，
    // 直接写 align:'center' 会让每个字各自居中，整行反而跑偏）
    type.writeLine('ANIMATION IS CODE', W * 0.82, H * 0.42 + 62, {
      anchor: 'right', size: 30, weight: 400, family: 'mono', tracking: 8,
      color: css(P.signal, 0.9), stagger: 0.02, t: f.lt,
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.3, grain: 0.03 };
  },
};
`);

  writeFileSync(path.join(dir, 'scenes', 'shapes.js'), `// 第二段：网格 + 粒子，演示「一切位置都是时间的函数」的写法。
import { css, rng } from '../../../src/core/util.js';

export default {
  id: 'shapes',

  setup(ctx) {
    // 预计算：确定性随机（永远不要用 Math.random）
    const r = rng(7);
    this.dots = Array.from({ length: 260 }, () => ({ x: r(), y: r(), s: 0.3 + r() * 1.4, ph: r() }));
  },

  render(ctx) {
    const { f, gl, P, text, type, comp, lines, params } = ctx;
    const { W, H } = gl;
    const local = f.lt;

    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);

    lines.begin();
    // 网格：每格一条线，按到中心的距离依次点亮
    const cols = 24, rows = 14;
    const cw = W / cols, ch = H / rows;
    for (let i = 0; i <= cols; i++) {
      const k = i / cols;
      const d = Math.abs(k - 0.5) * 2;
      const lit = Math.max(0, 1 - Math.abs(local * 1.4 - d * 2.2));
      lines.seg(i * cw, 0, i * cw, H, 1, [P.graphite[0] * (0.25 + lit), P.graphite[1] * (0.25 + lit), P.graphite[2] * (0.25 + lit)]);
    }
    for (let j = 0; j <= rows; j++) lines.seg(0, j * ch, W, j * ch, 1, P.graphite.map((c) => c * 0.25));

    // 粒子：每个点有自己的相位，位置是时间的纯函数（可以随便 seek / 多子帧采样）
    for (const d of this.dots) {
      const px = d.x * W + Math.sin(local * (0.6 + d.s) + d.ph * 6.28) * 40;
      const py = d.y * H + Math.cos(local * (0.4 + d.s * 0.7) + d.ph * 6.28) * 30;
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(local * 1.2 + d.ph * 9));
      lines.seg(px, py, px + 0.01, py, 2 + d.s * 3, [P.signal[0] * tw, P.signal[1] * tw, P.signal[2] * tw]);
    }
    lines.flush(ctx.out);

    text.clear();
    type.write(String(params.variant ?? '').toUpperCase(), 60, 90, {
      size: 34, family: 'mono', color: css(P.ash), tracking: 6,
    });
    // 整行淡入：写了 alpha 就会随 t 动画（不需要再塞个极小的 stagger 去骗引擎）
    type.writeLine('每一帧都是 t 的函数', W / 2, H - 110, {
      anchor: 'center', size: 54, weight: 600, family: 'sans', color: css(P.bone),
      alpha: [0, 1], t: local - 0.4, staggerDur: 0.6,
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.4, ca: Math.abs(Math.sin(local)) * 0.3, grain: 0.04 };
  },
};
`);

  log(`✓ 建好了 tasks/${name}/`);
  log('  下一步：');
  log(`    npm run still -- ${name} -t 1,2.5        出几帧看看`);
  log(`    npm run dev                              浏览器里实时预览`);
  log(`    npm run video -- ${name}                 渲染成片`);
}

/* ------------------------------------------------------------------ 命令：tasks */

/**
 * `anim tasks --json` 的字段契约（BACKLOG 1-58）。
 *
 * 为什么要它：任何"批量跑一批片子"的东西（`anim queue`、变体矩阵、外部脚本）都要先知道
 * **有哪些片子、每片多大多长、什么风格、有没有旁白、有哪些变体**。以前只有人能读的一行文本。
 * 出处：Remotion 的 `getCompositions()` —— 把片子清单与输入声明成机器可读的（见 docs/REFERENCE-remotion.md §2①）。
 *
 * schema 串沿用 `anim.shots --json` 的惯例：**只许加字段，不许改已有字段的含义**。
 */
export const TASKS_SCHEMA = 'anim.tasks/1';

/**
 * 从任务配置源码里抠出元信息（**纯函数**，离线可测）。
 *
 * ⚠ 这里是**静态解析**，不是执行配置：
 *   · `duration` 只有存在 `audio/timing.json`（旁白解算产物）时才知道，否则是 null + `durationSource: null`；
 *   · `variants` 只列名字（键），不展开它们的覆盖内容；
 *   · 解析不出来的一律留 null，**不猜**（与"空 ≠ 干净"同一条纪律）。
 *
 * @param {{ id: string, cfgText: string, sceneCount?: number, audio?: string[],
 *           timingTotal?: number|null }} a
 */
export function parseTaskMeta(a) {
  const cfg = String(a.cfgText ?? '');
  // ⚠ 只看 variants 之前的部分：变体里的 style / captions 是**变体的**，不是任务级的
  //   （第一版没切，_info-lab 被读成 style: noir —— 它只有 dark 变体是 noir）
  const baseText = cfg.split(/export\s+const\s+variants/)[0];
  const pick = (re) => { const m = re.exec(baseText); return m ? m[1] : null; };
  const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  // style 可以是字符串、也可以是 { name: '...' } —— 两种都认，认不出就是 null（= 默认 print）
  const style = pick(/\bstyle:\s*['"]([^'"]+)['"]/) ?? pick(/\bstyle:\s*\{[^}]*?name:\s*['"]([^'"]+)['"]/);
  // captions: true / false（不写 = 没开）
  const capRaw = pick(/\bcaptions:\s*(true|false)\b/);
  const variants = [];
  const vm = /export\s+const\s+variants\s*=\s*\{([\s\S]*?)\n\};/.exec(cfg);
  if (vm) for (const m of vm[1].matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:/gm)) variants.push(m[1]);
  return {
    id: a.id,
    title: pick(/\btitle:\s*['"]([^'"]+)['"]/) ?? a.id,
    width: num(pick(/\bwidth:\s*(\d+)/)),
    height: num(pick(/\bheight:\s*(\d+)/)),
    fps: num(pick(/\bfps:\s*(\d+)/)),
    scale: num(pick(/\bscale:\s*(\d+)/)),
    style,
    captions: capRaw == null ? false : capRaw === 'true',
    sceneCount: Number.isFinite(a.sceneCount) ? a.sceneCount : 0,
    audio: Array.isArray(a.audio) ? a.audio : [],
    variants,
    duration: Number.isFinite(a.timingTotal) ? a.timingTotal : null,
    durationSource: Number.isFinite(a.timingTotal) ? 'audio/timing.json' : null,
  };
}

function cmdTasks() {
  const names = taskNames();
  if (!names.length) { log('(还没有任务) 跑：node scripts/anim.mjs new 我的第一个动画'); return; }

  /** 一个任务的元信息（--json 与人类可读两条路共用同一份，避免两套口径漂移）。 */
  const metaOf = (n) => {
    const dir = path.join(ROOT, 'tasks', n);
    const cfg = readFileSync(path.join(dir, 'task.config.mjs'), 'utf8');
    const scenes = existsSync(path.join(dir, 'scenes'))
      ? readdirSync(path.join(dir, 'scenes')).filter((f) => f.endsWith('.js')).length
      : 0;
    const audio = existsSync(path.join(dir, 'audio'))
      ? readdirSync(path.join(dir, 'audio')).filter((f) => /\.(mp3|wav|m4a|flac|ogg)$/i.test(f))
      : [];
    let timingTotal = null;
    const timing = path.join(dir, 'audio', 'timing.json');
    if (existsSync(timing)) {
      try { timingTotal = Number(JSON.parse(readFileSync(timing, 'utf8'))?.total) || null; } catch { timingTotal = null; }
    }
    return parseTaskMeta({ id: n, cfgText: cfg, sceneCount: scenes, audio, timingTotal });
  };

  if (flag('json')) {
    const tasks = names.map(metaOf);
    log(JSON.stringify({ schema: TASKS_SCHEMA, count: tasks.length, tasks }, null, 2));
    return;
  }

  log('任务列表：');
  for (const m of names.map(metaOf)) {
    const size = m.width && m.height ? ` ${m.width}×${m.height}` : '';
    const dur = m.duration != null ? ` ${m.duration.toFixed(1)}s` : '';
    const varTag = m.variants.length ? `  变体 ${m.variants.join('/')}` : '';
    log(`  ${m.id.padEnd(16)} “${m.title}”${size}${m.fps ? ' @' + m.fps : ''}${dur}  ${m.sceneCount} 个场景`
      + `${m.audio.length ? '  ♪ ' + m.audio.join(',') : ''}${m.style ? '  风格 ' + m.style : ''}${varTag}`);
  }
  log('\n（机器可读：node scripts/anim.mjs tasks --json   · schema ' + TASKS_SCHEMA + '）');
}

/* ------------------------------------------------------------------ 命令：gpu */

async function cmdGpu() {
  // ⚠ 必须和 `check` 走**同一条采集路径**（P2-4）：以前这里自己新建 canvas 去问，
  //   于是同一个 GPU 在 `check` 里显示 `WebKit WebGL`、在这里显示 ANGLE 全串。
  //   现在两边都读引擎在 gl.js 里采集好的那一份。
  await openSession({ task: pickTask(), offline: false });
  try {
    const r = await session.page.evaluate(() => /** @type {any} */ (window).__anim.info());
    const g = r.gpu ?? {};
    log(JSON.stringify({
      ok: !!g.renderer,
      renderer: g.unmaskedRenderer ?? g.renderer,
      vendor: g.unmaskedVendor ?? g.vendor,
      version: g.version,
      /** unmasked 串可用吗 */
      unmasked: !!g.unmasked,
      floatRT: !!g.floatRT,
    }, null, 2));
    if (!g.unmasked) {
      warn('⚠ unmasked renderer 不可用（WEBGL_debug_renderer_info 拿不到）—— 上面是笼统的渲染器串。');
    }
    if (!g.floatRT) warn('⚠ 无法渲染到浮点纹理：本引擎需要 EXT_color_buffer_float（HDR 渲染）。');
  } finally { await closeSession(); }
}

/* ---------------- 镜头模板的依赖前置校验（BACKLOG 1-21 / docs/ENGINE.md §14.9）：纯函数区 */

/**
 * 把 JS 源码里的**注释换成空格**（长度与换行原样保留 ⇒ 行号不变），**字符串字面量原样留着**。
 *
 * 为什么需要它：依赖扫描要认的是 `shot('wave', …)` / `{ type: 'wave', … }` 里的那个**字符串**，
 * 所以不能像 `tools/test-shots.mjs` 的 `maskNonCode()` 那样把字符串一起抹掉；但注释里的举例
 * 绝不能被当成"真的用了这个模板"（`tasks/_config-lab/task.config.mjs` 的文件头就写着
 * `{ type: 'chart', …, post }`，`tasks/beat/task.config.mjs` 的注释里也提到过模板名）。
 *
 * 模板字符串（GLSL）按普通字符串处理：里面的 `//` 是 shader 注释，不是 JS 注释。
 */
function blankJsComments(src) {
  return sharedBlankJsComments(src);
}

/**
 * 纯函数：从任务源码文本里找出**用了哪些镜头模板**（`docs/ENGINE.md` §3.2 / §14.8 的两种写法）。
 *
 *   · 手写场景：`export default shot('chart', { … })`      → 认 `shot('名字'`
 *   · 配置档：  `{ type: 'chart', values: […] }`            → 认 `type: '名字'`
 *
 * 只认**已知模板名**：拼错的模板名由 `timeline.js` / `shot()` 抛错（带任务名与可用清单），
 * 这里再报一遍只会让读的人不知道该信哪条。
 *
 * ⚠ 它是**静态**的：不加载模块、不建 GL、不起浏览器，所以只能看字面量写法
 * （`const n = 'wave'; shot(n)` 这种扫不到 —— 代价是"少报一次"，不是"报错"）。
 *
 * @param {{ file: string, text: string }[]} files
 * @param {Iterable<string>} known 已知模板名（`SHOTS` 的键）
 * @returns {{ shot: string, file: string, line: number }[]}
 */
function scanShotUsage(files, known) {
  const names = new Set(known ?? []);
  const found = [];
  for (const f of Array.isArray(files) ? files : []) {
    const code = blankJsComments(f?.text ?? '');
    const lines = code.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      // ⚠ 两个分支都要吃掉分隔符：`{ type: '…'` 与行首的 `type: '…'`
      for (const m of lines[i].matchAll(/(?:\bshot\s*\(\s*|(?:^|[,{[\s])type\s*:\s*)['"]([\w-]+)['"]/g)) {
        if (!names.has(m[1])) continue;
        found.push({ shot: m[1], file: String(f?.file ?? ''), line: i + 1 });
      }
    }
  }
  return found;
}

/**
 * 纯函数：把「模板声明的 `spec.requires`」+「任务的事实」变成问题清单。
 *
 * **两档严重性是刻意分开的**（BACKLOG 1-21 的验收口径就在这一条上）：
 *
 *   · `missing-audio` → **error**（进 `errs` ⇒ 退出码 1）。
 *     依据：`src/app.js:150` 只在 `task.config.mjs` **有 `audio` 字段**时才 `MusicData.load(...)`，
 *     否则 `Engine` 拿到的是 `SILENT`（`src/core/audio.js:181`）。`wave`/`pulse`/`grid` 读的是
 *     包络数组与打击事件表 —— 空音乐的包络**恒为 0**、事件表**恒为空**：不抛错、只是画不出东西。
 *     这不是"提示"，是"这一段不可能对"，所以它该红。
 *     ⚠ 但**只有真的没配 `audio`** 才红 —— 别让"某个模板声明了 requires"把用它的任务一律染红。
 *
 *   · `missing-analysis` → **hint**（进 `skipped`，默认不改退出码）。
 *     依据：配了 `audio` 只是"还没跑那一步"——`video` 出片前会自动补一次分析
 *     （`cmdVideo` 里那句 `await analyzeTaskAudio(task)`），浏览器里也有"现算"的退路
 *     （`src/core/audio.js:69-88`）。所以它属于「没跑 ≠ 通过」，不属于「坏了」。
 *
 * 同一件事只报一次（按 `令牌:模板名` 去重）：根因是任务级的，模板出现在 3 段里也只是一件事。
 *
 * @param {{ shot: string, file: string, line: number }[]} usage `scanShotUsage()` 的结果
 * @param {(name: string) => any} specOf 模板名 → `spec`（没有 spec 的给 undefined ⇒ 不参与校验）
 * @param {{ audioDeclared?: boolean, audioPath?: string|null, audioSource?: string|null,
 *           analysisFile?: string|null, analysisExpected?: string|null }} facts
 * @returns {{ level: 'error'|'hint', kind: string, shot: string, where: string,
 *             message: string, fix: string }[]}
 */
function shotDependencyIssues(usage, specOf, facts) {
  const f = facts ?? {};
  const out = [];
  const seen = new Set();
  for (const u of Array.isArray(usage) ? usage : []) {
    const spec = typeof specOf === 'function' ? (specOf(u.shot) ?? {}) : {};
    const req = Array.isArray(spec.requires) ? spec.requires : [];
    if (!req.length) continue;
    const where = `${u.file}:${u.line}`;

    if (req.includes('music') && !f.audioDeclared) {
      if (seen.has(`music:${u.shot}`)) continue;
      seen.add(`music:${u.shot}`);
      out.push({
        level: 'error',
        kind: 'missing-audio',
        shot: u.shot,
        where,
        message: `模板 "${u.shot}" 读 ctx.music（音频包络 + 真实打击事件），但这支任务**没有配 audio**`
          + (f.audioSource
            ? ` —— ${f.audioSource} 这个音频文件在任务目录里，可 task.config.mjs 里没有 audio: 字段，`
              + '而页面正是按那个字段决定要不要加载音乐的'
            : '')
          + '；引擎给场景的是 SILENT（空音乐），这一段的画面只能是黑的',
        fix: "tasks/<任务>/task.config.mjs 里加一行 audio: './audio/xxx.mp3'，"
          + '然后 node scripts/anim.mjs analyze <任务>（出片前 CLI 也会自动补一次分析）',
      });
      // 根因已经报了：别再报它的派生项（"还没跑 analyze"是同一件事的下游）
      continue;
    }

    if (req.includes('analyze') && !f.analysisFile) {
      if (seen.has(`analyze:${u.shot}`)) continue;
      seen.add(`analyze:${u.shot}`);
      out.push({
        level: 'hint',
        kind: 'missing-analysis',
        shot: u.shot,
        where,
        message: `模板 "${u.shot}" 读音频包络，但还没有**预计算**的音频分析数据（${f.analysisExpected ?? 'audio/<文件>.analysis.json'}）`
          + ' —— 引擎会退到在浏览器里现算一份（`src/core/audio.js` 的第 2 条路：能用，但慢，'
          + '而且和成片用的不是同一份数据）；`video` 出片前 CLI 会自动补上正式的那一份',
        fix: 'node scripts/anim.mjs analyze <任务>（几秒钟，跑一次就够）',
      });
    }
  }
  return out;
}

/** `check` 的 skipped 段里，这一项的 what（同一个 what 会被 formatSkipped 聚合成一行）。 */
const SHOT_DEP_WHAT = '镜头模板依赖（spec.requires）';

/**
 * **在"开浏览器之前"这一步就查得了**的依赖令牌（靠任务源码文本 + 任务事实）。
 *
 * 词表（`src/shots/index.js` 的 `SHOT_REQUIRES`）里其余的令牌属于**时间线层**：
 * 它们的真假只有在 `build()` 排完时间之后才成立，文本扫描判不准（假报比不报贵）。
 *   · `'under'`（2026-10-16 起）—— 由**段级审计**查：`src/timeline.js` 的
 *     `auditUnderRequires()` → 页面侧 `__anim.underAudit()` → `cmdCheck` 打印并 gate
 *     （没有交叠 ⇒ errs；第 1 段 / `--only` 之后没得比 ⇒ 进 skipped）。
 *     所以这里那句"还没接线"必须改成"不在这一步查"，否则报告会把**已经验过**的说成没验。
 *
 * 为什么不把"这一步查不了的令牌"塞进 `skipped`：那是**引擎自己的**分工（对每个用 `whip`
 * 的任务都一样、任务作者也改不了），塞进去会让 `--strict` 永远红、还会把真正的"这次没跑"淹掉。
 * 它该说的是"**换到下面那一段去查**"，而不是"没验"。
 */
const SHOT_DEP_GATED = ['music', 'analyze'];

/**
 * 纯函数：把依赖校验渲染成 `check` 要打印的那些行 + 要进 `errs` 的串 + 要进 `skipped` 的条目。
 *
 * 三种结局都要**说话**（"空 ≠ 干净"，`docs/BACKLOG.md` 1-19）：
 *   · 任务根本没用到模板 → 明说"这一项没有可查的对象"，而不是安静地什么都不打；
 *   · 用到且都满足      → 打出"谁需要什么、在哪用到、事实是什么"；
 *   · 有没满足的        → 逐条点名 `文件:行号` + 给下一步命令。
 *
 * @param {{ scanned?: number, usage?: any[], issues?: any[], facts?: any, only?: string|null }} o
 * @returns {{ lines: { sev: 'log'|'warn', text: string }[], errors: string[],
 *             skipped: { what: string, why: string }[] }}
 */
function shotDependencyReport(o = {}) {
  const scanned = Number(o.scanned ?? 0);
  const usage = Array.isArray(o.usage) ? o.usage : [];
  const issues = Array.isArray(o.issues) ? o.issues : [];
  const facts = o.facts ?? {};
  const names = [...new Set(usage.map((u) => u.shot))];
  /** @type {{ sev: 'log'|'warn', text: string }[]} */
  const lines = [];
  const errors = [];
  const skipped = [];

  if (!names.length) {
    lines.push({
      sev: 'log',
      text: `镜头模板依赖：这支任务没有用到 src/shots/ 的模板（静态扫了 ${scanned} 个文件；`
        + "只认 shot('名字') 与 { type: '名字' } 两种字面量写法）—— 这一项**没有可查的对象**，"
        + '不是"依赖都对"',
    });
    return { lines, errors, skipped };
  }

  lines.push({
    sev: 'log',
    text: `镜头模板依赖：扫了 ${scanned} 个文件，用到 ${names.length} 个模板（${names.join(' / ')}）`,
  });
  for (const u of usage) {
    const req = Array.isArray(u.requires) ? u.requires : [];
    if (!req.length) continue;
    lines.push({
      sev: 'log',
      text: `  ${String(u.shot).padEnd(8)} 需要 ${req.join(' + ')}    ${u.file}:${u.line}`,
    });
  }
  const free = names.filter((n) => !usage.some((u) => u.shot === n && (u.requires ?? []).length));
  if (free.length) lines.push({ sev: 'log', text: `  ${free.join(' / ')}：没有声明任何依赖（requires: []）` });

  // 声明了、但这一次**查不了**的令牌：必须说出来（否则"✓ 都满足"就成了假话）
  const declared = [...new Set(usage.flatMap((u) => (Array.isArray(u.requires) ? u.requires : [])))];
  const ungated = declared.filter((t) => !SHOT_DEP_GATED.includes(t));

  if (!issues.length) {
    const have = [];
    if (facts.audioPath) have.push(`music = ${facts.audioPath}`);
    if (facts.analysisFile) have.push(`analyze = ${facts.analysisFile}`);
    lines.push({
      sev: 'log',
      text: `  ✓ ${ungated.length ? '能查的那几条依赖' : '声明的依赖'}都满足${have.length ? `（${have.join(' · ')}）` : ''}`,
    });
  } else {
    const nErr = issues.filter((i) => i.level === 'error').length;
    lines.push({
      sev: 'warn',
      text: `⚠ 镜头模板声明的依赖有 ${issues.length} 项没满足`
        + `（${nErr} 项是**画面不可能是对的**硬问题，${issues.length - nErr} 项是"这一步还没跑"）：`,
    });
    for (const it of issues) {
      const mark = it.level === 'error' ? '✗' : '⚠';
      lines.push({ sev: 'warn', text: `  ${mark} [${it.where}] ${it.message}` });
      lines.push({ sev: 'warn', text: `  → ${it.fix}` });
      if (it.level === 'error') errors.push(`[镜头模板依赖] ${it.shot}（${it.where}）：${it.message}`);
      else skipped.push({ what: SHOT_DEP_WHAT, why: `${it.shot}（${it.where}）：${it.message}` });
    }
  }

  if (ungated.length) {
    // `under` 已经接线了，只是**不在这两步里**：它在时间线展开之后由段级审计判
    // （见 `cmdCheck` 的「依赖 under」那一段）。说成"还没接线"会把验过的说成没验。
    const late = ungated.filter((t) => t === 'under');
    const never = ungated.filter((t) => t !== 'under');
    if (late.length) {
      lines.push({
        sev: 'log',
        text: `  · ${late.map((t) => `'${t}'`).join(' / ')} 是**时间线层**的依赖（交叠够不够），这一步判不准 —— `
          + '它在时间线展开之后由段级审计查，见下面「依赖 under」那一段；'
          + '那一段没出现就是**没验**，别当成满足（docs/ENGINE.md §14.9 读法 3）',
      });
    }
    if (never.length) {
      lines.push({
        sev: 'log',
        text: `  ⚠ ${never.map((t) => `'${t}'`).join(' / ')} 这一条**还没接线**：这次没有验它`
          + '（交叠是时间线层的声明，静态扫描判不准 —— 假报比不报更贵，见 docs/ENGINE.md §14.9 读法 3）',
      });
    }
  }
  if (o.only) {
    lines.push({
      sev: 'log',
      text: `  （--only ${o.only} 只挑了几段试渲染；这一项是**整个任务**范围的静态扫描）`,
    });
  }
  lines.push({
    sev: 'log',
    text: '  （依赖来自模板自己的 spec.requires —— 看某个模板：node scripts/anim.mjs shots <名字> --json；'
      + '契约：docs/ENGINE.md §14.9）',
  });
  return { lines, errors, skipped };
}

/**
 * 读任务里可能"取镜头模板"的源码文本（`task.config.mjs` + `scenes/**.js`）。
 * 只读文件、不加载模块（任务配置是 Vite 模块，CLI 侧 import 不了 —— 与 `resolveAudioTracks()` 同理）。
 *
 * @param {string} task
 * @returns {{ file: string, text: string }[]}
 */
function taskShotSources(task) {
  const out = [];
  const add = (file) => {
    try {
      out.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), text: readFileSync(file, 'utf8') });
    } catch { /* 读不到就不算扫过（调用方会打印扫了几个文件） */ }
  };
  add(path.join(ROOT, 'tasks', task, 'task.config.mjs'));
  const walk = (dir) => {
    let ents = [];
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of [...ents].sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.js')) add(p);
    }
  };
  walk(path.join(ROOT, 'tasks', task, 'scenes'));
  return out;
}

/**
 * 纯函数：任务配置文本里**有没有 `audio` 字段** —— 这就是"页面会不会加载音乐"的开关
 * （`src/app.js:150`：`if (preTask.audio) music = await MusicData.load(...)`；否则一直是 `SILENT`）。
 *
 * ⚠ 这是**文本**判据（CLI 侧 import 不了任务配置，见 `resolveAudioTracks()` 的同款注释），
 * 所以刻意放宽到"三面都认"：对象字面量里的 `audio:`（行首或 `,{` 之后都算）、
 * 以及 `const audio = …` 这种先在变量里写、再 shorthand 进对象的写法。
 * 宁可**漏报**（少报一条真问题）也不能误报 —— 误报会把一个本来正常的任务变成非零退出。
 * 注释先被抹掉（`blankJsComments`），所以"注释里写着 audio: …"不算。
 *
 * @param {string} text task.config.mjs 的源码文本
 */
function audioDeclaredInConfig(text) {
  const code = blankJsComments(text);
  return /(^|[,{[\s])audio\s*:/.test(code)
    || /(^|\n)[^\S\n]*(?:const|let|var)\s+audio\s*=/.test(code);
}

/**
 * 收集依赖校验的事实（**这一层做 IO，判据在 `shotDependencyIssues()` 里**）。
 *
 * `audioDeclared` 只看 `task.config.mjs` 里**有没有 `audio` 字段**（`audioDeclaredInConfig()`），
 * 而不是 `resolveAudioTracks()` 那条"扫 `audio/` 目录"的兜底 —— 后者只影响 CLI 侧的分析与封装，
 * **不会**让页面加载音乐。两者的差别正是"任务在 audio/ 里放了 mp3、却忘了写 audio: 字段"
 * 这种静默失败能被点名的地方。
 *
 * @param {string} task
 */
function shotDependencyFacts(task) {
  const dir = path.join(ROOT, 'tasks', task);
  let cfg = '';
  try { cfg = readFileSync(path.join(dir, 'task.config.mjs'), 'utf8'); } catch { /* 读不到＝没配 */ }
  const code = blankJsComments(cfg);
  const audioDeclared = audioDeclaredInConfig(cfg);
  const lit = /(^|[,{[\s])audio\s*:\s*(\{[^}]*\}|'[^']*'|"[^"]*")/.exec(code);
  const declaredValue = lit ? lit[2].replace(/^['"]|['"]$/g, '') : null;

  const tracks = resolveAudioTracks(task);
  const rel = (p) => (p ? path.relative(ROOT, p).replace(/\\/g, '/') : null);
  const audioSource = tracks.analysisSource ? rel(tracks.analysisSource) : null;
  const base = tracks.analysisSource ? tracks.analysisSource.replace(/\.[^.]+$/, '') : null;
  const analysisExpected = base
    ? rel(path.join(ROOT, 'tasks', task, 'audio', `${path.basename(base)}.analysis.json`))
    : null;
  const analysisFile = analysisExpected && existsSync(path.join(ROOT, analysisExpected))
    ? analysisExpected
    : null;
  // 展示用的 music 路径：页面上真正加载的是 `audio:` 字段指的那个文件
  const audioPath = audioDeclared && declaredValue
    ? `tasks/${task}/${declaredValue.replace(/^\.\//, '')}`
    : audioSource;

  return { audioDeclared, declaredValue, audioSource, analysisExpected, analysisFile, audioPath };
}

/* ------------------------------------------------------------------ 命令：check */

/**
 * 体检：静态检查 + 逐段试渲染 + 亮度统计 + 背景守门。
 *
 * **每段采三个点（15% / 50% / 85%）**，不是只采中点：入场头 1 秒恰恰是最容易出问题的地方
 * （文字没出来、位移方向不对、元素互相压字），而以前只看中点，那一段完全没被采到
 * （docs/history/IMPROVEMENTS-1-3.md P2-1）。
 *
 * 每个点渲两次：单子帧与多子帧（成片走的路径）。两条路径的亮度必须一致 ——
 * 运动模糊求平均出过错，而那个 bug 只存在于多子帧那条路。
 */
async function cmdCheck() {
  const task = pickTask();
  log(`检查任务 ${task} …`);

  /**
   * 「空 ≠ 干净」（`docs/BACKLOG.md` 1-19）：任何**没跑成 / 被跳过 / 不可用**的审计都进这里，
   * 末尾统一打一段 `skipped:`。以前它们只是"少打一行"，读输出的 agent 会把
   * 「没报错」当成「通过」——三个外部参考项目独立指向的正是这个失败模式。
   *
   * ⚠ 这个列表**不参与退出码**（`tools/regress-all.mjs` 有 10 个 `check:*` 项依赖
   *   `check` 的退出码语义）；要 gate 就显式加 `--strict`。
   */
  const skipped = [];
  const strict = flag('strict');

  // 1) 静态：非确定性写法（这是整个引擎的地基，必须拦）
  const statics = scanScenes(task);
  for (const s of statics) warn(`⚠ ${s}`);

  /**
   * 静态检查阶段（开浏览器**之前**）攒下的错误 —— `errs` 要等 `openSession` 之后才构造
   * （它读的是页面回传的 `info`），所以这一段先攒在这儿，下面 `const errs = [...staticErrs, ...]`。
   * ⚠ 2026-10-16：复述率那一档最早直接写 `errs.push(...)`，而 `errs` 在它下几十行 ——
   *   `--strict` 一跑就 `ReferenceError: errs is not defined`，还被 catch 吞成一句
   *   "旁白复述检查没跑成"（假 skipped）。**先攒后并**，别在 try 里引用后面的 const。
   */
  const staticErrs = [];

  // 1.5) 静态：**画面文字逐字复述旁白**（`docs/CAPTIONS.md`）。
  //
  // 为什么放在 check 里：观众对 sodium 的反馈是"两条字幕同时出现（页面介绍 + 语音字幕）
  // 看着好迷糊"，而逐字比对发现那支片子 43 句旁白里有 12 句被抄成了画面说明条
  // （optifine 3 句、beast 0 句）。这类重复在**渲染上看不出任何异常** —— 画面照样出、
  // 亮度照样正常，只有把两边文本对一遍才发现得了。
  //
  // ⚠ 只 warn 不 fail：已经交付的片子（sodium/optifine）必然命中，让 check 非零退出
  //   会把回归清单永久染红，反而没人看了。要卡死就在交付自检里跑那条命令（AGENTS.md §10.9）。
  {
    const lint = path.join(ROOT, 'tools', 'lint-narration-dup.mjs');
    try {
      const { spawnSync } = await import('node:child_process');
      if (existsSync(lint)) {
        const r = spawnSync(process.execPath, [lint, task], { encoding: 'utf8', timeout: 30000 });
        const txt = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
        if (r.status === 1) {
          warn('⚠ 画面文字在复述旁白 —— 同屏两套完整句子就是观众说的"两条字幕"：');
          for (const line of txt.split(/\r?\n/).slice(0, 12)) warn(`  ${line}`);
          warn('  → 画面只留标注（名词 / 数字 / 单位 / 出处），句子交给旁白与字幕；见 docs/CAPTIONS.md');
          // 观众对 sodium 的反馈「不如纯看字幕了 / 不明所以」：43 句旁白里 12 句被逐字抄进了画面。
          // 默认只 warn（已交付的片子必然命中，让 check 非零退出会把回归清单永久染红）；
          // --strict 下进 errs —— 交付自检跑 --strict、回归清单跑默认，两边都照顾到。
          if (strict) {
            const hit = /(\d+)\s*句被逐字写进画面/.exec(txt);
            staticErrs.push('[旁白复述] ' + (hit ? hit[1] + ' 句旁白被逐字写进画面' : '画面文字在复述旁白'));
          }
        } else if (r.status === 2) {
          warn(`⚠ lint-narration-dup 没跑成：${String(txt).split(/\r?\n/)[0]}`);
          pushSkipped(skipped, '旁白复述检查（lint-narration-dup）', `它自己以退出码 2 退出（工具内部错误，不是"没命中"）：${String(txt).split(/\r?\n/)[0] || '(没有输出)'}`);
        } else if (r.status !== 0) {
          warn(`⚠ lint-narration-dup 异常退出（status ${r.status}，signal ${r.signal ?? '无'}）`);
          pushSkipped(skipped, '旁白复述检查（lint-narration-dup）', `退出码 ${r.status} / signal ${r.signal ?? '无'} —— 这一项既没报"命中"也没报"干净"，等于没验`);
        }
      } else {
        pushSkipped(skipped, '旁白复述检查（lint-narration-dup）', `工具不存在：${path.relative(ROOT, lint)}`);
      }
    } catch (err) {
      // 受限沙箱里 spawn 可能被拒（EPERM）：这不是 check 的失败，但也**不是通过**
      warn(`（旁白复述检查跳过：${firstLine(err)}）`);
      pushSkipped(skipped, '旁白复述检查（lint-narration-dup）', `起不了这个子进程：${firstLine(err)}`);
    }
  }

  // 1.54) **卡点**：切点有没有落在拍上（tools/lint-beat-align.mjs）。
  //
  // 为什么放在 check 里：切点差 60ms 观众说不出哪里怪，只会觉得"没跟着音乐走"。
  // 判据用**从音频自己重建的网格**（不信 analysis.json 的 bpm 估计 —— 实测它对合成床偏 4%）。
  {
    const tool = path.join(ROOT, 'tools', 'lint-beat-align.mjs');
    try {
      const { spawnSync } = await import('node:child_process');
      // 多语言任务（nekohome-intro-ja）的段长来自 ../nekohome-intro/audio/ja.timing.json ——
      // 这里把"可用的 timing 文件"交给工具，别因为它不在本任务目录就跳过卡点
      const timingCandidates = [
        path.join(ROOT, 'tasks', task, 'audio', 'timing.json'),
        path.join(ROOT, 'tasks', task, 'audio', 'ja.timing.json'),
      ];
      const timingForBeat = timingCandidates.find((p) => existsSync(p)) ?? null;
      if (existsSync(tool) && timingForBeat) {
        const r = spawnSync(process.execPath, [tool, task, '--json', '--timing', timingForBeat], { encoding: 'utf8', timeout: 60000 });
        let j = null;
        try { j = JSON.parse(`${r.stdout ?? ''}${r.stderr ?? ''}`); } catch { j = null; }
        if (j && j.rows) {
          const bad = j.rows.filter((x) => !x.ok);
          // 硬门（--strict）：交付前要求 ≥90% 的切点落在拍上（4-6 段的短片允许一个例外）
          const need = Math.max(1, Math.ceil(j.rows.length * 0.9));
          if (bad.length) {
            const worst = bad.slice().sort((a, b) => Math.abs(b.offMs) - Math.abs(a.offMs))[0];
            warn(`⚠ 卡点：${bad.length}/${j.rows.length} 个切点没落在拍上（判据 ±${j.tolMs}ms，实测 ${j.bpm.toFixed(2)} BPM）`);
            for (const b of bad.slice(0, 4)) warn(`  · ${b.id}  ${b.offMs >= 0 ? '+' : ''}${b.offMs.toFixed(0)}ms 离最近拍`);
            warn(`  → 段长改用 { beat: n } / { bar: n }，或把 narration.mjs 的 BPM 设成实测的 ${j.bpm.toFixed(2)}`);
            if (strict && j.rows.length - bad.length < need) {
              staticErrs.push(`[卡点] 只有 ${j.rows.length - bad.length}/${j.rows.length} 个切点对得上拍子（要求 ≥${need}，最差 ${Math.abs(worst.offMs).toFixed(0)}ms）`);
            }
          } else {
            log(`  ✓ 卡点：${j.rows.length}/${j.rows.length} 个切点都在 ±${j.tolMs}ms 内（实测 ${j.bpm.toFixed(2)} BPM）`);
          }
        } else if (r.status === 2) {
          pushSkipped(skipped, '卡点（beat-align）', `这条片子没有可检测的音轨或起音太少：${firstLine(`${r.stdout ?? ''}${r.stderr ?? ''}`)}`);
        }
        // 分析器给出的拍网格置信度（软失败：bpm 有值但网格不可信）
        if (j && j.track) {
          const ap = path.join(ROOT, j.track.replace(/\.[^.]+$/, '.analysis.json'));
          if (existsSync(ap)) {
            try {
              const tq = JSON.parse(readFileSync(ap, 'utf8')).tempo;
              if (tq && typeof tq.score === 'number' && tq.score < 0.75) {
                warn(`⚠ 拍网格置信度偏低（${(tq.score * 100).toFixed(0)}%，精确率 ${(tq.precision * 100).toFixed(0)}% / 召回 ${(tq.recall * 100).toFixed(0)}%）`
                  + ` —— bpm 有值不等于可信，别让画面重度依赖 f.beat`);
                if (strict) staticErrs.push(`[拍网格] 置信度 ${(tq.score * 100).toFixed(0)}% < 75%`);
              }
            } catch { /* 读不出来就算了 */ }
          }
        }
      } else if (!existsSync(path.join(ROOT, 'tasks', task, 'audio', 'timing.json'))) {
        pushSkipped(skipped, '卡点（beat-align）', '没有 audio/timing.json —— 这条片子的段长不是由旁白/节拍解出来的，没得对');
      } else {
        pushSkipped(skipped, '卡点（beat-align）', '工具不存在：tools/lint-beat-align.mjs');
      }
    } catch (err) {
      pushSkipped(skipped, '卡点（beat-align）', `起不了这个子进程：${firstLine(err)}`);
    }
  }

  // 1.545) **事件密度**：观众每一秒有没有新东西看（tools/lint-event-density.mjs）。
  //
  // 为什么在 check 里：片子可以零报错、qa 全绿，但观众第 8 秒就走人。
  // 实测 nekohome-intro-ja：8–15s 连续 7 秒帧间差 < 0.3，全片 44% 的 2 秒窗口低于均值一半。
  // ⚠ 它量的是**成片**（mp4 的帧间差）—— 还没出片时只报 skipped，不当失败。
  {
    const tool = path.join(ROOT, 'tools', 'lint-event-density.mjs');
    const outDir = path.join(ROOT, 'out', task);
    const mp4 = existsSync(outDir)
      ? readdirSync(outDir).filter((f) => f.endsWith('.mp4') && !/^part_|_stitched/.test(f))[0]
      : null;
    if (!existsSync(tool)) {
      pushSkipped(skipped, '事件密度（event-density）', '工具不存在：tools/lint-event-density.mjs');
    } else if (!mp4) {
      pushSkipped(skipped, '事件密度（event-density）',
        '还没有成片可量 —— 先跑 anim video，再回头体检（它看的是 mp4 的帧间差）');
    } else {
      try {
        const { spawnSync } = await import('node:child_process');
        const r = spawnSync(process.execPath, [tool, task, '--json'], { encoding: 'utf8', timeout: 120000 });
        let j = null;
        try { j = JSON.parse(r.stdout ?? ''); } catch { j = null; }
        if (j && j.windows) {
          if (j.problems?.length) {
            warn(`⚠ 事件密度：${j.problems.join('；')}`);
            warn(`  → 最静的窗口：${j.worst.map((w) => w.t + 's(' + w.v + ')').join('  ')}`);
            warn('  → 补法：给这几段加持续运动（推近/逐条落位/扫描线），或把段缩短、并进相邻段');
            if (strict) staticErrs.push(`[事件密度] ${j.problems.join('；')}`);
          } else {
            log(`  ✓ 事件密度：最长静止 ${j.staticSpan.toFixed(1)}s · 稀薄窗口 ${(j.thinShare * 100).toFixed(0)}%（平均帧间差 ${j.mean}）`);
          }
        }
      } catch (err) {
        pushSkipped(skipped, '事件密度（event-density）', `起不了子进程：${firstLine(err)}`);
      }
    }
  }

  // 1.55) 静态：**运动上限**（BACKLOG 1-33；判据与 src/kit/motion.js 的 waterfallOver 逐字一致）。
  //
  // 为什么放在 check 里：错峰跨度「items × stagger ≤ 0.5s」是"一组元素像一个节拍到达"的判据，
  // 写超了画面不会报任何错 —— 只会"看着有点拖"。waterfallStagger() 能在运行时压回去，
  // 但作者得先想起来调用它；这一层从**源码字面量**里算跨度，把"想不起来"变成一条读数。
  //
  // ⚠ 默认只 warn：0.5 是外部经验值（docs/MOTION.md §0），不是实测结论；
  //   --strict 下进 errs（交付自检跑 --strict，回归清单跑默认）。
  //   "没有可判的对象"进 skipped —— 空不等于干净。
  {
    const lint = path.join(ROOT, 'tools', 'lint-motion-caps.mjs');
    try {
      const { spawnSync } = await import('node:child_process');
      if (existsSync(lint)) {
        const r = spawnSync(process.execPath, [lint, task, '--json'], { encoding: 'utf8', timeout: 30000 });
        const txt = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
        let j = null;
        try { j = JSON.parse(txt); } catch { j = null; }
        if (r.status === 0 && j) {
          if (j.over && j.over.length) {
            const stag = j.over.filter((o) => o.kind !== 'halo');
            const halo = j.over.filter((o) => o.kind === 'halo');
            warn(`⚠ 运动上限：${j.over.length} 处越线（错峰 ${stag.length} · 辉光峰值 ${halo.length}）：`);
            for (const o of stag.slice(0, 6)) {
              warn(`  · ${o.file}:${o.line}  stagger ${o.stagger} × ${o.items} 项 = ${o.span.toFixed(3)}s > ${j.cap}s`);
            }
            for (const o of halo.slice(0, 6)) {
              warn(`  · ${o.file}:${o.line}  halo.peak ${o.peak} > 0.45（辉光峰值上限）`);
            }
            if (stag.length) warn('  → 错峰：用 waterfallStagger(items, stagger).stagger 喂 type.write（按 0.5s/items 压回）');
            if (halo.length) warn('  → 辉光：峰值降到 0.45 以下（超限的辉光会把主体糊掉）；见 docs/MOTION.md §4');
            if (strict) staticErrs.push('[运动上限] ' + j.over.length + ' 处越线（错峰跨度 / 辉光峰值）');
          }
          if (!j.over.length && !j.checked.length) {
            pushSkipped(skipped, '运动上限（stagger 跨度）',
              `这个任务里没有可判的 stagger 字面量（可判 0 处、读不出 ${j.unchecked.length} 处）—— 没验`);
          } else if (j.unchecked.length && !j.over.length) {
            warn(`（运动上限：可判 ${j.checked.length} 处都在上限内；另有 ${j.unchecked.length} 处读不出元素个数 —— 那些**没验**）`);
          }
        } else if (r.status === 2) {
          pushSkipped(skipped, '运动上限（stagger 跨度）', `工具自己退出码 2（不是"没命中"）：${firstLine(txt)}`);
        } else if (r.status !== 0) {
          pushSkipped(skipped, '运动上限（stagger 跨度）', `退出码 ${r.status}，输出不是可解析的 JSON —— 没验`);
        }
      } else {
        pushSkipped(skipped, '运动上限（stagger 跨度）', `工具不存在：${path.relative(ROOT, lint)}`);
      }
    } catch (err) {
      pushSkipped(skipped, '运动上限（stagger 跨度）', `起不了这个子进程：${firstLine(err)}`);
    }
  }

  /**
   * 1.6) 镜头模板的**依赖前置校验**（BACKLOG 1-21 / `docs/ENGINE.md` §14.9）。
   *
   * 为什么放在开浏览器**之前**：`wave` / `pulse` / `grid` 读 `ctx.music`（音频包络 + 真实打击事件），
   * 忘了配 `audio`（或还没跑 `analyze`）时画面是黑的 —— 而这件事以前只能等逐段试渲染
   * （起一个私有 Vite + 无头 Chrome、几十秒之后）由亮度统计报一句「几乎全黑，场景可能没画东西」，
   * **方向完全错**：既不点名是哪个模板，也不提音乐。
   *
   * 现在它是**静态**的：任务源码文本（配置档 + `scenes/**.js`）+ 模板自己的 `spec.requires`
   * + 音频/分析文件在不在 —— 毫秒级，而且**渲染起不来也能报**（受限沙箱里 check 照样有用）。
   *
   * 两档严重性（判据在 `shotDependencyIssues()` 的注释里）：
   *   · 任务根本没配 `audio` ⇒ **errs**（这一段不可能对，退出码 1）；
   *   · 配了 `audio` 但没跑过 `analyze` ⇒ **skipped**（"这一步还没跑"，默认不改退出码）。
   * ⚠ `errs` 在 `openSession` 之后才构造（`reportErrors()` 的返回值），所以这里先攒进 `depErrs`，
   *   下面用 `const errs = [...depErrs, ...reportErrors(info)]` 合起来 —— 退出码语义一个字没动。
   */
  const depErrs = [];
  try {
    const { SHOTS } = await import('../src/shots/index.js');
    const files = taskShotSources(task);
    const usage = scanShotUsage(files, Object.keys(SHOTS ?? {}));
    const facts = shotDependencyFacts(task);
    const specOf = (n) => (SHOTS?.[n] ? SHOTS[n].spec : undefined);
    const issues = shotDependencyIssues(usage, specOf, facts);
    const rows = usage.map((u) => ({ ...u, requires: specOf(u.shot)?.requires ?? [] }));
    const dep = shotDependencyReport({
      scanned: files.length, usage: rows, issues, facts, only: opt('only', null),
    });
    for (const l of dep.lines) (l.sev === 'warn' ? warn : log)(l.text);
    depErrs.push(...dep.errors);
    for (const s of dep.skipped) pushSkipped(skipped, s.what, s.why);
  } catch (err) {
    // 「空 ≠ 干净」：这一项**没跑成**也要说话（不然"没报错"会被读成"依赖都对"）
    warn(`（镜头模板依赖校验没跑成：${firstLine(err)}）`);
    pushSkipped(skipped, SHOT_DEP_WHAT, `静态扫描起不来：${firstLine(err)}`);
  }


  /**
   * 1.7) **画面语义断言的声明文件**（BACKLOG 1-18）：`tasks/<任务>/motion.json`。
   *
   * 放在开浏览器**之前**做两件事（与 1.5 / 1.6 同一条"静态阶段能报的不等渲染"的道理）：
   *   · 文件不存在 → `pushSkipped`：任务没有声明任何断言，这一项**没判**（绝不当通过）；
   *   · JSON 解析失败 → **静态错误**（进 `staticErrs`，最后并进 `errs` gate 退出码）——
   *     声明文件本身坏了，后面的断言一条都验不了，这是硬问题。
   * 采样计划与判读（`planMotionAsserts` / `motionVerdict`）在下面的试渲染段里跑 ——
   * 它们需要 build() 之后的段表（`info.timeline`），而段表只有页面装完才有。
   */
  let motionSpec = null;
  {
    const motionPath = path.join(ROOT, 'tasks', task, 'motion.json');
    if (!existsSync(motionPath)) {
      pushSkipped(skipped, '画面语义断言（motion.json）', '任务没有声明任何断言——没判 ≠ 通过');
    } else {
      try {
        const parsed = JSON.parse(readFileSync(motionPath, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          staticErrs.push('[画面语义断言] ' + path.relative(ROOT, motionPath)
            + ' 的内容该是对象（{ "assert": [...], "thresholds": {...} }），收到 ' + (Array.isArray(parsed) ? '数组' : typeof parsed));
        } else {
          motionSpec = parsed;
        }
      } catch (err) {
        staticErrs.push('[画面语义断言] motion.json 解析失败：' + firstLine(err));
      }
    }
  }

  /**
   * 1.8) **词锚点的降级记录**（BACKLOG 1-17，2026-10-17）：`tasks/<任务>/audio/anchors.json`。
   *
   * `anim say` 解锚时，被锚句拿不到真词级时间戳（words 为空 / approx）会**退回手写秒数**，
   * 并把原因写进这个文件的 `degraded`—— 改词后那些段**不会自动重排**（时间表落在手写 cue 上）。
   * `say` 自己已经打过一遍；check 再报一遍是因为两件事看的时机不同：
   * say 看「合成这一刻」，check 看「交付这一刻」—— 改词重跑之间夹一次 check 是常态。
   * 文件不存在 = 脚本里没写锚点（或还没跑过 say）= 没有可报的降级，不打扰。
   */
  {
    const anchorsPath = path.join(ROOT, 'tasks', task, 'audio', 'anchors.json');
    if (existsSync(anchorsPath)) {
      try {
        const a = JSON.parse(readFileSync(anchorsPath, 'utf8'));
        const deg = Array.isArray(a?.degraded) ? a.degraded : [];
        if (deg.length) {
          warn('⚠ ' + deg.length + ' 个词锚点降级成了手写秒数（改词不会自动重排）：');
          for (const d of deg.slice(0, 12)) warn('  [' + d.id + '] ' + d.kind + ' 锚点：' + d.why);
          if (deg.length > 12) warn('  …以及另外 ' + (deg.length - 12) + ' 个');
          warn('  → 拿到真词级时间戳（重跑 say 且驱动支持）后锚点会自动接管；降级期间时间表落在手写 cue/internal 上。');
        }
      } catch (err) {
        warn('(词锚点降级记录读不了：' + firstLine(err) + ')');
      }
    }
  }

  // 2) 试渲染每一段的三个采样点（有 GPU 就能立刻抓到 shader 编译错误和 NaN）
  await openSession({ task, only: opt('only', undefined) });
  try {
    const info = session.info;
    log(`\n分辨率 ${info.width}×${info.height}×${info.scale}  @${info.fps}fps  时长 ${info.duration.toFixed(2)}s  ${info.timeline.length} 段  bpm ${Number(info.bpm).toFixed(1)}`);
    log(`GPU: ${info.rendererLabel || info.renderer}`);
    // 段名 + 时长摊开打印（P0-2）：写错时间线时，"片长/段名不对"必须一眼能看出来。
    // 以前 `check` 只在头上给一行汇总，伪时间线（12 段 × 默认 4s = 48s）就混过去了。
    log(`\n时间线（段名 / 时长 / 起止）：`);
    for (const it of info.timeline) {
      log(`  ${String(it.id).padEnd(16)} ${it.start.toFixed(2).padStart(8)} → ${it.end.toFixed(2).padStart(8)}  (${(it.end - it.start).toFixed(2)}s)${it.note ? '  ' + it.note : ''}`);
    }
    const errs = [...staticErrs, ...depErrs, ...reportErrors(info)];
    // `--quick` 的判据要在这之前就知道（响度那一档、试渲染那一档都用它）。
    // ⚠ 它只是**冒烟**：每段只采 50% 一个点、只跑单子帧、响度只量前 60 秒 ——
    //   不看多子帧路径、不看入场头 1 秒。结论行里会写清"哪些没跑"。
    const quick = flag('quick');
    // 音轨：说清"节拍是从哪条轨测的"（P1-4 —— 从混音里测会被旁白带偏）
    const tracks = resolveAudioTracks(task);
    if (tracks.analysisSource) log(`音频：${tracks.note}`);

    // 「音频分析」这一项**跑没跑**必须说出来（BACKLOG 头部 ④，2026-10-16）。
    //
    // 以前只有 `analyzeTaskAudio()` 在缺 ffmpeg 时 warn 一句然后返回 null —— 而那一步**只有
    // 出片路径（cmdVideo）会走**：`check` 不跑 analyze，于是"这支片子的画面压根踩不了拍子"
    // 在体检里一个字都不会提（除非用了声明 `requires: ['analyze']` 的模板）。
    // 现在这里明说，并且进 `skipped`（"没跑 ≠ 通过"）；`--strict` 会把它当失败。
    if (tracks.analysisSource) {
      const abase = tracks.analysisSource.replace(/\.[^.]+$/, '');
      const apath = path.join(ROOT, 'tasks', task, 'audio', path.basename(abase) + '.analysis.json');
      if (!existsSync(apath) && !(await checkFfmpeg())) {
        warn('⚠ 音频分析：还没有预计算的分析数据（' + path.relative(ROOT, apath) + ' 不存在），');
        warn('  而这台机器上**没有 ffmpeg** ⇒ 这一步连补都补不了：画面不会踩拍子（f.beat / f.a 全是 0）。');
        warn('  → 装 ffmpeg（或用 ANIM_FFMPEG 指定），再跑 node scripts/anim.mjs analyze ' + task);
        pushSkipped(skipped, '音频分析（analyze）', '没有 ffmpeg：这一步连补都补不了 —— 没验');
      }
    }

    // 音频的数字守门（1-20）：你听不见，就报数字。放在这里是因为它 spawnSync 会阻塞事件循环，
    // 绝不能夹在渲染会话中间（渲染靠 stdin 控制通道）。
    if (tracks.packaging) {
      const { measureLoudness, formatLoudness, assessLoudness } = await import('./lib/media.mjs');
      const t0 = Date.now();
      // `--quick` 用省时档：只量前 60 秒（BACKLOG 头部 ⑤ —— 4 分钟的轨整条量要 12–14s，
      // 而快捷冒烟只是想看数字有没有离谱）。**必须写在输出里**：整合响度是整段的量，
      // 截断读数不是一个可以当结论用的数字。
      const win = quick ? 60 : null;
      try {
        const m = measureLoudness(tracks.packaging, win ? { seconds: win } : undefined);
        const a = assessLoudness(m);
        log(`响度：${formatLoudness(m)}（packaging = ${path.basename(tracks.packaging)}，真峰=true peak）`
          + `  ${a.tier === 'ok' ? '✓' : a.tier === 'warn' ? '⚠' : '✗'} ${a.verdict}`);
        if (m.seconds) {
          warn(`  ⚠ 这个读数**只量了前 ${m.seconds}s**（--quick 的省时档）—— 整合响度是整段的量，`
            + '别拿它当全片结论；要结论就去掉 --quick。');
        }
        if (a.tier === 'error') warn(`  → 靶子是 ${m.target.i} LUFS / ${m.target.tp} dBTP（主流平台归一化目标）。`
          + `这一条只报数字、不自动归一化 —— 归一化会改动所有带旁白片子的音轨，等于已交付片子全部重出。`);
        log(`  （量了 ${((Date.now() - t0) / 1000).toFixed(1)}s；4 分钟的轨约 12s${win ? '，这里只量了前 60s' : ''}）`);
      } catch (e) {
        warn(`⚠ 响度没量成（${e.kind}）：${String(e.message).split('\n')[0]}`);
      }
    }

    // 风格包与字幕层（docs/STYLE.md / docs/CAPTIONS.md）—— 这两件事以前"没有任何入口"，
    // 于是每支片子都长得像上一支、而语音字幕干脆不在引擎里（出锅之后才用 ffmpeg 烧）。
    // check 把它们打出来，是为了让"这支片子长什么样"变成一件**看得见**的事。
    if (info.style) {
      log(`风格：${info.style.name}（${info.style.label}）· 背景母题 ${info.style.motif}`
        + (info.style.fonts ? ` · 自定义字体 ${info.style.fonts} 族` : ''));
    }
    if (info.captions?.on) {
      const b = info.captions.band;
      log(`字幕：引擎字幕层已开 · 保留带 y ${b.y0}–${b.y1} / x ${b.x0}–${b.x1}`
        + ` · 说完再留 ${info.captions.hold}s${info.captions.karaoke ? ' · 逐词高亮（研究上属负效应，慎用）' : ''}`);
    } else if (info.narrationLines > 0) {
      warn(`⚠ 这支片子有 ${info.narrationLines} 句旁白，但**没开字幕层** —— 观众看不到语音字幕。`);
      warn('  → task.config.mjs 里加一行 captions: true（用法与理由见 docs/CAPTIONS.md）。');
      warn('  → 以前字幕是出锅后用 ffmpeg 烧的，生成脚本还在 out/_staging/（out/ 会被 clean 清掉）。');
    }
    for (const w of info.warnings ?? []) warn(`⚠ ${w}`);

    // 字幕会不会**跨越场景切换**？（`docs/CAPTIONS.md`）
    //
    // 依据是 Netflix 的 timed-text 规范：「字幕不得跨越场景切换」—— 换镜头可以，
    // 换场景不行。出图时才发现的实例：`_style-sampler` 第一版旁白表里 4 句**全都**跨了段，
    // 于是每一段开头都会看到上一句字幕还在淡出（同一屏上两句字）。
    // 片尾最后一句豁免（画面结束在它后面，没有"下一个场景"）。
    if (info.captions?.on && (info.narration ?? []).length) {
      const hold = info.captions.hold ?? 1.06;
      const segs = info.timeline ?? [];
      const crossed = [];
      for (const l of info.narration) {
        const seg = segs.find((it) => l.start >= it.start - 1e-6 && l.start < it.end);
        if (!seg || seg === segs[segs.length - 1]) continue;
        const until = l.end + hold;
        if (until > seg.end + 0.05) crossed.push({ l, seg, until });
      }
      if (crossed.length) {
        warn(`⚠ ${crossed.length} 句字幕**跨越了场景切换**（规范要求字幕不得跨 scene change）：`);
        for (const c of crossed.slice(0, 6)) {
          warn(`  [${c.l.id}]「${String(c.l.text).slice(0, 18)}…」说到 ${c.l.end.toFixed(1)}s，`
            + `加上停留要到 ${c.until.toFixed(1)}s 才消失，而 ${c.seg.id} 段在 ${c.seg.end.toFixed(1)}s 就切走了`);
        }
        warn('  → 让这句说早一点 / 说短一点，或者把这一段放长（段长本来就该由旁白决定，docs/NARRATION.md）');
      }
    }

    // 背景守门（P0-2）：先问页面里有没有"声明了 handlesTransition 却没画共享背景"的段。
    // 那类段的底会是纯黑，而亮度统计抓不到（文字/面板/grain 自己就有亮度）。
    let world = null;
    try {
      world = await evaluateSafe(() => /** @type {any} */ (window).__anim.worldAudit(), undefined, 'worldAudit()');
      // ⚠ 口径：`world: false` 的段在下面单独一栏（`selfRows`），但它们**也是**"声明了转场"的段 ——
      //   统计"多少段声明了转场/共享背景"要把两栏合起来看，否则 whip 会被算成 0（2026-10-16 实测）。
      const risky = [...(world?.results ?? [])].filter((r) => r.handlesTransition || r.declaredWorld !== 'none');
      // 声明了 `world: false`（"整帧底我自己负责"）的段：**不判铺底**，但这次真的采了读数
      // （BACKLOG 头部 ⑦）。以前它们一行都不出现，于是"交叠窗之后那 1 秒"连个数字都没有。
      const selfRows = world?.selfBase ?? [];
      if (selfRows.length) {
        const darkSelf = selfRows.filter((r) => r.dark && (r.handlesTransition || r.declaredWorld !== 'none'));
        log(`\n背景守门（world: false 的段，**不判铺底**，只给读数）：${selfRows.length} 段`);
        for (const r of selfRows) {
          const means = (r.samples ?? []).filter((s) => typeof s.mean === 'number')
            .map((s) => `t=${s.t.toFixed(2)}s 亮度 ${s.mean.toFixed(3)}`).join('  ·  ');
          log(`  ${String(r.id).padEnd(14)} 整帧覆盖 ${String(r.full).padStart(3)} 次  ${means}`);
        }
        if (darkSelf.length) {
          // ⚠ 只 warn、不进 errs（2026-10-16 实测）：窗后中点**不是判据点** —— 转场模板在窗后
          //   走"没有 under"的分支，本来就可能是近黑的（whip 设计值 0.037–0.051）。这里只是把
          //   "真的低到 0.004 以下"（= 除了一层清屏色什么都没有）这件事**报出来**给人看；
          //   逐段亮度守门（15%/50%/85% 三点）才是那条 gate。
          warn(`⚠ 其中有 ${darkSelf.length} 段是**转场段**，窗后中点采到了"一片黑"（mean < 0.004）：${darkSelf.map((r) => r.id).join(', ')}`);
          warn('  → 这是**读数**不是判据：声明 world: false 是"底我自己负责"，不是"这段没人看着"。');
          warn('    甩镜尾巴的近黑（0.037–0.051）是模板设计；真的低到 0.004 以下才值得去看那一帧。');
        }
      }
      if (world?.results?.length) {
        const missing = world.results.filter((r) => r.missing);
        if (missing.length) {
          warn(`\n⚠ 背景守门：${missing.length}/${world.results.length} 个交叠段**没有铺满整帧的背景**`);
          for (const m of missing) {
            warn(`  [${m.id}] t=${m.t.toFixed(2)}s  整帧覆盖绘制 ${m.full} 次（本帧总绘制 ${m.drawAny} 次）${m.handlesTransition ? '，声明了 handlesTransition' : ''}`);
          }
          warn(`  → 这些段的底是纯黑（只有 grain 和暗角），而且亮度统计抓不到。`);
          warn(`    改法三选一：① 在 render 开头画一次全屏背景（scene 自己的 Pass，或 ctx.world）；`);
          warn(`                ② 时间线里写 cut(shot, { world: 'auto' })，由引擎先铺共享背景；`);
          warn(`                ③ 确实是刻意不铺底 → 明确写 cut(shot, { world: false })。`);
          errs.push(`[背景守门] 没铺背景的段：${missing.map((m) => m.id).join(', ')}`);
        } else {
          const riskyAll = [...risky, ...selfRows.filter((r) => r.handlesTransition || r.declaredWorld !== 'none')];
          log(`\n背景守门：${world.results.length} 个交叠段在**交叠窗中点**都铺满了整帧背景（窗后中点只做读数，不判）`
            + `（其中 ${riskyAll.length} 段声明了转场/共享背景）`
            + (selfRows.length
              ? `；另有 ${selfRows.length} 段声明了 world: false（不判铺底，读数见上）`
              : ''));
        }
      } else {
        // 「空 ≠ 干净」：审计跑通了、但一个交叠段都没被翻出来 —— 也就是**零条断言**。
        // 以前这里一行都不打，输出里于是看不出"背景守门这次等于没验"。
        const nSeg = world?.timeline ?? info.timeline?.length ?? 0;
        warn(`\n⚠ 背景守门这次**一条都没验**：时间线 ${nSeg} 段里没有"与前一段交叠"的段（--only 之后更常见）。`);
        warn('  → 这不是"背景都对"，是"没有可查的对象"；有转场的片子这一行不该出现。');
        pushSkipped(skipped, '背景守门（worldAudit）', `跑了，但零条断言（时间线 ${nSeg} 段里没有交叠段，--only 之后更常见）—— 不能算通过`);
      }
    } catch (err) {
      if (err && err.readable) throw err;      // 页面失联：照实抛出，不要吞成"背景守门不可用"
      log(`\n（背景守门不可用：${firstLine(err)}）`);
      pushSkipped(skipped, '背景守门（worldAudit）', firstLine(err));
    }

    // 依赖令牌 `under` 的**段级审计**（BACKLOG 头部 ② 的收口，2026-10-16）。
    //
    // 为什么必须在这里、而不是像 `music`/`analyze` 那样在开浏览器之前用文本扫描判：
    // `whip` 这类模板的画面来自"把上一段的成帧（ctx.under）甩走"，而引擎**只在两段交叠的
    // 那一小段**里给得出 ctx.under（engine.js：`under: k > 0 ? under : null`；交叠窗之外
    // 这一段就是 items[0]，没有"上一段"）。于是"交叠够不够"只在 build() 排完时间之后
    // 才是个事实 —— 源码文本里看不出来（对象可以跨行、可以 seq() 拼、--only 之后段表还会变）。
    //
    // 判据是纯函数 `src/timeline.js` 的 `auditUnderRequires()`（离线单测
    // `tools/test-timeline-audit.mjs`）：missing = 硬问题（画面几乎是黑的且不报错）⇒ errs；
    // noPrev = **没判**（--only 之后必然出现）⇒ 进 skipped，绝不说成"都满足"。
    try {
      const ua = await evaluateSafe(() => /** @type {any} */ (window).__anim.underAudit(), undefined, 'underAudit()');
      const rows = ua?.results ?? [];
      const missing = rows.filter((x) => x.missing);
      const dbl = rows.filter((x) => x.doubleTransition);
      const noPrev = rows.filter((x) => x.noPrev);
      const judged = rows.filter((x) => !x.noPrev);
      if (!rows.length) {
        log(`\n依赖 under：这次**没有可查的对象**（时间线 ${ua?.timeline ?? '?'} 段里没有哪一段声明要读 ctx.under）`
          + '—— 不是"依赖都对"');
      } else {
        // 只在"上面已经打过别的行"时才不补空行 —— 否则标题会粘在上一段输出尾巴上
        const pad = (missing.length || judged.length) ? '' : '\n';
        if (missing.length) {
          warn(`\n⚠ 依赖 under：${missing.length}/${rows.length} 段声明要读 ctx.under，却**与上一段没有交叠**`);
          for (const m of missing) {
            warn(`  [${m.id}] 第 ${m.index + 1} 段 ${m.start.toFixed(2)} → ${m.end.toFixed(2)}s：与上一段没有 overlap`);
          }
          warn('  → ctx.under 只在两段交叠的那一小段里有值，没有交叠时模板退回"没有 under"那条分支 ——');
          warn('    画面几乎是黑的、**而且一个字都不报**（这正是 BACKLOG 1-21 记的"只声明、没接线"）。');
          warn('    改法：给这一段写 overlap（{ type: \'whip\', dur, overlap: 0.5 } 或 cut(whip, { overlap: 0.5 })），');
          warn('          或者把它换成一个自己铺底的模板。');
          errs.push(`[under] 声明要读 ctx.under 却没有交叠的段：${missing.map((m) => m.id).join(', ')}`);
        } else if (judged.length) {
          log(`\n依赖 under：${judged.length}/${rows.length} 段声明要读 ctx.under，都真的与上一段交叠了`);
        }
        if (noPrev.length) {
          const ids = noPrev.map((m) => m.id).join(', ');
          warn(`${pad}⚠ 依赖 under：${noPrev.length} 段**没判**（它在展开后的时间线里是第 1 段，没有"上一段"可比）：${ids}`);
          warn('  → 这不是通过：--only 会把选中的段平移到时间轴开头，所以只挑一段试渲染时必然出现这一行。');
          pushSkipped(skipped, '依赖 under（段级审计）',
            `${noPrev.length} 段没有上一段可比（第 1 段 / --only 之后）：${ids} —— 没验`);
        }
        if (dbl.length) {
          warn(`⚠ 依赖 under：${dbl.length} 段读了 ctx.under，却没声明 handlesTransition（${dbl.map((m) => m.id).join(', ')}）`);
          warn('  → 引擎会在这上面**再叠一次交叉溶解**（engine.js: k > 0 && !scene.handlesTransition），');
          warn('    "甩走"会被稀释成两屏叠一起。改法：场景/时间线上写 handlesTransition: true。');
        }
      }
    } catch (err) {
      if (err && err.readable) throw err;      // 页面失联：照实抛出
      log(`\n（依赖 under 的段级审计不可用：${firstLine(err)}）`);
      pushSkipped(skipped, '依赖 under（段级审计）', firstLine(err));
    }

    /** 采样点 -> 这一帧的版面判定（按段聚合；`check` 汇总时只用它，不额外渲染） */
    const layoutSeen = new Map();
    /** 有几个采样点的记账没读成（读不成 = 那些点没验，收尾进 skipped） */
    let layoutSkipped = 0;
    /** 汇总那一段跑没跑（跑挂了就别再跑，免得刷两遍错） */
    let layoutErrs = false;

    const t0 = Date.now();
    const statsAt = (t, opts) => evaluateSafe(
      ([tt, oo]) => /** @type {any} */ (window).__anim.stats(tt, oo), [t, opts],
      `stats(t=${t.toFixed(2)}s)`,
    );
    // --quick：每段只在 50% 采一个点、只跑单子帧（`quick` 在上面已经取过了 ——
    // 响度那一档也要用它）。用于**快速冒烟**（改完引擎先扫一遍「有没有哪一段直接抛异常」），
    // 不替代完整 check —— 它不看多子帧路径、也不看入场头 1 秒。
    log(quick
      ? '\n--quick：每段只采 50% 一个点、只跑单子帧（冒烟用；完整体检请去掉 --quick）'
      : '\n每段：15% / 50% / 85% 三个点，各测单子帧与多子帧（成片走的路径）');
    let points = 0;
    for (const it of info.timeline) {
      const dur = it.end - it.start;
      const at = (quick ? [0.5] : [0.15, 0.5, 0.85]).map((k) => it.start + dur * k);
      const rows = [];
      for (const t of at) {
        // ⚠ 多子帧路径必须单独验一次：运动模糊整帧过曝 n 倍那个 bug 只存在于这条路，
        //   而 check 以前只跑 samples:1，于是它一路报「没问题」，成片却白到发光。
        let multi = null;
        let multiNote = '';
        let used = 0;
        if (!quick) {
          try {
            multi = await statsAt(t, { samples: 'auto' });
            // ⚠ 必须在跑完这一帧之后、跑 samples:1 之前取：lastSamples 会被下一次渲染覆盖
            used = await session.page.evaluate(() => /** @type {any} */ (window).__anim.lastSamples);
          } catch (err) {
            // 页面失联（HMR 重载 / 崩了）是**致命**诊断，别降级成"多子帧不可用"混过去
            if (err && err.readable) throw err;
            multiNote = `  ← ⚠ 多子帧这一条路径**没跑**（skipped）：${firstLine(err)}`;
            // ⚠ what 里**不带时刻**：时刻跟着这一行的内联提示，而 skipped 那一段是按 what
            //   聚合的（带时刻就聚合不起来 —— 页面一崩就是几十行，等于又变回"少打一行"）。
            pushSkipped(skipped, '多子帧路径（成片走的那条）', `[${it.id} t=${t.toFixed(2)}s] ${firstLine(err)}`);
          }
        }
        const one = await statsAt(t, { samples: 1 });
        points++;
        rows.push({ t, one, multi, used });

        // 版面守门（docs/LAYOUT.md）：**白拿**这一帧的记账 —— layoutRows() 不渲染，
        // 读的就是上面 statsAt / multi 那两次渲染留下的 gl.paint.blocks。
        // 必须**点名段**：交叠期同时画着两段，而问题问的是「这一段这一帧画了几块字」。
        try {
          const lr = await session.page.evaluate(
            (id) => /** @type {any} */ (window).__anim.layoutRows({ id }), it.id,
          );
          for (const row of lr ?? []) {
            if (!row || !row.id) continue;
            const list = layoutSeen.get(row.id) ?? [];
            list.push({ t: row.verdict?.t ?? 0, verdict: row.verdict });
            layoutSeen.set(row.id, list);
          }
        } catch (err) {
          if (err && err.readable) throw err;      // 页面失联：照实抛出
          layoutSkipped++;
        }

        const tag = `${it.id.padEnd(14)} t=${t.toFixed(2)}s`;
        const parts = [`  ${tag}  单帧 ${one.mean.toFixed(3)}`];
        if (multi) parts.push(`多子帧 ${multi.mean.toFixed(3)}（${used} 子帧）`);
        log(parts.join('  ') + multiNote);

        // 非有限值扫描（`docs/history/STATUS-rounds-1-6.md` §13.4）：场景 shader 写出 NaN / ±Inf 时，
        // 引擎**不会报任何错**：单帧直通后处理 → 整屏白；多子帧被累加 pass 丢掉 → 发黑。
        // 8bit 读回分不出这两者，`stats()` 也分不出，于是 check 只会说
        // 「单子帧与多子帧亮度差了 N×：这是运动模糊求平均/累加的问题」—— 方向完全错。
        // 这里读浮点缓冲直接点名，把"整屏白"从"看图才发现"变成"check 就报"。
        let nf = null;
        try {
          nf = await session.page.evaluate(
            (tt) => /** @type {any} */ (window).__anim.nonFinite(tt), t,
          );
        } catch (err) {
          nf = { error: firstLine(err) };
        }
        if (nf && nf.error) {
          // 「空 ≠ 干净」（1-19）：这一项**没跑成**（不是"扫了、没扫到"）。以前它静默消失，
          // 于是"整屏白 = NaN/Inf"这条最贵的诊断会在最需要它的时候不见踪影。
          warn(`      ← ⚠ 非有限值扫描**没跑**（skipped）：${nf.error}`);
          pushSkipped(skipped, '非有限值扫描（NaN/Inf）', `[${it.id} t=${t.toFixed(2)}s] ${nf.error}`);
        }
        if (nf && !nf.error && nf.bad > 0) {
          const pct = ((nf.bad / Math.max(1, nf.pixels)) * 100).toFixed(1);
          const where = nf.first ? `（首个坏像素 x=${nf.first.x} y=${nf.first.y}，${nf.first.kind}）` : '';
          warn(`      ← ⚠ 非有限值：NaN ${nf.nan} / Inf ${nf.inf} / 量级>5e4 ${nf.huge} 像素${where}`);
          warn(`        这是「整屏白 / 单帧白多帧黑」的一类根因：shader 里除了 0、开了 normalize(0)`);
          warn(`        （多半是相机 uniform 全 0）或 pow(0, 负数)。见 node tools/probe-raymarch.mjs`);
          errs.push(
            `[${it.id}] t=${t.toFixed(2)} 场景输出里有非有限值：NaN ${nf.nan} / Inf ${nf.inf} / ` +
            `量级>5e4 ${nf.huge} 像素（占 ${pct}%）${where}`,
          );
        }

        if (one.mean < 0.004) {
          const msg = `[${it.id}] t=${t.toFixed(2)} 几乎全黑（mean=${one.mean.toFixed(4)}），场景可能没画东西`;
          warn(`      ← 几乎是全黑，场景可能没画东西`);
          errs.push(msg);
        }
        if (multi) {
          // 过曝：亮度顶到 0.99 以上的像素太多，或整块死白
          if (multi.blownRatio > 0.2 || multi.clippedRatio > 0.15) {
            const msg = `[${it.id}] t=${t.toFixed(2)} 过曝：亮度>0.99 的像素占 ${(multi.blownRatio * 100).toFixed(1)}%，死白占 ${(multi.clippedRatio * 100).toFixed(1)}%`;
            warn(`      ← 过曝（>0.99 占 ${(multi.blownRatio * 100).toFixed(1)}%，死白 ${(multi.clippedRatio * 100).toFixed(1)}%）`);
            errs.push(msg);
          }
          // 单帧与多子帧的亮度必须一致：不一致 = 运动模糊路径有系统性错误（曾经过曝 n 倍）
          const ratio = multi.mean / Math.max(one.mean, 1e-6);
          if (ratio > 1.3 || ratio < 1 / 1.3) {
            const msg = `[${it.id}] t=${t.toFixed(2)} 单子帧与多子帧亮度差了 ${ratio.toFixed(2)}×（单帧 ${one.mean.toFixed(3)} → 多子帧 ${multi.mean.toFixed(3)}）`;
            warn(`      ← 两条路径不一致（${ratio.toFixed(2)}×）：这是运动模糊求平均/累加的问题，成片会和预览完全不同`);
            // 但如果是"非有限值"，方向就完全不同（累加 pass 会把 NaN/Inf 丢掉 → 单帧白、多帧黑）：
            // 上面那条扫描已经点名了，这里补一句，免得读者照着"累加 bug"去查。
            if (nf && !nf.error && nf.bad > 0) {
              warn(`        ⚠ 但这一帧同时有非有限值 —— 先修那个：累加 pass 丢掉 NaN/Inf 正是"单帧白、多帧黑"的成因。`);
            }
            errs.push(msg);
          }
        }
      }
      // 「这一整段都偏暗」——只看单点会漏掉，因为一个亮点就能把判据顶过去
      const lo = Math.min(...rows.map((r) => r.one.mean));
      const hi = Math.max(...rows.map((r) => r.one.mean));
      if (lo < 0.02 && hi > 0.06) {
        const msg = `[${it.id}] 段内亮度很不均（最低 ${lo.toFixed(3)} → 最高 ${hi.toFixed(3)}）：入场/出场某一段可能没画上东西`;
        warn(`      ← 段内亮度不均（${lo.toFixed(3)} → ${hi.toFixed(3)}）：查入场的头 1 秒和收尾`);
        errs.push(msg);
      }
    }
    log(`\n试渲染 ${info.timeline.length} 段 × ${quick ? 1 : 3} 个点 × ${quick ? 1 : 2} 条路径（共 ${points * (quick ? 1 : 2)} 帧）用了 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    /**
     * **版面守门**（`docs/LAYOUT.md`，2026-10-16）：钠那期三条外部批评里的两条 ——
     * 「元素互相遮挡害得我搞不清楚到底要看哪个主体」「不如纯看字幕了」—— 都发生在**信息设计**
     * 这一层，而引擎当时对此**一条判据都没有**（`check` 只管亮度 / 背景 / 非有限值 / 依赖令牌）。
     *
     * 判据（都在纯函数 `src/layout.js` 里，离线单测 `tools/test-layout.mjs`）：
     *   ① **每屏几块字**：把挨得近的文字合成「块」（26px 一道的读数面板算一块）再数，超过上限就报；
     *   ② **主体之外还有几个「看的地方」**（「不知道看哪个主体」的直接读数）；
     *   ③ 声明了 `focus` 的段另加一条「主体区里压着几块」。
     *
     * 退出码：**默认只 warn**（「先只报不改退出码」，同 1-19 的 skipped 与 lint-narration-dup），
     * `--strict` 才进 errs —— 现在每个任务都必然超限（这套阈值是一条新纪律），
     * 让 check 默认非零退出会把回归清单永久染红，反而没人看了。
     */
    if (!layoutErrs) {
      try {
        const rows = layoutReport([...layoutSeen.entries()].map(([id, samples]) => ({ id, samples })));
        const summary = layoutSummary(rows);
        const limits = info.layoutLimits ?? {};
        if (!rows.length) {
          warn('\n⚠ 版面守门这次**一条都没验**：一个采样点都没拿到绘制记账。');
          pushSkipped(skipped, '版面守门（layoutAudit）', '时间线里没有段可采样 —— 不能算通过');
        } else {
          log(`\n版面守门：${summary.judged}/${summary.segments} 段采到了文字绘制 · 最挤的一帧 ${summary.peak} 块`
            + `（上限 ${limits.maxBlocks ?? '?'}；主体之外 ≤ ${limits.maxOffSubject ?? '?'}）`
            + `${quick ? '（--quick：每段只采 50% 一个点）' : ''}`);
          for (const r of rows) {
            const w = r.worst;
            if (!w) { warn(`  ${String(r.id).padEnd(14)} 没采到（渲染失败或这一段没有文字）`); continue; }
            const mark = r.violations.length ? '⚠' : ' ';
            const extra = r.violations.length
              ? `  ← ${r.violations.map((v) => v.detail).join('；')}（${r.over}/${r.samples} 个采样点超限）`
              : '';
            log(`  ${mark} ${String(r.id).padEnd(14)} t=${w.t.toFixed(2)}s  ${w.blocks} 块（${w.draws} 次文字绘制）`
              + `  主体区 ${focusReading(w)}${extra}`);
          }
          if (summary.violates.length) {
            warn(`\n⚠ 版面守门：${summary.violates.length}/${summary.judged} 段**一屏的东西太多**`);
            warn('  观众对钠那期的原话：「有些动画元素相互遮挡害得我搞不清楚到底要看哪个主体」。');
            warn('  → 改法（都不需要动引擎）：① 读数**一次只揭一个**（同屏别一次亮 6 个数）；');
            warn('    ② 画面文字只放**标注**（名词 / 数字 / 出处），句子交给旁白与字幕；');
            warn('    ③ 场景里声明 focus（或时间线上写 focus: { x, y, w, h } / focus: center）——');
            warn('      声明之后「主体区里压了几块 / 主体之外还有几个看的地方」才有判据（见 docs/LAYOUT.md）；');
            warn('    ④ 几个**一行读得完**的标注合成一行（kit 的 labelRow）：判据 ② 数的是"看的地方"，');
            warn('      分三处写的 LOW / MID / HIGH 是三个入口，写成一行就只是一块（docs/LAYOUT.md §1 的「标注可以合并成一行」）。');
            if (strict) {
              for (const r of summary.violates) {
                errs.push(`[版面守门] ${r.id}：${r.violations.map((v) => v.detail).join('；')}`);
              }
            }
          }
          if (summary.noFocus.length) {
            warn(`\n⚠ 版面守门：${summary.noFocus.length} 段**没有主体声明** ——「这一段看哪里」没判`
              + '（数量判据跑了，但「主体区里压了几块 / 主体之外还有几个看的地方」这两条**没跑**）。');
            warn(`  段：${summary.noFocus.join(', ')}`);
            pushSkipped(skipped, '版面守门·主体声明（focus）',
              `${summary.noFocus.length} 段声明不了主体（场景读不到 focus）：${summary.noFocus.join(', ')} —— 约束没验`);
          }
          if (summary.unjudged.length) {
            pushSkipped(skipped, '版面守门（layoutAudit）',
              `${summary.unjudged.length} 段一次采样都没拿到：${summary.unjudged.join(', ')} —— 没验`);
          }
        }
      } catch (err) {
        layoutErrs = true;
        log(`\n（版面守门汇总失败：${firstLine(err)}）`);
        pushSkipped(skipped, '版面守门（layoutAudit）', firstLine(err));
      }
    }
    if (layoutSkipped) {
      pushSkipped(skipped, '版面守门（采样）', `${layoutSkipped} 个采样点的记账没读成 —— 那些点没验`);
    }

    /**
     * 节奏腿（BACKLOG 1-35，2026-10-17）：镜头长度变异系数（CoV）—— **纯静态**，零渲染。
     *
     * 判据【外部经验值】：CoV ≥ 0.25 否则整片是节拍器（onetake 的 motion-web 三版教训：
     * v1 匀速 dolly / v2 等长硬切都被否「依然是 PPT」，v3 镜头 0.22–2.2s 通过；
     * 两条通过片实测 0.44 / 0.67）。**默认只报读数**（与版面守门同例 —— 已交付的
     * 匀速片子必然命中，让它 gate 会把回归清单永久染红）；`--strict` 才进 errs。
     * 单段 / `--only`：不存在镜头长度分布 ⇒ 进 skipped（「没判 ≠ 通过」）。
     *
     * 静帧占比（≥25%、最长静段 ≥1s）这一半**需要逐帧渲染**，不在这里跑 ——
     * `anim carry` 顺路看，或将来 `check --rhythm`；先把免费的这半做进来。
     */
    {
      const { rhythmStats } = await import('../src/timeline.js');
      const r = rhythmStats(info.timeline ?? []);
      if (r.noRhythm) {
        pushSkipped(skipped, '节奏（镜头长度 CoV）', `时间线只有 ${r.count} 段，没有长度分布可判 —— 这一条没跑`);
      } else {
        const mark = r.metronome ? '⚠' : ' ';
        log(`\n节奏（静态）：${r.count} 段镜头长度 CoV ${r.cov.toFixed(2)}（最短 ${r.min.toFixed(2)}s / 最长 ${r.max.toFixed(2)}s）`
          + `  ${r.metronome ? '⚠ 低于 0.25 —— 节拍器' : '· ≥ 0.25'}`);
        if (r.metronome) {
          warn('  匀速镜头长度在观众眼里就是"一格一格翻灯片"，不管每个镜头内部多好看（onetake 的三版教训）。');
          warn('  → 镜头长度该由旁白与信息量决定（docs/NARRATION.md），长枪 8–13s、短击 2–4s、burst 里 0.2–0.5s，别平摊。');
          if (strict) errs.push(`[节奏] 镜头长度 CoV ${r.cov.toFixed(2)} < 0.25 —— 节拍器（${r.count} 段，最短 ${r.min.toFixed(2)}s / 最长 ${r.max.toFixed(2)}s）`);
        }
      }
    }

    /**
     * **画面语义断言**（BACKLOG 1-18，2026-10-17）：`tasks/<任务>/motion.json` 里的四种断言 ——
     * before（纯静态，不渲染）/ appearsBy / keepsMoving / noEdgeContent。
     *
     * 采样计划与判读都是纯函数（`src/timeline.js` 的 `planMotionAsserts` / `motionVerdict`，
     * 离线单测 `tools/test-motion-assert.mjs`）；页面侧只负责按计划渲帧算 changedRatio
     * （`__anim.motionAudit`，写法对照 worldAudit）。两条元设计（REFERENCE-hyperframes §4.2）：
     *   ① **持久性感知** —— 单点超限、下一采样点恢复的瞬态降级 info，永不 gate；
     *   ② **空 ≠ 干净** —— 没声明的段 / 没跑成的行都进 skipped，绝不当通过。
     *
     * 退出码：命中**默认只 warn**（同版面守门的"先只报不改退出码"——已交付的片子没写过
     * motion.json，一命中就 gate 会把回归清单永久染红）；`--strict` 才进 errs。
     * `--quick`：渲染类只跑 appearsBy，keepsMoving / noEdgeContent 这次没跑（明说）。
     */
    if (motionSpec) {
      const m0 = Date.now();
      const { planMotionAsserts, motionVerdict } = await import('../src/timeline.js');
      const plan = planMotionAsserts(info.timeline ?? [], motionSpec);
      const tot = plan.totals;
      log('\n画面语义断言（motion.json）：' + tot.asserts + ' 条断言 —— 静态 before ' + tot.static
        + ' 条 · 渲染类 ' + tot.render + ' 条（阈值 changed ' + plan.thresholds.changed + ' / edgeSafe ' + plan.thresholds.edgeSafe + '）');
      if (tot.missing) warn('其中 ' + tot.missing + ' 条断言的段名在时间线里找不到（段名拼错，或 --only 之后段表变了）—— 单列，绝不当通过');
      if (tot.ignored) warn('其中 ' + tot.ignored + ' 条断言形状不认识、没生效（断言名该是 before / appearsBy / keepsMoving / noEdgeContent）');
      // --quick 省时档：渲染类只跑 appearsBy（2 帧/条）；keepsMoving 全段逐 0.5s 扫太贵、这次没跑
      const quickRows = quick ? plan.render.filter((r) => r.kind === 'appearsBy') : plan.render;
      const planRun = quick ? { ...plan, render: quickRows } : plan;
      if (quick) {
        const skipKeeps = plan.render.filter((r) => r.kind === 'keepsMoving');
        const skipEdge = plan.render.filter((r) => r.kind === 'noEdgeContent');
        if (skipKeeps.length) {
          pushSkipped(skipped, '画面语义断言（keepsMoving）',
            '--quick 省时档：' + skipKeeps.length + ' 条 keepsMoving 这次没跑（全段逐 0.5s 扫帧太贵）—— 没判 ≠ 通过');
        }
        if (skipEdge.length) {
          pushSkipped(skipped, '画面语义断言（noEdgeContent）',
            '--quick 省时档：' + skipEdge.length + ' 条 noEdgeContent 这次没跑（只跑 appearsBy）—— 没判 ≠ 通过');
        }
      }
      /** 实际要渲的帧数（报告「试渲染时间涨了多少」的口径；noEdgeContent 的记账白拿，只算渲的 1 帧） */
      const framesRun = quickRows.reduce((n, r) =>
        n + (r.kind === 'appearsBy' ? 2 : r.kind === 'keepsMoving' ? r.times.length * 2 : r.times.length), 0);
      let rows = null;
      if (quickRows.length) {
        try {
          const audit = await evaluateSafe(
            (rs) => /** @type {any} */ (window).__anim.motionAudit(rs), quickRows, 'motionAudit()',
          );
          rows = audit?.rows ?? null;
        } catch (err) {
          if (err && err.readable) throw err;      // 页面失联：照实抛出
          log('（画面语义断言不可用：' + firstLine(err) + '）');
          pushSkipped(skipped, '画面语义断言（motionAudit）', firstLine(err));
        }
      }
      const v = motionVerdict(planRun, rows);
      if (v.errors.length) {
        warn('\n画面语义断言：' + v.errors.length + ' 条命中');
        for (const e of v.errors.slice(0, 12)) warn('  · [' + e.kind + '] ' + e.id + ' —— ' + e.message);
        if (v.errors.length > 12) warn('  · …另有 ' + (v.errors.length - 12) + ' 条');
        warn('  → 改时间线 / 改场景让断言成立，或删掉 motion.json 里对应的断言（断言是验收口径，不是装饰）。');
        if (strict) {
          for (const e of v.errors) errs.push('[画面语义断言·' + e.kind + '] ' + e.id + '：' + e.message);
        }
      }
      for (const inf of v.infos) {
        // 持久性感知的降级（单点瞬态）：打出来给人看，**永不 gate**
        log('  ℹ [' + inf.kind + '] ' + inf.id + ' —— ' + inf.message);
      }
      for (const s of v.skipped) {
        pushSkipped(skipped, '画面语义断言（' + (s.kind || '其他') + '）', s.id ? '[' + s.id + '] ' + s.why : s.why);
      }
      log('  判定：' + v.passed + ' 条通过 · ' + v.errors.length + ' 条命中（' + (strict ? '--strict：已进 errs' : '默认只 warn，--strict 才 gate')
        + '） · ' + v.infos.length + ' 条瞬态（info，不 gate） · ' + v.skipped.length + ' 条没判');
      log('  （画面语义断言用了 ' + ((Date.now() - m0) / 1000).toFixed(1) + 's、多渲 ' + framesRun + ' 帧'
        + (quick ? '；--quick 下 keepsMoving / noEdgeContent 这次没跑' : '') + '）');
    }



    /**
     * P0-3：**场景抛异常必须是硬失败**。
     *
     * 这条以前完全缺失，而它正是 beast 那轮最贵的一口：`check` 只读一次 `info`
     * （装载期的错误），而 render 期的异常是在**它之后**才产生的 ——
     * 于是"某个时刻起整屏暗红"这件事，三次采样全绿、控制台一个字都没有。
     * 现在渲染完再回读一次，并且**当成错误**（不是附注）。
     */
    const rerr = await collectRenderErrors({ take: false });
    if (rerr.count) {
      warn(`\n⚠ 场景在渲染时抛异常：${rerr.count} 帧`);
      for (const line of rerr.text.slice(0, 10)) warn('  · ' + line);
      warn(`  → 那些帧画出来的是**错帧卡片**（暗红底 + 红框 + ✗ SCENE ERROR），不是画面内容。`);
      errs.push(...rerr.text.map((t) => `[场景异常] ${t}`));
    }

    // 浏览器控制台里的 pageerror 一律算失败：场景里的 TypeError 会先在这里露出来
    // （以前只在末尾附注打印，很容易被漏读）。
    const pageErrs = session.consoleLog.filter((l) => l.startsWith('[pageerror]'));
    for (const l of pageErrs) errs.push(`[浏览器异常] ${l}`);

    // 3) 可选：把每个采样点拼成接触表，一张图看全片（--sheet）
    if (flag('sheet')) {
      const all = [];
      for (const it of info.timeline) {
        const dur = it.end - it.start;
        for (const k of [0.15, 0.5, 0.85]) all.push(it.start + dur * k);
      }
      // ⚠ `--sheet` 可以**不带值**：`opt('sheet', …)` 在「选项存在但后面没跟值」时返回 undefined
      //   （opt 取的是 `rest[i + 1]`），直接喂 path.resolve 会 `ERR_INVALID_ARG_TYPE`。
      //   2026-10-16 跑 `check _shots-lab --quick --sheet` 撞到的**既有 bug**（AGENTS.md 里
      //   那条 `check <task> [--sheet]` 一直是这样写的，只是没人跑过带 flag 的那条路）。
      //   另一个坑：`--sheet --quick` 时 opt 会把下一个 flag 当成值 ⇒ 用 startsWith('-') 挡掉。
      const sheetArg = opt('sheet', '');
      const sheetPath = path.resolve(ROOT, sheetArg && !String(sheetArg).startsWith('-') ? sheetArg
        : taskOut(task, 'check', 'contact.png'));
      await writeContactSheet(all, sheetPath);
      log(`✓ 接触表 ${path.relative(ROOT, sheetPath)}（${all.length} 格，每段 15%/50%/85%）`);
    }

    if (session.consoleLog.length) {
      warn('\n浏览器控制台：');
      for (const l of session.consoleLog.slice(0, 15)) warn('  ' + l);
    }

    /**
     * 「空 ≠ 干净」（`docs/BACKLOG.md` 1-19）：把**没跑成 / 被跳过 / 不可用**的审计
     * 明明白白列出来，并且写进结论行。这一段永远出现（哪怕是 `skipped: 无`）——
     * 否则"确实全跑了"和"这一段整个没执行"在输出里长得一模一样。
     *
     * ⚠ 不改退出码：`tools/regress-all.mjs` 有 10 个 `check:*` 项依赖它。
     *   要把它当门用就显式 `--strict`（默认关）。
     */
    const skippedLines = formatSkipped(skipped);
    if (skipped.length) { warn(''); for (const line of skippedLines) warn(line); }
    else log(`\n${skippedLines[0]}`);
    if (strict && skipped.length) {
      warn(`  --strict：把 ${skipped.length} 项"没跑"当成失败（退出码 1）。`);
      process.exitCode = 1;
    }
    if (errs.length) {
      /**
       * 逐条打印**为什么红**。
       *
       * 以前这里只打一行"✗ 有 N 个问题" —— 每条错误各自的 warn 早就打过了
       * （背景守门 / under / 亮度 / 非有限值），但 `--strict` 新接入的两类**只在 errs 里、
       * 不在上面任何一行**（`[旁白复述]` 与 `[版面守门]`），于是"退出码 1 + 只给个数字"。
       * 这与 `reportErrors()` 的既有做法一致（那里也是把 errs 逐条打出来）。
       * 上限 12 条：再多也没人读，后面还有结论行。
       */
      warn(`\n✗ 为什么红（${errs.length} 条）：`);
      for (const e of errs.slice(0, 12)) warn(`  · ${e}`);
      if (errs.length > 12) warn(`  · …另有 ${errs.length - 12} 条`);
      warn(`\n${checkVerdictLine({ problems: errs.length, skipped: skipped.length })}`);
      process.exitCode = 1;
    } else {
      // ⚠ `--quick` **只跑单子帧** —— 结论行不许说"两条路径都验过了"。
      //    那正是 1-19 要消灭的东西（没跑却说跑了）：`--quick` 本身不是失败，
      //    但它是**省掉了一半检验**，必须在结论行里如实讲出来，否则读输出的 agent
      //    会把"冒烟过了"当成"完整体检过了"（2026-10-10 主代理跑 `check demo --quick` 时抓到）。
      log(`\n${checkVerdictLine({ skipped: skipped.length })}${quick
        ? '（--quick：**只验了单子帧**这一条路径 —— 多子帧（成片真正走的那条）与入场头 1 秒这次都没看，交付前请去掉 --quick 再跑一次）'
        : '（单子帧与多子帧两条路径都验过了）'}`);
    }
  } finally { await closeSession(); }
}

/** 把若干时刻渲染成一张接触表（每格标时刻），写到 out/。
 *
 * `check --sheet` 与 `anim cuts` 共用这一份实现。可选项都是**向后兼容**的加法：
 *   · `samples` / `shutter`：不传就与从前逐像素一样（`samples: 1`）；
 *   · `marks`：要高亮的时刻数组（±0.02s 内算命中），命中格描一圈信号色方框 ——
 *     `anim cuts` 用它指出「这一格就是切点」。
 */
async function writeContactSheet(times, out, opts = {}) {
  const cols = Math.max(1, Number(opts.cols ?? opt('cols', '4')));
  const cell = Number(opts.cell ?? opt('cell', '420'));
  const samples = opts.samples ?? 1;
  const shutter = opts.shutter ?? 0.5;
  const marks = Array.isArray(opts.marks) ? opts.marks : null;
  const dataUrl = await session.page.evaluate(async ({ times, cols, cell, samples, shutter, marks }) => {
    const api = /** @type {any} */ (window).__anim;
    const w = cell, h = Math.round((cell * 9) / 16);
    const pad = 6, lab = 20;
    const rows = Math.ceil(times.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * (w + pad) + pad;
    cv.height = rows * (h + lab + pad) + pad;
    const c = cv.getContext('2d');
    c.fillStyle = '#1a1a1c'; c.fillRect(0, 0, cv.width, cv.height);
    const img = new Image();
    for (let i = 0; i < times.length; i++) {
      await api.frame(times[i], { samples: Number(samples), shutter });
      img.src = api.png();
      await img.decode();
      const x = pad + (i % cols) * (w + pad);
      const y = pad + Math.floor(i / cols) * (h + lab + pad);
      c.drawImage(img, x, y + lab, w, h);
      c.fillStyle = '#ddd'; c.font = '14px monospace';
      c.fillText(`${times[i].toFixed(2)}s`, x + 2, y + 15);
      if (marks && marks.some((m) => Math.abs(m - times[i]) < 0.02)) {
        c.strokeStyle = '#ff4d12'; c.lineWidth = 3;
        c.strokeRect(x + 2, y + lab + 2, w - 4, h - 4);
      }
    }
    return cv.toDataURL('image/png');
  }, { times, cols, cell, samples, shutter, marks });
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
}

/** 扫描场景源码里的非确定性写法。 */
function scanScenes(task) {
  const out = [];
  const dir = path.join(ROOT, 'tasks', task, 'scenes');
  if (!existsSync(dir)) return out;
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  const bad = [
    [/Math\.random\s*\(/, 'Math.random() —— 换成 rng(seed)（离线渲染会乱序多次调用本函数）'],
    [/Date\.now\s*\(/, 'Date.now() —— 时间只能来自 f.t'],
    [/performance\.now\s*\(/, 'performance.now() —— 时间只能来自 f.t'],
    [/new\s+Date\s*\(/, 'new Date() —— 时间只能来自 f.t'],
  ];
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return; // 注释里提到不算
      for (const [re, why] of bad) if (re.test(line)) out.push(`${f}:${i + 1} ${why}`);
    });
  }
  return out;
}

/* ------------------------------------------------------------------ 命令：still / sheet */

async function cmdStill() {
  const task = pickTask();
  const times = (opt('t', '1') ?? '1').split(',').map(Number).filter((x) => Number.isFinite(x));
  if (!times.length) die('-t 需要给时间，例如 -t 0,1.5,3');
  const outDir = path.resolve(ROOT, opt('out', opt('o', taskOut(task, 'stills'))));
  mkdirSync(outDir, { recursive: true });
  const samples = opt('samples', '1');
  const scale = Number(opt('scale', '0')) || undefined;

  if (samples === '1') {
    warn('· samples=1：这是单子帧，**只代表静止画面**，不代表成片的运动模糊。查运动质量用 `sheet`/`shot`，或加 --samples auto。');
  }

  await openSession({ task, scale, only: opt('only', undefined) });
  try {
    const info = session.info;
    log(`渲染 ${times.length} 帧 → ${outDir}  (${info.width}×${info.height}${info.scale > 1 ? ' ×' + info.scale : ''}, samples=${samples})`);
    for (const t of times) {
      const t0 = Date.now();
      const r = await session.page.evaluate(
        ([t, samples, shutter]) => /** @type {any} */ (window).__anim.still(t, { samples: samples === 'auto' ? 'auto' : Number(samples), shutter }),
        [t, samples, Number(opt('shutter', '0.5'))],
      );
      const file = path.join(outDir, `f_${t.toFixed(3).padStart(8, '0')}.png`);
      writeFileSync(file, Buffer.from(String(r.png).split(',')[1], 'base64'));
      log(`  t=${t.toFixed(3)}s  ${((Date.now() - t0) / 1000).toFixed(1)}s  子帧 ${r.samples}  ${path.relative(ROOT, file)}`);
    }
    reportErrors(session.info);
    // P0-3：出图这条路也必须响。错帧卡片是一张"看起来有内容"的 PNG，
    // 不点名的话它会被当成画面本身（beast 那次就是靠人眼抽帧才看出来的）。
    const rerr = await collectRenderErrors({ take: false });
    if (rerr.count) {
      warn(`\n⚠ 刚渲染的帧里有场景异常：${rerr.count} 帧`);
      for (const line of rerr.text.slice(0, 6)) warn('  · ' + line);
      warn('  → 上面那些 PNG 是**错帧卡片**（暗红底 + 红框 + ✗ SCENE ERROR），不是画面内容。');
      process.exitCode = 1;
    }
    log('\n下一步：用 Read 工具看这些 PNG，然后改场景再出一次。');
  } finally { await closeSession(); }
}

/**
 * `anim cover <任务> -t <秒>` —— 出一张**封面**（BACKLOG 1-53）。
 *
 * 与 `still` 的区别只有一层：still 出来的是"片子里的那一帧"，cover 在它上面再压
 * 底部渐变压暗 + 主标题 + 一条信号色短线 + 副标。字体用的是引擎那套（Noto Sans SC /
 * 拱形 Archivo / Plex Mono），所以封面与成片的字是同一家人 —— 不是 ffmpeg drawtext
 * 另找一份字体。
 *
 * 判据：出来的 PNG 尺寸 = 任务分辨率 × --scale；字的墨迹落在下半屏（上半屏留给画面）。
 *
 *   node scripts/anim.mjs cover <任务> -t 12 --title "把信号拆开" --sub "SPECTRUM · 72s"
 *   node scripts/anim.mjs cover <任务> -t 12 --title "…" --scale 2     # 4K 封面
 */
async function cmdCover() {
  const task = pickTask();
  const t = Number(opt('t', '6'));
  if (!Number.isFinite(t)) die('-t 需要给一个秒数，例如 -t 12');
  const title = opt('title', undefined);
  const sub = opt('sub', undefined);
  if (!title && !sub) die('封面至少要 --title 或 --sub（否则就是一张 still，用 still 更直接）');
  const scale = Number(opt('scale', '0')) || undefined;
  const scrim = opt('scrim', undefined);
  // 4K 封面不要覆盖 1080p 那张：文件名带上 @2x（--out 显式给了就照给的写）
  const tag = scale && scale > 1 ? `@${scale}x` : '';
  const outFile = path.resolve(ROOT, opt('out', opt('o', taskOut(task, `cover_${t.toFixed(2)}${tag}.png`))));
  mkdirSync(path.dirname(outFile), { recursive: true });

  await openSession({ task, scale });
  try {
    const info = session.info;
    const t0 = Date.now();
    const r = await session.page.evaluate(
      ([tt, o]) => /** @type {any} */ (window).__anim.cover(tt, o),
      [t, { title, sub, scrim: scrim === undefined ? undefined : Number(scrim) }],
    );
    writeFileSync(outFile, Buffer.from(String(r.png).split(',')[1], 'base64'));
    log(`封面 → ${path.relative(ROOT, outFile)}  (${info.width}×${info.height}${info.scale > 1 ? ' ×' + info.scale : ''}, t=${t}s, 子帧 ${r.samples}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    reportErrors(session.info);
    const rerr = await collectRenderErrors({ take: false });
    if (rerr.count) {
      warn(`\n⚠ 封面那一帧有场景异常（${rerr.count} 帧）—— 封面是**错帧卡片**，不是画面`);
      for (const line of rerr.text.slice(0, 4)) warn('  · ' + line);
      process.exitCode = 1;
    }
  } finally { await closeSession(); }
}

/**
 * 章节规划（**纯函数**，离线单测见 `tools/test-cover-chapters.mjs`）。
 *
 * 规则（三条，都有理由）：
 *   ① **第一段无论多短都是 00:00 的入口** —— YouTube 的章节第一个时间戳必须是 00:00，
 *      否则整组章节不生效；
 *   ② 短于 `minDur` 的段**不单独成章**，它的时长并进上一章（一个 3 秒的过场不该占一行）；
 *   ③ 起点取**段自己的 start**（不是累加），所以与时间线重叠（转场）时章节时刻仍然对。
 *
 * @param {{ id: string, start: number, end: number }[]} segs
 * @param {number} [minDur]
 * @returns {{ start: number, name: string, dur: number }[]}
 */
function planChapters(segs, minDur = 4) {
  const out = [];
  for (const s of Array.isArray(segs) ? segs : []) {
    const dur = Math.max(0, s.end - s.start);
    if (out.length === 0) {
      out.push({ start: 0, name: s.id, dur });
      continue;
    }
    if (dur < minDur) {
      out[out.length - 1].dur += dur;
      continue;
    }
    out.push({ start: s.start, name: s.id, dur });
  }
  return out;
}

/** `秒 → mm:ss`（章节时间码；向下取整到整秒是平台惯例）。 */
function formatChapterTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/**
 * `anim chapters <任务>` —— 从时间线生成**章节时间码**（BACKLOG 1-53）。
 *
 * B 站 / YouTube 的章节格式都是 `mm:ss 名字`（YouTube 首行必须是 00:00）。这里按段名与起点生成，
 * 名字取段的 id（作者写的那个），所以"章节名"就是你在时间线里写的段名 —— 想起好名字就去改时间线。
 *
 * 只在段边界是**自然的章节**时才有意义：一个 3 秒的过场不该单独成章。所以默认跳过短于
 * `--min`（默认 4 秒）的段，并把它的时长并进上一章。
 *
 *   node scripts/anim.mjs chapters <任务>                 # 打印 + 写 out/<任务>/chapters.txt
 *   node scripts/anim.mjs chapters <任务> --min 6 --json  # 机器可读
 */
async function cmdChapters() {
  const task = pickTask();
  const minDur = Number(opt('min', '4'));
  const outFile = path.resolve(ROOT, opt('out', opt('o', taskOut(task, 'chapters.txt'))));
  await openSession({ task });
  try {
    const segs = (await session.page.evaluate(() => /** @type {any} */ (window).__anim.info())).timeline;
    const rows = planChapters(segs, minDur);
    const mmss = formatChapterTime;
    const lines = rows.map((r) => mmss(r.start) + ' ' + r.name);
    if (flag('json')) {
      log(JSON.stringify({ task, chapters: rows.map((r) => ({ time: mmss(r.start), start: +r.start.toFixed(2), name: r.name, dur: +r.dur.toFixed(2) })) }, null, 2));
    } else {
      for (const l of lines) log(l);
    }
    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
    log(`\n${rows.length} 章 → ${path.relative(ROOT, outFile)}`);
    if (rows.length && rows[0].start !== 0) warn('⚠ 第一章不在 00:00 —— YouTube 会拒绝章节');
  } finally { await closeSession(); }
}

async function cmdSheet() {
  const task = pickTask();
  const from = Number(opt('from', '0'));
  const to = Number(opt('to', opt('dur', '10')));
  const n = Math.max(2, Number(opt('n', '12')));
  const cols = Math.max(1, Number(opt('cols', '4')));
  const cell = Number(opt('cell', '480'));
  const out = path.resolve(ROOT, opt('out', opt('o', taskOut(task, `sheet_${from}-${to}.png`))));

  await openSession({ task, only: opt('only', undefined) });
  try {
    const times = Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
    const samples = Number(opt('samples', '1'));
    log(`接触表 ${from}→${to}s，${n} 帧，samples=${samples}`);
    // 拼图逻辑只有 writeContactSheet 一份 —— 这里以前整段抄了一遍，两处只差 marks。
    await writeContactSheet(times, out, { cols, cell, samples, shutter: Number(opt('shutter', '0.5')) });
    log(`✓ ${path.relative(ROOT, out)}`);
    reportErrors(session.info);
  } finally { await closeSession(); }
}

/* ------------------------------------------------------------------ 命令：cuts */

/**
 * 切点接触表：**切点两侧固定出图**（BACKLOG 1-26）。
 *
 * 为什么要有它：`check` 的三点采样是每段的 15% / 50% / 85% —— **一个都不落在切点上**，
 * 而观众说"跳"的时刻恰恰全在切点。以前想知道切点长什么样，得自己从段起止时间里挑一个数、
 * 手写 `still -t … --only …`（还得先知道那一刻属于哪一段）。现在一条命令把每个切点两侧摊开。
 *
 *   node scripts/anim.mjs cuts <任务>                     # 每个内部段边界各出一张接触表
 *   node scripts/anim.mjs cuts <任务> --window 1.5 --n 7  # 每侧 1.5 秒共 7 格（默认）
 *   node scripts/anim.mjs cuts <任务> --at 12.5,30        # 只出这两个时刻（复现 check 报的切点）
 *   node scripts/anim.mjs cuts <任务> --samples auto      # 带运动模糊（默认 1：先看清画面）
 *
 * ⚠ 画着信号色方框的那一格**就是切点**，它画的是**后一段的第一帧** —— 引擎判"这一段在不在播"
 *   用的是 `t >= start && t < end`，所以切点那一刻已经归后一段了；它左边那一格才是前一段的最后一帧。
 *   转场交叠期里两侧都在播，那几格的底是两段叠出来的（这正是要看的东西）。
 */
async function cmdCuts() {
  const task = pickTask();
  const win = Math.max(0.1, Number(opt('window', '1.5')));
  const n = Math.max(3, Number(opt('n', '7')));
  const samples = opt('samples', '1');
  const shutter = Number(opt('shutter', '0.5'));
  const outDir = path.resolve(ROOT, opt('out', opt('o', taskOut(task, 'cuts'))));
  const atArg = opt('at', '');

  await openSession({ task, scale: Number(opt('scale', '0')) || undefined });
  try {
    const info = session.info;
    const timeline = info.timeline ?? [];
    if (!timeline.length) die('这条时间线是空的 —— 没有切点可看。');

    let cuts;
    if (atArg) {
      cuts = atArg.split(',').map(Number).filter(Number.isFinite);
      if (!cuts.length) die('--at 需要给时刻（秒），例如 --at 12.5,30');
    } else {
      // 内部段边界 = 每段的 start（0 是整片开头，不算切点）
      cuts = timeline.map((it) => it.start).filter((t) => t > 0.001);
    }
    cuts = [...new Set(cuts.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);
    if (!cuts.length) { log('这条时间线只有一个镜头（没有内部切点）。'); return; }

    const step = (win * 2) / (n - 1);
    mkdirSync(outDir, { recursive: true });
    log('切点 ' + cuts.length + ' 个：每个两侧 ±' + win + 's、' + n + ' 格'
      + '（步长 ' + step.toFixed(3) + 's，samples=' + samples + '）');
    log('输出目录 ' + path.relative(ROOT, outDir) + '\n');

    for (const c of cuts) {
      // 切点前一刻**在播**的段（交叠期可能不止一个）→ 这一刻**开始**的段。
      // ⚠ 别把 after 写成「c 时刻在播的段」：交叠期旧段还没结束，那样会把两段都列进去、
      //   读起来像「这一刻开始了两个镜头」（2026-10-16 出图时改的）。
      const before = timeline.filter((it) => c - 0.001 >= it.start && c - 0.001 < it.end).map((it) => it.id);
      const after = timeline.filter((it) => Math.abs(it.start - c) < 0.02).map((it) => it.id);
      const times = Array.from({ length: n }, (_, i) => Math.max(0, c - win + step * i));
      const file = path.join(outDir, 'cut_' + c.toFixed(3) + 's.png');
      const t0 = Date.now();
      await writeContactSheet(times, file, { samples, shutter, marks: [c] });
      log('  t=' + c.toFixed(3) + 's  ' + (before.join('+') || '—') + ' → ' + (after.join('+') || '—')
        + '  ' + ((Date.now() - t0) / 1000).toFixed(1) + 's  ' + path.relative(ROOT, file));
    }

    reportErrors(session.info);
    // 与 still 同一条底线：错帧卡片是一张"看起来有内容"的 PNG，不点名就会被当成画面
    const rerr = await collectRenderErrors({ take: false });
    if (rerr.count) {
      warn('\n⚠ 刚渲染的帧里有场景异常：' + rerr.count + ' 帧');
      for (const line of rerr.text.slice(0, 6)) warn('  · ' + line);
      warn('  → 上面那些 PNG 是**错帧卡片**（暗红底 + 红框 + ✗ SCENE ERROR），不是画面内容。');
      process.exitCode = 1;
    }
    log('\n下一步：用 Read 工具看这些 PNG —— 画着信号色方框的那一格就是切点。');
  } finally { await closeSession(); }
}

/* ------------------------------------------------------------------ 命令：diff / hashes */

/**
 * 逐像素差分：判「同一时刻两次渲染到底差多少」。
 *
 *   node scripts/anim.mjs diff demo --times 12            # 12 秒这一帧渲染两次
 *   node scripts/anim.mjs diff demo --times 12 --warm 9.5 # 先渲 9.5 再渲 12（查历史上文的影响）
 *
 * 用途：定标「确定性」到底有多确定。哈希是 0 容差，但 GPU 的导数/滤波在若干 tile 上有
 * 最后一位的噪声，这类差异不影响观感，却会让哈希比对失败——所以两者都要有。
 */
async function cmdDiff() {
  const task = pickTask();
  const times = (opt('times', opt('t', '1')) ?? '1').split(',').map(Number).filter(Number.isFinite);
  if (!times.length) die('--times 需要给时间');
  const warm = opt('warm', '');
  const samples = opt('samples', '1');
  await openSession({ task, scale: Number(opt('scale', '0')) || undefined, only: opt('only', undefined) });
  try {
    log(`差分（samples=${samples}）  阈值：>8 与 >32 的像素占比`);
    for (const t of times) {
      const warmPx = warm ? warm.split(',').map(Number).filter(Number.isFinite) : [];
      const r = await session.page.evaluate(async ({ t, warmPx, samples }) => {
        const api = /** @type {any} */ (window).__anim;
        for (const w of warmPx) await api.frame(w, { samples: Number(samples) });
        return api.diff(t, t, { samples: Number(samples) });
      }, { t, warmPx, samples });
      const tag = warmPx.length ? `（先渲 ${warmPx.join(',')}）` : '';
      log(`  t=${t.toFixed(3)}${tag}  max ${r.max}  mean ${r.mean.toFixed(4)}  >8 ${(r.over8 * 100).toFixed(3)}%  >32 ${(r.over32 * 100).toFixed(3)}%`);
    }
    reportErrors(session.info);
  } finally { await closeSession(); }
}

/**
 * 确定性指纹：同一 t 渲染出来的像素指纹 / 与基线的逐像素比对。
 *
 * 这是**重构的验收工具**：改了引擎、或把场景抽成模板之后，跑一遍前后对比，
 * 就能机械地证明「画面没变」——比人眼看图可靠，也比存一堆 PNG 便宜。
 *
 *   node scripts/anim.mjs hashes demo --every 2 --save       # 打指纹并存成基线
 *   node scripts/anim.mjs hashes demo --baseline             # 与基线逐像素比对
 *   node scripts/anim.mjs hashes demo --times 1,2.5,6        # 只看某几个时刻
 *
 * ⚠ 判定方式不是"哈希相等"，而是**差了多少**：同一时刻是 t 的纯函数，
 *   但 GPU 在少数 tile 上有最后一位（1/255）的噪声（交叠到 95% 的转场帧尤其敏感），
 *   跨进程重渲可能差 1 个 LSB。所以基线连原始像素一起存，比对时报 max / mean。
 *   判据**只有一处**：`negligible()` —— **差过 16/255 的像素一个都不许有**（`over16 === 0`）
 *   且 `mean < 0.002` ⇒ 逐像素没变。16 在 8bit 显示空间里已经能看出台阶，而实测噪声天花板是 10
 *   （反复重渲同一份基线稳定得到 max 8–10），中间留了一档余量。
 *   ⚠ 别照抄别处的说法（日志里打的是 `>16` / `>32` 两列，`max` 只是给人看的读数，**不参与判定**）。
 */
async function cmdHashes() {
  const task = pickTask();
  const every = Number(opt('every', '0'));
  const timesArg = opt('times', opt('t', ''));
  const scale = Number(opt('scale', '0')) || undefined;
  const only = opt('only', '');
  const baseFile = path.resolve(ROOT, opt('file', taskOut(task, `hashes${only ? '_' + only.replace(/,/g, '-') : ''}.json`)));
  const accept = flag('accept');
  const force = flag('force');
  const note = String(opt('note', '') || '').trim();
  const useBaseline = flag('baseline') || accept;
  const baseExists = existsSync(baseFile);

  /**
   * 基线是**变更探测器**，不是"画面永远不许变"（2026-10-24 拍板，见 `docs/BACKLOG.md` §4）。
   *
   * 以前这里只有一个隐含规矩：改完引擎必须让 22 帧逐像素不变 —— 于是任何**有意的**视觉改进
   * 都被挡在门外（1-41 的 blur 就是被这条逼成"默认 0"的）。现在拆成四种明确用法：
   *
   *   `--save`              第一次存基线；**已存在时拒绝覆盖**（防止"改完顺手重存"绕过比对）
   *   `--baseline`          比对；不一致 ⇒ 退出码 1。它回答"变了没有"，不回答"该不该变"
   *   `--accept --note "…"` 有意改画面：先比一遍、落一张前后对比图、再存新基线（原因进 `notes`）
   *   `--force`             只想重存（不推荐；比对会断掉，基线里留一条 force 记录）
   *
   * 判据仍然是 `negligible()`（over16 === 0 且 mean < 0.002），没有放松 —— 放松的是**流程**：
   * 有意的变化要**被看见、被说明**，而不是被"改回去"。
   */
  if (accept) {
    if (!baseExists) die(`没有基线可接受：${path.relative(ROOT, baseFile)} 不存在。第一次先跑 --save。`);
    if (!note) {
      die(`--accept 必须带 --note "这次画面为什么该变"。\n`
        + `  基线的作用是**抓住没注意到的变化**；接受一次视觉改动是决定，不是例行公事：\n`
        + `  node scripts/anim.mjs hashes ${task} --accept --note "title 默认开启 18px 虚焦入场（1-41 后续）"`);
    }
  } else if (!useBaseline && baseExists && !force) {
    die(`基线已经存在：${path.relative(ROOT, baseFile)}。\n`
      + `  · 有意改了画面：--accept --note "改了什么、为什么"（会先比一遍、落对比图，再存）\n`
      + `  · 只是重存一遍：--force（不推荐 —— 比对会断掉）`);
  }

  await openSession({ task, scale, only: only || undefined });
  try {
    const info = session.info;
    /** @type {{ t: number, buf: Buffer, stats: any }[]} */
    const changed = [];
    let baseCount = 0;
    /** @type {any} */
    let baseJson = null;
    if (baseExists) {
      baseJson = JSON.parse(readFileSync(baseFile, 'utf8'));
      baseCount = Array.isArray(baseJson.frames) ? baseJson.frames.length : 0;
    }

    if (useBaseline) {
      const j = baseJson;
      if (!j || !Array.isArray(j.frames)) die(`基线文件格式不对：${path.relative(ROOT, baseFile)}（没有 frames 数组）。`);
      const lastNote = Array.isArray(j.notes) && j.notes.length ? j.notes[j.notes.length - 1] : null;
      log(`与基线比对：${path.relative(ROOT, baseFile)}（${j.frames.length} 帧，${j.width}×${j.height}×${j.scale}）`);
      if (lastNote) log(`  上一次接受：${lastNote.at}  ${lastNote.note}`);
      let bad = 0;
      let prev = null;
      for (const f of j.frames) {
        // 相邻帧做 delta 再存 base64（原始 8.3MB/帧，帧间差异很小）
        const cur = f.delta ? deltaDecode(prev, Buffer.from(f.delta, 'base64'), j.bytes) : Buffer.from(f.pixels, 'base64');
        prev = cur;
        const r = await session.page.evaluate(
          ([tt, b64]) => /** @type {any} */ (window).__anim.diffToB64(b64, tt, { samples: 1 }),
          [f.t, cur.toString('base64')],
        );
        // 判据**以 negligible() 为准**（函数头那段）：over16 === 0 且 mean < 0.002。
        // 日志里的 max / >16 / >32 是给人看的读数，哪一个都不单独构成判据。
        const same = negligible(r);
        if (!same) { bad++; changed.push({ t: f.t, buf: cur, stats: r }); }
        log(`  t=${f.t.toFixed(3)}  ${same ? '✓ 画面一致' : '✗ 变了'}  max ${r.max}  mean ${r.mean.toFixed(4)}  >16 ${(r.over16 * 100).toFixed(4)}%  >32 ${(r.over32 * 100).toFixed(4)}%`);
      }
      if (bad) {
        const sheet = await writeHashesDiffSheet(task, changed, j.width * j.scale, j.height * j.scale);
        warn(`\n✗ ${bad}/${j.frames.length} 帧与基线不一致（逐像素差异超出噪声范围）`);
        if (sheet) log(`  前后对比图：${path.relative(ROOT, sheet)}（每行左 = 基线、右 = 现在）`);
        if (!accept) {
          warn(
            `  这是**变更探测器**，不是"画面永远不许变"。两种收场：\n`
            + `    · 有意改的 → node scripts/anim.mjs hashes ${task} --accept --note "改了什么、为什么"\n`
            + `    · 不该变的 → 把改动改回去，重跑这一条\n`
            + `  （已交付片子的 mp4 是既成产物，不会因为基线更新而被重渲。）`,
          );
          process.exitCode = 1;
          reportErrors(session.info);
          return;
        }
        log('  ✓ 已确认这次变化（note 会写进基线，下一次比对失败时会打出来）');
      } else {
        log(`\n✓ ${j.frames.length} 帧全部与基线一致（画面没有被改动）`);
        if (!accept) { reportErrors(session.info); return; }
        log('  没有变化，不需要接受 —— 只补一条 note 记录。');
      }
    }

    const dur = info.onlyDuration || info.duration;
    /**
     * ⚠ **`--accept` 必须沿用基线自己的采样时刻**（2026-10-24 修）。
     *
     * 在修之前这三条分支对 `--accept` 一视同仁：没写 `--every` 就回落到"默认 4 帧"
     * （`[0, 25%, 50%, 75%]`）。而基线通常是 `--every 2` 存的 11 帧 —— 于是一次
     * `hashes demo --accept --note …` 会把基线**从 11 帧悄悄缩成 4 帧**：
     * 检查密度掉了 64%，而日志只说"已确认这次变化"。
     *
     * 这是变更探测器上最不该有的那种损失：它不报错、不违反判据，只是**以后更查不出东西**了
     * （实测：0-3 与字体两次 accept 之后 demo 基线只剩 4 帧）。
     * 所以 `--accept` 时优先用基线里那批 `t`；只有第一次存基线（没有基线可继承）才用默认采样。
     */
    const baselineTimes = accept && Array.isArray(baseJson?.frames) && baseJson.frames.length
      ? baseJson.frames.map((f) => Number(f.t)).filter(Number.isFinite)
      : null;
    const times = timesArg
      ? timesArg.split(',').map(Number).filter(Number.isFinite)
      : every > 0
        ? Array.from({ length: Math.max(1, Math.ceil(dur / every)) }, (_, i) => i * every).filter((t) => t < dur)
        : baselineTimes && baselineTimes.length
          ? baselineTimes
          : [0, dur * 0.25, dur * 0.5, dur * 0.75].map((x) => Math.round(x * 1000) / 1000);
    if (!times.length) die('--times 需要给时间，例如 --times 0,2.5,6');
    if (baselineTimes && !timesArg && !(every > 0)) {
      log(`  （沿用基线原有的 ${times.length} 帧采样 —— --accept 不该改变检查密度）`);
    }

    /** @type {{ task: string, width: number, height: number, scale: number, bytes: number,
     *          format: number, savedAt: string, notes: any[], frames: any[] }} */
    const snap = {
      task, width: info.width, height: info.height, scale: info.scale, bytes: 0,
      format: 2, savedAt: new Date().toISOString(),
      // notes 是**审计轨迹**：基线为什么被接受过。没有它，`--accept` 就只是"把红的刷绿"。
      notes: Array.isArray(baseJson?.notes) ? baseJson.notes : [],
      frames: [],
    };
    if (accept) {
      snap.notes.push({
        at: snap.savedAt, note, changed: changed.length, total: baseCount || times.length,
        frames: changed.map((c) => Number(c.t.toFixed(3))),
      });
    } else if (force && baseExists) {
      snap.notes.push({ at: snap.savedAt, note: note || '（--force 重存，没有说明）', changed: null, total: times.length, force: true });
    }

    let prev = null;
    /**
     * ⚠ 基线是**一个 JSON 文件**，写和读都要经过 V8 的**单个字符串**（上限约 512MB）。
     * 每帧存的是"整帧像素 delta 之后的 base64"，delta 压不掉时就是 4/3 倍整帧。
     * 长片子很容易顶爆 —— 实测 sodium（246s、`--every 4`、62 帧）直接死在
     * `JSON.stringify` 上：`RangeError: Invalid string length`；而且**就算写出来也没用**，
     * `--baseline` 那侧的 `readFileSync` + `JSON.parse` 一样读不回来。
     * 所以攒到上限附近就当场停下，并给出这一轮真正能用的参数。
     */
    const B64_CAP = 380e6;
    let b64Total = 0;
    for (const t of times) {
      const r = await session.page.evaluate(
        (tt) => /** @type {any} */ (window).__anim.hash(tt, { samples: 1, pixels: true }),
        t,
      );
      const cur = Buffer.from(r.pixels, 'base64');
      snap.bytes = cur.length;
      const delta = deltaEncode(prev, cur).toString('base64');
      b64Total += delta.length;
      if (b64Total > B64_CAP) {
        die(`基线装不下：已经攒到 ${(b64Total / 1048576).toFixed(0)}MB（上限 ${(B64_CAP / 1048576).toFixed(0)}MB）。\n`
          + `  基线是单个 JSON 文件，超过 V8 的字符串上限（约 512MB）就写不出来、也读不回来。\n`
          + `  这一轮是 ${times.length} 帧 × ${(snap.bytes / 1048576).toFixed(1)}MB/帧（${dur.toFixed(0)}s 的片子）。\n`
          + `  → 采样放稀：--every ${Math.max(8, Math.ceil((every || dur / times.length) * 2))}，`
          + `或改用 --times 只挑每段的中间时刻。`);
      }
      snap.frames.push({ t, hash: r.hash, delta });
      prev = cur;
      log(`${t.toFixed(3)}\t${r.hash}\t${r.bytes}`);
    }
    mkdirSync(path.dirname(baseFile), { recursive: true });
    writeFileSync(baseFile, JSON.stringify(snap));
    log(`· 指纹已存 ${path.relative(ROOT, baseFile)}（${(statSync(baseFile).size / 1048576).toFixed(1)} MB）`);
    if (accept) log(`· 接受记录已写进基线的 notes（${snap.notes.length} 条）：${note}`);
    reportErrors(session.info);
  } finally { await closeSession(); }
}

/**
 * 把「基线 vs 现在」画成一张对比图 —— `--baseline` 失败 / `--accept` 时的**审查入口**。
 *
 * 左列是基线里存的那一帧（从 delta 还原出的原始 RGBA），右列是现在重渲的一帧。
 * 最多 8 行：够看清改了什么，再多也没人看。基线里存的是**像素**不是图片，
 * 所以这里要自己做一次行翻转（`readPixels` 自下而上，canvas 自上而下）。
 *
 * @param {string} task
 * @param {{ t: number, buf: Buffer, stats: any }[]} changed
 * @param {number} W 物理像素宽 @param {number} H 物理像素高
 * @returns {Promise<string|null>} 图片路径（没有变化时 null）
 */
async function writeHashesDiffSheet(task, changed, W, H) {
  if (!changed.length) return null;
  const rows = changed.slice(0, 8);
  const out = path.join(ROOT, 'out', task, 'hashes-diff.png');
  const dataUrl = await session.page.evaluate(async ({ items, W, H, rows }) => {
    const api = /** @type {any} */ (window).__anim;
    const cellW = 640;
    const cellH = Math.max(1, Math.round(cellW * H / W));
    const pad = 8;
    const label = 20;
    const cv = document.createElement('canvas');
    cv.width = pad * 3 + cellW * 2;
    // 最后一行下面还有 label 那行字，所以底部要多留一个 pad（第一版按 rows*(…) 算，标签被裁掉了一半）。
    cv.height = pad * 2 + rows * (cellH + label + pad);
    const c = cv.getContext('2d');
    c.fillStyle = '#1a1a1c'; c.fillRect(0, 0, cv.width, cv.height);
    const off = document.createElement('canvas'); off.width = W; off.height = H;
    const offc = off.getContext('2d', { willReadFrequently: true });
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const bytes = Uint8Array.from(atob(it.b64), (ch) => ch.charCodeAt(0));
      // readPixels 是自下而上；canvas 是自上而下 → 按行翻
      const flipped = new Uint8ClampedArray(bytes.length);
      const row = W * 4;
      for (let y = 0; y < H; y++) flipped.set(bytes.subarray((H - 1 - y) * row, (H - y) * row), y * row);
      offc.putImageData(new ImageData(flipped, W, H), 0, 0);
      const y = pad + i * (cellH + label + pad);
      c.drawImage(off, pad, y + label, cellW, cellH);
      await api.frame(it.t, { samples: 1 });
      const img = new Image();
      img.src = api.png();
      await img.decode();
      c.drawImage(img, pad * 2 + cellW, y + label, cellW, cellH);
      c.fillStyle = '#ddd'; c.font = '13px monospace';
      c.fillText(`t=${it.t.toFixed(3)}s   max ${it.max}  mean ${it.mean.toFixed(3)}  >16 ${(it.over16 * 100).toFixed(3)}%`, pad, y + 14);
      c.fillStyle = '#888';
      c.fillText('基线（改动前）', pad + 2, y + label + cellH + 13);
      c.fillText('现在（改动后）', pad * 2 + cellW + 2, y + label + cellH + 13);
    }
    return cv.toDataURL('image/png');
  }, {
    items: rows.map((c) => ({
      t: c.t, b64: c.buf.toString('base64'),
      max: c.stats.max, mean: c.stats.mean, over16: c.stats.over16,
    })),
    W, H, rows: rows.length,
  });
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
  return out;
}

/**
 * 「画面算不算变了」的判据。
 *
 * 为什么不能要求完全相等：GPU 在少数 tile 上的导数/滤波有最后一位噪声，
 * 交叠到 90% 的转场帧会把它放大。实测 demo 的 t=10/t=12 拿**同一份基线**反复重渲，
 * 稳定得到 max 8–10、mean ≤ 0.0001、差过 8 的像素占比 0%。这属于同一张画面。
 *
 * 判据（>16 一个都不许有 + mean 可忽略）：16/255 在 8bit 显示空间里已经是能看出来的
 * 台阶了，而实测噪声天花板是 10 —— 中间留了一档余量。真正的可见变化（元素错位、
 * 颜色整体偏、少画东西、拼错块）会以远大于 16 的幅度、成千上万个像素同时打破它。
 */
function negligible(r) {
  return r.over16 === 0 && r.mean < 0.002;
}

/** 相邻帧像素 delta（回绕到 255 以内）。 */
function deltaEncode(prev, cur) {
  if (!prev || prev.length !== cur.length) return cur;
  const out = Buffer.allocUnsafe(cur.length);
  for (let i = 0; i < cur.length; i++) out[i] = (cur[i] - prev[i]) & 0xff;
  return out;
}

function deltaDecode(prev, delta, bytes) {
  if (!prev) return Buffer.from(delta);
  const out = Buffer.allocUnsafe(bytes || prev.length);
  for (let i = 0; i < out.length; i++) out[i] = (prev[i] + delta[i]) & 0xff;
  return out;
}

/* ------------------------------------------------------------------ 命令：probe */

/**
 * 按给定顺序渲染一串时刻，看**渲染顺序会不会改变画面**。
 *
 *   node scripts/anim.mjs probe demo --times 4,12
 *
 * 这正是「同一 t 是 t 的纯函数」这条地基的机械检查：正向、反向各渲一遍，
 * 每个 t 两次的指纹必须一样。不一样就说明引擎里藏了跨帧状态（渲染目标的残留、
 * 惰性编译、缓冲没清），而那类问题在成片里表现为"某一帧颜色莫名差一点"。
 */
async function cmdProbe() {
  const task = pickTask();
  const times = (opt('times', opt('t', '0,4,12')) ?? '').split(',').map(Number).filter(Number.isFinite);
  if (!times.length) die('--times 需要给时间，例如 --times 0,4,12');
  await openSession({ task, scale: Number(opt('scale', '0')) || undefined, only: opt('only', undefined) });
  try {
    const seqs = flag('once') ? [times] : [times, [...times].reverse()];
    const rows = [];
    for (const seq of seqs) {
      const r = await session.page.evaluate((tt) => /** @type {any} */ (window).__anim.probe(tt), seq);
      rows.push({ seq, r });
      log(`顺序 ${seq.join(',')}`);
      for (const x of r) log(`  t=${x.t.toFixed(3)}  ${x.hash}  mean ${x.mean.toFixed(4)}  max ${x.max.toFixed(3)}`);
    }
    if (rows.length === 2) {
      const [a, b] = rows;
      let bad = 0;
      log('\n两次对比（同一 t 必须一致）：');
      for (let i = 0; i < times.length; i++) {
        const x = a.r[i], y = b.r[times.length - 1 - i];
        const same = x.hash === y.hash;
        if (!same) bad++;
        log(`  t=${x.t.toFixed(3)}  ${same ? '✓ 一致' : `✗ 不一致  ${x.hash} vs ${y.hash}`}`);
      }
      if (bad) {
        warn(`\n✗ 有 ${bad} 个时刻在两种渲染顺序下不一致 —— 引擎里有跨帧状态（见 docs/history/IMPROVEMENTS-1-3.md 第二轮 P1-2「同一时刻、从不同起点开渲结果不同」）`);
        process.exitCode = 1;
      } else log('\n✓ 渲染顺序不影响结果（同一 t 是纯函数）');
    }
  } finally { await closeSession(); }
}

/* ------------------------------------------------------------------ 命令：determinism */

/**
 * **P1-2 定位实验**：同一时刻，为什么"逐帧顺着渲"与"直接 seek 过去渲"不一样？
 *
 * 背景（`docs/history/IMPROVEMENTS-1-3.md` P1-2）：把成片抽帧和 `still` 重渲比对，同一个 t
 * 长期只能部分通过。beast 那轮的实测是：从 85s 起渲到 112s 的窗口 vs 从 110s 起渲
 * 同一窗口 → 34.8 dB；从 105s 起（预热 5 秒）→ 33.2 dB。也就是说
 * **"每帧是 t 的纯函数"这句话在像素层面只在同一个渲染序列内成立**。
 *
 * 这个命令把"序列"这件事显式化，用同一条会话测三组：
 *   A) 顺着 0,1,2,…,N-1 逐帧渲（= 出片那条路）
 *   B) 倒着 N-1,…,1,0 逐帧渲（= 另一个序列）
 *   C) 只在最末尾 seek 一次到 N-1（= `still` 那条路）
 * 然后对比「同一 t 在 A/B/C 里的指纹」，并**打印引擎内部所有可能与上一帧有关的量**
 * （子帧数、采样误差、post 参数、音频特征、池子复用），逐帧找第一个分叉点。
 *
 *   node scripts/anim.mjs determinism <任务> --from 0 --frames 40
 *   node scripts/anim.mjs determinism beast --from 100 --frames 40
 */
async function cmdDeterminism() {
  const task = pickTask();
  const from = Number(opt('from', '0'));
  const n = Math.max(2, Number(opt('frames', '40')));
  const samples = opt('samples', '1');
  const shutter = Number(opt('shutter', '0.5'));
  await openSession({ task, only: opt('only', undefined) });
  try {
    const r = await session.page.evaluate(async ({ from, n, samples, shutter }) => {
      const api = /** @type {any} */ (window).__anim;
      const times = Array.from({ length: n }, (_, i) => from + i / 60);
      /**
       * 一帧的指纹 + 所有"可能跨帧"的内部量。
       * 指纹用每 16 像素取一个的粗哈希（对 1 LSB 噪声宽容，但真变了会露出来）。
       */
      const measure = async (t) => {
        const e = window.__animEngine;
        await api.frame(t, { samples: samples === 'auto' ? 'auto' : Number(samples), shutter });
        const px = e.readPixels();
        let h = 0x811c9dc5, sum = 0, cnt = 0;
        for (let i = 0; i < px.length; i += 64) {
          h = Math.imul(h ^ px[i], 16777619) >>> 0;
          sum += px[i]; cnt++;
        }
        const a = e.music?.at ? e.music.at(t) : {};
        return {
          t,
          hash: (h >>> 0).toString(16).padStart(8, '0'),
          mean: sum / cnt,
          samples: e.lastSamples,
          lastErrors: (e.lastErrors ?? []).map((x) => +x.toFixed(4)),
          post: {
            bloom: e.lastPost?.bloom, grain: e.lastPost?.grain,
            vignette: e.lastPost?.vignette, zoom: e.lastPost?.zoom,
            shake: e.lastPost?.shake,
          },
          a: { rms: a.rms, kick: a.kick, beat: a.beat },
        };
      };
      const forward = [];
      for (const t of times) forward.push(await measure(t));
      const backward = [];
      for (let i = times.length - 1; i >= 0; i--) backward.push(await measure(times[i]));
      backward.reverse();
      // C) 只 seek 一次到最后一帧（模拟 still 那条路：会话里没有前面的帧）
      const seekOnly = [await measure(times[times.length - 1])];
      return { times, forward, backward, seekOnly };
    }, { from, n, samples, shutter });

    const show = (row) => `  t=${row.t.toFixed(4)}  ${row.hash}  mean ${row.mean.toFixed(4)}`
      + `  子帧 ${row.samples}  err [${row.lastErrors.join(' ')}]`
      + `  post ${JSON.stringify(row.post)}  a ${JSON.stringify(row.a)}`;

    const cmp = (name, A, B) => {
      let bad = 0, firstBad = -1;
      for (let i = 0; i < A.length; i++) {
        const same = A[i].hash === B[i].hash;
        if (!same) { bad++; if (firstBad < 0) firstBad = i; }
      }
      log(`\n${name}：${A.length - bad}/${A.length} 一致${bad ? `，第一个分叉在第 ${firstBad} 帧（t=${A[firstBad].t.toFixed(4)}）` : ''}`);
      if (bad) {
        const i = firstBad;
        log('  顺向 : ' + show(A[i]));
        log('  反向 : ' + show(B[i]));
        const d = (k, x, y) => {
          const va = x[k], vb = y[k];
          if (JSON.stringify(va) === JSON.stringify(vb)) return;
          log(`    ⚠ ${k} 不同：${JSON.stringify(va)} vs ${JSON.stringify(vb)}`);
        };
        for (const k of ['samples', 'lastErrors', 'post', 'a', 'mean']) d(k, A[i], B[i]);
      }
      return bad;
    };

    log(`确定性实验  ${task}  从 ${from}s 起 ${n} 帧  samples=${samples}  shutter=${shutter}`);
    log('A/B = 顺着 / 倒着逐帧渲同一串时刻；C = 只 seek 一次到最后一帧\n');
    log('顺向：');
    for (const row of r.forward.slice(0, 6)) log(show(row));
    if (n > 6) log(`  …（共 ${n} 帧）`);

    let bad = 0;
    bad += cmp('A 顺向 vs B 反向（同一串时刻，不同顺序）', r.forward, r.backward);
    bad += cmp(
      'B 反向 vs C 只 seek 一帧（末尾那一帧）',
      [r.backward[r.backward.length - 1]],
      r.seekOnly,
    );

    if (!bad) log('\n✓ 这一串时刻在三种序列下逐像素一致（这批帧没有跨帧依赖）');
    else {
      warn('\n✗ 存在跨帧依赖 —— 见上面"⚠ … 不同"的那几行：那就是根因所在。');
      process.exitCode = 1;
    }
  } finally { await closeSession(); }
}

/* ------------------------------------------------------------------ 命令：dumpframe */

/**
 * 把某一帧的原始 RGBA 落盘（浏览器那条路），给"两条渲染路径到底哪里不同"做对照。
 *
 *   node scripts/anim.mjs dumpframe beat -t 0.508333 --samples 2
 *   node scripts/anim.mjs dumpframe beat -t 0.508333 --samples 2 --run-up   # 先顺着渲 0..N
 *
 * `--run-up` 是关键对照：`stream()` 是顺着 0,1,2,… 渲的，而 `still`/`framePixels`
 * 是**直接 seek** 到那一帧渲的。如果只有"顺着渲"才和成片对得上，那根因就是渲染历史。
 */
async function cmdDumpFrame() {
  const task = pickTask();
  const times = (opt('t', opt('times', '0')) ?? '0').split(',').map(Number).filter(Number.isFinite);
  const samples = opt('samples', '1');
  const runUp = flag('run-up');
  const outDir = path.resolve(ROOT, opt('out', taskOut(task, '_dumpframe')));
  mkdirSync(outDir, { recursive: true });
  await openSession({ task, only: opt('only', undefined), scale: Number(opt('scale', '0')) || undefined });
  try {
    const meta = await session.page.evaluate(async ({ times, samples, shutter, runUp, via }) => {
      const api = /** @type {any} */ (window).__anim;
      const e = /** @type {any} */ (window).__animEngine;
      const rows = [];
      for (const t of times) {
        if (runUp) {
          // 顺着渲到这一帧（与 stream() 的渲染历史一致）
          for (let k = 0; k * (1 / 60) < t - 1e-9; k++) {
            await api.frame(k / 60, { samples: samples === 'auto' ? 'auto' : Number(samples), shutter });
          }
        }
        let used;
        if (via === 'render') {
          // 完全照 stream() 的方式调引擎（同一个会话里就能和 api.frame 逐像素对比）
          const r = e.render(t, {
            samples: samples === 'auto' ? 'auto' : Number(samples),
            shutter, toScreen: false, seeked: true,
          });
          used = r.samples;
        } else {
          const r = await api.frame(t, { samples: samples === 'auto' ? 'auto' : Number(samples), shutter });
          used = r.samples;
        }
        const px = e.readPixels();
        let s = '';
        const CH = 0x8000;
        for (let i = 0; i < px.length; i += CH) s += String.fromCharCode.apply(null, px.subarray(i, i + CH));
        rows.push({
          t, samples: used, b64: btoa(s),
          engine: {
            hud: e.hud, fps: e.fps, scale: e.gl.scale, w: e.gl.w, h: e.gl.h, pw: e.gl.pw, ph: e.gl.ph,
            lastSamples: e.lastSamples, lastPost: e.lastPost,
            lastT: e.lastT, duration: e.duration,
            renderer: e.gl.renderer,
            idAt: e.timeline.filter((i) => t >= i.start && t < i.end).map((i) => i.id),
          },
        });
      }
      return rows;
    }, { times, samples, shutter: Number(opt('shutter', '0.5')), runUp, via: opt('via', 'frame') });
    for (const row of meta) {
      const f = path.join(outDir, `t${row.t.toFixed(6)}.rgba`);
      writeFileSync(f, Buffer.from(row.b64, 'base64'));
      log(`t=${row.t}  子帧 ${row.samples}  ${path.relative(ROOT, f)}`);
      log(`  ${JSON.stringify(row.engine)}`);
    }
  } finally { await closeSession(); }
}

/* ------------------------------------------------------------------ 命令：dumpframes */

/**
 * 顺着渲一串帧并把每帧的原始 RGBA 落盘 —— 与 `video --keep-raw` 做逐帧对照用。
 *
 *   node scripts/anim.mjs dumpframes beat --from 0 --to 1 --samples 2 --out out/beat/_frames
 *   node tools/probe-frame-drift.mjs out/beat/_raw.rgba out/beat/_frames
 */
async function cmdDumpFrames() {
  const task = pickTask();
  const from = Number(opt('from', '0'));
  const to = Number(opt('to', '1'));
  const fps = Number(opt('fps', '60'));
  const samples = opt('samples', '1');
  const outDir = path.resolve(ROOT, opt('out', taskOut(task, '_frames')));
  mkdirSync(outDir, { recursive: true });
  const n = Math.max(1, Math.round((to - from) * fps));
  await openSession({ task, only: opt('only', undefined), scale: Number(opt('scale', '0')) || undefined });
  try {
    log(`顺着渲 ${from}→${to}s 共 ${n} 帧，samples=${samples} → ${path.relative(ROOT, outDir)}`);
    /**
     * ⚠ 必须**分批** evaluate：一帧 1080p 的 base64 是 ~11 MB 字符串，
     * 一次把 60 帧（≈660 MB）从页面里送回来会撞上 Node 的字符串上限
     * （`ERR_STRING_TOO_LONG: Cannot create a string longer than 0x1fffffe8 characters`）。
     * 分成每批 4 帧既安全又快 —— 渲染本身在页面里顺序进行，分批不影响渲染历史。
     */
    const BATCH = 4;
    let done = 0;
    for (let i = 0; i < n; i += BATCH) {
      const chunk = await session.page.evaluate(async ({ from, fps, samples, shutter, i0, count }) => {
        const api = /** @type {any} */ (window).__anim;
        const e = /** @type {any} */ (window).__animEngine;
        const out = [];
        for (let k = 0; k < count; k++) {
          const t = from + (i0 + k) / fps;
          const r = await api.frame(t, { samples: samples === 'auto' ? 'auto' : Number(samples), shutter });
          const px = e.readPixels();
          let s = '';
          const CH = 0x8000;
          for (let j = 0; j < px.length; j += CH) s += String.fromCharCode.apply(null, px.subarray(j, j + CH));
          out.push({ t, samples: r.samples, b64: btoa(s) });
        }
        return out;
      }, { from, fps, samples, shutter: Number(opt('shutter', '0.5')), i0: i, count: Math.min(BATCH, n - i) });
      for (const row of chunk) {
        writeFileSync(path.join(outDir, `t${row.t.toFixed(6)}.rgba`), Buffer.from(row.b64, 'base64'));
        done++;
      }
      process.stdout.write(`\r  ${done}/${n} 帧`);
    }
    process.stdout.write('\n');
    log(`✓ ${done} 帧 → ${path.relative(ROOT, outDir)}`);
  } finally { await closeSession(); }
}

/* ------------------------------------------------------------------ 命令：probe-alpha */

/**
 * P1-3 验收：`type.write` 的 `alpha` 在 `stagger: 0` 时也要参与动画。
 *
 * 判据是机械的：一行字 `alpha: [0, 1]`、`t = f.lt`，在 t=0 / 0.5 / 1 量整帧平均亮度，
 * 必须 0 < 0.5 < 1 地递增（而不是 t=0 就已经是终值）。
 * 修复前 t=0 与 t=1 一样亮 —— 也就是"整行淡入"从来没生效过。
 */
async function cmdProbeAlpha() {
  const task = pickTask();
  await openSession({ task, offline: false });
  try {
    const r = await session.page.evaluate(async () => {
      const { Engine } = await import('/src/core/engine.js');
      const { makePalette } = await import('/src/core/palette.js');
      const { css } = await import('/src/core/util.js');

      const cv = document.createElement('canvas');
      cv.style.cssText = 'position:fixed;left:-10000px;top:0';
      document.body.appendChild(cv);
      const eng = new Engine(cv, { width: 960, height: 540, scale: 1, fps: 60, palette: makePalette({}) });
      eng.hud = false;

      const scene = {
        id: 'alpha_probe',
        render(ctx) {
          const { gl, text, type, P, f } = ctx;
          gl.clear(ctx.out, [0.01, 0.01, 0.012]);
          text.clear();
          // stagger 刻意不写（= 0）：这正是出问题的那条路径
          type.write('ALPHA', 480, 300, {
            size: 220, weight: 900, family: 'sans', align: 'left',
            color: css(P.bone), alpha: [0, 1], t: f.lt, staggerDur: 1,
          });
          text.upload();
          ctx.comp.draw(gl, text, ctx.out, { premult: false });
          // 关掉会污染"平均亮度"的后处理（泛光/颗粒），让读数只反映字
          return { bloom: 0, bloomThreshold: 9, halation: 0, grain: 0, vignette: 0, ca: 0, flash: 0, fade: 0, exposure: 1 };
        },
      };
      await eng.load({ timeline: [{ id: 'a', scene, start: 0, end: 4, params: {} }], duration: 4 });
      const out = [];
      for (const t of [0, 0.5, 1, 2]) {
        eng.render(t, { samples: 1, toScreen: false });
        const px = eng.readPixels();
        let sum = 0;
        for (let i = 0; i < px.length; i += 4) {
          sum += (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) / 255;
        }
        out.push({ t, mean: sum / (px.length / 4) });
      }
      // 参考帧：同样一条时间线、**同样的 post**，但场景一笔不画。
      // ⚠ post 必须与下面各用例逐项一致：`meanOf` 是"减去参考"，而暗角/泛光/颗粒
      //   会把同一个线性值映射成不同的显示亮度。第一版这里用了默认 post，
      //   于是参考值偏大，`alpha:0.5` 与"静默帧"都被算成了负数（假的 FAIL）。
      //
      // ⚠⚠ 还有一条**必须踩对**的：canvas 不能是 `display:none` 那种被隐藏的尺寸，
      //   而且每一段用例必须**重新 load**（换 timeline）—— 见下面 narrScene 那段注释。
      const SENTINEL = [0.01, 0.01, 0.012];
      /** 关掉所有会污染"平均亮度"读数的后处理，让读数只反映场景画了什么。 */
      const POST_OFF = {
        bloom: 0, bloomThreshold: 9, halation: 0, grain: 0, vignette: 0,
        ca: 0, flash: 0, fade: 0, exposure: 1, contrast: 1, saturation: 1, lift: 0, shoulder: 1000,
      };
      const sceneEmpty = { id: 'empty', render(c) { c.gl.clear(c.out, SENTINEL); return { ...POST_OFF }; } };
      await eng.load({ timeline: [{ id: 'e', scene: sceneEmpty, start: 0, end: 4, params: {} }], duration: 4 });
      eng.render(0, { samples: 1, toScreen: false });
      const px0 = eng.readPixels();
      let s0 = 0, mx0 = 0;
      for (let i = 0; i < px0.length; i += 4) {
        const lum = (px0[i] * 0.2126 + px0[i + 1] * 0.7152 + px0[i + 2] * 0.0722) / 255;
        s0 += lum; if (lum > mx0) mx0 = lum;
      }
      const blank = s0 / (px0.length / 4);
      // ⚠ 光看 mean 分不清"空参考帧"和"错帧卡片"（错帧卡片也会有一个中等偏亮的 mean）。
      //   把 max 也量出来：只 clear 一个暗色时 max ≈ 0.10，而错帧卡片有亮红边框 → max ≈ 0.9。
      //
      // ⚠⚠ 这个数是 **0.10 不是 0.06**（BACKLOG 1-5 核正过，2026-10-16）：`readPixels()` 读的是
      //   **sRGB 编码之后**的显示空间值，而 SENTINEL 那个 0.01 是**线性**值 ——
      //   `lin2srgb(0.01) ≈ 0.1005`。0.06 是拿线性值当显示值算出来的（旧注释写错了口径）。
      //   **别照着它去"修" blank**：把 0.10 掰成 0.06 会让 ⑤⑥ 两条判据集体失真。
      //   相对判据（下面的 `meanOf()` 减参考）本来就不受这个口径影响。
      const blankMax = mx0;
      void SENTINEL;
      // 参考帧的 post 到底是什么？判据依赖"用例与参考用同一套 post"，
      // 而 post 是**逐帧**由场景返回值和 `item.post` 合并出来的 —— 直接把它读出来核对。
      const blankPost = { ...eng.lastPost, tint: '(略)', center: '(略)' };

      /**
       * P0-1 用例：**数值型 alpha**（常量不透明度）。
       * 以前 `opts.alpha !== undefined` 被当成"要按 t 动画" → `t` 缺省 0 ⇒ `k = 0`
       * ⇒ 字形直接 `continue`（整个不画），而不是画成透明。
       * 判据：alpha 是多少就该有多亮，而且**与 t 无关**。
       */
      const meanOf = (px) => {
        let s = 0;
        for (let i = 0; i < px.length; i += 4) s += (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) / 255;
        return s / (px.length / 4) - blank;
      };
      const constScene = (alpha) => ({
        id: 'const_alpha',
        render(c) {
          const { gl, text, type, P } = c;
          gl.clear(c.out, [0.01, 0.01, 0.012]);
          text.clear();
          // ⚠ 刻意不传 t、不传 stagger：这正是踩坑的那条路径
          type.write('ALPHA', 480, 300, {
            size: 220, weight: 900, family: 'sans', align: 'left',
            color: css(P.bone), alpha,
          });
          text.upload();
          c.comp.draw(gl, text, c.out, { premult: false });
          return { ...POST_OFF };
        },
      });
      const constAlpha = {};
      const constPost = {};
      for (const a of [1, 0.5]) {
        await eng.load({ timeline: [{ id: 'c', scene: constScene(a), start: 0, end: 4, params: {} }], duration: 4 });
        const vals = [];
        for (const t of [0, 2]) {
          eng.render(t, { samples: 1, toScreen: false });
          vals.push(meanOf(eng.readPixels()));
        }
        constAlpha[a] = vals;
        constPost[a] = { ...eng.lastPost, tint: '(略)', center: '(略)' };
      }

      /**
       * P1-5 用例：**旁白表真的进了引擎**吗？
       *
       * 单测（`tools/test-narration.mjs`）只验了 `makeNarration` 这些纯函数；
       * 这里验的是"接线"：`load({ narration })` → `ctx.narration` / `f.narration` → 场景里能查到。
       *
       * 判据刻意**用逻辑而不是像素**：像素受后处理/误差影响太大，
       * 而这一条要回答的只是"场景能不能拿到旁白表"。所以场景自己把查到的句子 id
       * **画成一个白点**（画在固定位置），再用"有没有白点"当布尔量 ——
       * 同时顺手证明"旁白表能驱动画面"这件事本身是通的。
       */
      const narrScene = {
        id: 'narr',
        render(c) {
          c.gl.clear(c.out, [0.01, 0.01, 0.012]);
          const q = c.narration?.at(c.f.t) ?? c.f.narration?.at(c.f.t);
          if (q) {
            // 一个 40×40 的纯白方块：在只有 0.01 灰底的画面上，它是"有没有"的布尔量
            c.lines.begin();
            c.lines.fillRect(400, 240, 40, 40, [1, 1, 1, 1]);
            c.lines.flush(c.out);
          }
          return { ...POST_OFF };
        },
      };
      const narrSpec = {
        lines: [
          { id: 'n1', text: '第一句旁白', start: 0.5, dur: 1.5 },
          { id: 'n2', text: '第二句旁白', start: 2.5, dur: 1.0 },
        ],
      };
      await eng.load({ timeline: [{ id: 'n', scene: narrScene, start: 0, end: 4, params: {} }], duration: 4, narration: narrSpec });
      const narr = {};
      for (const [key, t] of [['a', 0.2], ['b', 1.25], ['c', 3.5]]) {
        eng.render(t, { samples: 1, toScreen: false });
        const q = eng.narration?.at(t);
        // 峰值亮度：白方块在 → 明显高；不在 → 只有底色
        let mx = 0;
        const px = eng.readPixels();
        for (let i = 0; i < px.length; i += 4) {
          const lum = (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) / 255;
          if (lum > mx) mx = lum;
        }
        narr[key] = {
          peak: mx,
          id: q?.id ?? null,
          p: q?.p ?? null,
          typed: q?.typedText ?? null,
          lineCount: eng.narration?.lines?.length ?? 0,
          warnings: eng.narration?.warnings?.length ?? -1,
          durOf: eng.narration?.durOf?.('n1') ?? null,
        };
      }
      eng.dispose();
      cv.remove();
      // 把**没减过参考**的原始读数一起带回来：判据出问题时能一眼看出是"参考帧"还是"用例"的问题
      return {
        frames: out, blank, blankMax, constAlpha, narr,
        raw: { blank, c1: constAlpha[1][0] + blank, ch: constAlpha[0.5][0] + blank },
        posts: { blank: blankPost, c1: constPost[1], ch: constPost[0.5] },
      };
    });

    log(`参考（只有背景、没有字）：mean ${r.blank.toFixed(5)}  max ${r.blankMax?.toFixed(4)}`
      // ⚠ 0.10 而不是 0.06：readPixels 是 sRGB 编码后的显示空间，lin2srgb(0.01) ≈ 0.1005（BACKLOG 1-5）
      + `（只 clear 一个暗色时 max 应 ≈0.10；≈0.9 说明画的是**错帧卡片**而不是空参考）`);
    log('一行字 alpha:[0,1]、stagger:0（不写）—— 减去参考后的平均亮度：');
    const r2 = r.frames.map((x) => ({ t: x.t, mean: x.mean - r.blank }));
    for (const x of r2) log(`  t=${x.t.toFixed(2)}  mean ${x.mean.toFixed(5)}`);
    const [a, b, c, d] = r2.map((x) => x.mean);
    const c1 = a < 0.004;                 // ① t=0 几乎看不见
    const c2 = b > a + 0.003;             // ② 0.5 明显亮于 0
    const c3 = c > b + 0.001;             // ③ 1 明显亮于 0.5
    const c4 = Math.abs(d - c) < 0.001;   // 到 1 之后就不再变（到位了）
    log(`\n① t=0 不可见（mean ${a.toFixed(5)} < 0.004）  → ${c1 ? 'PASS' : 'FAIL'}`);
    log(`② t=0.5 在淡入（${b.toFixed(5)} > ${a.toFixed(5)} + 0.003）  → ${c2 ? 'PASS' : 'FAIL'}`);
    log(`③ t=1 更亮（${c.toFixed(5)} > ${b.toFixed(5)} + 0.001）  → ${c3 ? 'PASS' : 'FAIL'}`);
    log(`④ t≥1 不再变（|${d.toFixed(5)} − ${c.toFixed(5)}| < 0.001）  → ${c4 ? 'PASS' : 'FAIL'}`);

    // ⑤⑥ P0-1：数值型 alpha 是**常量**不透明度 —— 必须画得出来，且与 t 无关
    const full = r.constAlpha?.[1] ?? null;
    const half = r.constAlpha?.[0.5] ?? null;
    let c5 = false, c6 = false;
    if (full && half) {
      const [f0, f2] = full, [h0, h2] = half;
      c5 = f0 > 0.004 && f2 > 0.004;                       // alpha:1 在 t=0 与 t=2 都画出来了
      c6 = Math.abs(f0 - f2) < 0.0008                      // 常量：两帧一样亮
        && h0 > 0.001 && h0 < f0 * 0.95;                   // alpha:0.5 明显比 1 淡（但没有消失）
      log(`⑤ alpha:1（数值）画得出来（t=0 ${f0.toFixed(5)}、t=2 ${f2.toFixed(5)} > 0.004）  → ${c5 ? 'PASS' : 'FAIL'}`);
      log(`⑥ alpha:0.5 是半透明常量（${h0.toFixed(5)} 在 (0.001, ${(f0 * 0.95).toFixed(5)}) 且 t=2 同值 ${h2.toFixed(5)}）  → ${c6 ? 'PASS' : 'FAIL'}`);
    } else {
      log('⑤⑥ 数值型 alpha 用例没有拿到读数  → FAIL');
    }
    // ⑦⑧⑨ P1-5：旁白表有没有真的接进引擎
    //
    // 判据分两层，**不依赖"参考帧减去"那套**（那是给 alpha 用的，跨场景比较会带上后处理差异）：
    //   · 逻辑层：`ctx.narration` 能查到正确的句子 / 进度 / 时长（这是接线本身）；
    //   · 像素层：场景按旁白表画了白方块 —— **在说话的那一帧一定能看到纯白**（peak ≈ 1.0）。
    //     ⚠ 只断言"看得到"这一侧就够了：`at()` 已经证明"静默帧查不到"（n35.id === null），
    //       而"没在说话就不画"是同一行代码的同一条分支，不需要再用像素验第二遍。
    const nr = r.narr ?? {};
    const n02 = nr.a, n125 = nr.b, n35 = nr.c;
    let c7 = false, c8 = false, c9 = false;
    if (n02 && n125 && n35) {
      c7 = n02.lineCount === 2 && n125.lineCount === 2
        // ⚠ t=0.2 在第一句（start=0.5）**之前** → 必须是 null。
        //   这一条正好覆盖"句子之间/之前不算在说"这个边界。
        && n02.id === null && n125.id === 'n1' && n35.id === null
        && n02.durOf === 1.5 && n125.durOf === 1.5;
      c8 = n125.p !== null && Math.abs(n125.p - 0.5) < 0.02 && n125.typed === '第一';
      // 在说 → 画面里有纯白方块；静默 → 只有底色（peak 就是底色的亮度）
      c9 = n125.peak > 0.9 && n35.peak < 0.5;
      log(`⑦ 旁白表进了引擎：lines=${n02.lineCount}  durOf('n1')=${n02.durOf}s  `
        + `t=0.2 → ${n02.id ?? 'null'}（第一句之前）、t=1.25 → ${n125.id}、t=3.5 → ${n35.id ?? 'null'}（静默）  → ${c7 ? 'PASS' : 'FAIL'}`);
      log(`⑧ 进度正确：t=1.25 的 p=${n125.p?.toFixed(3)}（期望 ≈0.5），typedText="${n125.typed}"  → ${c8 ? 'PASS' : 'FAIL'}`);
      log(`⑨ 旁白能驱动画面：在说那一帧峰值 ${n125.peak.toFixed(4)}（纯白方块），静默帧 ${n35.peak.toFixed(4)}  → ${c9 ? 'PASS' : 'FAIL'}`);
    } else {
      log(`⑦⑧⑨ 旁白用例没有拿到读数（${JSON.stringify(nr)}）  → FAIL`);
    }

    if (!(c1 && c2 && c3 && c4)) {
      warn('\n✗ alpha 没有随 t 动画 —— 检查 src/core/text.js 里 `k` 的计算条件');
      process.exitCode = 1;
    }
    if (!(c5 && c6)) {
      warn('\n✗ 数值型 alpha 语义不对（docs/history/IMPROVEMENTS-1-3.md P0-1）—— 它必须是常量不透明度，');
      warn('  且 alpha:1 必须画得出来。检查 text.js 里 `alphaIsRamp` / `constAlpha` 两行。');
      process.exitCode = 1;
    }
    if (!(c7 && c8 && c9)) {
      warn('\n✗ 旁白层接线有问题（docs/history/IMPROVEMENTS-1-3.md P1-5）—— 检查 engine.load 有没有收到 narration、');
      warn('  _ctxFor 有没有把 this.narration 挂到 ctx 与 f 上。');
      process.exitCode = 1;
    }
    if (c1 && c2 && c3 && c4 && c5 && c6 && c7 && c8 && c9) {
      log('\n✓ alpha 语义全对（数组型随 t 动画 P1-3、数值型是常量 P0-1）+ 旁白层已接通（P1-5）');
    }
  } finally { await closeSession(); }
}

/* ------------------------------------------------------------------ 命令：verify */

/**
 * 成片验收：把 mp4 里的若干帧抽出来，与**同一时刻重新渲染的那一帧**逐像素比。
 *
 * 为什么这条判据成立且很强：渲染是 t 的纯函数，`still` 与成片走同一条代码路径，
 * 所以「成片第 N 帧」必须等于「t = (N+0.5)/fps 处渲染的那一帧」。一次比对同时抓住：
 *   · 分段拼接错位（某块接错了位置 → 整帧都对不上）
 *   · 帧数不对 / 有丢帧（抽到的帧其实是别的时间）
 *   · 色彩空间不一致（整体偏暗/偏亮 → mean 明显抬手）
 *   · ffmpeg 与浏览器两条路不一致
 *
 * 什么时候抽帧：默认抽**每个段边界前后**（切点最容易被拼错）+ 每段中点。
 * 有音频的成片比画面短一点，所以边界取 ±1 帧、并跳过超出时长的时刻。
 *
 *   node scripts/anim.mjs verify demo
 *   node scripts/anim.mjs verify fidus --times 1,30,59
 *   node scripts/anim.mjs verify demo --file out/demo/shot_0-3.mp4
 */
async function cmdVerify() {
  const task = pickTask();
  const file = path.resolve(ROOT, opt('file', opt('o', taskOut(task, `${task}.mp4`))));
  if (!existsSync(file)) die(`没有找到成片 ${path.relative(ROOT, file)}。先跑 video，或用 --file 指定。`);

  const p = await probeVideo(file, { count: false });
  if (!p.ok) die(`这个成片本身就有问题，先修它：\n${p.reasons.map((r) => '  · ' + r).join('\n')}`);
  const fps = Number(opt('fps', String(p.fps || 0))) || 60;
  const duration = p.duration ?? 0;
  log(`验收 ${path.relative(ROOT, file)}  ${p.width}×${p.height} @${fps}fps  ${duration.toFixed(3)}s  ${p.frames ?? '?'} 帧`);

  const explicit = opt('times', '');
  const verifySamples = opt('samples', '1');
  /**
   * 成片覆盖的是**任务时间轴上的哪一段**。默认 0 = 从片头渲的完整成片；
   * `--from` 配合 `video --from/--to` 出来的片段用（那种片段的第 N 帧对应任务时间
   * `from + N/fps`，不再是 `N/fps`）。
   */
  const clipFrom = Number(opt('from', '0'));
  const clipFrames = p.frames ?? Math.round(duration * fps);
  const clipTo = clipFrom + clipFrames / fps;
  let times;
  if (explicit) {
    times = explicit.split(',').map(Number).filter(Number.isFinite);
  } else {
    await openSession({ task, scale: Number(opt('scale', '0')) || undefined, only: opt('only', undefined) });
    const items = session.info.timeline;
    const set = new Set();
    /**
     * 探针时刻要抬到**帧内**（`docs/history/IMPROVEMENTS-1-3.md` P1-3 的第 3 条）。
     *
     * 原来的默认探针里有 `it.start - 1/fps`（切点前一帧）—— 那正好落在**帧边界**上。
     * 而"帧边界"这个时刻本身是有歧义的：引擎算帧号用 `floor(t*fps + 1e-6)`，
     * 浮点误差会让它掉到前一帧去（`t=6.133333` → 367 而不是 368），
     * 于是抽到的帧和重渲的帧差了整整一帧，颗粒图案不同 → 误报 ✗。
     *
     * ⚠ 但"帧内"**不等于**"帧中心"：见下面 `refT` 的注释 ——
     *   成片是在每一帧的**起点** `N/fps` 渲染的，探针必须用同一个时刻，
     *   否则多子帧的运动模糊窗会差半帧（实测 mean 8.4，看着像"跨会话不确定"）。
     *
     * ⚠⚠ 还必须**钳在成片覆盖的区间里**。默认探针里原来有 `duration - 1/fps`，
     *   而 `video --to` 出来的片段往往比任务时长短 —— 那一帧根本不在成片里，
     *   `round(t*fps)` 又正好停在边界上会映射到**最后一帧**，于是拿"不存在的第 N 帧"
     *   去和"成片的第 N-1 帧"比，必然 ✗（demo 的 4 秒片段就这么误报过一次）。
     */
    const snap = (t) => (Math.floor(t * fps) + 0.25) / fps;
    const add = (t) => {
      if (t < clipFrom || t >= clipTo - 0.5 / fps) return;   // 不在成片里的一律跳过
      set.add(Math.round(snap(t) * 1e6) / 1e6);
    };
    for (const it of items) {
      add(it.start + 1 / fps);            // 切点后一帧（这里最容易错）
      add((it.start + it.end) / 2);       // 段中点
    }
    add(clipTo - 1.5 / fps);              // 成片的收尾一帧
    add(clipFrom + 0.5 / fps);            // 成片的开头一帧
    times = [...set].filter((t) => {
      // 二次保险：抽帧的帧号必须落在成片的帧数范围内
      const k = Math.round((t - clipFrom) * fps);
      return k >= 0 && k < clipFrames;
    }).sort((a, b) => a - b);
  }
  if (!times.length) die(`没有可验收的时刻（成片 ${clipFrames} 帧 / ${duration.toFixed(2)}s，时间线是空的？）`);

  // 会话可能已经开过（自动挑点时），也可能还没开
  const ownSession = !session;
  if (ownSession) await openSession({ task, scale: Number(opt('scale', 0)) || undefined, only: opt('only', undefined) });
  try {
    log(`比对 ${times.length} 个时刻（成片抽帧 vs 同 t 重新渲染，samples=${verifySamples}）：`);
    let bad = 0;
    for (const t of times) {
      // 成片里的帧号 = (t - from) * fps；抽帧与重渲都必须用这个时刻
      const local = t - clipFrom;
      const idx = Math.max(0, Math.round(local * fps));
      const refT = t;
      const r = await session.page.evaluate(
        ([tt, s]) => /** @type {any} */ (window).__anim.framePixels(tt, { samples: s === 'auto' ? 'auto' : Number(s) }),
        [refT, verifySamples],
      );
      const browser = Buffer.from(r.pixels, 'base64');
      const mp4 = await ffmpegFrame(file, local, p.width, p.height, fps);
      if (!mp4) { warn(`  t=${t.toFixed(3)}（成片第 ${idx} 帧） ← ffmpeg 抽帧失败`); bad++; continue; }
      const d = pixelDiff(browser, mp4);
      /**
       * 判据**可调、默认宽松**，并且把量到的数都打出来。
       *
       * 为什么不能写死一个紧阈值（这段是实测出来的，`docs/STATUS.md` §11.7）：
       * h264 是 yuv420p，色度**二次采样**。在"480 根 2px 细竖线"、密集网点这类
       * 高频画面上，编码损失能到 mean 7–8、>16 占 13–17% —— 那不是渲染错，
       * 是编码器的物理极限（实测同一帧的**原始字节**与成片抽帧逐字节相同，
       * 见 `tools/probe-determinism.mjs`）。紧阈值会在这种镜头上误报，
       * 而误报多了这个工具就没人信了。
       *
       * 反过来，真正的问题量级大得多，实测：
       *   · 正确匹配（含高频画面）：mean 1.4–7.0，>64 占 0.000–0.115%
       *   · 拿错成片：            mean 26.5、43.8，>64 成片出现
       *   · 帧号口径错（--from）： mean 7.7
       * 所以默认取 `mean < 18`，中间留着 2.5× 的余量；要更严用 `--tol 6`
       * （或 `--samples 1` —— 那条路上没有子帧近似，与成片逐字节相同）。
       */
      const limit = Number(opt('tol', '18'));
      const ok = d.mean < limit;
      if (!ok) bad++;
      log(`  第 ${String(idx).padStart(5)} 帧  t=${refT.toFixed(4)}  ${ok ? '✓ 一致' : '✗ 不一致'}`
        + `  max ${String(d.max).padStart(3)}  mean ${d.mean.toFixed(2).padStart(6)}`
        + `  >16 ${(d.over16 * 100).toFixed(3)}%  >64 ${(d.over64 * 100).toFixed(3)}%`
        + `  （判据 mean<${limit}）`);
    }
    if (bad) {
      warn(
        `\n✗ ${bad}/${times.length} 个时刻与成片不一致。最可能的原因：\n` +
        `  · 成片是旧版本渲染的（改了场景/引擎但没重渲）\n` +
        `  · 分段拼接错位（某一块接到了错误的位置）—— 删掉 out/${task}/*.parts 重渲\n` +
        `  · 成片不是 --samples 1 渲的（运动模糊的子帧数不同，画面本来就该不一样）：\n` +
        `    用同样的 --samples 重渲，或给 verify 传 --samples auto\n` +
        `  · 色彩空间不一致（整体偏亮/偏暗 → mean 明显变大；见 docs/ENGINE.md §2.3）\n` +
        `  · 跨会话不确定性（同一时刻从不同起点开渲差一点）—— 见 docs/PERF.md 与本文件 §11.9`,
      );
      process.exitCode = 1;
    } else log(`\n✓ ${times.length} 个时刻（按帧号对齐）全部与重新渲染的结果一致（成片可信）`);
  } finally { if (ownSession) await closeSession(); }
}

/* ------------------------------------------------------------------ 命令：qa */

/**
 * `anim qa <任务>` —— **成片级技术扫描**（BACKLOG 1-39），纯 ffmpeg：不起 Vite、不起 Chrome、不 import 引擎。
 *
 * 为什么需要它（`docs/REFERENCE-eac-design-world.md` §3）：
 * `check` 每段只采 15% / 50% / 85% 三个点，`rhythm` 是**重新渲染**再差分，`verify` 是若干时刻抽帧比像素 ——
 * 三条都在"渲染/重渲"这一侧，**没有一条读过编码后的文件的每一秒**。切点处 0.3s 的黑闪正好从三点采样之间漏过去。
 *
 * 与 `verify` 的分工（别混）：
 *   · `verify` = 成片 vs 同 t 重渲 → 证明**画面是这一版**（拼错位 / 色彩 / 旧产物）；
 *   · `qa`     = 文件自己的技术读数 → 证明**这份文件没有黑闪 / 冻结 / 静音**，且能解码。
 *
 * ⚠ 默认**只报读数**（warn 不改退出码），因为黑场和静帧都可能是设计如此：
 * 我们的 `outro` 结尾压黑、hold 段本来就不动。`--strict` 才把 warn 当失败。
 *
 * ```sh
 * node scripts/anim.mjs qa demo
 * node scripts/anim.mjs qa demo --strict --freeze 5      # 静帧超过 5s 才算问题
 * node scripts/anim.mjs qa demo --file out/demo/shot_0-3.mp4 --json
 * ```
 */
async function cmdQa() {
  const task = pickTask();
  const file = path.resolve(ROOT, opt('file', opt('o', taskOut(task, `${task}.mp4`))));
  if (!existsSync(file)) die(`没有找到成片 ${path.relative(ROOT, file)}。先跑 video，或用 --file 指定。`);
  const strict = flag('strict');
  const withDecode = !flag('no-decode');
  const head = Number(opt('head', '0.5'));
  const tail = Number(opt('tail', '1.2'));
  const maxFreeze = Number(opt('freeze', '3'));
  for (const [k, v] of Object.entries({ head, tail, maxFreeze })) {
    if (!Number.isFinite(v) || v < 0) die(`--${k === 'maxFreeze' ? 'freeze' : k} 要一个非负秒数（收到 ${JSON.stringify(v)}）`);
  }

  const { scanMediaFile, classifyMediaScan } = await import('./lib/media.mjs');
  const scan = scanMediaFile(file, { decode: withDecode });
  const verdict = classifyMediaScan(scan, { head, tail, maxFreeze });
  const frames = scan.fps ? Math.round(scan.duration * scan.fps) : null;

  if (flag('json')) {
    log(JSON.stringify({ scan, verdict, strict }, null, 2));
    process.exitCode = verdict.errors.length || (strict && verdict.warnings.length) ? 1 : 0;
    return;
  }

  log(`成片技术扫描 ${path.relative(ROOT, file)}  ${scan.width ?? '?'}×${scan.height ?? '?'} @${scan.fps ? scan.fps.toFixed(2) : '?'}fps`
    + `  ${scan.duration.toFixed(3)}s  ${frames ?? '?'} 帧`);
  const th = verdict.thresholds;
  log(`  判据：黑场 ≥${th.blackDur}s（pix_th 0.10）· 静帧 ≥${th.freezeDur}s（-50dB）`
    + ` · 片头 ${th.head}s / 片尾 ${th.tail}s 的黑算设计 · 静帧超过 ${th.maxFreeze}s 才警`);
  log('');

  const label = { error: '✗', warn: '⚠', info: '·' };
  for (const group of [verdict.errors, verdict.warnings, verdict.infos]) {
    for (const it of group) log(`  ${label[it.tier]} ${it.text}`);
  }
  if (!verdict.items.length) log('  ✓ 解码、黑场、静帧、音量四项都没有异常读数');

  log('');
  log(`结论：${verdict.errors.length ? '失败' : (strict && verdict.warnings.length ? '失败（--strict）' : '通过')}`
    + `（${verdict.errors.length} 错 / ${verdict.warnings.length} 警 / ${verdict.infos.length} 条读数`
    + (withDecode ? '' : '；--no-decode：解码这一条没验') + '）');
  if (verdict.warnings.length && !strict) log('  （警告默认不改退出码；要当门用加 --strict）');
  process.exitCode = verdict.errors.length || (strict && verdict.warnings.length) ? 1 : 0;
}

/**
 * 用 ffmpeg 从成片里取**第 N 帧**（N 由时刻算出来），输出 RGBA（翻成与浏览器 readPixels 一致的方向：自下而上）。
 *
 * 为什么按**帧号**取，而不是按时间（`docs/history/IMPROVEMENTS-1-3.md` P1-3）：
 *   旧实现用 `select='between(t, t±0.5/fps)'` —— 那是个**闭区间**，而且 t 是用
 *   `toFixed(6)` 写进 filter 字符串的。在帧边界上（默认探针里的 `it.start - 1/fps`
 *   正好是帧边界）它会同时框住前后两帧，抽到哪一帧取决于浮点尾数；
 *   加上引擎算帧号是 `idx = floor(t*fps + 1e-6)`，`t=6.133333` 会掉到 367 而不是 368，
 *   于是颗粒图案（`frameSeed(idx)`）不同 → 一堆误报 ✗，而两张图肉眼看一模一样。
 *   实测：24 个探针 9 ✓ / 15 ✗，✗ 的全是移动中的画面。
 *
 * 现在：帧号由 `round(t*fps)` 算出来，`select=eq(n\,N)` 只会命中一帧 ——
 * 没有浮点边界问题，也不需要"帧中心"的近似。
 *
 * 另一个必须踩对的细节：ffmpeg 的 rawvideo **行序是自上而下**，而 `engine.readPixels()`
 * 是自下而上（WebGL 原生顺序）。不翻就会得到 mean≈20、31% 像素超阈值的"全线不一致"，
 * 而两张图肉眼看是同一画面 —— 这条当初把我骗了三轮。
 *
 * @returns {Promise<Buffer|null>}
 */
async function ffmpegFrame(file, t, w, h, fps, opts = {}) {
  const [bin, ...prefix] = ffmpegCmd();
  const idx = Math.max(0, Math.round(t * fps));
  // ⚠ `-copyts` 不是必须的：`select` 的 n 是**解码帧序号**，与时间戳无关，
  //   所以哪怕成片首帧 PTS 不是 0（自己手工 concat 的片子），帧号依然是帧号。
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
  void opts;
  return flipRows(buf, w, h);
}

/** 上下翻转一张 RGBA 图（行序反转）。 */
function flipRows(buf, w, h) {
  const row = w * 4;
  const out = Buffer.allocUnsafe(buf.length);
  for (let y = 0; y < h; y++) buf.copy(out, y * row, (h - 1 - y) * row, (h - y) * row);
  return out;
}

/**
 * 两张 RGBA 的差异统计。
 *
 * 阈值按「同一帧经 h264 往返」来定，不能按"逐像素相等"：
 *   yuv420p 色度二次采样 + BT.709 往返 + x264 压缩，实测差异**全部落在 0–63 这一档**
 *   （正确匹配时：99.5% 的像素差 0–31、0.5% 差 32–63、**>64 的是 0.0%**）。
 *   真正的问题（抽错帧、拼接错位、色彩空间不对）会让画面整体错位，>64 成片出现、
 *   mean 抬到 20–45。所以除了 mean，`over64` 才是最有区分度的那一项 ——
 *   它在"高频细密画面"（细竖线、网点）上也不会被压缩噪声污染。
 */
function pixelDiff(a, b) {
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
    max, mean: sum / Math.max(1, count),
    over16: over16 / Math.max(1, count),
    over32: over32 / Math.max(1, count),
    over64: over64 / Math.max(1, count),
  };
}

/* ------------------------------------------------------------------ 命令：dumppx */

/**
 * 把浏览器渲染的某一帧的**裸像素**吐到文件（RGBA，自下而上，显示空间）。
 * 排查用：拿它和 `ffmpeg -f rawvideo` 抽出来的帧做各种组合比对，判断差异来自哪里。
 *
 *   node scripts/anim.mjs dumppx demo --times 1.5 --out out/demo/_browser.raw
 */
async function cmdDumpPx() {
  const task = pickTask();
  const times = (opt('times', opt('t', '1')) ?? '1').split(',').map(Number).filter(Number.isFinite);
  const out = path.resolve(ROOT, opt('out', taskOut(task, '_browser.raw')));
  await openSession({ task, scale: Number(opt('scale', '0')) || undefined, only: opt('only', undefined) });
  try {
    for (const t of times) {
      const r = await session.page.evaluate(
        (tt) => /** @type {any} */ (window).__anim.framePixels(tt, { samples: 1 }),
        t,
      );
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from(r.pixels, 'base64'));
      log(`t=${t.toFixed(3)}  ${r.bytes} 字节 → ${path.relative(ROOT, out)}`);
    }
  } finally { await closeSession(); }
}

/**
 * 背景守门的原始数据（排查用）：每个交叠段在交叠期画了几次、画了什么。
 *
 *   node scripts/anim.mjs audit demo
 */
async function cmdAudit() {
  const task = pickTask();
  await openSession({ task, only: opt('only', undefined) });
  try {
    const r = await session.page.evaluate(() => /** @type {any} */ (window).__anim.worldAudit());
    // 两个采样时刻都要露出来（BACKLOG 头部 ⑦）：交叠窗中点（判"铺没铺底"）+ 交叠窗之后的中点
    // （"那一秒到底黑没黑"）。以前只打一个时刻，于是交叠窗之外的部分在这张表里根本不存在。
    const dump = (x) => {
      log(`  ${String(x.id).padEnd(14)} handlesTransition=${x.handlesTransition ? 'Y' : 'n'}  world=${x.declaredWorld}`
        + `${x.selfBase ? '  ← 声明 world: false：不判铺底，只给读数' : ''}`
        + `${x.missing ? '   ← 没铺满整帧（这一段的底是黑的）' : ''}${x.error ? '  错误: ' + x.error : ''}`);
      for (const s of x.samples ?? []) {
        log(`      ${s.error
          ? `t=${s.t.toFixed(2)}s  渲染出错: ${s.error}`
          : `t=${s.t.toFixed(2)}s  整帧覆盖 ${String(s.full).padStart(3)} 次  本帧总绘制 ${String(s.any).padStart(3)} 次  亮度 ${s.mean.toFixed(3)}`}`);
      }
      if (flag('debug') && x.trace) log(`      整帧覆盖来自: ${(x.trace ?? []).join('  ///  ')}`);
    };
    log(`时间线 ${r.timeline} 段；与前一段交叠、**判铺底**的 ${r.results.length} 段`
      + `（各采两个时刻）；另有 ${(r.selfBase ?? []).length} 段声明了 world: false（不判铺底）：`);
    for (const x of r.results) dump(x);
    if ((r.selfBase ?? []).length) {
      log('');
      for (const x of r.selfBase) dump(x);
    }
    reportErrors(session.info);
  } finally { await closeSession(); }
}

/**
 * 测速：在 `[from,to)` 上**均匀取 n 个时刻**各渲一帧（含读回像素），算出 fps。
 *
 * 为什么值得做：`samples=auto` 在"背景一直在动 + 摄影机一直在动"的片子里会持续吃到高子帧，
 * 而 CLI 的 ETA 是**滚动平均** —— 前 30 帧给的是 7000s 这种没用的数字，收敛很慢
 * （实测 1080p60 / 8 子帧约 1.5 fps，60 秒片子 34 分钟）。先花几秒测一次，就能在开渲之前
 * 给出可信的预估（`docs/history/IMPROVEMENTS-1-3.md` P2-3）。
 *
 * 两个刻意的设计：
 *   ① 均匀铺满整片而不是只测开头 —— 运动模糊的子帧数是随画面变化的，
 *      只测开头会严重低估（或者高估）"甩镜/砸字"那几段的成本。
 *   ② 走 `hash()`（渲染 + `readPixels`）而不是 `png()` —— 后者多一次 PNG 编码，
 *      在 1080p 下比渲染本身还贵，会把预估压低好几倍（第一版就是这么错的：给出 731 fps）。
 */
async function measureSpeed({ info, from, to, fps, samples, shutter, n = 10 }) {
  const times = Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 0.5)) / n);
  const t0 = Date.now();
  const hist = new Map();
  let drawn = 0;
  for (const t of times) {
    const r = await session.page.evaluate(
      ([tt, s, sh]) => /** @type {any} */ (window).__anim.hash(tt, {
        samples: s === 'auto' ? 'auto' : Number(s), shutter: sh,
      }),
      [t, samples, shutter],
    );
    hist.set(r.samples, (hist.get(r.samples) ?? 0) + 1);
    drawn++;
  }
  const elapsed = Date.now() - t0;
  return { fps: drawn / (elapsed / 1000), frames: drawn, elapsed, hist, perFrame: elapsed / drawn };
}

/**
 * 打印渲染预估（--dry-run）。
 *
 * C-1：改成**按档预估**。老版本只测「这次手上的参数」，而用户真正要回答的问题
 * 是两档各自的价钱 —— 草稿档（`--draft`：绝对 scale 0.5 + samples 1）与
 * 成片档（任务 scale + samples auto），两者差 8–24×（docs/PERF.md A1）：
 * 只看成片档会被分钟数吓住、只看草稿档会被速度骗到。现在一次 dry-run 两档都测
 * （缺的档另起一个短会话，`--scale` 沿用档位定义），两行分钟数都给。
 * 非标准参数（比如 `--samples 8`）不属于任何一档时，补一行「本次参数」。
 */
async function printEstimate({ task, info, from, to, fps, samples, shutter, label }) {
  const total = Math.max(1, Math.round((to - from) * fps));
  const encMs = Number(opt('encode', '4'));                // 编码开销（x264 veryfast @1080p 约 3–6ms/帧）
  // ⚠ 必须在渲染之前测，而且**不能在测速期间关掉 ack** —— 这里是主流渲染循环之外的
  //   独立 evaluate，安全。
  //
  // 「成片档」的分辨率以任务自己声明的 scale 为准：草稿档会话里 info.scale 是 0.5，
  // 问不出成片的 scale（config scale 2 + --draft 时尤其）。
  let configScale = null;
  try {
    configScale = parseTaskMeta({ id: task, cfgText: readFileSync(path.join(ROOT, 'tasks', task, 'task.config.mjs'), 'utf8') }).scale;
  } catch { /* 读不到就走下面的兜底 */ }
  if (!configScale) configScale = Math.abs(info.scale - DRAFT_SCALE) < 1e-9 ? 1 : info.scale;
  const tiers = planTiers({ configScale, scale: info.scale, samples });

  log(`\n[--dry-run] 按档预估：每档整片均匀取 10 个时刻各渲一帧测速…`);
  const rows = [];
  for (const t of tiers) {
    if (!t.current) continue;
    log(`  · 测 ${t.label}（${info.pw}×${info.ph}，samples=${samples}）…`);
    const sp = await measureSpeed({ info, from, to, fps, samples, shutter });
    rows.push({ ...t, sp, pw: info.pw, ph: info.ph });
  }
  for (const t of tiers) {
    if (t.current) continue;
    const rec = { ...t, sp: null, error: null };
    rows.push(rec);
    log(`  · 测 ${t.label}（另起一个短会话，按那一档的参数）…`);
    try {
      await closeSession();
      await openSession({ task, scale: t.scale, only: opt('only', undefined) });
      rec.pw = session.info.pw; rec.ph = session.info.ph;
      rec.sp = await measureSpeed({ info: session.info, from, to, fps, samples: String(t.samples), shutter });
    } catch (e) { rec.error = String(e?.message ?? e).split('\n')[0].slice(0, 140); }
  }

  // 打表按档位顺序（草稿 → 成片 → 本次），不按测速先后 —— 方向感交给「← 本次参数」标记
  rows.sort((a, b) => tiers.findIndex((t) => t.id === a.id) - tiers.findIndex((t) => t.id === b.id));
  log('');
  for (const r of rows) {
    if (r.error) { log(`  ${r.label}  （没测成：${r.error} —— 这一档没有读数，别拿另一档按比例硬推）`); continue; }
    const enc = r.id === 'draft' ? DRAFT_ENCODE_MS : encMs;   // 540p 的编码开销约是 1080p 的一半
    const est = estimateTier({ seconds: to - from, fps, perFrameMs: r.sp.perFrame, encodeMs: enc });
    log(`  ${r.label}  ${r.pw}×${r.ph}  samples=${r.samples}  ${r.sp.fps.toFixed(2)} fps（${est.perFrameMs.toFixed(0)} ms/帧 含编码）→ ${est.frames} 帧约 ${est.minutes.toFixed(1)} 分钟${r.current ? ' ← 本次参数' : ''}`);
    const hist = [...r.sp.hist.entries()].sort((a, b) => a[0] - b[0]);
    if (hist.length && !(hist.length === 1 && hist[0][0] === 1)) {
      log(`      子帧分布 ${hist.map(([k, v]) => `${k}子帧:${v}`).join('  ')}`);
    }
  }
  log(`  段数 ${info.timeline.length}；${flag('segments') || opt('segments', null) ? '分块渲染（已渲好的块会跳过）' : '未分块（中断要重来，长片子建议加 --segments）'}`);
  const curRow = rows.find((r) => r.current && r.sp);
  const curEst = curRow && estimateTier({ seconds: to - from, fps, perFrameMs: curRow.sp.perFrame, encodeMs: curRow.id === 'draft' ? DRAFT_ENCODE_MS : encMs });
  if (curEst && curEst.minutes > 20) log(`  ⚠ 本次参数超过 20 分钟：建议 --segments 分块（可断点续渲）、先 --samples 8 压一压，或缩短${label}`);
  if (flag('json')) {
    log(JSON.stringify({
      total,
      perFrameMs: curEst?.perFrameMs ?? null,
      minutes: curEst?.minutes ?? null,
      measureFps: curRow?.sp.fps ?? null,
      tiers: rows.map((r) => {
        const base = { id: r.id, label: r.label, scale: r.scale, samples: r.samples, current: r.current, pw: r.pw ?? null, ph: r.ph ?? null };
        if (r.error) return { ...base, error: r.error };
        const est = estimateTier({ seconds: to - from, fps, perFrameMs: r.sp.perFrame, encodeMs: r.id === 'draft' ? DRAFT_ENCODE_MS : encMs });
        return { ...base, measureFps: r.sp.fps, renderMsPerFrame: r.sp.perFrame, perFrameMs: est.perFrameMs, frames: est.frames, minutes: est.minutes };
      }),
    }));
  }
  return true;
}

/* ------------------------------------------------------------------ 命令：video / shot / perf */

/**
 * 分段渲染：把 [from,to) 切成若干块，每块渲染成一个 mp4，最后用 ffmpeg concat 拼起来。
 *
 * 为什么需要它：整片一遍 40 分钟，改一个镜头又得从头来过；中途断了（HMR 重载、页面崩）
 * 前面的时间全白费。分块之后，**已经渲好的块会跳过**，重跑只补没渲完的那几块。
 *
 * `--segments N` 里的 N 是**目标块时长（秒）**，不是"等分几份"。
 *
 * 为什么改成秒：以前的名字叫 `minutes`（注释里写"切点落在段边界上，每一块都是完整的镜头"），
 * 但实现是**把时间轴等分成 N 份**再加段边界 —— 60 秒的片子 `--segments 6` 产出 13 块，
 * 其中 11 秒长的镜头被 10.00s 那一刀切成两半，注释的承诺当场作废
 * （`docs/history/IMPROVEMENTS-1-3.md` P2-4）。现在：
 *   ① 切点**只能落在段边界**上，且该处不能有别的段还在播（不在转场中间切）；
 *   ② 只有当两个切点之间超过 `2 × 目标时长` 时才在中点补一刀（否则长镜头会变成一整块）；
 *   ③ 过短的块（< 1.5s）并进前一块。
 * 于是「块数 ≈ 时长 / 目标时长」，且每块都是完整的镜头。
 */
async function renderSegments({ task, info, out, from, to, fps, samples, shutter, audioFile, withAudio }) {
  const segStart = Date.now();
  // 目标块时长（秒）。默认 15：块间有固定开销（重连浏览器 + 下发推流参数），块越小越亏 ——
  // optifine 那次 `--segments 8` 在 254 秒的片子上切了 35 块，每块开头都要重连一次
  // （`docs/history/IMPROVEMENTS-4-5.md` §6 C 给的经验值：块数 ≈ 时长 / 15）。
  //
  // ⚠ 裸 `--segments`（后面不跟数字）时 `opt()` 返回 undefined → `Number(undefined)` = NaN，
  //   而 NaN 会一路传进 planSegmentCuts 让每块的边界都变成 NaN（画面全黑且不报错）。
  //   这里必须兜住：拿不到有限正数就退回默认值。
  const target = (() => {
    const v = Number(opt('segments', '15'));
    return Number.isFinite(v) && v > 0 ? Math.max(0.5, v) : 15;
  })();
  const segDir = path.join(path.dirname(out), `${path.basename(out, '.mp4')}.parts`);
  mkdirSync(segDir, { recursive: true });

  const cuts = planSegmentCuts(info.timeline, from, to, target);
  const chunks = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1];
    // 过短的块并进前一块（单独渲一块的固定开销比它本身还大）
    if (b - a < 1.5 && chunks.length) chunks[chunks.length - 1].to = b;
    else chunks.push({ from: a, to: b });
  }
  log(`分 ${chunks.length} 块渲染（--segments ${target}s = 目标块时长，切点只落在段边界且避开转场）`);
  log(`  ${chunks.map((c) => `${c.from.toFixed(1)}–${c.to.toFixed(1)}s`).join('  ')}`);
  log(`  → ${path.relative(ROOT, segDir)}`);

  /**
   * 分块复用必须**先校验渲染参数 + 场景签名**（P1-1）。
   * 用户拍板：参数变了就全部重渲（不做混合）—— 因为混合出来的片子自己都不自洽。
   */
  const man = segmentManifest(segDir, task, { fps, samples, shutter });
  const paramChanged = man.changed.filter((c) => !c.startsWith('tasks/') && !c.startsWith('首次'));
  /**
   * **块级增量重渲**（BACKLOG 1-45，2026-10-26）。
   *
   * 以前只有两档：要么整批复用，要么整批重渲。于是"改一个镜头"和"改一个参数"代价一样 ——
   * 三分钟的片子 ~70 分钟。现在多一档：**按块判断**。
   *
   *   · 渲染参数（fps / samples / shutter / scale / vcodec / crf …）变了 ⇒ 整批重渲
   *     （混合出来的片子自己都不自洽，这是 P1-1 的结论，不改）；
   *   · 只有 `tasks/` 下的场景改了 ⇒ 逐块比签名，只重渲**签名变了**的那几块；
   *   · `src/` 下的引擎改了 ⇒ 引擎签名进每一块的签名 ⇒ 整批失效（保守且正确）。
   */
  const force = flag('force');
  const engineSig = engineSignature();
  const sceneIndex = sceneFileIndex(path.join(ROOT, 'tasks', task), ROOT);
  /**
   * 字幕表（task.narration）的绝对路径 —— 进块签名用。
   * 为什么现算：改字幕不会动任何场景文件，块签名不变就会整批复用，
   * 结果是「5.8 秒渲完」但画面还是旧字幕（实测：把日文字幕换成中文时踩到）。
   */
  const narrationFile = (() => {
    try {
      const cfgText = readFileSync(path.join(ROOT, 'tasks', task, 'task.config.mjs'), 'utf8');
      const m = /narration:\s*['"]\.\/([^'"]+)['"]/.exec(cfgText);
      return m ? path.join(ROOT, 'tasks', task, m[1]) : null;
    } catch { return null; }
  })();
  const prevBlocks = man.prev?.blocks ?? null;
  /** 这一批块的签名（收尾写进 params.json，下一次拿来比） */
  /** @type {Record<string, string>} */
  const blockSigs = {};
  const globalReuse = !force && paramChanged.length === 0;

  if (force) {
    log('  --force：忽略已存在的分块，全部重渲');
  } else if (paramChanged.length) {
    warn(`\n⚠ 分块参数与上一次不同，**全部重渲**（不复用旧块）：`);
    for (const c of man.changed) warn(`  · ${c}`);
    warn(`  → 提示：上一次是 ${man.prev?.text ?? '(未知)'}；本次是 ${man.fp.text}`);
    warn(`  （这正是 P1-1 那个坑：以前这里会静默复用旧分块，秒完成并报 ✓ 出片成功）\n`);
  } else if (man.changed.length && prevBlocks) {
    log('  参数没变，按块比对签名：只重渲改到的那几块（BACKLOG 1-45）');
  }

  const files = [];
  /** 本次**新渲**的块的逐帧 shake（跳过的块没有数据，所以只统计重新渲的那部分） */
  const shakeAll = [];
  /**
   * 非有限值扫描（BACKLOG 1-4）的**跨块汇总**：每块自己那份由 `renderToFile` 实时打过
   * （每段第一条），这里把各块的命中合起来，在收尾给一次完整清单 ——
   * 逐块各打一份会被"第 N 块 ✓"那几十行冲散。
   * 只统计**本次新渲**的块；跳过的旧块没有数据（与 shake 同一个口径）。
   * @type {any[]}
   */
  const nfAll = [];
  let nfScannedAll = 0;
  const scanNf = resolveScanNf();
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const file = path.join(segDir, `part_${String(i).padStart(3, '0')}_${c.from.toFixed(2)}-${c.to.toFixed(2)}.mp4`);
    const expect = Math.max(1, Math.round((c.to - c.from) * fps));
    // 块的 key 用**时间边界**：时间线一改（段变长/挪位），对得上号的块才会复用
    const key = `${c.from.toFixed(2)}-${c.to.toFixed(2)}`;
    const sig = blockSignature({
      root: ROOT, engineSig, paramsText: man.fp.text, timeline: info.timeline,
      index: sceneIndex, from: c.from, to: c.to,
      // 字幕改了就重渲：字幕层是引擎画的（task.narration → 每帧文字），不是 ffmpeg 烧的
      narrationFile,
    });
    blockSigs[key] = sig;
    // 已经渲好的块直接复用（改一个镜头就只重渲它所在的那块）
    if (globalReuse && existsSync(file) && prevBlocks?.[key] === sig) {
      log(`  [${i + 1}/${chunks.length}] ${c.from.toFixed(2)}–${c.to.toFixed(2)}s  已存在且签名一致，跳过（${man.fp.text}）`);
      files.push({ file, expect });
      continue;
    }
    if (existsSync(file)) {
      log(`  [${i + 1}/${chunks.length}] ${c.from.toFixed(2)}–${c.to.toFixed(2)}s  签名变了 → 重渲这一块`);
      try { rmSync(file, { force: true }); } catch { /* ignore */ }
    }
    log(`  [${i + 1}/${chunks.length}] ${c.from.toFixed(2)}–${c.to.toFixed(2)}s  ${expect} 帧 …`);
    const r = await renderToFile({
      info, out: file, from: c.from, to: c.to, fps, samples, shutter,
      withAudio: false, audioFile: null, quiet: true,
      // 块号一路带到诊断里：`atFrame` 是**块内**帧号，不带块号会被读成整片帧号
      chunk: `${i + 1}/${chunks.length}`,
    });
    if (r.frames < expect) {
      try { rmSync(file, { force: true }); } catch { /* ignore */ }
      const d = decideGateFailure({
        problems: [],
        phase: 'chunk',
        reusable: true,
        chunk: { i: i + 1, n: chunks.length, range: `${c.from.toFixed(2)}–${c.to.toFixed(2)}s` },
        expected: expect,
        got: r.frames,
      });
      die(
        `第 ${i + 1} 块的帧数不足（${r.frames}/${expect} 帧，${c.from.toFixed(2)}–${c.to.toFixed(2)}s），已删掉这一块。\n` +
        `  最近一次进展：${r.progressWhy}\n` +
        // ⚠ 措辞按「已知 / 未知」分开（BACKLOG 1-3）：分块这一步**确实**能靠重跑恢复
        //   （已渲好的块会跳过），所以这里保留"重跑"，但把**代价与前提**写清楚 ——
        //   不修任何东西的重跑只会得到同样的半块。
        `  ${d.headline}\n` +
        d.next.map((l) => `  ${l}`).join('\n') + '\n' +
        `  其他已渲好的块会保留：确认上面那些之后重跑同一条命令，只会重渲这一块（画面不必重渲）。`,
      );
    }
    if (r.code !== 0) {
      // ffmpeg 非零退出：**可能是瞬时的**（被外部中断 / 磁盘满 / 编码器掉线），
      // 所以这一类不禁重跑，只要求先看一眼原因（BACKLOG 1-3）。
      die(
        `第 ${i + 1} 块 ffmpeg 退出码 ${r.code}${r.exitSignal ? `（信号 ${r.exitSignal}）` : ''}\n` +
        `  这一类**不在"确定性失败"里** —— ffmpeg 非零退出可能是瞬时的（被外部中断 / 磁盘满 / 编码器掉线），\n` +
        `  也可能是确定性的（参数写错 / 编码器不支持）。\n` +
        `  下一步：① 先看它最后打印的那几行（分块渲染时 ffmpeg 的输出在 out/<任务>/<任务>.parts/ 附近）；\n` +
        `          ② 确认磁盘还有空间；\n` +
        `          ③ 再重跑同一条命令（其他块会跳过，只补这一块）。`,
      );
    }
    // 场景抛异常（P0-3）：帧数可能是齐的、ffprobe 也挑不出毛病，但画面里是错帧卡片。
    // 所以**先判异常再判产物**，并且把这一块删掉 —— 留着它只会让下一轮误以为已经渲好了。
    if (r.renderErrors?.length) {
      const errs = await collectRenderErrors();
      try { rmSync(file, { force: true }); } catch { /* ignore */ }
      failOnRenderErrors(errs, `  第 ${i + 1} 块（${c.from.toFixed(2)}–${c.to.toFixed(2)}s）已删除；已渲好的其他块保留。`);
    }
    // 产物守门（P0-3）：**CLI 自己数的帧数不算证据**。曾经第 1 块进度跑到 330/330、
    // CLI 记的帧数也对，但 ffmpeg 没写 moov，产物根本打不开 —— 13 块全部 ✓，
    // 第 1 块是坏的。所以每一块都要让 ffprobe 去看实际写出来的文件。
    const bad = await checkVideoFile(file, expect, { what: `第 ${i + 1} 块`, fps });
    if (bad.length) {
      try { rmSync(file, { force: true }); } catch { /* ignore */ }
      die(gateFailureLines(
        { title: `第 ${i + 1} 块的产物验收不通过，已删掉它：`, problems: bad },
        {
          phase: 'chunk',
          reusable: true,
          chunk: { i: i + 1, n: chunks.length, range: `${c.from.toFixed(2)}–${c.to.toFixed(2)}s` },
          expected: expect,
          got: r.frames,
          note: `渲染侧收到 ${r.frames}/${expect} 帧，ffmpeg 退出码 ${r.code}`,
        },
      ).join('\n'));
    }
    log(`         ✓ ${r.frames} 帧，${(r.elapsed / 1000).toFixed(1)}s`);
    files.push({ file, expect });
    if (r.shakeSeq?.length) shakeAll.push(...r.shakeSeq);
    // 非有限值：带上块号，收尾汇总里能直接定位到是哪一块（哪一段）
    for (const h of r.nonFinite ?? []) nfAll.push({ ...h, chunk: `${i + 1}/${chunks.length}` });
    nfScannedAll += r.nfScanned ?? 0;
  }

  // concat 拼接（先转成统一的 ts 再拼，避免不同 moov 结构拼不上）
  // —— 先把本次的参数指纹落盘：**拼接之后**才写，是为了让"中途失败的分块"
  //    不会被下一次误认为"这批块是用当前参数渲的"。
  mkdirSync(segDir, { recursive: true });
  writeFileSync(man.file, JSON.stringify({
    ...man.fp, at: new Date().toISOString(), chunks: chunks.length, frames: files.reduce((s, f) => s + f.expect, 0),
    // 每块的签名（BACKLOG 1-45）：下一次逐块比对，只重渲改到的那几块
    blocks: blockSigs,
  }, null, 2));
  const listFile = path.join(segDir, 'concat.txt');
  writeFileSync(listFile, files.map((f) => `file '${f.file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const stitched = path.join(segDir, '_stitched.mp4');
  // ⚠ `-copyts` 是必须的：每块的 mp4 都从 PTS=0 开始，靠 concat demuxer 按累计时长
  //   加偏移；不带它接缝处时间戳会错开（实测 avg_frame_rate 变成 60.08、duration 11.983）。
  //   见 `renderParallel()` 里那段长注释 —— 这条坑是在做 `--parallel` 时量出来的。
  await runFfmpeg(['-y', '-loglevel', 'error', '-copyts', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', stitched,
    '-movflags', '+faststart']);

  // 音轨：整段切一次，再和画面一起封装（比每块带音轨更稳）
  if (withAudio && audioFile) {
    // ⚠ **`-af apad` 不能省，`-shortest` 也不能省**（2026-10 修，起因见下）。
    //
    //   症状：分块出片跑完，35 块**每一块**都被 ffprobe 复核通过，最后一步却报
    //   「ffprobe 数出 15237 帧，期望 15240 帧（差 -3）」，而且**重跑多少次都是 −3**。
    //   实测定位（`tasks/optifine`，15,240 帧 / 254.000s）：
    //     · 纯视频拼接件 `parts/_stitched.mp4` = **15,240 帧 ✓**
    //     · 过完这一步的成片              = **15,237 帧 ✗**
    //   根因：**只有 `-shortest` 的时候，它按"容器记账时长"取短的那一路**。音轨是
    //   254.000s、视频也是 254.000s，看似相等，但 AAC 封装有 priming samples 与尾部
    //   padding，音频流的记账时长比视频**短几十毫秒** → 被当成"短的" → **把视频尾巴切掉**。
    //   （`tasks/sodium/HANDOFF.md` 记的「偶发差 1 帧、重跑就过」是同一个根因，
    //     差多少取决于音轨尾部静音的长度，所以那次"重跑就过"是运气。）
    //
    //   为什么不是简单地把 `-shortest` 删掉：`-shortest` 在这里**是有用的** ——
    //   用 `--from/--to` 只渲一段时，`-ss` 之后的音轨通常**比视频长**，没有它就多出一截
    //   只有声音没有画面的尾巴。正确做法是让**视频当唯一的长短基准**：
    //   `apad` 把音轨补成无限长（补的是静音），于是 `-shortest` 必然停在视频的最后一帧上。
    //   两个方向都对：音轨短了会被补齐，音轨长了会被切掉，而**视频一帧都不会丢**。
    await runFfmpeg(audioMuxArgs(stitched, audioFile, from, out));
  } else {
    await runFfmpeg(['-y', '-loglevel', 'error', '-i', stitched, '-c', 'copy', '-movflags', '+faststart', out]);
  }
  const frames = files.reduce((s, f) => s + f.expect, 0);

  // 产物守门（P0-3）：拼接之后再验一次实际写出来的文件。每块都合格、拼起来却少了帧
  // （concat 的常见故障）——只有看**最终文件**才发现得了。frame 数由容器头给出，很快。
  const stitchedBad = await checkVideoFile(stitched, frames, { what: '拼接结果', fps });
  const finalBad = await checkVideoFile(out, frames, { what: path.relative(ROOT, out), fps });
  const bad = [...stitchedBad, ...finalBad];
  if (bad.length) {
    try { rmSync(out, { force: true }); } catch { /* ignore */ }
    // ⚠ 措辞按「已知 / 未知」分开（`docs/BACKLOG.md` 1-3 / `docs/history/IMPROVEMENTS-4-5.md` §1.5）：
    //   这一步是**确定性**的，写"重跑即可"会把人指偏（那一次照着重跑一遍，白等 30 秒，
    //   帧数一模一样）。措辞现在统一由 `decideGateFailure()` 生成 —— 与分块路径、
    //   并行路径、直播路径共用一个判据，免得同一件事在四个地方四种说法。
    die(gateFailureLines(
      { title: `产物验收不通过，已删除 ${path.relative(ROOT, out)}：`, problems: bad },
      { phase: 'stitch', expected: frames, note: '各块本身都通过了守门，所以问题出在**拼接 / 封装**这一步' },
    ).join('\n'));
  }

  const st = statSync(out);
  log(`\n✓ ${path.relative(ROOT, out)}`);
  log(`  ${frames} 帧（${chunks.length} 块拼接，ffprobe 复核通过），用时 ${((Date.now() - segStart) / 1000).toFixed(1)}s`);
  log(`  文件大小 ${(st.size / 1048576).toFixed(1)} MB`);
  // 非有限值扫描的跨块汇总（BACKLOG 1-4）：只报告、不删产物
  reportNonFinite(nfAll, { scanNf, scanned: nfScannedAll, what: '（分块）' });
  // `--segments` 才是中间产物的**大头**（optifine 那次 11.2 GB），而这一段以前从不提示清理
  // （`docs/history/IMPROVEMENTS-4-5.md` §6 E：报告里只有直播路径挂了它）。
  reportIntermediates(task, out);
  // 抖动守门（只对本次重新渲过的块有数据；跳过的旧块不计入）
  if (shakeAll.length) reportShake(analyzeShake(shakeAll, { fps, checkTail: to >= info.duration - 1e-6 }), task);
  return { frames, nonFinite: nfAll };
}

/**
 * 抖动守门（`docs/history/IMPROVEMENTS-1-3.md` 建议 F）：出片当场判"这一片是手持还是振动"。
 *
 * 为什么把判据放在这里：那次事故（用户说"最后像地震"）是**成片出来之后**才靠
 * 相邻帧互相关反查出来的 —— 眼睛先发现、工具后确认。而 `post.shake` 是设计值、
 * 又跟着每一帧一起回来了（帧头 4/8 字节），所以出片当场就能判，成本为零：
 *   · 逐帧变化量 ≈ 幅度 ⇒ 逐帧白噪声，60fps 下是**振动**
 *   · 收尾段幅度 ≫ 中段   ⇒ 镜头都停住了画面还在晃（"越到后面越像地震"）
 *
 * ⚠ 只**提醒**，绝不因此删产物：抖动是内容问题，不是"文件不合格"（那种才删）。
 */
function reportShake(st, task) {
  if (!st || !st.n || st.kind === 'none') return;
  if (!st.notices.length) {
    log(`  抖动 ${shakeSummary(st)}`);
    return;
  }
  warn(`\n⚠ 抖动看着像"振动"而不是手持（${shakeSummary(st)}）：`);
  for (const n of st.notices) warn(`  · ${n}`);
  warn(`  出片前先体检：node scripts/anim.mjs shake ${task}`);
  warn(`  参考：post.shake 单位是物理像素、影响整帧；平滑抖动用 shakeSmooth(f.t, amp)（src/core/cam.js）。`);
  warn(`  （这不影响文件合格与否，产物保留。）`);
}

/**
 * 规划分块切点：**只落在安全的地方**。
 *
 * 安全 = 时间线上的一段边界，且那一刻没有别的段还在播（不在转场交叠里）。
 * 在转场中间切会把一个交叉溶解劈成两块，各自都缺一半信息。
 *
 * 长镜头（两个安全切点之间超过 2×目标时长）允许在中点补一刀 —— 否则一个 40 秒的
 * 长镜头会变成一整块，"断点续渲"就失去意义了。
 *
 * @param {{id:string,start:number,end:number}[]} timeline
 * @returns {number[]} 升序的切点（含 from 与 to）
 */
function planSegmentCuts(timeline, from, to, target) {
  // 某时刻有几个段在播？>1 说明处在转场里，不能切
  const activeAt = (t) => timeline.reduce((n, it) => n + (t >= it.start && t < it.end ? 1 : 0), 0);
  const safe = [];
  for (const it of timeline) {
    for (const b of [it.start, it.end]) {
      if (b <= from + 0.05 || b >= to - 0.05) continue;
      if (activeAt(b) !== 1) continue;       // 边界处正好有段结束/开始时是安全的
      if (!safe.includes(b)) safe.push(b);
    }
  }
  safe.sort((a, b) => a - b);

  const cuts = [from];
  let cursor = from;
  /** 在已有边界之前尽量按目标时长补刀（只落在不进转场的地方） */
  const fill = (until) => {
    let t = cursor + target;
    while (t < until - 1.5) {
      if (activeAt(t) === 1) { cuts.push(Math.round(t * 1000) / 1000); cursor = t; }
      t += target;
    }
  };
  for (const b of safe) {
    if (b - cursor < 1.5) continue;          // 太近，并进上一块
    fill(b);
    cuts.push(b);
    cursor = b;
  }
  fill(to);
  cuts.push(to);
  return [...new Set(cuts)].sort((a, b) => a - b);
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

async function cmdVideo(short = false) {
  const task = pickTask();
  const from = Number(opt('from', '0'));
  /**
   * 草稿档（BACKLOG 1-44）：`--draft` = 半分辨率 + `samples 1`，两样都可以被显式选项覆盖。
   * 用途只有一个 —— **审节奏与信息密度**（一晚上能验 3–5 版，而不是一版）。定稿去掉它。
   */
  const draft = flag('draft');
  const scale = draft ? (Number(opt('scale', '0')) || 0.5) : (Number(opt('scale', '0')) || undefined);

  if (!(await checkFfmpeg())) die(`找不到 ffmpeg。装一个，或用 ANIM_FFMPEG 环境变量指定路径。`);

  const segStart = Date.now();
  await openSession({ task, scale, only: opt('only', undefined) });
  try {
    const info = session.info;
    /**
     * 音轨（P1-4）：**分析与封装可以是两条不同的轨**。
     *   · 分析（`f.beat` / `f.a`）用 music 轨 —— 从带人声的混音里测 bpm 会被带偏；
     *   · 封装进成片的用 mix 轨（有旁白的片子就该听混音）。
     * `resolveAudioTracks()` 缺省时会退回老行为（一条轨两用），并打印用的是哪条。
     */
    const tracks = resolveAudioTracks(task);
    if (tracks.analysisSource) {
      log(`音频：${tracks.note}`);
      if (tracks.isSplit && !tracks.music && tracks.vo) {
        warn(`  ⚠ 分轨写法里没有 music —— 节拍会从旁白里测，建议补上 music 轨。`);
      }
    }
    // 有音频但还没分析？先算好（成片要踩拍子）
    if (tracks.analysisSource) {
      const abase = tracks.analysisSource.replace(/\.[^.]+$/, '');
      if (!existsSync(path.join(ROOT, 'tasks', task, 'audio', path.basename(abase) + '.analysis.json'))) {
        warn('· 还没有音频分析数据，先算一遍（让画面能踩拍子）…');
        const an = await analyzeTaskAudio(task);
        // ⚠ "没做成"必须在这里说清楚（BACKLOG 头部 ④）：出片照样会成功，
        //   但如果不说，观众看到的是一整片**不踩拍子**的画面，而日志里只有一句 warn。
        if (!an?.file) {
          warn(`  ⚠ 音频分析**没做出来**（${an?.skipped ?? '未知原因'}：${an?.message ?? '—'}）——`);
          warn('    这一次渲染里 f.beat / f.a 全是 0：镜头对不上拍子，但成片不会有别的错。');
        }
      }
    }

    const to = Number(opt('to', String(short ? Math.min(info.duration, from + 4) : (info.onlyDuration || info.duration))));
    const fps = Number(opt('fps', String(info.fps)));
    const samples = opt('samples', draft ? '1' : (short ? '8' : 'auto'));
    const shutter = Number(opt('shutter', '0.5'));
    const out = path.resolve(ROOT, opt('out', opt('o', taskOut(task, short ? `shot_${from}-${to}.mp4` : `${task}.mp4`))));
    mkdirSync(path.dirname(out), { recursive: true });

    const audioFile = tracks.packaging;
    const withAudio = !short && !!audioFile && !flag('noaudio');
    if (draft) {
      log(`· 草稿档（--draft）：${info.pw}×${info.ph}、samples=${samples} —— **不是成片**，只用来审节奏与信息密度；`);
      log('  定稿去掉 --draft（仍出 1080p60）。半分辨率下小字会糊，那是分辨率不是 bug。');
    }
    // 物理像素才是真正的输出尺寸：`--scale 2` 是 4K、`--draft` 是半分辨率，都会让 width/height 骗人
    const sizeLabel = info.scale === 1
      ? `${info.width}×${info.height}`
      : `${info.pw}×${info.ph}（逻辑 ${info.width}×${info.height} @${info.scale}×）`;
    log(`渲染 ${from}→${to}s @${fps}fps  ${sizeLabel}  samples=${samples}  快门 ${shutter}`);
    const total = Math.max(1, Math.round((to - from) * fps));
    log(`共 ${total} 帧 → ${path.relative(ROOT, out)}${withAudio ? '  (带音轨)' : ''}`);

    // --dry-run：只测速 + 给预估，不出片（长片子开渲之前先看一眼值不值得）
    if (flag('dry-run')) {
      await printEstimate({ task, info, from, to, fps, samples, shutter, label: '时长' });
      return;
    }

    // --parallel N：切片并行渲染 + 自己拼（P2-1）
    if (opt('parallel', null)) {
      await renderParallel({ task, info, out, from, to, fps, samples, shutter, audioFile, withAudio });
      return;
    }

    // --segments：分块渲染 + 拼接（已渲好的块自动复用）
    if (flag('segments') || opt('segments', null)) {
      await renderSegments({ task, info, out, from, to, fps, samples, shutter, audioFile, withAudio });
      reportErrors(session.info);
      return;
    }

    const r = await renderToFile({
      info, out, from, to, fps, samples, shutter, withAudio, audioFile,
    });
    const { code, frames, samplesHist, elapsed } = r;

    // 场景抛异常 = 硬失败：**在帧数检查之前**判，而且产物一定要删掉
    // （帧数可能是齐的，ffprobe 也挑不出毛病 —— 但画面里是错帧卡片）。
    if (r.renderErrors?.length) {
      const summary = await collectRenderErrors();
      const bySeg = new Map();
      for (const e of r.renderErrors) {
        const hit = bySeg.get(e.id);
        if (hit) hit.frames++;
        else bySeg.set(e.id, { id: e.id, frames: 1, firstT: e.t, message: e.message });
      }
      const errs = summary.count
        ? summary
        : {
          count: r.renderErrors.length,
          text: [...bySeg.values()].map((b) => `[${b.id}] 场景 render 抛异常 ${b.frames} 帧（最早 t=${b.firstT.toFixed(3)}s）：${String(b.message).split('\n')[0]}`),
        };
      try { rmSync(out, { force: true }); } catch { /* ignore */ }
      failOnRenderErrors(errs, `  已删除不完整的产物 ${path.relative(ROOT, out)}。`);
    }

    // 帧数没齐就是没出完片。以前这里只看 ffmpeg 退出码，于是「渲染中途断流」
    // 会留下一个几秒钟的短 mp4 并照样打印 ✓（曾把 2880 帧的片子截成 152 帧）。
    if (frames < total) {
      // 删掉不完整的产物：留着它只会让人以为片子已经出好了（日志里说了删，就得真的删）
      let removed = '';
      try { rmSync(out, { force: true }); removed = `已删除 ${path.relative(ROOT, out)}`; }
      catch { removed = `删除 ${path.relative(ROOT, out)} 失败，请手动删掉它`; }
      // `--nf-stop` 是**故意**停的，不是断流：措辞必须分开，否则会被读成"页面崩了"
      // （那一类根因的下一步是查 HMR / 查页面，方向完全不同）。
      if (r.nfStopped) {
        const d = r.nonFinite?.[0];
        die(
          `--nf-stop：扫到非有限值，第 ${frames}/${total} 帧就停下了，${removed}。\n` +
          `  首个命中：[${d?.id ?? '?'}] ${d ? nonFiniteWhere(d) : ''} ← ⚠ ${d ? nonFiniteLine(d) : '(无)'}\n` +
          `  这是**已知原因**（确定性）：同一份代码重跑会在同一帧停下。\n` +
          `  下一步：① node scripts/anim.mjs check <任务>（点名段名与时刻）；\n` +
          `          ② 修 shader 之后重跑；不想中断就**去掉 --nf-stop**（默认只报告、不停）。`,
        );
      }
      // ⚠ 措辞按「已知 / 未知」分开（`docs/BACKLOG.md` 1-3）：直播这一条路**没有可复用的块**
      //   —— 重跑就是整片重渲，而"渲染期间改了文件"/"页面崩了"这类根因是**确定性**的，
      //   不修就重跑＝白等一整片。所以这里只给"先做什么"。
      //
      // ⚠ 2026-10-26：**ffmpeg 自己提前退出**（退出码非 0）不再归到"断流"，那是两回事 ——
      //   前者多半是编码器/参数问题（Windows 上最常见的 LGPL 构建没有 libx264），
      //   把它说成"重跑会停在同一个地方、去查 HMR"会把人指偏。
      const ffDied = code !== null && code !== undefined && code !== 0;
      die(
        `只渲染了 ${frames}/${total} 帧，成片不完整，${removed}。\n` +
        `  ffmpeg 退出码 ${signedExitCode(code)}。最近一次进展：${r.progressWhy}\n` +
        (ffDied
          ? `  **这一条是 ffmpeg 提前退出**（不是页面断流）⇒ 先查编码器，别急着重跑：\n`
            + `  ① 这台 ffmpeg 到底有没有你指定的 --vcodec：\n`
            + `     node -e "const{spawnSync}=require('child_process');console.log(spawnSync('ffmpeg',['-hide_banner','-encoders'],{encoding:'utf8'}).stdout)"\n`
            + `  ② Windows 上最常见的 LGPL 构建**没有 libx264**（引擎会自己退到 h264_mf/libopenh264；\n`
            + `     如果你手写了 --vcodec libx264，把那个参数去掉）；\n`
            + `  ③ 要原配方（crf16 + tune grain）就装 GPL 构建（winget install Gyan.FFmpeg）后重跑。`
          : `  ${knownCauseHeadline('interrupted')}\n`
            + `  下一步：① 先看"最近一次进展"停在哪一帧 —— 那附近就是断点；\n`
            + `          ② 如果渲染期间动过 tasks/ 或 src/ 下任何文件，那就是根因：私有 Vite 会 HMR 重载页面 → WebSocket 断开\n`
            + `             （连 docs/*.md 也不行：编辑器的原子写会留下 .tmp，watch 挡不住，撞 EBUSY 直接让 Vite 崩）；\n`
            + `          ③ 否则看是不是页面渲染报错/崩溃（加 --headed 能看到控制台）；\n`
            + `          ④ 改完之后：长片子用 --segments 分块，已渲好的块会保留，重跑只补没渲完的块。`),
      );
    }
    if (code !== 0) {
      die(
        `ffmpeg 退出码 ${signedExitCode(code)}${r.exitSignal ? `（信号 ${r.exitSignal}）` : ''}\n` +
        `  这一类**不在"确定性失败"里** —— 可能是瞬时的（被外部中断 / 磁盘满 / 编码器掉线），也可能是参数问题。\n` +
        `  下一步：① 确认磁盘还有空间、out/ 没被别的进程碰过；② 再重跑一次；\n` +
        `          ③ 同样的错再来一次就按确定性处理：先 node scripts/anim.mjs check <任务>，再考虑换 --vcodec / --preset。`,
      );
    }

    /**
     * 渲染期间改了模块图里的文件（P2-2）→ 产物**混合了两个版本**，不能算成片。
     * 删掉并点名，而不是留一个"看起来完整"的文件让人以为渲好了。
     */
    if (r.changedSources?.length) {
      try { rmSync(out, { force: true }); } catch { /* ignore */ }
      die(
        `渲染期间 src/ 或 tasks/ 下的源文件被改动了，${path.relative(ROOT, out)} 已删除（画面混合了两个版本）：\n` +
        r.changedSources.slice(0, 10).map((f) => `  · ${f}`).join('\n') + '\n' +
        `  渲染期间**一个文件都别写**（连 docs/*.md 也不行：编辑器的原子写会留下 .tmp 临时文件，\n` +
        `  watch.ignored 挡不住，撞 EBUSY 会让 Vite 进程直接崩 —— docs/history/STATUS-rounds-7-10.md §14.5）。\n` +
        `  长片子建议 --segments 分块渲染，改完只重渲受影响的那一块。`,
      );
    }

    // 产物守门（P0-3）：CLI 自己数的帧数不算数，**让 ffprobe 去看真的写出来的文件**。
    // 半截流（没写 moov）在这个场景下打不开，会被当场抓住，而不是留给下一个会话去发现。
    const bad = await checkVideoFile(out, total, { what: path.relative(ROOT, out), fps });
    if (bad.length) {
      try { rmSync(out, { force: true }); } catch { /* ignore */ }
      // ⚠ 「已知 / 未知」分开措辞（`docs/BACKLOG.md` 1-3）：这里以前只说"先按帧数差判断"，
      //   既没说清这是确定性失败，也没说下一步做什么。
      die(gateFailureLines(
        { title: `产物验收不通过，已删除 ${path.relative(ROOT, out)}：`, problems: bad },
        {
          phase: 'final',
          expected: total,
          got: frames,
          note: `渲染侧收到 ${frames}/${total} 帧，ffmpeg 退出码 ${code}`,
        },
      ).join('\n'));
    }
    log(`\n✓ ${path.relative(ROOT, out)}`);
    log(`  ${frames} 帧（ffprobe 复核 ${total} 帧），用时 ${(elapsed / 1000).toFixed(1)}s（${(frames / (elapsed / 1000)).toFixed(1)} fps 渲染速度）`);
    log(`  子帧分布 ${samplesHist}`);
    if (r.maxBlockedMs > 5000) {
      log(`  背压：最长一次等 ffmpeg 排水 ${(r.maxBlockedMs / 1000).toFixed(1)}s（正常，说明编码比渲染慢）`);
    }
    const st = statSync(out);
    log(`  文件大小 ${mb(st.size)}`);
    reportShake(r.shake, task);          // 抖动守门（docs/history/IMPROVEMENTS-1-3.md 建议 F）
    // 中间产物占了多大，以及怎么清（P2-5：以前一个提示都没有，out/ 悄悄涨到几 GB）
    reportIntermediates(task, out);
    reportErrors(session.info);
  } finally { await closeSession(); }
}

/**
 * 打印 `out/<任务>/` 里的中间产物体积与清理命令（P2-5）。
 * 只在"确实有中间产物"时打印，而且不删任何东西 —— 分块留着是为了断点续渲。
 */
function reportIntermediates(task, out) {
  const dir = path.join(ROOT, 'out', task);
  let bytes = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && (/\.parts$/.test(e.name) || /^_(frames|dumpframe|determinism|align|via)/.test(e.name))) {
      bytes += dirStats(p).bytes;
    } else if (!e.isDirectory() && /\.(yuv|nv12|rgba|raw)$/i.test(e.name)) {
      try { bytes += statSync(p).size; } catch { /* ignore */ }
    }
  }
  if (bytes < 1048576) return;                 // 不到 1 MB 就不啰嗦
  log(`  中间产物 ${mb(bytes)}（保留以便断点续渲）—— 想清掉跑：node scripts/anim.mjs clean ${task}`);
  void out;
}

function findAudio(task) {
  const dir = path.join(ROOT, 'tasks', task, 'audio');
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).filter((x) => /\.(mp3|wav|m4a|flac|ogg)$/i.test(x))[0];
  return f ? path.join(dir, f) : null;
}

/** 用给定的浏览器会话逐帧渲染，并通过 WebSocket 推给 ffmpeg。 */
async function renderToFile({ info, out, from, to, fps, samples, shutter, withAudio, audioFile, quiet, chunk }) {
  const pw = info.pw, ph = info.ph;
  const args = [
    '-y', '-loglevel', 'error',
    // 页面推来的是 **NV12**（GPU 上已经做完 linear→sRGB→BT.709 limited 的 4:2:0，见
    // src/core/gl.js 的 `readNV12`）—— 每帧 3.11MB 而不是 RGBA 的 8.3MB，
    // 传输（Chrome→Node 的 ws 上限 ~110MB/s）从 ~73ms/帧降到 ~28ms/帧（docs/PERF.md §5.3–§5.4）。
    '-f', 'rawvideo', '-pix_fmt', 'nv12', '-s', `${pw}x${ph}`, '-r', String(fps), '-i', 'pipe:0',
  ];
  if (withAudio) args.push('-ss', String(from), '-i', audioFile);
  // 像素已经是 BT.709 limited 的 YUV420：这里只做**翻转**（读回是自下而上）与（4K 时）缩放，
  // 再打色彩标记 —— 不标记的话播放器会按 BT.601 解释而偏色。
  // ⚠ 不要再让它做 RGB→YUV 转换（原来的 `scale=out_color_matrix=bt709`）：那一步已经被搬到 GPU。
  //   `range=limited` 是**钉住**色彩标记用的：NV12 输入没有 range 元数据，
  //   不钉住的话编码器可能按"全范围"打标，播放时整片对比度就变了。
  const vf = ['vflip'];
  if (info.scale > 1) {
    vf.push(`scale=${info.width}:${info.height}:flags=lanczos:in_color_matrix=bt709:out_color_matrix=bt709`);
  }
  vf.push('setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited');
  args.push('-vf', vf.join(','));
  // 编码器：默认仍是 libx264（质量最好），但允许换成硬件编码器 ——
  // 这台机器上「300 帧 1080p60 带颗粒」的实测（`ffmpeg -f null -`）：
  //   libx264 slow/crf16  25.4s（11.8 fps）· medium/crf18 11.4s · veryfast/crf18 4.5s
  //   h264_nvenc p5/cq19   1.8s（166 fps）· p1/cq21 1.6s
  // 硬件编码不只是快：它把 16 个 CPU 线程全让给浏览器那一侧（渲染才是大头），所以
  // `--vcodec h264_nvenc` 常常比「省下的编码时间」还要多省一点。
  //
  // ⚠ `pickVideoEncoder()` 会先探一次「这台 ffmpeg 到底有没有它」：LGPL 构建（Windows 上
  //   最常见的发行包）**没有 libx264**，硬写默认值的结果是 ffmpeg 打一行
  //   `Unrecognized option 'x264-params'` 就退出，而 CLI 在那儿等帧（2026-10-25 实测挂 20 分钟）。
  //   `ANIM_VCODEC` 给"这台机器固定用某个编码器"留了个口子，优先级低于 `--vcodec`。
  const vcodec = pickVideoEncoder(opt('vcodec', process.env.ANIM_VCODEC || 'libx264'));
  const isNvenc = vcodec.endsWith('_nvenc');
  args.push('-c:v', vcodec, '-pix_fmt', 'yuv420p');
  if (vcodec.startsWith('libx264')) {
    args.push(
      '-preset', opt('preset', withAudio ? 'slow' : 'veryfast'),
      '-crf', opt('crf', withAudio ? '16' : '20'),
      '-tune', 'grain',
      '-x264-params', opt('x264', 'aq-mode=3'),
    );
    /**
     * **码率封顶**（2026-10-26 实测后才加的）：`-tune grain` + crf16 在带颗粒的画面上会飙到
     * **230 Mbit/s**（4 秒 1080p60 = 112 MB，75 秒的片子就是 2 GB）—— crf 调到 20 也几乎不变，
     * 因为颗粒保护把细节全留下了。上传平台还要再压一遍，等于白折腾。
     *
     * 给 `--bitrate 12M` 就切到「封顶 VBR」：`-b:v` 目标 + `-maxrate` 峰值 + `-bufsize` 缓冲。
     * 不给则完全沿用原配方（**默认行为一个字节不动**）。
     */
    const cap = opt('bitrate', '');
    if (cap) {
      const m = /^([0-9.]+)\s*([KMG]?)$/i.exec(String(cap).trim());
      if (!m) die(`--bitrate 看不懂：${cap}（写成 12M / 8000K 这种）`);
      const mult = { K: 1e3, M: 1e6, G: 1e9 }[String(m[2] || '').toUpperCase()] ?? 1;
      const bps = Math.round(Number(m[1]) * mult);
      args.push(
        '-b:v', String(bps),
        '-maxrate', String(Math.round(bps * 1.4)),
        '-bufsize', String(Math.round(bps * 2)),
      );
      warn(`（码率封顶：目标 ${cap} / 峰值 ${(bps * 1.4 / 1e6).toFixed(1)} Mbps —— 上传用，画质与体积折中）`);
    }
  } else if (isNvenc) {
    args.push(
      '-preset', opt('preset', 'p5'),          // p1 最快 … p7 最慢最好
      '-rc', 'vbr', '-cq', opt('cq', withAudio ? '19' : '23'), '-b:v', '0',
      '-spatial-aq', '1', '-aq-strength', '8',
    );
  } else {
    /**
     * 兜底编码器（`h264_mf` / `libopenh264`）：**它们不认识 `-crf`**。
     *
     * 2026-10-26 实测（这台机器的 ffmpeg 是 LGPL 构建，没有 libx264）：原来这一支直接把
     * `-crf 16` 递过去，ffmpeg 不报错、按自己的默认码率出片 —— 4 秒 1080p60 出来 **112 MB / 235 Mbit/s**。
     * 一支 75 秒的片子会变成 2 GB 级，平台还得再压一遍，画质反而更差（re-encode 二次损失）。
     * 所以这里改成**显式码率**：1080p60 带颗粒给 12–14 Mbps（B 站/YouTube 的推荐区间），
     * 码率数字可用 `--bitrate` 覆盖。
     */
    const br = opt('bitrate', withAudio ? '14M' : '12M');
    const bps = (() => {
      const m = /^([0-9.]+)\s*([KMG]?)$/i.exec(String(br).trim());
      if (!m) return null;
      const mult = { K: 1e3, M: 1e6, G: 1e9 }[String(m[2] || '').toUpperCase()] ?? 1;
      return Math.round(Number(m[1]) * mult);
    })();
    if (!bps) die(`--bitrate 看不懂：${br}（写成 12M / 8000K 这种）`);
    args.push(
      '-b:v', String(bps),
      '-maxrate', String(Math.round(bps * 1.5)),
      '-bufsize', String(Math.round(bps * 2)),
    );
    if (vcodec === 'h264_mf') {
      // MediaFoundation：`-rate_control` 只吃**数值枚举**（写 'vbr' 会 "Error setting option"）。
      // 1 = pc_vbr（峰值受限 VBR）—— 正好对得上我们给的 -b:v / -maxrate 三元组。
      args.push('-rate_control', '1', '-quality', opt('quality', '82'));
    } else {
      // libopenh264：只有码率模式与 profile
      args.push('-rc_mode', 'bitrate', '-profile:v', 'high');
    }
    warn(`（兜底编码器 ${vcodec}：按 ${br} 显式码率出片 —— 它不支持 -crf；想要 crf16 + tune grain 请装 GPL 构建）`);
  }
  // ⚠ `-shortest` 必须与 `-af apad` 成对（`docs/history/IMPROVEMENTS-4-5.md` §1）：AAC 封装有
  //   priming/padding，音频流的记账时长会比视频**短几十毫秒**，单独用 `-shortest` 会把
  //   视频尾巴切掉几帧（optifine 那次 −3 帧就是这么来的）。`apad` 把音轨补成无限长（补静音），
  //   于是 `-shortest` 必然停在视频最后一帧上：音轨短了补齐、长了切掉，视频一帧不丢。
  if (withAudio) args.push('-c:a', 'aac', '-b:a', '320k', '-af', 'apad', '-shortest');
  args.push('-movflags', '+faststart', out);

  const ffCmd = ffmpegCmd();
  const ff = spawn(ffCmd[0], [...ffCmd.slice(1), ...args], { stdio: ['pipe', 'inherit', 'inherit'] });
  let ffErr = '';
  ff.on('error', (e) => { ffErr = String(e); });

  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once('listening', r));
  const port = /** @type {any} */ (wss.address()).port;
  const wsUrl = `ws://127.0.0.1:${port}`;

  // 自检：页面能不能连到我们的端口？连不上就别干等，直接把原因说出来。
  const reach = await session.page.evaluate(async (u) => {
    try { await fetch(u.replace('ws://', 'http://'), { mode: 'no-cors' }); return 'ok'; }
    catch (e) { return `fetch 失败: ${e && e.message}`; }
  }, wsUrl).catch((e) => `evaluate 失败: ${e.message}`);
  if (reach !== 'ok') warn(`⚠ 页面无法访问 ${wsUrl}（${reach}）——推流会失败`);

  let frames = 0;
  const samplesHist = new Map();
  const t0 = Date.now();
  let finished = false;
  /**
   * `--keep-raw <文件>`：把推给 ffmpeg 的**原始 NV12 字节**同时落一份盘。
   *
   * 为什么需要它：验收（`verify`）只能拿**编码后的成片**去比，而 h264 的
   * 色度二次采样在"480 根 2px 细竖线"这类高频画面上会让 mean 抬到 7–8、
   * >16 占 13–17% —— 那到底是"渲染不一样"还是"压缩损失"，光看成片分不出来。
   * 有了原始字节，就能做**不带编码器**的对照：raw 第 N 帧 vs 另一个会话渲的同一帧
   * （`tools/probe-determinism.mjs` 就是这么验的，结论是逐字节相同）。
   */
  const rawOut = opt('keep-raw', '');
  const rawFile = rawOut ? path.resolve(ROOT, rawOut) : null;
  /** @type {Buffer[]} */
  const rawChunks = [];
  const rawLimit = Number(opt('keep-raw-frames', '0')) || Infinity;
  /**
   * 每帧的 `post.shake`（页面把它塞在帧头里一起送回来）。
   *
   * 为什么要收它：`docs/history/IMPROVEMENTS-1-3.md` 那次事故（"最后像地震"）是**成片出来之后**
   * 才靠相邻帧互相关查出来的。shake 是设计值、又跟着帧一起回来，收尾顺手统计一下
   * 就能在出片当场报警 —— 不用再等成片，也不用解析成片。
   * 判据在 `scripts/lib/shake.mjs`（逐帧变化量 ≈ 幅度 ⇒ 逐帧白噪声 ⇒ 60fps 下是振动）。
   * @type {{dx:number,dy:number}[]}
   */
  const shakeSeq = [];
  /**
   * **模块图 mtime 守门**（`docs/history/IMPROVEMENTS-1-3.md` P2-2 的后半条）。
   *
   * 渲染期间改动 `src/` 或 `tasks/<任务>/scenes/` 下的文件 → 私有 Vite 会 HMR
   * 重载页面 → WebSocket 断流 → 推帧提前结束。历史症状是「CLI 报 ✓ 出片成功，
   * 但 mp4 只有前若干帧」（2880 帧被截成 152 帧）。帧数守门能抓到结果，但要等它
   * 跑完，而且报错信息指向"断流"而不是"你改了文件"。
   *
   * 所以这里在渲染开始时把**模块图内**文件的 mtime 记下来，收尾时再比一次：
   * 变了就**明说是哪个文件变了**。`docs/`、音频、`*.md` 不在模块图里，因此不会触发这条 ——
   * ⚠ 但这**不等于**"渲染期间可以写它们"：它们照样可能让 Vite 崩（见 AGENTS.md §7 / docs/history/STATUS-rounds-7-10.md §14.5）。
   */
  const watchStart = flag('no-hmr-guard') ? null : sourceMtimes();
  const total = Math.max(1, Math.round((to - from) * fps));
  let lastSent = 0;
  let client = null;
  /**
   * 「上次看到进展」的时刻与原因。看门狗只看**没有进展**，不再看"距上一帧多久"——
   * 后者在正确工作的背压上必然误报（见下面看门狗的注释）。
   */
  let lastProgressAt = Date.now();
  let progressWhy = '等待页面连接';
  let everConnected = false;
  /** ffmpeg 是否可能仍在处理数据（进程活着且我们还没 end 它的 stdin） */
  let stdinClosed = false;
  let ffExitCode = null;
  let ffExitSignal = null;
  /** ffmpeg 卡了多久没 drain（用于把"背压很慢"和"真的死了"分开） */
  let blockedSince = 0;
  let lastStdoutAt = Date.now();
  let lastFileSize = 0;
  let maxBlockedMs = 0;
  const bump = (why) => { lastProgressAt = Date.now(); progressWhy = why; };

  /**
   * ffmpeg 的 stdin 出错（EPIPE）要**吞掉**，不能让进程崩在栈上。
   *
   * 场景：编码器提前退出（参数不认 / 编码器不存在），我们这边还在写帧 —— 写管道必然 EPIPE。
   * 以前这个错误没人接，于是 CLI 打出一段 Node 栈就退出，看不出"是 ffmpeg 死了"。
   * 现在：写失败由 `ff.on('close')` 那条路**说人话**，这里只负责别崩。
   */
  ff.stdin.on('error', (e) => {
    ffExitSignal = ffExitSignal ?? `stdin ${e?.code ?? 'error'}`;
  });

  /**
   * 背压状态。ffmpeg 比渲染慢时 `stdin.write()` 返回 false，此时**必须停发 ack**：
   * 页面是「发一帧等一个 ack」的，只要不回 ack 它就停下来等；
   * 不回 ack 又继续写就会把几百帧 8MB 的 RGBA 全堆在 Node 内存里（1080p 一帧 8.3MB）。
   * 但也不能一直不 ack：drain 之后把攒下的 ack 补上。
   */
  let ffBlocked = false;
  let pendingAck = 0;
  let lastQueued = 0;
  const flushAcks = () => {
    if (ffBlocked || !pendingAck) return;
    const n = pendingAck;
    pendingAck = 0;
    try { for (let i = 0; i < n; i++) client?.send('ack'); } catch { /* 断了 */ }
  };
  ff.stdin.on('drain', () => {
    const blockedMs = blockedSince ? Date.now() - blockedSince : 0;
    if (blockedMs > maxBlockedMs) maxBlockedMs = blockedMs;
    blockedSince = 0;
    ffBlocked = false;
    lastStdoutAt = Date.now();
    bump('ffmpeg 排空了缓冲（drain）');
    flushAcks();
  });

  /** @type {() => void} */
  let finish = () => {};
  const doneP = new Promise((resolve) => {
    finish = () => { if (!finished) { finished = true; resolve(undefined); } };
  });

  /**
   * 场景抛异常时页面推过来的诊断（P0-3）。两个作用：
   *   ① **立刻停**：异常往往从某一帧开始、"之后每一帧都崩"（beast 那次就是
   *      `slot` 被遮蔽，从 121.2s 起整屏暗红）。让一整段错误画面流进成片毫无意义，
   *      而且流完了 CLI 还报 ✓ —— 所以连续崩够几帧就收工，交给下面判死。
   *   ② 单帧偶发（比如某个边界时刻的 NaN）不立刻停，但收尾时**一样报错不出片**。
   */
  const renderErrors = [];
  let consecErrFrames = 0;
  const ERR_STOP_AFTER = Number(opt('err-stop', '5'));

  /**
   * 非有限值扫描（BACKLOG 1-4）：页面每 `scanNf` 帧扫一次那一帧的浮点 RT 并推一条
   * `{diag:'nonFinite'}`。这里只收集 + 实时报第一条（同一段不刷屏），收尾交给 `reportNonFinite()`。
   *
   * ⚠ 这条诊断**绝不参与帧计数**：文本消息在下面的 `if (!isBinary)` 分支里就被吃掉了。
   */
  const scanNf = resolveScanNf();
  /** @type {any[]} */
  const nfHits = [];
  const nfWarned = new Set();
  /** 扫到就停（显式开关；默认只报告） */
  const nfStop = flag('nf-stop');
  let nfStopped = false;
  if (scanNf > 0 && !quiet) {
    log(`  · 非有限值扫描：每 ${scanNf} 帧 1 帧（--scan-nf 0 关掉；--nf-stop 扫到就停）`);
  }

  // 页面每帧：帧头 4 字节 = 子帧数，其后是 RGBA。收满或断连就结束。
  wss.on('connection', (ws) => {
    client = ws;
    everConnected = true;
    bump('浏览器已连接');
    log(`· 浏览器已连接（${wss.clients.size} 条），开始推帧`);
    ws.on('message', (msg, isBinary) => {
      if (!isBinary) {
        // 文本消息：'ack' 之外就是诊断。绝不能参与帧计数。
        try {
          const d = JSON.parse(String(msg));
          if (d && d.diag === 'renderError') {
            renderErrors.push(d);
            consecErrFrames++;
            bump(`场景抛异常（${d.id} t=${Number(d.t).toFixed(2)}s）`);
            if (renderErrors.length <= 3) {
              warn(`\n  ⚠ [${d.id}] t=${Number(d.t).toFixed(3)}s 场景 render 抛异常：${String(d.message).split('\n')[0]}`);
            }
            if (ERR_STOP_AFTER > 0 && consecErrFrames >= ERR_STOP_AFTER && !finished) {
              warn(`\n  ✗ 连续 ${consecErrFrames} 帧场景抛异常，停止渲染（这段之后每一帧都会是错帧卡片）。`);
              warn(`    用 node scripts/anim.mjs check <任务> 复现，或 still --only ${d.id} -t ${Number(d.t).toFixed(2)} 看图。`);
              finish();
            }
          } else if (d && d.diag === 'nonFinite') {
            // 出片路径的「整屏白 / 单帧白多帧黑」判据（BACKLOG 1-4）：只报告，默认不停。
            nfHits.push(d);
            // 实时只报**每一段的第一条**：一个 shader 写坏了通常是整段整段地坏，
            // 每帧都打一遍会把几十行的进度日志淹掉（要完整清单看收尾汇总）。
            // 分块渲染时带上块号：`atFrame` 是**块内**帧号，不带块号会被读成整片帧号。
            const key = d.id ?? '(未知段)';
            if (!nfWarned.has(key) && nfWarned.size < 6) {
              nfWarned.add(key);
              warnNonFiniteHit(d, chunk ? `[${chunk}] ` : '');
            }
            bump(`非有限值（${key} t=${Number(d.t).toFixed(2)}s）`);
            if (nfStop && !finished) {
              nfStopped = true;
              warn(`\n  ✗ --nf-stop：扫到非有限值就停下（[${key}] ${nonFiniteWhere(d)}）。`);
              warn(`    这一段的画面已经错了，继续渲下去只是把错帧多写几百帧进产物。`);
              finish();
            }
          }
        } catch { /* 不是 JSON 就忽略（'ack' 之类） */ }
        return;
      }
      /**
       * ⚠ 提前收工之后还可能收到几帧 —— `--nf-stop` / 连续场景异常 / 看门狗都会在
       * `frames < total` 时收工，而页面是「发一帧等一个 ack」的流水线（`inflight` 默认 4），
       * 那时**已经有几帧在路上**。等它们到达时 ffmpeg 的 stdin 可能已经 `end()` 了，
       * 再 `write()` 会抛 `ERR_STREAM_WRITE_AFTER_END`：**整个进程崩掉**，栈里只有 streams
       * 内部帧，看不出真正的原因，连收尾要打印的那句话都打不出来（实测踩到）。
       * 这些帧**不计数也不写**：产物本来就要删掉，计进去只会让人以为"帧数是齐的"。
       */
      if (finished || stdinClosed) return;
      frames++;
      consecErrFrames = 0;
      bump(`收到第 ${frames} 帧`);
      try {
        // msg 可能是 Buffer 也可能是裸 ArrayBuffer，统一成 ArrayBuffer 再取帧头
        const ab = msg instanceof ArrayBuffer
          ? msg
          : msg.buffer.slice(msg.byteOffset, msg.byteOffset + msg.byteLength);
        // ⚠ 帧头 12 字节：0 = 子帧数，4/8 = 这一帧的 post.shake（**物理像素**，见 post.js）。
        //   长度在 src/app.js 的 stream().step() 里写，两边必须一起改（搜 FRAME_HEADER）。
        const n = new DataView(ab).getFloat32(0, true);
        samplesHist.set(n, (samplesHist.get(n) ?? 0) + 1);
        const dv0 = new DataView(ab);
        shakeSeq.push({ dx: dv0.getFloat32(4, true), dy: dv0.getFloat32(8, true) });
        const payload = Buffer.from(ab, FRAME_HEADER);
        if (rawFile && frames <= rawLimit) rawChunks.push(Buffer.from(payload));
        // write() 返回 false = 内核缓冲已满：记住状态，drain 之后再把 ack 放出去
        if (!ff.stdin.write(payload)) {
          if (!ffBlocked) blockedSince = Date.now();
          ffBlocked = true;
        }
      } catch (err) {
        // 这里绝不能抛：一抛就不再发 ack，页面会永远等下去
        warn('  处理帧失败:', err && err.message);
      }
      if (frames % 30 === 0 || frames === total) {
        const el = (Date.now() - t0) / 1000;
        const bp = ffBlocked ? `  背压中(积压 ${(ff.stdin.writableLength / 1048576).toFixed(1)}MB)` : '';
        process.stdout.write(`\r  ${frames}/${total} 帧  ${(frames / el).toFixed(1)} fps  ETA ${((total - frames) / (frames / el)).toFixed(0)}s${bp}   `);
      }
      // 被 ffmpeg 顶住时只记账、不发 ack，等 drain（页面自然就停下来等了）
      pendingAck++;
      flushAcks();
      if (frames >= total) finish();
    });
    ws.on('close', () => { if (!finished) finish(); });
    ws.on('error', (e) => { warn('  WebSocket 错误:', e.message); if (!finished) finish(); });
  });

  ff.on('close', (code, signal) => {
    ffExitCode = code; ffExitSignal = signal;
    // ffmpeg 已经退出：stdin 上再也不会触发 drain，别让 pendingAck 把页面吊在那里
    ffBlocked = false;
    flushAcks();
    /**
     * **提前退出就是失败，立刻收工**（2026-10-26）。
     *
     * 以前这里只记账，于是编码器一死（参数不认 / 编码器不存在 / 磁盘满 / 输出被占用），
     * 页面还在欢快地推帧，CLI 一直等到看门狗（`--idle` 默认 300s）—— 实测有人挂了 20 分钟
     * 才发现 `out/*.mp4` 根本没在长。退出码非 0 且流还没收尾 ⇒ 明确报错 + 结束这次渲染，
     * 让上面的帧数/产物复核把"废片"判出来，而不是等人肉盯屏。
     *
     * 退出码 0 不走这条路：`-shortest` 与音频等场景下它可能合法地提前结束，
     * 那种情况由帧数守门负责判定（"只渲染了 N/M 帧"）。
     */
    if (!finished && !stdinClosed && code !== null && code !== 0) {
      warn(`\n⚠ ffmpeg 提前退出（退出码 ${signedExitCode(code)}${signal ? ` / ${signal}` : ''}）—— 编码器没吃下这些参数，或磁盘写不进去。`);
      warn(`  产物作废。改 --vcodec / -crf 重跑，或换一个带 libx264 的 ffmpeg 构建。`);
      finish();
    }
  });

  /**
   * 看门狗：**只有真的没有进展才报**。
   *
   * 曾经的判据是"距上一帧超过 N 秒"→ 它把**正常工作的背压**判成了卡死：
   * ffmpeg 一慢 → 我们按设计停发 ack → 页面停在等 ack（`sent` 当然不涨）→
   * 看门狗收工 → `ff.stdin.end()` → ffmpeg 拿到半截流、永远不写 moov →
   * 产物是个打不开的 mp4，而 CLI 还以为成功了（`docs/history/IMPROVEMENTS-1-3.md` P0-1）。
   *
   * 现在的判据是"四个信号全都静止了"：
   *   ① 收到新帧   ② 页面侧 sent 在涨   ③ ffmpeg 在排水（stdin 缓冲在变短 / 刚 drain 过）
   *   ④ 输出文件在变大
   * 任一条成立就续命 —— 那说明系统在干活，只是慢。
   */
  const idleLimit = Number(opt('idle', '300'));
  const watchdog = setInterval(async () => {
    if (finished) { clearInterval(watchdog); return; }
    const idle = (Date.now() - lastProgressAt) / 1000;
    if (idle < idleLimit) return;

    // ③ ffmpeg 还在排水吗？（缓冲在变短，即使还没 drain）
    const queued = ff.stdin.writableLength;
    if (queued < lastQueued - 4096) {
      lastQueued = queued;
      bump(`ffmpeg 在排水（积压 ${(queued / 1048576).toFixed(1)}MB）`);
      return;
    }
    lastQueued = queued;
    // ④ 产物文件还在变大吗？（ffmpeg 把已经编码的数据刷出去了）
    try {
      if (existsSync(out) && statSync(out).size > lastFileSize) {
        lastFileSize = statSync(out).size;
        lastStdoutAt = Date.now();
        bump('ffmpeg 仍在写出文件');
        return;
      }
    } catch { /* 文件还没建出来 */ }
    // ② 页面还在往外发吗？（我们还没收完）
    let pagePath = null;
    try {
      const st = await session.page.evaluate(() => /** @type {any} */ (window).__anim.debug());
      pagePath = st?.stream ?? null;
    } catch { /* 页面可能已经没了，继续按 idle 判定 */ }
    const pageSent = pagePath?.sent ?? -1;
    if (pageSent > lastSent) {
      lastSent = pageSent;
      bump(`页面仍在推（已发出 ${pageSent}）`);
      return;
    }

    if (idle < idleLimit * 1.5) return;   // 给收尾留够时间
    finished = true;
    clearInterval(watchdog);
    // 分清两种"没帧"：背压是「在等 ffmpeg 排水」，不是「页面停了」。
    // 混为一谈会把人引向完全错误的排查方向（曾经去查页面崩没崩、WS 断没断，全查错了）。
    if (ffBlocked && ff.exitCode === null) {
      warn(`\n⚠ 等 ffmpeg 排水超时：${idle.toFixed(0)}s 没有进展（已收到 ${frames}/${total}）`);
      warn(`  ffmpeg 还活着，但已经 ${((Date.now() - blockedSince) / 1000).toFixed(0)}s 没能把积压排掉（积压 ${(queued / 1048576).toFixed(1)}MB）。`);
      warn(`  这不是页面卡住。多半是编码器太慢或被系统抢了 CPU（试试 --preset veryfast / 更小的 --scale）。`);
    } else {
      warn(`\n⚠ 渲染停滞：${idle.toFixed(0)}s 没有任何进展（已收到 ${frames}/${total}）`);
      warn(`  页面推流状态: ${JSON.stringify(pagePath ?? '(取不到)')}`);
      warn(`  已连接客户端: ${wss.clients.size}   ffmpeg 退出码: ${ff.exitCode}  ffErr: ${ffErr || '(无)'}`);
      warn(`  提示：真正卡住时多半是页面崩了、WebSocket 断了，或渲染期间改了 tasks//src/（HMR 重载页面）。`);
    }
    warn(`  最近一次进展：${progressWhy}`);
    finish();
  }, 2000);

  // 视频序列是同步渲染的，这里直接触发；不需要等连接建立
  const started = await session.page.evaluate((o) => {
    const api = /** @type {any} */ (window).__anim;
    if (!api || typeof api.stream !== 'function') return { err: '__anim.stream 不可用' };
    try { return { ok: api.stream(o) }; } catch (e) { return { err: String(e && e.message ? e.message : e) }; }
  }, {
    from, to, fps, ws: wsUrl,
    samples: samples === 'auto' ? 'auto' : Number(samples), shutter, inflight: Number(opt('inflight', '4')),
    // 非有限值扫描的频率交给页面（页面按帧号决定扫哪几帧，见 src/app.js 的 stream()）
    scanNf,
  });
  if (started.err) die(`无法启动推流：${started.err}`);
  log(`· 推流参数已下发 → ${wsUrl}（共 ${total} 帧）`);

  await doneP;
  clearInterval(watchdog);
  try { client?.close(); } catch { /* ignore */ }
  process.stdout.write('\n');

  /**
   * 收尾。**这里必须等 ffmpeg 真的把 moov 写完**：
   * stdin 一 end，ffmpeg 还要把编码器里的帧刷完、写索引 —— 1080p60 的片子这一下
   * 可能要几十秒。以前这里没有上限，卡住就永远挂着；现在给它一个明确的期限，
   * 超时就杀掉，并让随后的 ffprobe 守门把废品判出来。
   */
  const finalizeLimit = Number(opt('finalize', '180')) * 1000;
  // ⚠ stdin 可能**已经死了**（ffmpeg 提前退出 ⇒ EPIPE）：这时再 end() 会抛一个没人接的错误。
  //   直接跳过，让下面的 `code` 走"已退出"分支（退出码非 0 ⇒ 上层会把这次渲染判成失败）。
  if (!ff.stdin.destroyed) {
    await new Promise((r) => { try { ff.stdin.end(r); } catch { r(); } });
  }
  stdinClosed = true;
  const code = ffExitCode !== null ? ffExitCode : await new Promise((r) => {
    const timer = setTimeout(() => {
      warn(`\n⚠ ffmpeg 在 ${(finalizeLimit / 1000).toFixed(0)}s 内没有退出（应该是在写 moov）。已强制结束它。`);
      warn(`  产物很可能不完整 —— 下面的 ffprobe 守门会判定。`);
      try { ff.kill('SIGKILL'); } catch { /* 已经没了 */ }
      r(null);
    }, finalizeLimit);
    ff.on('close', (c) => { clearTimeout(timer); r(c); });
  });  wss.close();
  if (rawFile && rawChunks.length) {
    mkdirSync(path.dirname(rawFile), { recursive: true });
    writeFileSync(rawFile, Buffer.concat(rawChunks));
    log(`· 原始帧已另存 ${path.relative(ROOT, rawFile)}（${rawChunks.length} 帧 × ${(pw * ph * 3) >> 1} 字节 NV12，给对照实验用）`);
  }
  // 渲染期间改了模块图内的文件？→ 点名报出来（P2-2）
  const cookedSources = changedSources(watchStart, watchStart ? sourceMtimes() : null);
  if (cookedSources.length) {
    warn(`\n⚠ 渲染期间这些源文件被改动了（会触发 HMR 重载 → 推帧可能提前结束）：`);
    for (const f of cookedSources.slice(0, 10)) warn(`  · ${f}`);
    warn(`  这条片子**可能混合了两个版本**，不该被当成成片。`);
    warn(`  渲染期间**一个文件都别写**（连 docs/*.md 也不行，见 AGENTS.md §7）。`);
  }
  if (ffErr) warn('ffmpeg 启动失败:', ffErr);
  const hist = [...samplesHist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}子帧:${v}帧`).join('  ');
  // 抖动守门（docs/history/IMPROVEMENTS-1-3.md 建议 F）：只统计**设计值**，不碰成片。
  const shake = shakeSeq.length
    ? analyzeShake(shakeSeq, { fps, from, checkTail: to >= (info.duration ?? to) - 1e-6 })
    : null;
  // 非有限值：实时那条已经在收到时就打过了（每段第一条），这里给**完整汇总**
  // （扫了几帧 / 命中几帧 / 哪几段）。分块渲染时由 renderSegments 汇总（quiet）。
  if (!quiet) {
    reportNonFinite(nfHits, { scanNf, scanned: scanNf > 0 ? Math.ceil(frames / scanNf) : 0 });
  }
  return {
    code, frames, samplesHist: hist, elapsed: Date.now() - t0,
    total, stalled: frames < total, everConnected, ffBlocked, maxBlockedMs,
    exitSignal: ffExitSignal, progressWhy, renderErrors,
    /** 出片期间扫到的非有限值（`--scan-nf`，BACKLOG 1-4）；空数组 = 扫过、干净 */
    nonFinite: nfHits,
    /** 扫了几帧（0 = 没扫 —— 注意「没扫」≠「干净」，与 BACKLOG 1-19 同一个口径） */
    nfScanned: scanNf > 0 ? Math.ceil(frames / scanNf) : 0,
    /** `--nf-stop` 扫到非有限值而提前停下 */
    nfStopped,
    /** 这一段的 `post.shake` 统计（见 scripts/lib/shake.mjs）；没有帧时为 null */
    shake,
    /** 原始逐帧 shake（分块渲染要靠它把各块接起来算整片）；调用方不关心 */
    shakeSeq,
    /** 渲染期间改动过的源文件（模块图 mtime 守门，P2-2） */
    changedSources: cookedSources,
  };
}

/**
 * 渲染完之后问页面「有哪些场景抛过异常」。
 *
 * ⚠ 时机必须在推流**结束之后**：契约禁止在回 ack 前调 `page.evaluate`
 *   （页面正跑同步渲染循环等 ack，我们却去问它 → 死锁）。收尾阶段循环已经停了，
 *   这时候问是安全的，而且能补上 WS 诊断可能漏掉的部分。
 *
 * ⚠ 默认**取走并清零**（`take`）：分块渲染时每一块都是独立的一次 `renderToFile`，
 *   如果只读不清，第 2 块会把第 1 块的异常也算到自己头上。
 *
 * @param {{ take?: boolean }} [opts]
 * @returns {Promise<{ count: number, text: string[] }>}
 */
async function collectRenderErrors(opts = {}) {
  if (!session) return { count: 0, text: [] };
  try {
    return await session.page.evaluate(
      (take) => {
        const api = /** @type {any} */ (window).__anim;
        return take ? api.takeRenderErrors() : api.renderErrors();
      },
      opts.take !== false,
    );
  } catch {
    return { count: 0, text: [] };
  }
}

/**
 * 场景抛异常 = 硬失败（P0-3）：**不产出、非零退出、点名是哪一段**。
 *
 * 为什么不能只警告：错帧卡片会**正常地**流进成片（帧数够、ffprobe 也挑不出毛病），
 * 于是 CLI 打印 ✓、成片里却有一段是崩溃卡片。旧行为更糟 —— 整帧暗红，
 * 连"这是崩了"都看不出来（beast 那次 check 三次全绿）。
 */
function failOnRenderErrors(errs, extra = '') {
  if (!errs || !errs.count) return;
  warn(`\n✗ 有 ${errs.count} 帧渲染时场景抛异常，画面不可用：`);
  for (const line of errs.text.slice(0, 8)) warn('  · ' + line);
  if (errs.text.length > 8) warn(`  · …还有 ${errs.text.length - 8} 处的段`);
  warn(`\n  这些帧画出的是**错帧卡片**（暗红底 + 红框 + ✗ SCENE ERROR），不是画面内容。`);
  // ⚠ 措辞按「已知 / 未知」分开（`docs/BACKLOG.md` 1-3）：场景抛异常是**确定性**的 ——
  //   同一份代码、同一个时刻，跑多少次都是同一个异常。以前这里只说"复现"，
  //   读的人很容易顺手重跑一遍出片命令，白等一整片的时间（而且产物还是会被删掉）。
  warn(`  ${knownCauseHeadline('scene')}`);
  warn(`  下一步：① 复现并点名：node scripts/anim.mjs check <任务>（会报段名与时刻）；`);
  warn(`          ② 看那一帧的图：node scripts/anim.mjs still <任务> -t <时刻> --only <段>；`);
  warn(`          ③ 改代码 —— **不要直接重跑出片**：不修代码的重跑会得到同样的错帧卡片。`);
  if (extra) warn('\n' + extra);
  process.exitCode = 1;
  die(`场景抛异常，已停止（不产出成片）。`);
}

/**
 * 一句"这是已知原因 / 原因未知"的定性（纯函数，与 `decideGateFailure` 同一套口径）。
 * @param {'scene'|'interrupted'} kind
 */
function knownCauseHeadline(kind) {
  if (kind === 'scene') {
    return '这是**已知原因**（确定性）：场景代码在某个时刻抛异常，重跑不会有不同结果。';
  }
  if (kind === 'interrupted') {
    return '这是**已知原因**（确定性）：画面渲染到一半停了（断流/崩溃），同一份代码、同样的环境重跑会停在同一个地方。';
  }
  return '这条不匹配任何已知的确定性根因，可能是瞬时的（磁盘满 / 内存耗尽 / 被外部中断 / GPU 掉线）。';
}

/* ------------------------------------------------ 出片路径的非有限值扫描（BACKLOG 1-4） */

/**
 * `--scan-nf[=N]` 的解析：**每 N 帧扫一次这一帧的浮点 RT**。
 *
 *   `--scan-nf`      不跟数字 → 默认频率（`DEFAULT_SCAN_NF`，实测定的）
 *   `--scan-nf 1`    每帧都扫（量代价用；出片太慢）
 *   `--scan-nf 0`    关掉（不扫就是不扫，一个字都不多打）
 *
 * ⚠ 不能直接用 `opt('scan-nf', …)`：裸 `--scan-nf`（后面跟的是别的开关）时
 *   `opt()` 会把下一个参数当成频率，`Number('--samples')` = NaN 一路传下去 →
 *   页面侧 `i % NaN === 0` 恒为 false ⇒ **静默不扫**（这正是 1-19「空 ≠ 干净」那一类坏法）。
 */
function resolveScanNf() {
  const i = rest.indexOf('--scan-nf');
  if (i < 0) return DEFAULT_SCAN_NF;
  const v = rest[i + 1];
  if (v === undefined || v.startsWith('-')) return DEFAULT_SCAN_NF;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(1, Math.floor(n));
}

/**
 * `check` 与出片路径**共用同一句话**（措辞照抄 `cmdCheck`，别发明新词）：
 *
 *   ← ⚠ 非有限值：NaN n / Inf n / 量级>5e4 n 像素（首个坏像素 x=… y=…，kind）
 */
function nonFiniteLine(d) {
  const where = d.first ? `（首个坏像素 x=${d.first.x} y=${d.first.y}，${d.first.kind}）` : '';
  return `非有限值：NaN ${d.nan} / Inf ${d.inf} / 量级>5e4 ${d.huge} 像素${where}`;
}

/** 「这是哪一类根因」——与 `check` 的同一条一字不差。 */
function nonFiniteWhy() {
  return [
    '这是「整屏白 / 单帧白多帧黑」的一类根因：shader 里除了 0、开了 normalize(0)',
    '（多半是相机 uniform 全 0）或 pow(0, 负数）。见 node tools/probe-raymarch.mjs',
  ];
}

/**
 * 「第几帧、什么时刻」那一小段（实时与汇总共用）。
 *
 * ⚠ 多子帧时扫的是**这一帧的第一个子帧**（`subT`），段名按 `subT` 取 —— 紧挨切点的那一帧
 *   会出现 `t` 在新段、而扫到的图还是旧段的（实测踩过：Inf 段被标成 NaN）。
 *   所以只要 `subT ≠ t` 就把两个时刻都写出来，别让读者以为报的是恰好 t 的那张图。
 */
function nonFiniteWhere(d) {
  const t = Number(d.t);
  const subT = d.subT == null ? t : Number(d.subT);
  const head = `t=${t.toFixed(3)}s（第 ${d.atFrame} 帧`;
  return Math.abs(subT - t) > 5e-4
    ? `${head}，扫的是这一帧的第一个子帧 t=${subT.toFixed(3)}s）`
    : `${head}）`;
}

/** 实时那条警告（每段只报第一条，避免刷屏）。`prefix` 给分块渲染带块号用。 */
function warnNonFiniteHit(d, prefix = '') {
  const id = d.id ?? '(未知段)';
  warn(`\n  ⚠ ${prefix}[${id}] ${nonFiniteWhere(d)}`);
  warn(`     ← ⚠ ${nonFiniteLine(d)}`);
  for (const l of nonFiniteWhy()) warn(`     ${l}`);
}

/**
 * 收尾汇总：出片期间扫到的非有限值。
 *
 * 为什么默认**只报告、不中断也不删产物**：「画面已经错了」和「要不要停下」是两件事
 * （12 分钟的片子扫到一处 NaN 就整条停掉、把已经渲好的几百帧丢掉，代价比这一处错更大）。
 * 想中断就显式加 `--nf-stop`。
 *
 * @param {any[]} hits 页面推来的 `diag: 'nonFinite'` 消息（可能来自多个分块）
 * @param {{ scanNf?: number, scanned?: number, what?: string, quiet?: boolean }} [opts]
 */
function reportNonFinite(hits, opts = {}) {
  if (!hits || !hits.length) return;
  // 按段聚合：同一段报第一条就够（一个 shader 写坏了一路，通常是整段整段地坏）
  const bySeg = new Map();
  for (const h of hits) {
    const key = h.id ?? '(未知段)';
    const cur = bySeg.get(key);
    if (cur) { cur.n++; continue; }
    bySeg.set(key, { first: h, n: 1 });
  }
  const head = opts.what ? `出片期间${opts.what}` : '出片期间';
  warn(`\n⚠ ${head}扫到非有限值（NaN / ±Inf）—— 这些帧的画面已经错了：`);
  for (const [id, g] of [...bySeg.entries()].slice(0, 8)) {
    const d = g.first;
    warn(`  · ${d.chunk ? `[${d.chunk}] ` : ''}[${id}] ${nonFiniteWhere(d)}  ← ⚠ ${nonFiniteLine(d)}`
      + (g.n > 1 ? `  （这一段共扫到 ${g.n} 帧）` : ''));
  }
  if (bySeg.size > 8) warn(`  · …还有 ${bySeg.size - 8} 段`);
  const freq = opts.scanNf ? `每 ${opts.scanNf} 帧扫 1 帧` : '（频率未知）';
  warn(`  扫描频率 ${freq}${opts.scanned ? `（共扫了 ${opts.scanned} 帧），命中 ${hits.length} 帧` : `，命中 ${hits.length} 帧`}`);
  for (const l of nonFiniteWhy()) warn(`  ${l}`);
  warn(`  下一步：① node scripts/anim.mjs check <任务>（会点名段名与时刻，并再扫一次）；`);
  warn(`          ② node scripts/anim.mjs still <任务> -t <时刻> --only <段> 看一眼那一帧；`);
  warn(`          ③ 画面是**单帧白 / 成片黑**就正是这一类：多子帧那条路会把 NaN/Inf 丢掉。`);
  warn(`  （默认只报告、不中断：产物已保留 —— 要不要重出由你决定；想渲染时就停下用 --nf-stop）`);
}

async function cmdPerf() {
  const task = pickTask();
  const from = Number(opt('from', '0'));
  await openSession({ task, only: opt('only', undefined) });
  try {
    const info = session.info;
    const to = Number(opt('to', String(Math.min(info.duration, from + 5))));
    const samples = opt('samples', '1');
    log(`性能测量 ${from}→${to}s  samples=${samples}  (${info.width}×${info.height}${info.scale > 1 ? ' ×' + info.scale : ''})`);
    const r = await session.page.evaluate(async ({ from, to, samples, shutter }) => {
      const api = /** @type {any} */ (window).__anim;
      const ms = [];
      const used = {};
      for (let t = from; t < to; t += 1 / 60) {
        const a = performance.now();
        const res = await api.frame(t, { samples: samples === 'auto' ? 'auto' : Number(samples), shutter });
        await api.stats();
        ms.push(performance.now() - a);
        used[res.samples] = (used[res.samples] ?? 0) + 1;
      }
      ms.sort((x, y) => x - y);
      return {
        n: ms.length,
        avg: ms.reduce((a, b) => a + b, 0) / ms.length,
        p50: ms[ms.length >> 1], p95: ms[Math.floor(ms.length * 0.95)], max: ms[ms.length - 1],
        used,
      };
    }, { from, to, samples, shutter: Number(opt('shutter', '0.5')) });
    log(`  帧数 ${r.n}  平均 ${r.avg.toFixed(1)}ms  p50 ${r.p50.toFixed(1)}ms  p95 ${r.p95.toFixed(1)}ms  最慢 ${r.max.toFixed(1)}ms`);
    log(`  子帧分布 ${Object.entries(r.used).map(([k, v]) => `${k}:${v}`).join('  ')}`);
    const perFrame = r.avg + Number(opt('encode', '8'));
    const totalFrames = info.duration * 60;
    const minutes = (totalFrames * perFrame) / 60000;
    log(`  按 ${totalFrames.toFixed(0)} 帧算，整片约 ${minutes.toFixed(1)} 分钟（含编码开销）`);
  } finally { await closeSession(); }
}

/* ------------------------------------------------------------------ 抖动体检 / 音频分轨 */

/**
 * `anim shake <任务>` —— 把整片的 `post.shake` 拉出来量一遍（docs/history/IMPROVEMENTS-1-3.md 建议 E）。
 *
 * 为什么需要这条命令：那次事故（用户说"最后像地震"）是**成片出来之后**才靠
 * "相邻帧互相关"反查出来的 —— 眼睛先发现、工具后确认。shake 是场景里的**设计值**，
 * 本来就拿得到，所以这条命令把它变成"工具先发现"：
 *
 *   · 逐帧变化量 ≈ 幅度  ⇒ 逐帧白噪声（`hash2(f.idx)`），60fps 下是**振动**，不是手持
 *   · 收尾段幅度 ≫ 中段   ⇒ 镜头停住了画面还在晃（"越到后面越像地震"的就是这个）
 *
 * 只跑 `samples: 1` 且**不读像素**。跑多快取决于场景本身：promo 的走廊段约 8ms/帧，
 * 而 raymarch 段（大厅/隧道）要 170ms/帧 —— 所以**慢是正常的**，命令会分批打进度；
 * 想快就用 `--from/--to` 只体检有疑虑的那一段。
 * 判据与 `video` 收尾的守门共用 `scripts/lib/shake.mjs`，两处口径一致。
 */
async function cmdShake() {
  const task = pickTask();
  const from = Number(opt('from', '0'));
  await openSession({ task, only: opt('only', undefined) });
  try {
    const info = session.info;
    const dur = info.onlyDuration || info.duration;
    const to = Number(opt('to', String(dur)));
    const fps = info.fps;
    log(`抖动体检 ${task}  ${from}–${to}s  ${fps}fps${info.only ? `  --only ${info.only}` : ''}`);
    const totalFrames = Math.max(1, Math.round((to - from) * fps));
    /**
     * ⚠ **分批** evaluate，不是一次跑完。
     *   · 一次跑整片（2880 帧）时 CLI 长时间收不到任何输出 —— 看上去就是卡死；
     *     而且 promo 的 raymarch 段要 170ms/帧，整片要几分钟。
     *   · 分批还能打进度 + ETA，出问题也知道停在哪一段。
     */
    const batch = Math.max(30, Number(opt('batch', '240')));
    /** @type {[number, number][]} */
    const seq = [];
    const errs = [];
    const tAll = Date.now();
    for (let i0 = 0; i0 < totalFrames; i0 += batch) {
      const n = Math.min(batch, totalFrames - i0);
      const part = await session.page.evaluate(async ({ from, fps, i0, n }) => {
        const e = /** @type {any} */ (window).__animEngine;
        const out = [];
        const errs = [];
        for (let i = 0; i < n; i++) {
          const t = from + (i0 + i) / fps;
          try {
            e.render(t, { samples: 1, toScreen: false });
            const s = e.lastPost && e.lastPost.shake;
            out.push(Array.isArray(s)
              ? [Number(s[0]) || 0, Number(s[1]) || 0]
              : [0, 0]);
          } catch (err) {
            if (errs.length < 2) errs.push(`t=${t.toFixed(2)}s ${String(err && err.message).split('\n')[0]}`);
            out.push([0, 0]);
          }
        }
        return { out, errs };
      }, { from, fps, i0, n });
      seq.push(...part.out);
      errs.push(...part.errs);
      const done = i0 + n;
      const sec = (Date.now() - tAll) / 1000;
      const worst = errs.length ? `  ⚠ ${errs.length} 帧抛异常` : '';
      process.stdout.write(`\r  渲染中 ${done}/${totalFrames} 帧  ${(done / sec).toFixed(1)} fps  ETA ${((totalFrames - done) / (done / sec)).toFixed(0)}s${worst}   `);
    }
    process.stdout.write('\n');
    const r = { seq, errs };

    const st = analyzeShake(r.seq, { fps, from, checkTail: to >= dur - 1 / fps - 1e-6 });
    if (flag('json')) { log(JSON.stringify(st, null, 2)); return st; }

    log(`  ${shakeSummary(st)}`);
    log(`\n  分段（每段 ${(st.n / st.segments.length / fps).toFixed(1)}s）：`);
    for (const s of st.segments) {
      log(`    ${s.from.toFixed(2).padStart(6)}–${s.to.toFixed(2).padStart(6)}s   峰值 ${s.amp.toFixed(2).padStart(6)}px   逐帧变化 ${s.stepRms.toFixed(3).padStart(6)}px`);
    }
    log(`\n  收尾段 / 中段幅度 = ${st.tailRatio.toFixed(2)}`);
    if (r.errs.length) {
      warn(`\n  ⚠ ${r.errs.length >= 3 ? '至少 3' : r.errs.length} 个时刻 render 抛异常（这些帧的抖动按 0 计）：`);
      for (const e of r.errs) warn(`    · ${e}`);
    }
    if (st.notices.length) {
      warn('');
      for (const n of st.notices) warn(`  ⚠ ${n}`);
      log(`\n  参考：post.shake 单位是**物理像素**（4K 下要乘 scale）、影响整帧（含文字/HUD）。`);
      log(`        平滑抖动用 shakeSmooth(f.t, amp)（src/core/cam.js），幅度 ≤2px 是呼吸、3–5px 是手持、≥5px 是冲击。`);
      warn(`        见 docs/history/IMPROVEMENTS-1-3.md 第三轮（"像不像手持取决于频率，不取决于幅度"）。`);
      process.exitCode = 1;
    } else {
      log(`\n  ✓ 没有发现问题（抖动平滑、且没有"停住了还在晃"）`);
    }
    return st;
  } finally { await closeSession(); }
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

  const { analyzePCM } = await import('../src/core/audio-analysis.js');
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

/* ------------------------------------------------------------------ 命令：carry（连贯度审计，BACKLOG 1-34） */

/**
 * 连贯度 oracle：每个镜头边界两侧各渲一帧，块匹配找"活过边界的东西"，
 * 分类 carried / anchored / bare，汇总 carry score。
 *
 *   node scripts/anim.mjs carry <任务>              # 全片
 *   node scripts/anim.mjs carry <任务> --strict     # score < 0.5 时退出码 1
 *   node scripts/anim.mjs carry <任务> --at 12,30   # 只查给定时刻（调试用）
 *
 * 判据出处：外部项目 onetake 的 probe（`docs/REFERENCE-onetake.md` §2，【外部经验值】）——
 * 同一条片子的四个版本 carry 0.00 / 0.40 / 0.75 / 0.83 与人审结论逐版一致，
 * 而**节奏腿四版全过**：连贯是节奏看不见的维度。判据 + 盲区（跨元素合成、连续世界）：
 *   · carried  = 有东西活过边界且动了（位移 ≥2% 对角线 或 缩放 ≥10%）
 *   · anchored = 大块幸存物没动（≥3% 画面）—— 世界没变，新内容围着它长
 *   · bare     = 互相替换 —— 无论节奏多好都读作换灯片
 *   · 豁免     = burst（1.5s 内 ≥3 切）、片尾 1.2s、`carry: 'morph'` 显式登记
 *
 * ⚠ 读数不 gate（默认退出码 0）：与版面守门同例 —— 这是一条新纪律，先让数字被看见。
 *   要卡死加 --strict。
 */
async function cmdCarry() {
  const task = pickTask();
  const strict = flag('strict');
  const atArg = opt('at', '');

  await openSession({ task, scale: Number(opt('scale', '0')) || undefined, only: opt('only', undefined) });
  try {
    const { planCarryBoundaries, classifyCarry, summarizeCarry } = await import('../src/timeline.js');
    const timeline = session.info.timeline ?? [];
    let bounds = planCarryBoundaries(timeline);
    if (atArg) {
      const times = atArg.split(',').map(Number).filter(Number.isFinite);
      bounds = bounds.filter((b) => times.some((t) => Math.abs(t - b.at) < 0.05));
      if (!bounds.length) { log('--at 给的时刻附近没有镜头边界（±0.05s）。'); return; }
    }

    if (!bounds.length) {
      // onetake probe 的盲区②（REFERENCE-onetake.md §2.3）：连续世界 / 单镜头没有边界可判，
      // "continuity 1.00 over 0 boundaries" 不是证据 —— 这里明说，不说"通过"。
      log(`时间线 ${timeline.length} 段、没有内部边界可判 —— carry 在一镜到底的片子上只能靠眼睛（CARRY 分不出来）。`);
      log('→ 这不是通过；要看衔接质量用 anim cuts 出图，或者只挑有切点的区间。');
      return;
    }

    log(`连贯度审计：${bounds.length} 个边界（${bounds.filter((b) => b.overlap > 0).length} 个交叠 / ${bounds.filter((b) => !b.overlap).length} 个硬切）`);
    log(`块匹配：每边界两侧各 1 帧 · 16×16 块 · 位移半径 3 块（判据见 docs/REFERENCE-onetake.md §2）\n`);

    const rows = [];
    for (const b of bounds) {
      // 两侧各取一帧：交叠边界取中点前 0.30s（旧段还在画）与后 0.30s（新段接手了）；
      // 硬切取切点前后各 1/6 秒（避开切点本身的转场噪声，也避开相邻内容静止帧）。
      const off = b.overlap > 0 ? 0.30 : Math.max(1 / 12, 1 / 6);
      const tA = Math.max(0, b.at - off), tB = Math.min(session.info.duration, b.at + off);
      const m = await session.page.evaluate(async ({ tA, tB, grid, maxShift, tol }) => {
        const api = /** @type {any} */ (window).__anim;
        await api.frame(tA, { samples: 1 });
        const A = new Uint8Array(await api.pixels());
        await api.frame(tB, { samples: 1 });
        const B = new Uint8Array(await api.pixels());
        // 块匹配（页面侧算：省去 8MB×2 的跨桥传输）。
        const W = api.info().width, H = api.info().height;
        const bw = Math.ceil(W / grid), bh = Math.ceil(H / grid);
        // 每块取 4×4 采样的平均灰度（128 级量化），抗噪且便宜
        const blockGray = (px, bx, by) => {
          const x0 = bx * (W / grid), y0 = by * (H / grid);
          let s = 0, n = 0;
          for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
            const x = Math.min(W - 1, Math.floor(x0 + (sx + 0.5) * (bw / 4)));
            const y = Math.min(H - 1, Math.floor(y0 + (sy + 0.5) * (bh / 4)));
            const i = (y * W + x) * 4;   // pixels() 自下而上：A/B 同序，比位移不用翻
            s += (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
            n++;
          }
          return s / Math.max(1, n);
        };
        let matched = 0, total = 0, shiftSum = 0, scaleSum = 0;
        for (let by = 1; by < grid - 1; by++) {
          for (let bx = 1; bx < grid - 1; bx++) {
            total++;
            const ga = blockGray(A, bx, by);
            let best = Infinity, bdx = 0, bdy = 0;
            for (let dy = -maxShift; dy <= maxShift; dy++) {
              for (let dx = -maxShift; dx <= maxShift; dx++) {
                const nx = bx + dx, ny = by + dy;
                if (nx < 0 || ny < 0 || nx >= grid || ny >= grid) continue;
                const d = Math.abs(ga - blockGray(B, nx, ny));
                if (d < best) { best = d; bdx = dx; bdy = dy; }
              }
            }
            if (best <= tol) {
              matched++;
              // 位移以"块"计（两帧分辨率相同，scale ≈ 1 的水平位移才是 carry 的常态；
              // 缩放检测给 morphRect/zoomThrough 那类边界：B 帧同一内容占的块数变了 ⇒ 近似
              // 用"匹配块对的间距差"没有稳定定义，退化为不报缩放，位移判据已够用）
              shiftSum += Math.hypot(bdx, bdy) * bw;
              scaleSum += 1;
            }
          }
        }
        const diag = Math.hypot(W, H);
        return {
          matched, total,
          avgShiftFrac: matched ? (shiftSum / matched) / diag : 0,
          avgScale: 1,
          quality: 1 - (matched / Math.max(1, total)) * 0, // 匹配覆盖率即质量读数
          cover: matched / Math.max(1, total),
        };
      }, { tA, tB, grid: 16, maxShift: 3, tol: 0.02 });
      const verdict = classifyCarry(m);
      rows.push({ ...b, verdict: verdict.verdict, reason: verdict.reason, cover: m.cover });
      const mark = verdict.verdict === 'carried' ? '✓ carried  ' : verdict.verdict === 'anchored' ? '· anchored ' : '✗ bare     ';
      log(`  t=${b.at.toFixed(2).padStart(7)}s  ${b.prevId} → ${b.id}${b.overlap ? `（交叠 ${b.overlap.toFixed(2)}s）` : '（硬切）'}`
        + `  ${mark} 覆盖 ${(m.cover * 100).toFixed(0)}%  位移 ${(m.avgShiftFrac * 100).toFixed(2)}% 对角线`);
      log(`      ${verdict.reason}`);
    }

    const sum = summarizeCarry(rows);
    log('');
    if (sum.noBoundaries) {
      log(`计入的边界 0 个（豁免 ${sum.exempt} 个）—— 没有可判对象，carry score 无意义。`);
    } else {
      log(`carry score = ${sum.score.toFixed(2)}（carried ${sum.carried} · anchored ${sum.anchored} · bare ${sum.bare} · 豁免 ${sum.exempt}）`
        + `  ${sum.tier === 'pass' ? '✓' : sum.tier === 'warn' ? '⚠' : '✗'} ${sum.tier === 'pass' ? '通过（≥0.7）' : sum.tier === 'warn' ? '警告（<0.7）—— 有缝在互相替换' : '不合格（<0.5）—— 大量边界互相替换，像 PPT'}`);
      log('  阈值出处：onetake probe 的标定（【外部经验值】，我方未实测）：0.00/0.40 被否、0.75/0.83 通过。');
    }
    const bareList = rows.filter((r) => r.verdict === 'bare' && !r.exemptTail && !r.registered);
    if (bareList.length) {
      warn(`\n⚠ ${bareList.length} 个 bare 边界（互相替换 —— 观众读作"换了一张灯片"）：`);
      for (const r of bareList) warn(`  t=${r.at.toFixed(2)}s  ${r.prevId} → ${r.id}：${r.reason}`);
      warn('  → 改法（都是内容层的事，不动引擎）：');
      warn('    ① 让一个东西活过边界：按下的东西变成结果（morphRect）、卡片推近成场景（zoomThrough）、');
      warn('       主体跳到下一个槽（hop）、一群元素收拢（gather）—— src/kit/carry.js 有现成纯函数；');
      warn('    ② 硬切集中在 burst 里（1.5s ≥3 切会被豁免），别匀速铺满全片；');
      warn('    ③ 跨元素合成的衔接（卡片淡出+新页淡入）对观众成立但量具判 bare —— 在 cut(..., { carry: \'morph\' }) 里声明。');
    }
    if (strict && sum.tier === 'fail') {
      warn('\n--strict：carry score < 0.5，判不合格。');
      process.exitCode = 1;
    }
    reportErrors(session.info);
    const rerr = await collectRenderErrors({ take: false });
    if (rerr.count) {
      warn(`\n⚠ 刚渲染的帧里有场景异常：${rerr.count} 帧 —— carry 读数里那些帧是错帧卡片，先修场景错误。`);
      process.exitCode = 1;
    }
    log('\n下一步：把 bare 边界的两侧用 anim cuts --at <t> 出图，亲眼看是什么替换了什么，再决定 carry 声明还是改衔接。');
  } finally { await closeSession(); }
}

/* ------------------------------------------------------------------ 命令：rhythm（静/动分段，BACKLOG 1-38） */

/**
 * 静/动分段量具：降采样渲帧 → 相邻帧差 → 静段区间表。
 *
 *   node scripts/anim.mjs rhythm <任务>              # 全片，0.5s 步长
 *   node scripts/anim.mjs rhythm <任务> --step 0.25  # 更细的采样
 *   node scripts/anim.mjs rhythm <任务> --strict    # 死静占比 <25% 或最长静段 <1s 时退出码 1
 *
 * 判据出处（【外部经验值】，docs/REFERENCE-onetake.md §3）：死静帧 ≥25% 且最长静段 ≥1s
 * ——「停顿才让动作落得下来」；**rest 必须真空静**（慢推/drift 在量具眼里永远不静，
 * clearing 假红的教训 —— 夹具 tasks/_carry-lab 的 rhythm 段就是这条判据的标定样本：
 * 静 0.5 → burst 1.0 → 静 0.8，应量出 stillRatio ≈ 0.57、最长静段 0.8s…）。
 *
 * 与 `check` 的「节奏（静态）」腿互补：那边是**镜头长度 CoV**（零渲染），这边是
 * **画面内容的静/动**（要渲帧）。跑一次的代价：帧数 = 时长 / step（16s 片 @0.5s = 33 帧，
 * 大约与 check 的试渲染同量级）。
 */
async function cmdRhythm() {
  const task = pickTask();
  const strict = flag('strict');
  const step = Math.max(0.1, Number(opt('step', '0.5')));

  await openSession({ task, scale: Number(opt('scale', '0')) || undefined, only: opt('only', undefined) });
  try {
    const { rhythmSegments } = await import('../src/timeline.js');
    const info = session.info;
    const dur = info.onlyDuration || info.duration;
    const times = [];
    for (let t = 0; t < dur; t += step) times.push(Math.min(t, dur - 0.01));
    if (times.length < 2) { log('片子太短（<2 个采样步），没有静/动可言。'); return; }

    log(`静/动分段：${times.length} 帧 × ${step}s 步长（判据 docs/REFERENCE-onetake.md §3）`);
    // 页面侧：逐帧渲 → 与前一帧差分（>6/255 的像素占比）。samples=1：静止判定不需要运动模糊。
    const steps = await session.page.evaluate(async ({ times }) => {
      const api = /** @type {any} */ (window).__anim;
      const out = [];
      let prev = null;
      for (const t of times) {
        await api.frame(t, { samples: 1 });
        const px = new Uint8Array(await api.pixels());
        if (!prev) { out.push({ t, movedFrac: 1 }); prev = px; continue; }
        let moved = 0;
        const n = Math.min(px.length, prev.length);
        for (let i = 0; i < n; i += 4) {
          if (Math.abs(px[i] - prev[i]) > 6 || Math.abs(px[i + 1] - prev[i + 1]) > 6
            || Math.abs(px[i + 2] - prev[i + 2]) > 6) moved++;
        }
        out.push({ t, movedFrac: moved / (n / 4) });
        prev = px;
      }
      return out;
    }, { times });

    const seg = rhythmSegments(steps, { step });
    log(`\n静帧占比 ${(seg.stillRatio * 100).toFixed(0)}%（判据 ≥25%）  最长静段 ${seg.longest.toFixed(2)}s（判据 ≥1s）`
      + `  静段 ${seg.holds.length} 个 / 覆盖 ${seg.total.toFixed(1)}s`);
    for (const h of seg.holds) log(`  hold  ${h.from.toFixed(2)} → ${h.to.toFixed(2)}s（${(h.to - h.from).toFixed(2)}s）`);

    const lowStill = seg.stillRatio < 0.25;
    const noHold = seg.longest < 1.0;
    if (lowStill || noHold) {
      warn(`\n⚠ ${lowStill ? '死静帧占比 ' + (seg.stillRatio * 100).toFixed(0) + '% < 25%' : ''}${lowStill && noHold ? ' 且 ' : ''}${noHold ? '没有 ≥1s 的静段' : ''}`);
      warn('  「停顿才让动作落得下来」——永远在动的片子读作屏保（onetake 的判据）。');
      warn('  → 改法：每 3–5 个动作 beat 里放一个真空静的 hold（不许慢推/drift——量具眼里那永远不静）；');
      warn('    ⚠ 场景的 post 还得把 grain 与 dither 关掉（return { grain: 0, dither: \'off\' }）：');
      warn('    默认 grain=0.035 与 dither 的种子都来自帧号，任何帧间比对都会被它们判成"在动"。');
      warn('    标定样本看 tasks/_carry-lab 的 rhythm 段（静 0.5 → burst 1.0 → 静 1.2）。');
      if (strict) {
        warn('\n--strict：静/动判据不达标。');
        process.exitCode = 1;
      }
    } else {
      log('\n✓ 静/动节奏达标（≥25% 死静 + ≥1s 最长静段）。');
    }
    reportErrors(session.info);
    const rerr = await collectRenderErrors({ take: false });
    if (rerr.count) {
      warn(`\n⚠ 渲染中有场景异常：${rerr.count} 帧 —— 上面的读数里混着错帧卡片，先修场景错误。`);
      process.exitCode = 1;
    }
  } finally { await closeSession(); }
}

/* ------------------------------------------------------------------ 命令：clean */

/** 递归算一个目录的总大小（字节）与文件数。 */
function dirStats(dir) {
  let bytes = 0, files = 0;
  const walk = (d) => {
    let ents = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { bytes += statSync(p).size; files++; } catch { /* ignore */ } }
    }
  };
  walk(dir);
  return { bytes, files };
}

/** 人类可读的大小。 */
function mb(bytes) { return `${(bytes / 1048576).toFixed(1)} MB`; }

/**
 * 清理 `out/<任务>/` 下的中间产物（`docs/history/IMPROVEMENTS-1-3.md` P2-5）。
 *
 * 背景：做 beast 那轮 `out/beast/` 峰值 ≈ 3.8 GB（分块）+ 650 MB 成片 + 284 MB 分发版
 * + 86 MB stills + 我手工产生的 `*.yuv`（每个 400 MB），**没有任何清理提示**。
 *
 * 默认只删"能重新生成、且重新生成很贵但确实只是中间物"的东西：
 *   `*.parts/`（分块，删了要重渲）、`*.yuv`/`*.nv12`、`*.rgba`、`_stitched.mp4`、`concat.txt`。
 * **不删**成片、stills、接触表、hash 基线 —— 那些是产物或验收证据。
 * `--all` 才连成片一起删（那要显式要求）。
 * `--dry-run` 只列清单不动手。
 *
 * ⚠ **`NOTES.json` 也绝不删**（BACKLOG 1-29 后半）：它是"第 12.5 秒这里字幕太小"这类反馈的
 * **唯一落点**，删掉就是不可恢复地丢反馈 —— 它不是中间产物，是项目文件。保护方式有两条：
 *   ① 结构上：下面每个分支都先过 `isProtectedOutFile()`（判据只有一处，将来加规则也不会漏）；
 *   ② 输出上：只要这个文件在，收尾就**明说"评论保留"**（读的人不必去读代码才知道它被保护了）。
 */
function cmdClean() {
  const task = pickTask();
  const dir = path.join(ROOT, 'out', task);
  if (!existsSync(dir)) die(`没有 out/${task}/（还没渲过什么东西）`);
  const dry = flag('dry-run');
  const all = flag('all');

  // 评论（NOTES.json）：既不进 targets，也不受 --all 影响，而且要说出来（见函数头 ②）
  const notesFile = path.join(dir, 'NOTES.json');
  let notesLine = null;
  if (existsSync(notesFile)) {
    const rel = path.relative(ROOT, notesFile).replace(/\\/g, '/');   // 与文档里的 `out/<任务>/NOTES.json` 一致
    try {
      const s = notesSummary(parseNotesJson(readFileSync(notesFile, 'utf8'), { file: rel }).notes);
      notesLine = `评论保留：${rel}（${s.total} 条，其中 ${s.open} 条未解决）`
        + ` —— 评论是项目文件，clean${all ? '（含 --all）' : ''} 不删它；看/记：node scripts/anim.mjs note ${task} --list`;
    } catch (err) {
      // 读不动也照样不删：坏文件留给 `anim note` 报行列（它才知道怎么修）
      notesLine = `评论保留：${rel}（读不动：${firstLine(err)}）—— clean 不删它，用 anim note 看它到底哪里坏了`;
    }
  }

  const targets = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (isProtectedOutFile(e.name)) continue;   // ← 评论永不删（判据只有一处）
    if (e.isDirectory()) {
      // 分块目录 / 诊断用的裸帧目录
      if (/\.parts$/.test(e.name) || /^_(frames|dumpframe|determinism|align|via)/.test(e.name)) {
        targets.push({ p, why: /\.parts$/.test(e.name) ? '分块（断点续渲用，删了要重渲）' : '诊断中间产物' });
      }
      continue;
    }
    if (/\.(yuv|nv12|rgba|raw)$/i.test(e.name)) targets.push({ p, why: '裸帧中间产物' });
    else if (e.name === '_stitched.mp4' || e.name === 'concat.txt') targets.push({ p, why: '分块拼接的中间文件' });
    else if (all && e.name.endsWith('.mp4')) targets.push({ p, why: '成片（--all 才会删）' });
  }

  // parts 目录里的 raw 也算上（上面按目录整体处理了，这里只算体积）
  let freed = 0;
  const rows = [];
  for (const t of targets) {
    const st = statSync(t.p);
    const s = st.isDirectory() ? dirStats(t.p) : { bytes: st.size, files: 1 };
    freed += s.bytes;
    rows.push({ ...t, ...s });
  }
  if (!rows.length) {
    log(`out/${task}/ 没有可清理的中间产物（成片与 stills 都保留）。`);
    if (notesLine) log(notesLine);
    return;
  }
  rows.sort((a, b) => b.bytes - a.bytes);
  log(`out/${task}/ 可清理的中间产物（${rows.length} 项，共 ${mb(freed)}）：`);
  for (const r of rows) {
    log(`  ${mb(r.bytes).padStart(10)}  ${String(r.files).padStart(4)} 个文件  ${path.relative(ROOT, r.p)}  —— ${r.why}`);
  }
  if (notesLine) log(`\n${notesLine}`);
  if (dry) { log(`\n（--dry-run：什么都没删）`); return; }
  for (const r of rows) {
    try { rmSync(r.p, { recursive: true, force: true }); } catch (err) { warn(`  删不掉 ${path.relative(ROOT, r.p)}：${err.message}`); }
  }
  const after = dirStats(dir);
  log(`\n✓ 已清理，释放 ${mb(freed)}；out/${task}/ 现在 ${mb(after.bytes)}（${after.files} 个文件）`);
  if (existsSync(notesFile)) log(`  ${path.relative(ROOT, notesFile)} 还在（评论没有被清掉）。`);
  if (rows.some((r) => /\.parts$/.test(r.p))) {
    log(`  ⚠ 分块已删：下次 \`video --segments\` 会全部重渲。`);
  }
}

/* ------------------------------------------------------------------ 命令：note（评论） */

/** `out/<任务>/NOTES.json` 的绝对路径。 */
function notesPath(task) {
  return path.join(ROOT, 'out', task, 'NOTES.json');
}

/** 落盘（**utf8**：评论里有中文；这是评论唯一的写入点）。 */
function writeNotes(file, o) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, serializeNotes(o), 'utf8');
}

/**
 * `anim note` 的裸参数：任务名 / 正文（跳过 `--xxx <值>` 的"值"）。
 *
 * 为什么不能直接用 `positional()`：`--at 12.5` 里的 `12.5` 不以 `-` 开头，
 * 会被当成"位置参数"混进正文里。要彻底绕开这套推断就写 `--text "…"`。
 */
function noteWords() {
  const VALUE_FLAGS = new Set(['--at', '--text', '--id', '--resolve', '--unresolve', '--task', '--out', '-o']);
  const words = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (VALUE_FLAGS.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    words.push(a);
  }
  return words;
}

/**
 * `anim note` —— 给一支片子的某一秒留一句评论（`out/<任务>/NOTES.json`，BACKLOG 1-29 后半）。
 *
 *   node scripts/anim.mjs note demo "第 12.5 秒这里字幕太小" --at 12.5   # 追加（--at 是秒，可省）
 *   node scripts/anim.mjs note demo --list [--json]                      # 列出（未解决在前 …按写入顺序）
 *   node scripts/anim.mjs note demo --resolve n1                         # 标记已解决
 *
 * 为什么是**文件**而不是别的东西：外部参考项目的 Studio 把评论做成普通项目文件
 * （`docs/REFERENCE-hypit.md` §5.5 的 `FEEDBACK.json`）—— 读写走文件、**不轮询、不重编译**。
 * 所以"这里字幕太小"是一条命令的事，不需要跑一次渲染；agent 与人都读写同一份数据。
 * 放 `out/<任务>/` 还有个副作用是对的：`out/**` 是 Vite 明确忽略的目录，
 * 渲染期间写它**不会**触发 HMR（AGENTS.md §7 那条"渲染期间一个文件都别写"的唯一例外）。
 *
 * 读写都走 `scripts/anim.mjs` 前部那组**纯函数**（`parseNotesJson` / `addNote` / `resolveNote` …），
 * 所以"这份文件到底长什么样、坏了会怎么报"可以离线断言，不用真的出一次片。
 */
function cmdNote() {
  const task = pickTask();
  const file = notesPath(task);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');   // 与文档里的 `out/<任务>/NOTES.json` 长得一样

  const words = noteWords();
  const textArg = String(opt('text') ?? (words[0] === task ? words.slice(1).join(' ') : words.join(' '))).trim();
  const ri = rest.indexOf('--resolve');
  const resolveId = ri >= 0 ? rest[ri + 1] : null;

  // 读：文件不存在 = 全新（不是错）；存在但坏了 → 报行列 + 修法（绝不当成"没有评论"）
  let cur = { notes: [], extra: {}, task };
  const hasFile = existsSync(file);
  if (hasFile) {
    let raw;
    try { raw = readFileSync(file, 'utf8'); } catch (err) { die(`${rel} 读不动：${firstLine(err)}`); }
    try { cur = parseNotesJson(raw, { file: rel }); } catch (err) { die(String(err.message)); }
    for (const w of cur.warnings ?? []) warn(`⚠ ${w}`);
    if (cur.task && cur.task !== task) warn(`⚠ ${rel} 里的 task 是 "${cur.task}"，不是 "${task}"（原样留着，没有改它）`);
  }

  // --list
  if (flag('list')) {
    const s = notesSummary(cur.notes);
    if (flag('json')) {
      log(JSON.stringify({
        schema: NOTES_SCHEMA, task, file: rel, exists: hasFile,
        total: s.total, open: s.open, resolved: s.resolved, notes: cur.notes,
      }, null, 2));
      return;
    }
    // 说清"文件还没建"与"文件在、但没有条目"的区别：它的**空**和它的**坏**都不是"干净"（BACKLOG 1-19 的同一条纪律）
    log(`${rel} —— ${s.total} 条（${s.open} 条未解决${s.resolved ? `，${s.resolved} 条已解决` : ''}）`
      + (hasFile ? '' : ' · 文件还没建（第一条评论会建它）'));
    for (const l of formatNoteLines(cur.notes)) log(l);
    if (!s.total) log(`\n  记一条：node scripts/anim.mjs note ${task} "第 12.5 秒这里字幕太小" --at 12.5`);
    return;
  }

  // --resolve <id>
  if (ri >= 0) {
    if (!resolveId || resolveId.startsWith('-')) die('--resolve 后面要给一个 id（先 --list 看 id）。');
    if (!cur.notes.length) die(`${rel} 里一条评论都没有，没什么可解决的。`);
    let r;
    try { r = resolveNote(cur.notes, resolveId, { now: new Date().toISOString() }); } catch (err) { die(String(err.message)); }
    if (!r.changed) {
      log(`· ${r.note.id} 本来就是已解决（resolvedAt 不变）—— ${rel} 没有改动。`);
      return;
    }
    writeNotes(file, { task, notes: r.notes, extra: cur.extra });
    const s = notesSummary(r.notes);
    log(`✓ ${r.note.id} 标记为已解决 → ${rel}（还剩 ${s.open} 条未解决）`);
    return;
  }

  // 追加
  if (!textArg) {
    die(`anim note 要做什么？三种用法（<任务> 必给，评论落在 out/<任务>/NOTES.json）：\n`
      + `  node scripts/anim.mjs note ${task} "第 12.5 秒这里字幕太小" --at 12.5   记一条（--at 是秒，可省）\n`
      + `  node scripts/anim.mjs note ${task} --list [--json]                      列出全部评论\n`
      + `  node scripts/anim.mjs note ${task} --resolve n1                         把某条标记成已解决\n`
      + `  （正文也可以用 --text "…"；多词不加引号时按空格拼起来）`);
  }
  let added;
  try { added = addNote(cur.notes, { text: textArg, at: opt('at'), now: new Date().toISOString() }); } catch (err) { die(String(err.message)); }
  writeNotes(file, { task, notes: added.notes, extra: cur.extra });
  const s = notesSummary(added.notes);
  log(`✓ 记下 ${added.note.id}  ${added.note.at === null ? '（没有时刻）' : `${added.note.at.toFixed(2)}s`}  ${added.note.text}`);
  log(`  → ${rel}（共 ${s.total} 条，${s.open} 条未解决；anim clean 不会删它）`);
  log(`  看全部：node scripts/anim.mjs note ${task} --list`);
}


/**
 * `video --parallel N`：把片子切成 N 段**并行**渲染，再自己拼好（`docs/history/IMPROVEMENTS-1-3.md` P2-1）。
 *
 * 为什么要进 CLI：那轮实测 2 进程 1.81×、3 进程 2.3×（7650 帧：59 分钟 → 26.1 分钟），
 * 瓶颈在浏览器那侧（`samples=1` 就 214ms/帧），**一个进程吃不满机器**。但手工做这件事
 * 有两个必踩的坑：
 *   ① 切点**只能落在"下一段转场已经结束"的时刻** —— 在转场中间切，那一段开头拿不到
 *      上一帧，甩镜会缺一半（`planSegmentCuts` 已经在保证这一点，这里复用）；
 *   ② 自己用 `ffmpeg -f concat` 拼 mp4 **必须加 `-copyts`**，否则整条视频被推后
 *      `+0.022982s`（B 帧 CTS 偏移），帧号与时间戳错位。
 *      这里干脆不走 mp4 concat：每段先转 MPEG-TS 再拼，和 CLI 内部分块那条路一致
 *      （实测 `--segments` 出的成片首帧 PTS = 0.000000）。
 *
 * 每个子进程是完全独立的 `anim video --from/--to`，所以：
 *   · 各自起自己的私有 Vite 与 Chrome（互不干扰）；
 *   · 各自的产物都要过 ffprobe 守门（某一段失败就整体失败，已渲好的段保留）。
 *
 * ⚠ 并行度不要超过物理核数：每个子进程都要跑一个无头 Chrome。
 */
async function renderParallel({ task, info, out, from, to, fps, samples, shutter, audioFile, withAudio }) {
  const t0 = Date.now();
  const n = Math.max(2, Math.min(8, Number(opt('parallel', '2'))));
  const target = Math.max(1, (to - from) / n);
  const dir = path.join(path.dirname(out), `${path.basename(out, '.mp4')}.par`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  // 切点复用 `planSegmentCuts`：只落在段边界、且不在转场交叠里
  const cuts = planSegmentCuts(info.timeline, from, to, target);
  const jobs = [];
  for (let i = 0; i < cuts.length - 1; i++) jobs.push({ from: cuts[i], to: cuts[i + 1] });
  // 过短的段并进前一段
  const merged = [];
  for (const j of jobs) {
    if (j.to - j.from < 1.5 && merged.length) merged[merged.length - 1].to = j.to;
    else merged.push({ ...j });
  }

  log(`并行渲染 ${merged.length} 段（--parallel ${n}）→ ${path.relative(ROOT, dir)}`);
  for (const [i, j] of merged.entries()) {
    log(`  [${i + 1}/${merged.length}] ${j.from.toFixed(2)}–${j.to.toFixed(2)}s  ${Math.round((j.to - j.from) * fps)} 帧`);
  }

  /** 跑一个子进程；把输出写到日志文件，失败时把尾部打出来。 */
  const runOne = (i) => new Promise((resolve) => {
    const j = merged[i];
    const file = path.join(dir, `p${String(i).padStart(2, '0')}.mp4`);
    const logFile = path.join(dir, `p${String(i).padStart(2, '0')}.log`);
    const args = [
      path.join(ROOT, 'scripts', 'anim.mjs'), 'video', task,
      '--from', String(j.from), '--to', String(j.to),
      '--samples', String(samples), '--shutter', String(shutter),
      '--noaudio', '--out', file,
    ];
    for (const k of ['vcodec', 'crf', 'cq', 'preset', 'x264', 'scale', 'tol', 'gpu']) {
      const v = opt(k, null);
      if (v != null) args.push(`--${k}`, String(v));
    }
    // ⚠ `--scan-nf` 可能是不带数字的裸开关：`opt('scan-nf')` 会把下一个参数（比如 `--from`）
    //   当成频率传给子进程。这里走同一个解析函数，把**解析之后**的值传下去 ——
    //   与单进程那条路（`renderToFile` 里的 `resolveScanNf()`）口径一致，子进程各扫各的那一段。
    args.push('--scan-nf', String(resolveScanNf()));
    if (flag('nf-stop')) args.push('--nf-stop');
    const fd = openSync(logFile, 'w');
    const p = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', fd, fd] });
    children.add(p);
    p.on('close', (code) => {
      children.delete(p);
      try { closeSync(fd); } catch { /* ignore */ }
      resolve({ i, code, file, logFile, from: j.from, to: j.to });
    });
  });

  // 限制并发为 n（jobs 已经按目标时长切好，通常就是 n 段）
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, merged.length) }, async () => {
    while (next < merged.length) {
      const i = next++;
      const r = await runOne(i);
      results[i] = r;
      const tag = `[${i + 1}/${merged.length}] ${r.from.toFixed(2)}–${r.to.toFixed(2)}s`;
      if (r.code !== 0) {
        warn(`  ✗ ${tag} 失败（退出码 ${r.code}）—— 日志尾部：`);
        try { warn(readFileSync(r.logFile, 'utf8').split('\n').slice(-12).join('\n')); } catch { /* ignore */ }
      } else {
        log(`  ✓ ${tag} 完成`);
      }
    }
  }));

  const failed = results.filter((r) => !r || r.code !== 0);
  if (failed.length) {
    // ⚠ 措辞按「已知 / 未知」分开（`docs/BACKLOG.md` 1-3）：`--parallel` 这条路的失败**没有
    //   什么可复用的** —— 它是"整段重渲"（与 --segments 不同，`--segments` 会跳过已渲好的块）。
    //   所以这句以前写的"修好之后重跑同一条命令即可"成本极高，而且它把两件完全不同的事
    //   混成了一句：**输入性的失败**（场景/参数写错，重跑一百次都一样）与**资源性的失败**
    //   （并发把内存/显存挤爆、磁盘满、GPU 掉线，重跑降并发确实能过）。
    const reasons = failed.map((r) => `第 ${(r?.i ?? 0) + 1} 段`).join('、');
    die(
      `并行渲染有 ${failed.length}/${merged.length} 段失败（${reasons}）。\n` +
      `  已渲好的段仍在 ${path.relative(ROOT, dir)}，但**这一步没有可复用的块**：重跑就是整段重渲。\n` +
      `  失败分两类，先判是哪一类（上面的日志尾部就是依据）：\n` +
      `    · 输入性（已知原因、确定性）—— 段名/参数写错、场景在某个时刻抛异常、时间线不合法。\n` +
      `      重跑不会有不同结果；先 node scripts/anim.mjs check <任务> 点名段与时刻，再改。\n` +
      `    · 资源性（可能是瞬时）—— 并发把内存/显存挤爆、磁盘满、GPU 掉线、被外部中断。\n` +
      `      先降并发再跑：--parallel ${Math.max(1, Math.floor(n / 2))}（并发度上限应按 物理核数-2 与 内存/3GiB 取小）。\n` +
      `  每段的完整输出在 ${path.relative(ROOT, dir)}/p*.log —— 先看第一个失败段的日志尾部，不要直接重跑。`,
    );
  }

  // 逐段 ffprobe 守门
  for (const [i, r] of results.entries()) {
    const expect = Math.max(1, Math.round((r.to - r.from) * fps));
    const bad = await checkVideoFile(r.file, expect, { what: `第 ${i + 1} 段`, fps });
    if (bad.length) {
      die(gateFailureLines(
        { title: `第 ${i + 1} 段的产物验收不通过：`, problems: bad },
        {
          phase: 'parallel',
          step: '并行渲染（这一段）',
          chunk: { i: i + 1, n: merged.length, range: `${r.from.toFixed(2)}–${r.to.toFixed(2)}s` },
          expected: expect,
        },
      ).join('\n'));
    }
  }

  // 拼接。
  // ⚠⚠ **必须加 `-copyts`**（这是 P2-1 里那条"自己拼 mp4 要小心"的实测确认）：
  //   每段的 mp4 都是从 PTS=0 开始的，concat demuxer 靠"累计时长"给后续段加偏移；
  //   不带 `-copyts` 时接缝处的时间戳会错开，实测
  //     `avg_frame_rate 43200/719 ≈ 60.08`、`duration 11.983`（而不是 12.000）——
  //     **帧数是 720 没错、能播、但节奏是歪的**，只有量时间戳才发现。
  //   带 `-copyts` 之后：`avg_frame_rate 60/1`、`duration 12.000000`。
  //   （另外别走"先转 MPEG-TS 再拼"：实测同样会得到 60.08 那种不均匀时间戳。）
  const expectTotal = Math.max(1, Math.round((to - from) * fps));
  const listFile = path.join(dir, 'concat.txt');
  writeFileSync(listFile, results.map((r) => `file '${r.file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const stitched = path.join(dir, '_stitched.mp4');
  await runFfmpeg(['-y', '-loglevel', 'error', '-copyts', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', stitched]);

  const sBad = await checkVideoFile(stitched, expectTotal, { what: '并行拼接结果', fps, count: true });
  if (sBad.length) {
    die(gateFailureLines(
      { title: '并行拼接后的产物不合格：', problems: sBad },
      { phase: 'stitch', expected: expectTotal, note: '各段本身都通过了守门，问题出在拼接这一步' },
    ).join('\n'));
  }
  // 时间戳也必须严格（帧距 / 首帧 PTS）—— 帧数对但时间戳漂了同样是废品
  const tsBad = await checkTimestamps(stitched, fps, expectTotal);
  if (tsBad.length) {
    die(gateFailureLines(
      { title: '并行拼接后的时间戳不合格：', problems: tsBad },
      { phase: 'stitch', hint: 'stitch', expected: expectTotal, note: '帧数对但时间戳不均匀 —— 这一类几乎总是拼接参数的问题' },
    ).join('\n'));
  }

  if (withAudio && audioFile) {
    // 与 renderSegments 同一处坑：参数表只有 audioMuxArgs() 一份
    await runFfmpeg(audioMuxArgs(stitched, audioFile, from, out));
  } else {
    await runFfmpeg(['-y', '-loglevel', 'error', '-i', stitched, '-c', 'copy', '-movflags', '+faststart', out]);
  }
  const bad = await checkVideoFile(out, expectTotal, { what: path.relative(ROOT, out), fps });
  if (bad.length) {
    try { rmSync(out, { force: true }); } catch { /* ignore */ }
    die(gateFailureLines(
      { title: `产物验收不通过，已删除 ${path.relative(ROOT, out)}：`, problems: bad },
      { phase: 'stitch', expected: expectTotal, note: '各段与拼接件本身都通过了守门，问题出在最后的封装（音轨）这一步' },
    ).join('\n'));
  }
  log(`\n✓ ${path.relative(ROOT, out)}`);
  log(`  ${expectTotal} 帧（${results.length} 段并行拼接，ffprobe 复核通过），用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  log(`  中间产物在 ${path.relative(ROOT, dir)}（含每段的日志）—— 清理：node scripts/anim.mjs clean ${task}`);
  return { frames: expectTotal };
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

/* ------------------------------------------------------------------ 口播/旁白（B/C 档） */

/**
 * `anim say` —— 把 TTS 接进来：逐句合成 → 量真实时长 → 反推每段的 `stretch`/`slot` → 写表。
 *
 * 实现整体在 `scripts/lib/say.mjs`（CLI 侧、不进浏览器）。这里只做参数搬运，
 * 因为 `scripts/lib/*` 里的东西要被 `tools/test-say.mjs` 直接 import（不需要经过 CLI）。
 *
 * ⚠ 这条路**不渲染画面**：它只产出"每段多长、旁白摆在哪"，所以换音色/改旁白
 * 都不需要动场景代码（`docs/NARRATION.md` §5.4）。
 */
async function cmdSay() {
  const task = pickTask();
  const { runSay } = await import('./lib/say.mjs');
  const r = await runSay(task, {
    taskDir: path.join(ROOT, 'tasks', task),
    script: opt('script'),
    voice: opt('voice'),
    rate: opt('rate'),
    bpm: opt('bpm') ? Number(opt('bpm')) : undefined,
    tail: opt('tail') ? Number(opt('tail')) : undefined,
    maxStretch: opt('max-stretch') ? Number(opt('max-stretch')) : undefined,
    tts: opt('tts'),
    force: flag('force'),
    dryRun: flag('dry-run'),
    noVo: flag('no-vo'),
    // BACKLOG 1-23：拿上一版 audio/timing.json 当钉子 —— 时间线不动，改一句词不重排全片
    pinTiming: flag('pin-timing'),
    // 表写到另一份（不动默认那份）：多语言 / 剪短版 / 手写表回放
    table: opt('table'),
    pinTable: opt('pin-table'),
  });
  return r;
}

/**
 * `anim mix` —— 旁白摆位 + 用旁白自己的包络给音乐做闪避，混成**一条**交给引擎的音轨。
 * 引擎只有一条音轨、没有 sidechain（`docs/NARRATION.md` §1），所以这一步必须在外面做。
 */
async function cmdMix() {
  const task = pickTask();
  const { runMix } = await import('./lib/mix.mjs');
  /**
   * `--target` 的三种写法都在 `mix.mjs` 的 `resolveLoudnessTarget()` 里收口（预设名 / 数字 /
   * 都不给）。这里**只做透传**，不在这里判数字合不合法 —— 判据只有一份，单测直接断言那个
   * 纯函数；在 CLI 里再抄一遍，两边迟早漂成"命令行放行、lib 拒绝"这种最难查的错。
   * 唯一的例外是"写了 `--target` 却没跟值"：那会让 opt() 拿到 undefined，归一化就**静默
   * 不发生** —— 必须当场拒绝。
   */
  const rawTarget = opt('target');
  if (flag('target') && rawTarget === undefined) die('--target 后面要跟一个值：streaming / cinema / off，或一个数字（如 -14）。');
  const rawLra = opt('lra');
  const lra = rawTarget !== undefined && rawLra !== undefined ? Number(rawLra) : undefined;
  if (lra !== undefined && !Number.isFinite(lra)) die(`--lra 要一个数字（现在给的是 "${rawLra}"）。`);
  /**
   * ⚠ 参数错（预设名写错 / 数字超范围 / 只给 `--lra`）在 lib 里是**抛异常**的 —— 那是给单测
   * 直接断言用的形状。CLI 这一侧要把它变成一行 `✗ …`：抛出去的 stack 会盖住真正的错因，
   * 作者看到的是 20 行 node 内部帧，找不到"是我把 streaming 拼错了"。
   * 判据仍只有 lib 那一份（这里只换呈现，不重写判据）。
   */
  try {
    return runMix(task, {
      taskDir: path.join(ROOT, 'tasks', task),
      music: opt('music'),
      out: opt('out') ?? opt('o'),
      voOnly: flag('vo-only'),
      bitrate: opt('bitrate'),
      target: rawTarget,
      lra,
      // 多语言/多变体：不给它，--table ja 会去读 zh 的 timing 并**覆盖 zh 的混音**（实测踩过）
      table: opt('table'),
    });
  } catch (e) {
    if (e && /^(不认识的 --target|靶子的 |给了 LRA)/.test(String(e.message))) die(String(e.message));
    throw e;
  }
}

/* ------------------------------------------------------------------ 命令：shots */

/** `anim shots --json` 的 schema 版本（字段契约见 `docs/ENGINE.md` §14.9；改字段名就要改它）。 */
const SHOTS_SCHEMA = 'anim.shots/1';

/**
 * `anim shots --json` 的载荷（**纯函数**：不碰磁盘、不看时钟 —— 同一份 `src/shots/`
 * 永远得到同一个字符串，可以直接 diff / 存成基线。可离线断言）。
 *
 * 这是 BACKLOG **1-21**（给每个模板补声明式 `spec` + 依赖前置校验）的**输入契约**，
 * 所以字段名在这里一次定死，并按"将来能长出东西"的形状排：
 *
 *   { schema: 'anim.shots/1', count, requireTokens?, shots: [
 *       { name, summary, notes,
 *         params: [ { name, type, desc, default, required } ],
 *         requires?: ['music', …], outputs?: { visual: 'full-frame'|'transition', … } } ] }
 *
 * 三条**读法**（它们和字段名一样是契约，写在文档里）：
 *   · `required: true` ⟺ 这个参数**没有默认值**（不传时模板拿到 `undefined`）。
 *     JSON 里没有 `undefined`，所以这时 `default` 恒为 `null`、由 `required` 区分。
 *     当前 11 个模板的每个参数都有默认值 ⇒ 全是 `false`（这只说明"省掉它不会出错"，
 *     **不**说明"这个参数没用"——画面照样是模板自带的那一段）。
 *   · **缺字段 ≠ false / 空**：`requires` / `outputs` 是 1-21 补上的**声明式 spec**
 *     （`src/shots/*.js` 的 `xxxShot.spec`）。没有 spec 的模板，这两个键**根本不出现** ——
 *     读到"没有这个键"要理解成"还没声明过"，绝不能当成"不需要"。
 *     （1-21 只**加**字段、没改任何已有字段名 ⇒ `schema` 仍是 `anim.shots/1`，
 *       老的读者不会坏。见 `docs/ENGINE.md` §14.9。）
 *   · `requireTokens` 是**依赖令牌的词表**（`src/shots/index.js` 的 `SHOT_REQUIRES`）：
 *     `requires` 里出现的是令牌，不是自由文本 —— 词表随载荷一起发出去，机器读者不必翻源码。
 *     调用方不传词表时这个键不出现（纯函数不许自己去 import 模块）。
 *
 * 退出码 / 出错：模板名给错时 stdout 上什么都没有、stderr 一行 `✗ …`、退出码 1
 * （机器读者要按这个判，别去解析人读的那张表）。
 *
 * @param {{ name: string, summary?: string, notes?: string,
 *           params?: { name: string, type: string, desc?: string, default?: any }[],
 *           requires?: string[], outputs?: any }[]} list
 *        `listShots()` 的返回值（给了模板名时是只含一个元素的数组）；顺序原样保留
 * @param {Record<string, string>|null} [requireTokens] 依赖令牌词表（`SHOT_REQUIRES`），可省
 * @returns {{ schema: string, count: number, requireTokens?: any, shots: any[] }}
 */
function shotsCatalog(list, requireTokens = null) {
  const shots = (list ?? []).map((s) => ({
    name: String(s.name),
    summary: s.summary ?? '',
    notes: s.notes ?? '',
    params: (s.params ?? []).map((p) => {
      const hasDefault = p.default !== undefined;
      return {
        name: p.name,
        type: p.type,
        desc: p.desc ?? '',
        default: hasDefault ? p.default : null,
        required: !hasDefault,
      };
    }),
    // ⚠ 用"源对象里有这个键才加"而不是"没有就给个空数组/ null"：后者会把
    //   "还没声明过"伪装成"声明了、不需要任何东西"—— 那正是 §14.9 第 2 条读法要防的静默失真。
    ...(s && 'requires' in s ? { requires: s.requires ?? [] } : {}),
    ...(s && 'outputs' in s ? { outputs: s.outputs ?? null } : {}),
    // 用途元数据（1-42）：同样是"有才加键"。`use` / `avoid` 是给人和 agent 读的，
    // `energy` 只许取 SHOT_ENERGY 里的五档（`tools/test-shots.mjs` 断言）。
    ...(s && 'use' in s ? { use: s.use } : {}),
    ...(s && 'energy' in s ? { energy: s.energy } : {}),
    ...(s && 'avoid' in s ? { avoid: s.avoid } : {}),
    // 选型元数据（1-62，学 JIZURA 的部件表）：tags / w / fitsNote 有才加。
    // ⚠ `fits`（函数本体）不进 JSON——序列化会整个丢掉，读的人该看的是 `fitsNote` 人话版；
    //   真条件在 `src/shots/pick.js` 的 brief 契约里。
    ...(s && 'tags' in s ? { tags: s.tags } : {}),
    ...(s && 'w' in s ? { w: s.w } : {}),
    ...(s && 'fitsNote' in s ? { fitsNote: s.fitsNote } : {}),
  }));
  return {
    schema: SHOTS_SCHEMA,
    count: shots.length,
    ...(requireTokens ? { requireTokens: { ...requireTokens } } : {}),
    shots,
  };
}

/**
 * 镜头库（`src/shots/`）—— 列出可用的镜头模板与它们的参数。
 *
 *   node scripts/anim.mjs shots            # 全部模板
 *   node scripts/anim.mjs shots chart      # 某个模板的全部参数与默认值
 *   node scripts/anim.mjs shots --json     # 机器可读的参数表 + 声明式 spec（requires / outputs / requireTokens）
 *   node scripts/anim.mjs shots chart --json
 *   node scripts/anim.mjs shots --pick --slot content --chars 8 --seed 7   # 按条件筛+按权重抽一个（1-62）
 *   node scripts/anim.mjs shots --pick --n 6 --slot content --seed 3       # 抽一串（同一版内不重复）
 *
 * 为什么要有这条命令：模板名与参数名是这个库的公开 API（写错 `shot()` 会**抛错**，
 * 不静默忽略），而"有哪些模板、参数叫什么"不该靠翻源码才知道。
 *
 * `--json` 只**换一种呈现**，不换数据源：两者都来自 `listShots()`，所以"文档里写的默认值"
 * 与"代码实际用的默认值"不可能对不上（字段契约见 `docs/ENGINE.md` §14.9）。
 * ⚠ 不加 `--json` 的那份人读输出**一个字都不许变**：它与 §14.2 的参数表、`AGENTS.md` §3.2
 *   的示例是同一份事实，要改就得三处一起说清。
 */
async function cmdShots() {
  const { listShots, filterShots, SHOTS, SHOT_REQUIRES, SHOT_ENERGY, pickShot, pickSequence, SHOT_SLOTS } = await import('../src/shots/index.js');
  const all = listShots();
  const use = opt('use', '');
  // ⚠ `positional()` 只按"以 - 开头"过滤，**不认识"某个 flag 的值"**：`shots --use 转场` 会把
  //   `转场` 当成 positional(0)。这条命令没有任务名参数，所以在这里把 flag 的值让开。
  const want = positional(0) === use && use !== '' ? positional(1) : positional(0);

  /* ── 选型模式（BACKLOG 1-62，学 JIZURA 的部件表）────────────────────────────
   *
   *   node scripts/anim.mjs shots --pick --slot content --tags data,graphic --points 5 --seed 7
   *   node scripts/anim.mjs shots --pick --n 6 --slot content --seed 3     # 抽一串（一支片子的骨架）
   *
   * 先筛后抽：energy / tags（任一命中） / fits（chars·rows·points·slot·hasMusic·hasScreenshot）
   * 是硬条件，w 是权重，seed 决定抽到谁 —— 同一个查询 + 同一个 seed 永远同一个结果；
   * 换 seed = 重抽一版；`--exclude chart` = 只换这一项。角色锁定：outro/lockup 只进 `--slot ending`，
   * whip 只进 `--slot transition`（不指明角色槽，它们不会被抽到）。
   */
  const numOpt = (k) => (opt(k, '') === '' ? undefined : Number(opt(k, '')));
  const pickQ = {
    slot: opt('slot', '') || undefined,
    tags: opt('tags', '').split(',').map((t) => t.trim()).filter(Boolean),
    energy: opt('energy', '') || undefined,
    chars: numOpt('chars'),
    rows: numOpt('rows'),
    points: numOpt('points'),
    hasMusic: flag('music') ? true : flag('no-music') ? false : undefined,
    hasScreenshot: flag('shot') ? true : flag('no-shot') ? false : undefined,
    exclude: opt('exclude', '').split(',').map((t) => t.trim()).filter(Boolean),
    seed: numOpt('seed'),
  };
  if (flag('pick') || Object.values(pickQ).some((v) => v != null && !(Array.isArray(v) && !v.length))) {
    const n = numOpt('n') ?? 1;
    const pool = use ? filterShots(all, use) : all;
    const queryDesc = [
      `pool ${pool.length}/${all.length}`,
      pickQ.slot ? `slot=${pickQ.slot}` : '',
      pickQ.tags.length ? `tags=[${pickQ.tags.join(',')}]` : '',
      pickQ.energy ? `energy=${pickQ.energy}` : '',
      pickQ.chars != null ? `chars=${pickQ.chars}` : '',
      pickQ.rows != null ? `rows=${pickQ.rows}` : '',
      pickQ.points != null ? `points=${pickQ.points}` : '',
      pickQ.hasMusic !== undefined ? `hasMusic=${pickQ.hasMusic}` : '',
      pickQ.hasScreenshot !== undefined ? `hasScreenshot=${pickQ.hasScreenshot}` : '',
      pickQ.exclude.length ? `exclude=[${pickQ.exclude.join(',')}]` : '',
      `seed=${pickQ.seed ?? 1}`,
    ].filter(Boolean).join(' · ');
    let seq;
    try {
      seq = n > 1 ? pickSequence(pool, pickQ, n) : [pickShot(pool, pickQ)];
    } catch (e) {
      die(e instanceof Error ? e.message : String(e));
    }
    if (flag('json')) {
      log(JSON.stringify({ schema: 'anim.shots.pick/1', query: { ...pickQ, n }, pick: seq }, null, 2));
      return;
    }
    log(`选型（${queryDesc}）${n > 1 ? `—— 抽 ${n} 个` : ''}：\n`);
    for (const r of seq) {
      log(`  ✓ ${r.name.padEnd(9)} w ${r.w}  [${r.tags.join(' ')}]  ${r.fitsNote}`);
    }
    const r0 = seq[0];
    log(`\n  候选 ${r0.pool.length}：${r0.pool.map((c) => `${c.name}(${c.w})`).join(' ')}`);
    log('\n只换这一项：--seed 换个数，或 --exclude <名字>；看全部模板：node scripts/anim.mjs shots');
    log(`角色槽只有这几种：${SHOT_SLOTS.join(' / ')}（outro/lockup 只进 ending，whip 只进 transition）`);
    return;
  }

  if (!want) {
    if (flag('json')) { log(JSON.stringify(shotsCatalog(use ? filterShots(all, use) : all, SHOT_REQUIRES), null, 2)); return; }
    const list = filterShots(all, use);
    if (use && !list.length) {
      die(
        `没有模板匹配 --use ${JSON.stringify(use)}（匹配面：模板名 / summary / use / energy / avoid）。\n`
        + `  能量档位只有这五档：${SHOT_ENERGY.join(' / ')}。全部模板：\n`
        + all.map((s) => `  · ${s.name.padEnd(8)} ${s.energy ?? '?'}  ${s.use ?? s.summary}`).join('\n'),
      );
    }
    log(`镜头模板（src/shots/，共 ${list.length} 个${use ? `，--use ${JSON.stringify(use)} 从全部 ${all.length} 个里筛` : ''}）：\n`);
    const w = Math.max(...list.map((s) => s.name.length));
    for (const s of list) {
      log(`  ${s.name.padEnd(w)}   ${String(s.params.length).padStart(2)} 个参数   ${s.summary}`);
      // 第二行只放"选镜头时最先要回答的两件事"：多响、什么时候用。
      // `avoid` 留在详情页 —— 列表里塞三段话会让人扫不动（11 个模板 × 3 行）。
      if (s.energy || s.use) log(`  ${' '.repeat(w)}   能量 ${(s.energy ?? '?').padEnd(2)}  ·  ${s.use ?? ''}`);
    }
    log('\n用法：scenes/xxx.js 里 export default shot(\'名字\', { 参数 })');
    log('看某个模板的参数与默认值：node scripts/anim.mjs shots chart');
    log('按用途筛（匹配名 / summary / use / energy / avoid）：node scripts/anim.mjs shots --use 转场');
    return;
  }

  if (typeof SHOTS[want] !== 'function') {
    die(`没有镜头模板 "${want}"。可用的：${Object.keys(SHOTS).join(' / ')}`);
  }
  const s = all.find((x) => x.name === want);
  if (flag('json')) { log(JSON.stringify(shotsCatalog([s], SHOT_REQUIRES), null, 2)); return; }
  log(`镜头模板 ${s.name} —— ${s.summary}\n`);
  if (s.use || s.energy || s.avoid) {
    log(`  能量  ${s.energy ?? '未标注'}`);
    log(`  用于  ${s.use ?? '未标注'}`);
    log(`  别用  ${s.avoid ?? '未标注'}\n`);
  }
  if (s.notes) log(`${s.notes}\n`);
  const shown = (v) => {
    const str = JSON.stringify(v);
    return str.length > 72 ? `${str.slice(0, 69)}…` : str;
  };
  const w = Math.max(...s.params.map((p) => p.name.length));
  log('参数（默认值 = 什么都不传时的画面）：');
  for (const p of s.params) {
    log(`  ${p.name.padEnd(w)}  ${String(p.type).padEnd(7)}  ${shown(p.default)}`);
    log(`  ${' '.repeat(w)}  ${' '.repeat(7)}  ${p.desc}`);
  }
}

/* ------------------------------------------------------------------ 命令：styles / subs */

/**
 * `anim styles` —— 列出全部风格包（`docs/STYLE.md`）。
 *
 * 为什么值得单独一条命令：风格是"整片观感"的开关，而它以前**没有任何入口**
 * （审计结论：8 个**老**镜头模板是 `demo` + `beat` 两支片子的逐像素冻结副本，2026-10-16 起镜头库共 11 个（新加的 quote / counter / compare 是新写的）；默认调色板就是
 * `tasks/pdoom-lab` 那一支的配色；三份入口文档印着同一段起手场景）。有了这张清单，
 * "下一支换一套"才可能真的发生。
 */
async function cmdStyles() {
  const { listStyles } = await import('../src/style/index.js');
  const all = listStyles();
  log(`风格包（src/style/，共 ${all.length} 套）—— task.config.mjs 里写 style: '<名字>' 就行\n`);
  const w = Math.max(...all.map((s) => s.name.length));
  for (const s of all) {
    log(`  ${s.name.padEnd(w)}  ${s.label}   [背景母题 ${s.motif}]`);
    log(`  ${' '.repeat(w)}  ${s.note}`);
    log(`  ${' '.repeat(w)}  底色 ${s.palette.ink} · 正文 ${s.palette.bone} · 强调 ${s.palette.signal}`);
    log('');
  }
  log('细则（合并优先级 / 反审美疲劳的两条纪律 / 每片必须换掉的三项）：docs/STYLE.md');
  log('想看看同一段画面在几套风格下各长什么样：node scripts/anim.mjs still style-sampler -t 2,6,10');
}

/** 秒 → `HH:MM:SS,mmm`（SRT） */
function srtTime(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * 秒 → `H:MM:SS.cc`（ASS，百分秒）。**时间向上取整**，字幕宁可晚 10ms 也不早显一帧。
 *
 * ⚠ 旧实现是 `Math.round(小数部分 × 100)`：`1.999` 会被舍成 `cs = 100`，输出
 * `0:00:01.100`（ASS 的百分秒字段只有两位）—— 一个**不报错但时间轴错位**的坏值。
 * 现在先化成整数百分秒再拆分，`cs % 100` 天然落在 0..99。
 */
export function assTime(sec) {
  const cs = Math.max(0, Math.ceil(Number(sec) * 100 - 1e-7));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, ss = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/**
 * ASS 的 `Dialogue:` 文本转义。**不做就会静默坏掉**，而且导出时看不出任何异常。
 *
 * ASS 不是纯文本格式：`\N` 是硬换行、`{...}` 是覆盖块（样式指令）。旁白里一句
 * `C:\new\table` 会被渲成两行，`{...}` 会整段消失 —— 平台上传的软字幕于是和画面里的
 * 字幕不是一回事（而这条命令存在的唯一理由就是"和画面一致"）。
 *
 * 三种写法：
 *   · **反斜杠**：ASS 没有通用转义（`\\` 不可靠），在 `\` 后面插 **U+2060 词连接符**，
 *     让 `\N` / `\n` / `\h` 不再是两字符序列 —— 渲染时零宽、不可见。上游 EAC design world
 *     的 `literalText()` 用的是同一手法（`src/media/captions.mjs:78-84`，那个仓库是 AGPL：
 *     这里只借"插零宽连接符"这条**知识**，实现与命名都是我们自己的）；
 *   · **花括号**：`\{` / `\}` 是 libass 认的字面量转义；
 *   · **换行**：文本里本来就该是一行（`wrapCaption` 已经切好），残留的 `\n` 统一成 `\N`。
 */
export function assText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0085\u2028\u2029]/gu, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, '')
    .replace(/\\/g, '\\\u2060')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\n/g, '\\N');
}

/**
 * 字幕断行：每行最多 `per` 个字（**Netflix 简体中文规范是 16 字/行、最多 2 行**），
 * 先按标点贪心装；超过两行时在中点附近找标点切一刀，绝不把收尾标点留在行首。
 */
function wrapCaption(text, per = 16) {
  const s = String(text);
  if (s.length <= per) return [s];
  const parts = s.match(/[^，。、；：！？]{1,}[，。、；：！？]?/g) ?? [s];
  const rows = [];
  let cur = '';
  for (const p of parts) {
    if (cur && (cur + p).length > per) { rows.push(cur); cur = ''; }
    cur += p;
  }
  if (cur) rows.push(cur);
  if (rows.length <= 2) return rows;
  const mid = Math.ceil(s.length / 2);
  let cut = -1;
  for (let i = mid; i >= Math.max(1, mid - 10); i--) if ('，。、；：！？'.includes(s[i - 1])) { cut = i; break; }
  if (cut < 0) for (let i = mid; i < Math.min(s.length, mid + 10); i++) if ('，。、；：！？'.includes(s[i - 1])) { cut = i; break; }
  if (cut <= 0 || cut >= s.length) cut = mid;
  return [s.slice(0, cut), s.slice(cut)];
}

/**
 * `anim subs <任务>` —— 从旁白表导出 `.srt` / `.ass`（**给视频平台上传用**）。
 *
 * 为什么要有它：以前这一步是 `out/_staging/make-srt.mjs` —— 一个活在**渲染产物目录**里的
 * 手抄脚本（`out/` 会被 `anim clean` 清掉、不在版本管理视野内、没有任何回归），
 * 换一支片子就要再抄一份（optifine 与 sodium 各有一份，几乎逐字相同）。
 * 现在它是 CLI 的一条命令，断行按 Netflix 简体中文规范（16 字/行、最多 2 行）。
 *
 * ⚠ 别和引擎内字幕叠着用：`task.captions: true` 时字幕**已经烧进画面**了，
 *   再拿这份 `.ass` 过一遍 ffmpeg 就是两层字幕（观众反馈里"两条字幕"的一种）。
 */
async function cmdSubs() {
  const task = pickTask();
  const narPath = path.join(ROOT, 'tasks', task, 'audio', 'narration.json');
  /** @type {any} */
  let data = null;
  /** task.config.mjs 导入失败的原因（有的话；别静默吞掉 —— 见下面的注释） */
  let inlineErr = null;
  if (existsSync(narPath)) {
    try { data = JSON.parse(readFileSync(narPath, 'utf8')); } catch (e) {
      die(`${path.relative(ROOT, narPath)} 读不动：${e.message}`);
    }
  } else {
    // 内联写法：task.config.mjs 里直接写 narration: { lines: [...] }
    //
    // ⚠ 这里的 catch **不能**静默（本命令第一版就栽在这上面）：`pathToFileURL` 忘了 import
    //   时抛的是 ReferenceError，被吞掉之后报出来的是"这个任务没有旁白表"——
    //   方向完全错（任务明明有）。所以把原因留下来，报错时一起打。
    try {
      const cfg = path.join(ROOT, 'tasks', task, 'task.config.mjs');
      const mod = await import(pathToFileURL(cfg).href);
      const spec = mod.default ?? mod;
      if (spec?.narration && typeof spec.narration === 'object') data = spec.narration;
    } catch (err) {
      inlineErr = String(err && err.message ? err.message : err).split('\n')[0];
    }
  }
  const lines = (data?.lines ?? []).filter((l) => Number.isFinite(Number(l.start)) && Number(l.dur) > 0);
  if (!lines.length) {
    die(
      `tasks/${task} 没有可用的旁白表（看 ${path.relative(ROOT, narPath)}，或 task.config.mjs 里的 narration）。\n` +
      (inlineErr ? `  ⚠ task.config.mjs 导入失败：${inlineErr}\n` : '') +
      `  有旁白的任务先用 anim say 生成：node scripts/anim.mjs say ${task}`,
    );
  }

  const outDir = path.resolve(ROOT, opt('out', opt('o', taskOut(task))));
  mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `${opt('name', task)}`);
  const per = Math.max(8, Number(opt('per', '16')) || 16);

  let srt = '';
  let ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    'PlayResY: 1080',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Alignment=2 = 底部居中；MarginV=64 是离底边的距离；白字 + 深色描边（平台上传的通用观感）
    'Style: Main,Microsoft YaHei,46,&H00FFFFFF,&H000000FF,&H00141414,&HA0000000,0,0,0,0,100,100,1,0,1,3,1,2,80,80,64,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  let n = 0;
  let tooLong = 0;
  for (const l of lines) {
    const a = Number(l.start);
    // 说完之后再多留一点：规范建议对白结束后 +0.5s，读起来不赶
    const b = a + Number(l.dur) + 0.5;
    const rows = wrapCaption(String(l.text ?? ''), per);
    if ([...String(l.text ?? '')].length / Math.max(0.1, Number(l.dur)) > 9) tooLong++;
    n++;
    srt += `${n}\n${srtTime(a)} --> ${srtTime(b)}\n${rows.join('\n')}\n\n`;
    // ⚠ 逐行转义再拼 `\N`：直接把原文拼进去，含 `\` / `{}` 的那一行会被 ASS 解释成
    //   换行或覆盖块（见 assText 的注释）。`\N` 只能出现在我们自己的行间。
    ass += `\nDialogue: 0,${assTime(a)},${assTime(b)},Main,,0,0,0,,${rows.map(assText).join('\\N')}`;
  }
  ass += '\n';
  writeFileSync(`${base}.srt`, srt, 'utf8');
  writeFileSync(`${base}.ass`, ass, 'utf8');
  log(`✓ ${path.relative(ROOT, `${base}.srt`)}  ${n} 条（每行 ≤${per} 字、最多 2 行）`);
  log(`✓ ${path.relative(ROOT, `${base}.ass`)}  ${n} 条（底部居中，MarginV=64）`);
  if (tooLong) {
    warn(`⚠ 有 ${tooLong} 句的语速超过 9 字/秒（Netflix 简体中文的成人上限，建议按 8–9 校核）—— 观众读不完。`);
  }
  log('');
  log('这份文件是给**视频平台上传**用的（软字幕）。');
  log('⚠ 如果这支片子在 task.config.mjs 里开了 captions: true，字幕**已经烧进画面**了 ——');
  log('  不要再把这份 .ass 过一遍 ffmpeg，否则就是两层字幕（docs/CAPTIONS.md）。');
}

/* ------------------------------------------------------------------ help */

function help() {
  // 打印文件头那段 JSDoc（新增命令时只要改头部，help 自动跟上）
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const start = src.indexOf('/**');
  const end = src.indexOf('*/', start);
  log(src.slice(start + 3, end).split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim());
}

/* ------------------------------------------------------------------ 排队 */

/**
 * 响一声（一声 / 两声 / 三声）—— 让"渲完了"这件事在**不看屏幕**的时候也能被听见（BACKLOG 1-43）。
 * BEL 在所有终端都能响；Windows 再补一个 `[console]::beep`（更明显，拉不起来就算了）。
 */
function chime(n, silent) {
  if (silent) return;
  for (let i = 0; i < n; i++) process.stdout.write('\u0007');
  try {
    if (process.platform === 'win32') {
      spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', '[console]::beep(880,250)'],
        { stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('afplay', ['/System/Library/Sounds/Glass.aiff'], { stdio: 'ignore' }).unref();
    }
  } catch { /* 响不了就算了：BEL 已经响过 */ }
}

/**
 * `anim queue <任务…> [video 的选项…]` —— 睡前排队渲几支，早上收片（BACKLOG 1-43）。
 *
 * **为什么是顺序而不是并行**：本机实测 4 进程并行 720 帧只有 **6.1 fps**，比单进程 7.5 fps 还慢
 * （抢核显与 ws 带宽，见 `docs/PERF.md` §5.6）。所以这里一支接一支地跑。
 *
 * **为什么用子进程**：`cmdVideo` 用的是本文件里那批**全局** argv 解析（`opt` / `flag` 读同一个
 * `rest`），连跑两支就得改全局状态；而且每支片子各自起停一次 Vite + Chrome 本来就更干净
 * （`--segments` 的块缓存也不受影响）。
 *
 * **失败不中断**：夜里没人看着，第二支因为第一支出错而没渲，比"少一支"更糟。最后汇总，
 * 按失败数给退出码（0 = 全部成功 / 1 = 有失败）。
 */
async function cmdQueue() {
  // 任务名 = 开头的裸词；遇到第一个 `-` 开头的参数，后面全部原样转发给 `video`
  let i = 0;
  const tasks = [];
  while (i < rest.length && !rest[i].startsWith('-')) tasks.push(rest[i++]);
  const silent = flag('silent');
  const forward = rest.slice(i).filter((a) => a !== '--silent');
  if (!tasks.length) {
    die('用法：node scripts/anim.mjs queue <任务A> [任务B …] [video 的选项…]\n' +
        '      例：node scripts/anim.mjs queue promo spectrum --segments 10 --gpu high');
  }
  const names = taskNames();
  for (const t of tasks) {
    if (!names.includes(t)) die(`没有任务 "${t}"。现有：${names.join(', ') || '(空)'}`);
  }
  const self = fileURLToPath(import.meta.url);
  log(`排队渲染 ${tasks.length} 支：${tasks.join(' → ')}`);
  log(`  转发给 video 的选项：${forward.length ? forward.join(' ') : '(无)'}`);
  log('  ⚠ 渲染期间**不要动仓库里的任何文件**（连 docs/*.md 也会把私有 Vite 打崩）');

  const done = [];
  const failed = [];
  const t0 = Date.now();
  for (const [k, t] of tasks.entries()) {
    log(`\n──────── [${k + 1}/${tasks.length}] ${t} ────────`);
    const s = Date.now();
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [self, 'video', t, ...forward], { stdio: 'inherit' });
      children.add(child);
      child.on('close', (c, sig) => { children.delete(child); resolve(sig ? 1 : (c ?? 1)); });
      child.on('error', () => { children.delete(child); resolve(1); });
    });
    const sec = Math.round((Date.now() - s) / 1000);
    const mmss = `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, '0')}s`;
    if (code === 0) { done.push({ t, mmss }); log(`\n✅ ${t} 完成（${mmss}）`); chime(1, silent); }
    else { failed.push({ t, mmss, code }); warn(`\n✗ ${t} 失败（${mmss}，退出码 ${code}）`); chime(2, silent); }
  }

  const total = Math.round((Date.now() - t0) / 1000);
  log(`\n──────── 排队结束（总 ${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s）────────`);
  for (const d of done) log(`  ✅ ${d.t}  ${d.mmss}`);
  for (const f of failed) warn(`  ✗ ${f.t}  ${f.mmss}（退出码 ${f.code}）`);
  if (failed.length) {
    warn(`\n${failed.length} 支失败。排查顺序：先看上面那一支的报错 → docs/DIAGNOSIS.md §1.5；`);
    warn('分块渲染时已渲好的块会保留，重跑只补没渲完的块。');
  }
  chime(failed.length ? 2 : 3, silent);
  process.exitCode = failed.length ? 1 : 0;
}

/* ------------------------------------------------------------------ 分发 */


/**
 * `anim report <任务>` —— **一屏自检**：把四条机器判据汇总成一张表。
 *
 *   node scripts/anim.mjs report <任务> [--json] [--strict]
 *
 * 为什么要它：判据各自是独立工具（卡点 / 事件密度 / 底色 / 成片一致性），
 * Agent 改完一次要跑四次、还得自己拼结论。这里一次跑完、一次给结论 ——
 * 「确定性可复现」要能被一句话验收，否则它只是文档里的承诺。
 *
 * 每条判据都只**读**已有产物（成片 mp4 / analysis.json / timing.json），不重新渲染；
 * 没有产物的项标 skipped，并在结尾说明为什么跳过。
 */
async function cmdReport() {
  const task = pickTask();
  const asJson = flag('json');
  const strict = flag('strict');
  const { spawnSync } = await import('node:child_process');
  const outDir = path.join(ROOT, 'out', task);
  const taskDir = path.join(ROOT, 'tasks', task);
  /** @type {{id:string, ok:boolean|null, summary:string, detail?:string}[]} */
  const rows = [];
  const skipped = [];

  const runTool = (tool, args) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', tool), ...args], { encoding: 'utf8', timeout: 180000 });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };

  // ① 成片
  // 优先 <task>.mp4（成片本体）；-web / -draft 之类的变体只在没有本体时才用
  const mp4s = existsSync(outDir)
    ? readdirSync(outDir).filter((f) => f.endsWith('.mp4') && !/^part_|_stitched/.test(f))
    : [];
  const mp4 = mp4s.includes(task + '.mp4') ? task + '.mp4' : (mp4s[0] ?? null);
  if (!mp4) skipped.push('成片：out/' + task + '/ 里还没有 mp4（先跑 anim video）');
  else {
    const st = statSync(path.join(outDir, mp4));
    rows.push({ id: '成片', ok: true, summary: mp4 + ' · ' + (st.size / 1048576).toFixed(1) + ' MB' });
  }

  // ② 卡点（只在**有音乐**时才判：没有音乐的片子，拍网格是从人声里估的，199 BPM 是念稿节奏）
  const hasMusic = /audio:\s*\{[^}]*music:|music:\s*'\.\//.test(existsSync(path.join(taskDir, 'task.config.mjs')) ? readFileSync(path.join(taskDir, 'task.config.mjs'), 'utf8') : '');
  if (!hasMusic) {
    skipped.push('卡点：这支没有音乐轨（拍网格只能从人声估，判据不成立）');
  } else if (!existsSync(path.join(taskDir, 'audio', 'timing.json')) && !existsSync(path.join(taskDir, 'audio', 'ja.timing.json'))) {
    skipped.push('卡点：没有 timing 表（段长不是由旁白/节拍解出来的）');
  } else {
    // 多语言任务（ja.timing.json）要把表显式传过去，否则工具会去找默认的 timing.json
    const jaTiming = path.join(taskDir, 'audio', 'ja.timing.json');
    const timingArg = existsSync(jaTiming) ? ['--timing', jaTiming] : [];
    const r = runTool('lint-beat-align.mjs', [task, '--json', ...timingArg]);
    try {
      const j = JSON.parse(r.stdout);
      const bad = (j.rows ?? []).filter((x) => !x.ok).length;
      rows.push({
        id: '卡点', ok: bad === 0,
        summary: (j.rows.length - bad) + '/' + j.rows.length + ' 切点在 ±' + j.tolMs + 'ms 内 · 实测 ' + j.bpm.toFixed(2) + ' BPM',
      });
    } catch { skipped.push('卡点：lint-beat-align 没有给出 JSON（' + firstLine(r.stderr) + '）'); }
  }

  // ③ 事件密度
  if (!mp4) skipped.push('事件密度：要先有成片（它量的是 mp4 的帧间差）');
  else {
    const r = runTool('lint-event-density.mjs', [task, '--json']);
    try {
      const j = JSON.parse(r.stdout);
      rows.push({
        id: '事件密度', ok: !(j.problems ?? []).length,
        summary: '最长静止 ' + j.staticSpan.toFixed(1) + 's · 稀薄窗口 ' + (j.thinShare * 100).toFixed(0) + '%',
        detail: (j.problems ?? []).join('；'),
      });
    } catch { skipped.push('事件密度：工具没有给出 JSON'); }
  }

  // ④ 风格 / 底色
  try {
    const { resolveStyle } = await import('../src/style/index.js');
    const st = resolveStyle({ style: readStyleName(taskDir) });
    const bg = st?.palette?.bg ?? st?.palette?.ink ?? '(默认)';
    rows.push({ id: '风格', ok: true, summary: (st?.name ?? 'print') + ' · 底色 ' + bg + ' · 母题 ' + (st?.motif ?? 'grid') });
  } catch (err) {
    skipped.push('风格：读不出来（' + firstLine(err) + '）');
  }

  // ⑤ 成片一致性（qa 只读文件，不起浏览器）
  if (!mp4) skipped.push('一致性：要先有成片');
  else {
    const qa = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'anim.mjs'), 'qa', task], { encoding: 'utf8', timeout: 300000 });
    const txt = (qa.stdout ?? '') + (qa.stderr ?? '');
    const m = /结论：(.+)/.exec(txt);
    const line = m ? m[1].trim() : firstLine(txt);
    const ok = /0 错/.test(line) && !/⚠/.test(line);
    rows.push({ id: '一致性(qa)', ok, summary: line });
  }

  const bad = rows.filter((r) => r.ok === false);
  if (asJson) {
    console.log(JSON.stringify({ task, rows, skipped, ok: bad.length === 0 }, null, 2));
  } else {
    log('');
    log('自检报告 —— ' + task);
    for (const r of rows) {
      const mark = r.ok === false ? '✗' : '✓';
      log('  ' + mark + ' ' + r.id.padEnd(10) + r.summary);
      if (r.detail) log('    ' + r.detail);
    }
    for (const s of skipped) log('  – ' + s);
    log('');
    log(bad.length ? '✗ ' + bad.length + ' 项未通过：' + bad.map((b) => b.id).join('、') : '✓ 全部通过（' + rows.length + ' 项）');
  }
  if (strict && bad.length) process.exitCode = 1;
}

/** 读任务的 style 名（配置档里一行 `style: 'xxx'`；没有就 return 空 → 默认 print） */
function readStyleName(taskDir) {
  try {
    const src = readFileSync(path.join(taskDir, 'task.config.mjs'), 'utf8');
    const m = /style:\s*'([^']+)'/.exec(src);
    return m ? m[1] : undefined;
  } catch { return undefined; }
}


/** `anim icons` —— 列出内置矢量图标（层 1 素材库） */
async function cmdIcons() {
  const { ICON_NAMES } = await import('../src/kit/icons.js');
  if (flag('json')) { console.log(JSON.stringify({ icons: ICON_NAMES }, null, 2)); return; }
  log('内置矢量图标（' + ICON_NAMES.length + ' 个，24×24 折线定义，src/kit/icons.js）');
  log('');
  for (let i = 0; i < ICON_NAMES.length; i += 6) log('  ' + ICON_NAMES.slice(i, i + 6).map((n) => n.padEnd(14)).join(''));
  log('');
  log('看长什么样：node scripts/anim.mjs still _icon-sheet -t 1');
  log('用法：import { drawIcon } from \'../kit/icons.js\' → drawIcon(lines, \'cat\', x, y, 48, color)');
}


/** `anim assets [--json]` —— 校验共享素材库（层 2）。只读文件，不起浏览器。 */
async function cmdAssets() {
  const man = path.join(ROOT, 'assets', 'manifest.json');
  if (!existsSync(man)) { console.error('没有 assets/manifest.json —— 见 docs/ASSETS.md 层 2'); process.exitCode = 2; return; }
  const j = JSON.parse(readFileSync(man, 'utf8'));
  const REQUIRED = ['id', 'path', 'kind', 'license', 'source'];
  const rows = [];
  const seen = new Set();
  let bad = 0;
  for (const a of j.assets ?? []) {
    const errs = [];
    for (const f of REQUIRED) if (!a[f]) errs.push('缺字段 ' + f);
    if (a.id && seen.has(a.id)) errs.push('id 重复');
    if (a.id) seen.add(a.id);
    const p = a.path ? path.join(ROOT, 'assets', a.path) : null;
    if (p && !existsSync(p)) errs.push('文件不存在：' + a.path);
    rows.push({ id: a.id ?? '(无)', kind: a.kind ?? '-', license: a.license ?? '-',
      size: p && existsSync(p) ? (statSync(p).size / 1024).toFixed(0) + ' KB' : '-', errs });
    if (errs.length) bad++;
  }
  if (flag('json')) { console.log(JSON.stringify({ count: rows.length, bad, rows }, null, 2)); if (bad) process.exitCode = 1; return; }
  log('共享素材库 assets/（' + rows.length + ' 条）');
  log('');
  for (const r of rows) {
    log('  ' + (r.errs.length ? '✗' : '✓') + ' ' + r.id.padEnd(22) + r.kind.padEnd(10) + r.license.padEnd(12) + r.size);
    for (const e of r.errs) log('      ' + e);
  }
  log('');
  log(bad ? '✗ ' + bad + ' 条不合法（四个字段 + 文件都要在，见 docs/ASSETS.md）' : '✓ 全部合法');
  log('用法：import { loadAsset, drawAsset } from \'../kit/assets.js\'（只能在 setup 里 load）');
  if (bad) process.exitCode = 1;
}

/** `anim shot-cards`：重新生成 docs/shots/ 的镜头卡；`--check` 只校验分类是否齐全 */
async function cmdShotCards() {
  // 同进程调用（沙箱里 spawn 子进程会 EPERM）
  const { generateShotCards, checkShotCards } = await import('../tools/gen-shot-cards.mjs');
  if (flag('check')) checkShotCards();
  else generateShotCards();
}
const commands = {
  new: cmdNew,
  tasks: cmdTasks,
  shots: cmdShots,
  styles: cmdStyles,
  subs: cmdSubs,
  check: cmdCheck,
  still: cmdStill,
  cover: cmdCover,
  chapters: cmdChapters,
  sheet: cmdSheet,
  cuts: cmdCuts,
  carry: cmdCarry,
  rhythm: cmdRhythm,
  hashes: cmdHashes,
  diff: cmdDiff,
  probe: cmdProbe,
  verify: cmdVerify,
  qa: cmdQa,
  audit: cmdAudit,
  determinism: cmdDeterminism,
  dumppx: cmdDumpPx,
  dumpframe: cmdDumpFrame,
  dumpframes: cmdDumpFrames,
  'probe-alpha': cmdProbeAlpha,
  video: () => cmdVideo(false),
  shot: () => cmdVideo(true),
  queue: cmdQueue,
  perf: cmdPerf,
  shake: cmdShake,
  report: cmdReport,
  icons: cmdIcons,
  'shot-cards': cmdShotCards,
  assets: cmdAssets,
  gpu: cmdGpu,
  clean: cmdClean,
  note: cmdNote,
  say: cmdSay,
  mix: cmdMix,
  analyze: async () => { const t = pickTask(); await analyzeTaskAudio(t); },
  help,
};

/**
 * 分发。⚠ 整个 CLI 只在本文件**被直接执行**时启动（`IS_MAIN`）：
 * 单测（`tools/test-*.mjs` / `out/_staging/*.mjs`）要 import 上面那些纯函数
 * （`formatSkipped` / `decideGateFailure` / `gateFailureLines`），
 * 一 import 就跑一条命令会把单测变成"顺手出片"。
 */
if (IS_MAIN) {
  try {
    const fn = commands[cmd];
    if (!fn) { warn(`未知命令 "${cmd}"`); help(); process.exit(1); }
    await fn();
    process.exit(process.exitCode ?? 0);
  } catch (err) {
    await closeSession();
    die(err && err.stack ? err.stack : String(err));
  }
}

export {
  IS_MAIN,
  pushSkipped,
  firstLine,
  formatSkipped,
  checkVerdictLine,
  decideGateFailure,
  gateFailureLines,
  knownCauseHeadline,
  // `anim shots --json` 的载荷（BACKLOG 1-29 前半 / 1-21 的输入契约，纯函数）
  SHOTS_SCHEMA,
  shotsCatalog,
  // 封面与章节（BACKLOG 1-53）：章节规划是纯函数，可离线断言
  planChapters,
  formatChapterTime,
  // 镜头模板的依赖前置校验（BACKLOG 1-21）：纯函数，可离线断言（不起浏览器、不渲染）
  blankJsComments,
  scanShotUsage,
  shotDependencyIssues,
  shotDependencyReport,
  SHOT_DEP_WHAT,
  // 上面那两个之外的**IO 层**（读任务源码文本 / 收集音频事实）：导出是为了让离线测试能
  // 拿**真实任务**跑一遍（"用了 wave 的任务在有音乐时必须是干净的"这条断言只能这样验）
  taskShotSources,
  shotDependencyFacts,
  audioDeclaredInConfig,
  // 评论文件（`out/<任务>/NOTES.json`，BACKLOG 1-29 后半）的读写/校验：纯函数，可离线断言
  NOTES_SCHEMA,
  PROTECTED_OUT_FILES,
  parseNotesJson,
  serializeNotes,
  nextNoteId,
  addNote,
  resolveNote,
  notesSummary,
  formatNoteLines,
  isProtectedOutFile,
};