// @ts-check
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import path from "node:path";
import { parseTaskMeta } from "./tasks.mjs";
import { blockSignature, sceneFileIndex } from "../lib/blocksig.mjs";
import { flag, opt, rest } from "../lib/cli/args.mjs";
import { analyzeTaskAudio, resolveAudioTracks } from "../lib/cli/audio.mjs";
import { collectRenderErrors, decideGateFailure, failOnRenderErrors, gateFailureLines, knownCauseHeadline, reportErrors } from "../lib/cli/gates.mjs";
import { die, log, warn } from "../lib/cli/log.mjs";
import { audioMuxArgs, checkFfmpeg, checkTimestamps, checkVideoFile, ffmpegCmd, pickVideoEncoder, runFfmpeg, signedExitCode } from "../lib/cli/media.mjs";
import { ROOT, dirStats, mb, pickTask, taskOut } from "../lib/cli/paths.mjs";
import { children, closeSession, getSession, openSession } from "../lib/cli/session.mjs";
import { changedSources, engineAtoms, segmentManifest, sourceMtimes } from "../lib/cli/sources.mjs";
import { entryEngineDeps } from "../lib/engine-graph.mjs";
import { conflictingParallelFlags, createFrameStallWatch, planParallelChunks, planParallelConcurrency } from "../lib/render-guard.mjs";
import { engineSig as stampEngineSig, stampPath, taskSig as stampTaskSig, writeStamp } from "../lib/render-stamp.mjs";
import { analyzeShake, shakeSummary } from "../lib/shake.mjs";
import { DRAFT_ENCODE_MS, DRAFT_SCALE, estimateTier, planTiers } from "../lib/tier-estimate.mjs";
import { WebSocketServer } from "ws";
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
    const r = await getSession().page.evaluate(
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
      rec.pw = getSession().info.pw; rec.ph = getSession().info.ph;
      rec.sp = await measureSpeed({ info: getSession().info, from, to, fps, samples: String(t.samples), shutter });
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
   *   · `src/` 下的**引擎地基**（core / style / app / timeline / public）改了 ⇒ 整批失效；
   *   · `src/kit/` `src/shots/` 这些**通用件**改了 ⇒ **只重渲真正用到它的块**
   *     （2026-10-31 细化：以前是"改一行引擎注释也整片重渲"）。
   */
  const force = flag('force');
  const eng = engineAtoms();
  const sceneIndex = sceneFileIndex(path.join(ROOT, 'tasks', task), ROOT);
  /**
   * 每个场景文件**传递依赖**到的引擎通用件（按真实 import 图算）。
   *
   * 只把**场景文件**作为收窄入口。
   *
   * `task.config.mjs`（时间线配置）与 `src/timeline.js`（构建器）**不参与块级收窄**：
   * 它们的内容由"段参数 / 时间边界"和地基全局签名决定；把它们也当收窄入口会得到
   * "判不出字面量"的误报（它们确实不写 shot('x')），进而让每一块都退回全部引擎件。
   */
  const sceneEntries = sceneIndex.all
    .filter((rel) => !/task\.config\.mjs$/.test(rel))
    .map((rel) => path.join(ROOT, rel));
  const entryDeps = entryEngineDeps(sceneEntries, ROOT);
  for (const rel of entryDeps.unresolved) {
    if (!sceneIndex.all.includes(rel) && !(sceneIndex.shared ?? []).includes(rel)) continue;
    warn(`  ⚠ ${rel} 里有静态解析不了的 import ⇒ 含它的块按"全部引擎件"判重渲（保守）`);
  }
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
      root: ROOT, engineSig: eng.global, paramsText: man.fp.text, timeline: info.timeline,
      index: sceneIndex, from: c.from, to: c.to,
      engineAtoms: eng.atoms, engineDeps: entryDeps.deps,
      // 字幕改了就重渲：字幕层是引擎画的（task.narration → 每帧文字），不是 ffmpeg 烧的
      narrationFile,
    });
    blockSigs[key] = sig;
    // 已经渲好的块直接复用（改一个镜头就只重渲它所在的那块）
    const hasSources = sceneIndex.all.length > 0;
    if (globalReuse && hasSources && existsSync(file) && prevBlocks?.[key] === sig) {
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
    const info = getSession().info;
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
      // BACKLOG 1-24①：下面这些开关只属于单进程推流（--idle/--keep-raw）或 --segments 的
      // 分块复用（--segments/--force），--only 还会平移时间轴让子进程的 --from/--to 对不上。
      // 以前同时给出会被**静默丢掉**（这个分支排在 --segments 之前，后者根本走不到）——
      // 用户以为生效了，实际整片照渲。现在显式给出即报错；只给 --parallel 时一个字不变。
      const conflicts = conflictingParallelFlags(rest);
      if (conflicts.length) {
        die(
          `这些开关在 --parallel 模式不生效：${conflicts.map((f) => `--${f}`).join(' ')}
` +
          `  · --parallel 把片子切片交给独立子进程（各自起 Vite + Chrome、按整片时间 --from/--to 切）；
` +
          `    --segments/--force 是另一条分块复用的路，--idle/--keep-raw 只属于单进程推流，
` +
          `    --only 会平移时间轴 —— 子进程按整片时间切块，两边对不上。
` +
          `  要用它们就分两次跑：先单进程 / --segments 出这一版，再单独跑 --parallel。`,
        );
      }
      await renderParallel({ task, info, out, from, to, fps, samples, shutter, audioFile, withAudio });
      return;
    }

    // --segments：分块渲染 + 拼接（已渲好的块自动复用）
    if (flag('segments') || opt('segments', null)) {
      await renderSegments({ task, info, out, from, to, fps, samples, shutter, audioFile, withAudio });
      reportErrors(getSession().info);
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
    /**
     * **成片版本戳**（1-73）：把「这份 mp4 是哪一版引擎 / 哪一版场景渲的」写进
     * `tasks/<任务>/render-stamp.json`。
     *
     * ⚠ 这不是缓存失效（那是 `--segments` 的块签名，规则完全不同）。它回答的是另一件事：
     *    **这份交付物是不是当前代码的样子** —— 引擎往前走**不作废**已交付的片子。
     * 之前没有这一层，唯一能判"新旧"的是 mtime；而 mtime 在 `git clone` / `checkout`
     * 之后集体刷新，于是「成片比源码旧」对每支片子都成立 —— 那是个**错的信号**。
     *
     * 只写 `tasks/`（跟着版本控制走），不写 `out/`（那是 gitignore 的产物目录）。
     * 写失败**不让出片失败**：戳是记录，不是产物的一部分。
     *
     * 不写戳的两种情况：`--draft`（那不是成片，戳会让人以为"成片已经重渲过了"）、
     * `--from/--to` 只渲一段（同上）。两者都只在 `--segments` 的**完整**出片里才对。
     */
    const partial = draft || from > 0 || (opt('to', null) != null);
    if (partial) {
      log(`  版本戳跳过（${draft ? '草稿档' : '只渲了一段'} 不是完整成片 —— 写了会让人以为成片已重渲）`);
    } else {
      try {
        const res = writeStamp(ROOT, task, {
          engine: stampEngineSig(ROOT),
          scene: stampTaskSig(ROOT, task),
          video: path.relative(ROOT, out).split(path.sep).join('/'),
          frames: total,
          fps: Number(fps),
          draft: !!draft,
          scale: Number(info.scale ?? 1),
          samples: String(samples),
          files: st.size,
        });
        log(`  版本戳 ${path.relative(ROOT, stampPath(ROOT, task))}（引擎 ${res.engine} · 场景 ${res.scene}）`);
      } catch (e) {
        warn(`  ⚠ 版本戳没写成（${e && e.message ? e.message : e}）—— 不影响出片`);
      }
    }
    reportShake(r.shake, task);          // 抖动守门（docs/history/IMPROVEMENTS-1-3.md 建议 F）
    // 中间产物占了多大，以及怎么清（P2-5：以前一个提示都没有，out/ 悄悄涨到几 GB）
    reportIntermediates(task, out);
    reportErrors(getSession().info);
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
  const reach = await getSession().page.evaluate(async (u) => {
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
   * 帧停滞心跳（复盘 §2：中途卡死 12 分钟没人知）。它和下面的"没进展"看门狗是**两回事**：
   * 看门狗看四信号（帧 / 页面 sent / 排水 / 文件变大），防的是"整个系统死了"；
   * 这里只看**帧有没有到** —— 帧停在半路（页面崩了 / WS 断了）时四信号也可能被
   * 偶发的排水续命，用户却 12 分钟看不到一行新帧。判据与文案在
   * scripts/lib/render-guard.mjs（tools/test-cli-hardening.mjs 离线测）。
   */
  const stallWatch = createFrameStallWatch({
    warn: (s) => warn(`\n  ${s}`),
    chunk: typeof chunk === 'string' ? chunk : '',
    total,
    startAt: t0,
  });

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
    finish = () => { if (!finished) { finished = true; stallWatch.stop(); resolve(undefined); } };
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
      stallWatch.onFrame(frames, total, Date.now());
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
    // 帧停滞心跳：与下面的"没进展"判据独立 —— 就算排水/文件增长一直给看门狗续命，
    // 帧停在半路也该喊出来。背压中（ffBlocked）不算停滞：页面按设计停在等 ack，
    // 帧都堆在 ffmpeg 的 stdin 缓冲里，这时候喊"渲染可能卡死"会把人引偏（真死由四信号判）。
    if (!ffBlocked) stallWatch.check(Date.now());
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
      const st = await getSession().page.evaluate(() => /** @type {any} */ (window).__anim.debug());
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
  const started = await getSession().page.evaluate((o) => {
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
 * ⚠ 并行度不要超过物理核数：每个子进程都要跑一个无头 Chrome ——
 * 现在由 `planParallelConcurrency()`（scripts/lib/render-guard.mjs）按
 * `min(cpu-2, 内存/3GiB, 块数)` 夹在 [2..8]；`--parallel N` 的 N 主要决定切块粒度。
 */
async function renderParallel({ task, info, out, from, to, fps, samples, shutter, audioFile, withAudio }) {
  const t0 = Date.now();
  // BACKLOG 1-24① 后半：并发度不再拍脑袋夹 [2..8]，按机器资源收窄 ——
  // 每个子进程一个无头 Chrome，超卖只会把内存/显存挤爆（资源性失败）。
  // requested 的 N 决定切块粒度（切多少段），真正同时跑的进程数由 min(cpu-2, 内存/3GiB, 块数) 定。
  const { n, capCpu, capMem, capChunks } = planParallelConcurrency({
    cpus: availableParallelism(),
    memoryGiB: totalmem() / 2 ** 30,
    // requested 的 N 也决定切块数（min(N, floor(片长))）：不传的话长片会被压成 2 块
    chunks: planParallelChunks({ from, to, requested: Number(opt('parallel', '2')) }),
  });
  log(`并发度 ${n}（按 cpu-2 / 内存/3GiB / 块数 取小）`);
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
    // E-1：子进程与父进程渲的是同一个任务、同一把锁 —— 父进程已经持锁，
    // 子进程必须跳过（ANIM_RENDER_LOCK_SKIP=1），否则一开跑就自己 die 自己。
    const p = spawn(process.execPath, args, {
      cwd: ROOT, stdio: ['ignore', fd, fd],
      env: { ...process.env, ANIM_RENDER_LOCK_SKIP: '1' },
    });
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
      `      先降并发再跑：--parallel ${Math.max(1, Math.floor(n / 2))}（并发度按 cpu-2 / 内存/3GiB / 块数 取小，见上面的并发度日志）。\n` +
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

export { cmdVideo };
export { cmdVideo as run };
