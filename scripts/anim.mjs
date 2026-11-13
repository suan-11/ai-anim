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
 *
 * 【成片版本戳】——交付物是**哪一版**渲的（BACKLOG 1-73）
 *   node scripts/anim.mjs stamp [<task>] [--json] [--strict] [--legacy]
 *                                                       读 tasks/<任务>/render-stamp.json（video 成功时写的）：
 *                                                        引擎签名 + 任务签名，**按内容算**（不是 mtime ——
 *                                                        mtime 在 git clone 后集体刷新，"成片比源码旧"全线误判）
 *                                                       四档：current / engine-drift / scene-drift / missing
 *                                                        ⚠ **engine-drift 不需要重渲**：引擎往前走不等于已交付的片子作废；
 *                                                        只有 scene-drift（这支片子自己的文件改过）才值得为了看效果重渲
 *                                                        --legacy 给版本戳落地之前渲的片子补一笔「引擎版本未知」
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
 *                               每个进程一个无头 Chrome：并发度按 cpu-2 / 内存/3GiB / 块数
 *                               取小后夹在 2..8。切点自动避开转场，拼接走 MPEG-TS，
 *                               不受 `-copyts` 那个坑影响。与 --segments/--only/--idle/
 *                               --force/--keep-raw 互斥，同给会报错 —— 那些开关它不认）
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

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setRest } from './lib/cli/args.mjs';
import { warn, die } from './lib/cli/log.mjs';
import { closeSession } from './lib/cli/session.mjs';
import { run as cmdNew } from "./cmd/new.mjs";
import { run as cmdTasks } from "./cmd/tasks.mjs";
import { run as cmdShots } from "./cmd/shots.mjs";
import { run as cmdStyles } from "./cmd/styles.mjs";
import { run as cmdSubs } from "./cmd/subs.mjs";
import { run as cmdCheck } from "./cmd/check.mjs";
import { run as cmdStill } from "./cmd/still.mjs";
import { run as cmdCover } from "./cmd/cover.mjs";
import { run as cmdChapters } from "./cmd/chapters.mjs";
import { run as cmdSheet } from "./cmd/sheet.mjs";
import { run as cmdCuts } from "./cmd/cuts.mjs";
import { run as cmdCarry } from "./cmd/carry.mjs";
import { run as cmdRhythm } from "./cmd/rhythm.mjs";
import { run as cmdHashes } from "./cmd/hashes.mjs";
import { run as cmdDiff } from "./cmd/diff.mjs";
import { run as cmdProbe } from "./cmd/probe.mjs";
import { run as cmdVerify } from "./cmd/verify.mjs";
import { run as cmdQa } from "./cmd/qa.mjs";
import { run as cmdAudit } from "./cmd/audit.mjs";
import { run as cmdDeterminism } from "./cmd/determinism.mjs";
import { run as cmdDumpPx } from "./cmd/dumppx.mjs";
import { run as cmdDumpFrame } from "./cmd/dumpframe.mjs";
import { run as cmdDumpFrames } from "./cmd/dumpframes.mjs";
import { run as cmdProbeAlpha } from "./cmd/probe-alpha.mjs";
import { run as cmdVideo } from "./cmd/video.mjs";
import { run as cmdShot } from "./cmd/shot.mjs";
import { run as cmdQueue } from "./cmd/queue.mjs";
import { run as cmdPerf } from "./cmd/perf.mjs";
import { run as cmdShake } from "./cmd/shake.mjs";
import { run as cmdReport } from "./cmd/report.mjs";
import { run as cmdStamp } from "./cmd/stamp.mjs";
import { run as cmdFilmHtml } from "./cmd/film-html.mjs";
import { run as cmdIcons } from "./cmd/icons.mjs";
import { run as cmdShotCards } from "./cmd/shot-cards.mjs";
import { run as cmdAssets } from "./cmd/assets.mjs";
import { run as cmdGpu } from "./cmd/gpu.mjs";
import { run as cmdClean } from "./cmd/clean.mjs";
import { run as cmdNote } from "./cmd/note.mjs";
import { run as cmdSay } from "./cmd/say.mjs";
import { run as cmdMix } from "./cmd/mix.mjs";
import { run as cmdAnalyze } from "./cmd/analyze.mjs";
import { run as help } from "./cmd/help.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help';
const rest = cmd === 'help' ? argv : argv.slice(1);
setRest(rest);

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
  shot: cmdShot,
  queue: cmdQueue,
  perf: cmdPerf,
  shake: cmdShake,
  report: cmdReport,
  stamp: cmdStamp,
  'film-html': cmdFilmHtml,
  icons: cmdIcons,
  'shot-cards': cmdShotCards,
  assets: cmdAssets,
  gpu: cmdGpu,
  clean: cmdClean,
  note: cmdNote,
  say: cmdSay,
  mix: cmdMix,
  analyze: cmdAnalyze,
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

export { IS_MAIN };
export { TASKS_SCHEMA, parseTaskMeta } from "./cmd/tasks.mjs";
export { assTime, assText } from "./cmd/subs.mjs";
export { pushSkipped, firstLine, formatSkipped, checkVerdictLine, decideGateFailure, gateFailureLines, knownCauseHeadline } from "./lib/cli/gates.mjs";
export { SHOTS_SCHEMA, shotsCatalog } from "./cmd/shots.mjs";
export { planChapters, formatChapterTime } from "./cmd/chapters.mjs";
export { blankJsComments, scanShotUsage, shotDependencyIssues, shotDependencyReport, SHOT_DEP_WHAT, taskShotSources, shotDependencyFacts, audioDeclaredInConfig } from "./cmd/check.mjs";
export { NOTES_SCHEMA, PROTECTED_OUT_FILES, parseNotesJson, serializeNotes, nextNoteId, addNote, resolveNote, notesSummary, formatNoteLines, isProtectedOutFile } from "./lib/cli/notes.mjs";
export { conflictingParallelFlags, planParallelConcurrency, planParallelChunks } from "./lib/render-guard.mjs";
