// @ts-check
import path from "node:path";
import { flag, opt } from "../lib/cli/args.mjs";
import { collectRenderErrors, reportErrors } from "../lib/cli/gates.mjs";
import { log, warn } from "../lib/cli/log.mjs";
import { ROOT, pickTask, taskOut } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
import { printRhythmReport, readTaskRhythm } from "../lib/rhythm.mjs";
import { attentionStep, attentionSummary, attentionVideoPath, collectAttention, writeAttentionReport } from "../lib/attention.mjs";
import { evaluateComplexityRepetition } from "../lib/rhythm-complexity.mjs";
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
  if (flag('complexity')) {
    const step = attentionStep(opt('step', undefined));
    const only = opt('only', undefined);
    const scale = Number(opt('scale', '0.35'));
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('渲染倍率须为正数');
    await openSession({ task, scale, only });
    try {
      const session = getSession();
      const errors = reportErrors(session.info);
      if (errors.length) { process.exitCode = 1; return; }
      const report = await collectAttention(session, { task, step });
      const rerr = await collectRenderErrors({ take: false });
      if (rerr.count) throw new Error(`复杂度取样遇到 ${rerr.count} 个渲染错误：${rerr.text[0] ?? ''}`);
      const cr = evaluateComplexityRepetition(report);
      const att = report.rhythmScore;
      log(`复杂度 ${cr.complexity.score}/100（分散度 ${cr.complexity.meanDispersion.toFixed(2)} · 热点多样 ${cr.complexity.hotspotDiversity.toFixed(2)} · 信息密度 ${cr.complexity.meanInfoDensity.toFixed(1)}）`);
      log(`重复度 ${cr.repetition.score}/100（帧重复 ${cr.repetition.frameRepetition.toFixed(2)} · 序列循环 ${cr.repetition.sequenceRepetition.toFixed(2)}）`);
      if (att && Number.isFinite(att.score)) log(`注意力曲线 ${att.score}/100（${att.status === 'observed' ? '波形通过' : '待复看'}）`);
      const dir = path.join(ROOT, taskOut(task, 'attention', only ? `only-${only.replace(/[^\w.-]+/g, '_')}` : ''));
      writeAttentionReport(dir, report, { videoPath: attentionVideoPath(ROOT, opt('video', undefined), only ? null : taskOut(task, `${task}.mp4`)) });
      const { writeFileSync } = await import('node:fs');
      writeFileSync(path.join(dir, 'complexity.json'), JSON.stringify({ schema:'anim.rhythm-complexity/1', task, ...cr, attention: att }, null, 2));
      log(`复杂度/重复度 → ${path.relative(ROOT, path.join(dir, 'complexity.json'))}`);
    } finally { await closeSession(); }
    return;
  }
  if (flag('attention')) {
    const step = attentionStep(opt('step', undefined));
    const only = opt('only', undefined);
    const videoPath = attentionVideoPath(ROOT, opt('video', undefined), only ? null : taskOut(task, `${task}.mp4`));
    const scale = Number(opt('scale', '0.35'));
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('渲染倍率须为正数');
    await openSession({ task, scale, only });
    try {
      const session = getSession();
      const errors = reportErrors(session.info);
      if (errors.length) { process.exitCode = 1; return; }
      const report = await collectAttention(session, { task, step });
      const rerr = await collectRenderErrors({ take: false });
      if (rerr.count) throw new Error(`注意力取样遇到 ${rerr.count} 个渲染错误：${rerr.text[0] ?? ''}`);
      const dir = path.join(ROOT, taskOut(task, 'attention', only ? `only-${only.replace(/[^\w.-]+/g, '_')}` : ''));
      writeAttentionReport(dir, report, { videoPath });
      log(attentionSummary(report));
      log(`注意力曲线 → ${path.relative(ROOT, path.join(dir, 'attention.html'))} · attention.json`);
    } finally { await closeSession(); }
    return;
  }
  const strict = flag('strict');
  const explicitTable = flag('table') || flag('json');
  const legacyOptions = ['step', 'scale', 'only'].some((key) => opt(key, undefined) !== undefined);
  if (!flag('motion') && (explicitTable || !legacyOptions)) {
    const report = readTaskRhythm(task);
    if (report || explicitTable) {
      printRhythmReport(task, report, { strict, json: flag('json') });
      return;
    }
    log('未声明 rhythm.json，使用静/动分段量具。');
  }
  const step = Math.max(0.1, Number(opt('step', '0.5')));

  await openSession({ task, scale: Number(opt('scale', '0')) || undefined, only: opt('only', undefined) });
  try {
    const { rhythmSegments } = await import("../../src/timeline.js");
    const info = getSession().info;
    const dur = info.onlyDuration || info.duration;
    const times = [];
    for (let t = 0; t < dur; t += step) times.push(Math.min(t, dur - 0.01));
    if (times.length < 2) { log('片子太短（<2 个采样步），没有静/动可言。'); return; }

    log(`静/动分段：${times.length} 帧 × ${step}s 步长（判据 docs/REFERENCE-onetake.md §3）`);
    // 页面侧：逐帧渲 → 与前一帧差分（>6/255 的像素占比）。samples=1：静止判定不需要运动模糊。
    const steps = await getSession().page.evaluate(async ({ times }) => {
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
    reportErrors(getSession().info);
    const rerr = await collectRenderErrors({ take: false });
    if (rerr.count) {
      warn(`\n⚠ 渲染中有场景异常：${rerr.count} 帧 —— 上面的读数里混着错帧卡片，先修场景错误。`);
      process.exitCode = 1;
    }
  } finally { await closeSession(); }
}
export { cmdRhythm as run };