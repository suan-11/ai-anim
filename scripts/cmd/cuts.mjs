// @ts-check
import { mkdirSync } from "node:fs";
import path from "node:path";
import { opt } from "../lib/cli/args.mjs";
import { collectRenderErrors, reportErrors } from "../lib/cli/gates.mjs";
import { die, log, warn } from "../lib/cli/log.mjs";
import { ROOT, pickTask, taskOut } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
import { writeContactSheet } from "../lib/cli/sheet.mjs";
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
    const info = getSession().info;
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

    reportErrors(getSession().info);
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
export { cmdCuts as run };
