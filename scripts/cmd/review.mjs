// @ts-check
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { opt } from "../lib/cli/args.mjs";
import { planBoard } from "../lib/cli/board.mjs";
import { collectRenderErrors, reportErrors } from "../lib/cli/gates.mjs";
import { log, warn } from "../lib/cli/log.mjs";
import { ROOT, pickTask, taskOut } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
import { writeContactSheet } from "../lib/cli/sheet.mjs";

/**
 * 找出下一轮 review 目录名（round-1, round-2, ...）。
 */
function nextRoundNum(reviewRoot, explicit) {
  if (explicit != null && Number.isFinite(Number(explicit)) && Number(explicit) > 0) {
    return Math.floor(Number(explicit));
  }
  if (!existsSync(reviewRoot)) return 1;
  let mx = 0;
  for (const e of readdirSync(reviewRoot, { withFileTypes: true })) {
    const m = /^round-(\d+)$/.exec(e.name);
    if (m && e.isDirectory()) mx = Math.max(mx, Number(m[1]));
  }
  return mx + 1;
}

/**
 * `anim review <任务> [--only a,b] [--round N] [--samples auto]`
 * 生成独立审查评审包（out/<任务>/review/round-N/）：
 *   1. 每段 0.15 / 0.50 / 0.85 三帧 PNG（默认 samples=auto，与成片运动模糊一致）
 *   2. board.png 分镜总览 + cuts/ 切点接触表（无内部切点时跳过）
 *   3. lint-craft --json --stills 读数 + 可选事件密度读数
 *   4. index.md：图片路径表 + 机器读数 + 8 维空白评分表 + 已填好路径的审查者派单模板
 */
async function cmdReview() {
  const task = pickTask();
  const only = opt('only', undefined);
  const samples = opt('samples', 'auto');
  const shutter = Number(opt('shutter', '0.5'));
  const scale = Number(opt('scale', '0')) || undefined;

  const reviewRoot = path.resolve(ROOT, taskOut(task, 'review'));
  const roundNum = nextRoundNum(reviewRoot, opt('round', null));
  const outDir = path.join(reviewRoot, `round-${roundNum}`);
  const framesDir = path.join(outDir, 'frames');
  mkdirSync(framesDir, { recursive: true });

  /** @type {{ id: string, start: number, end: number, dur: number, frames: { frac: number, t: number, file: string }[] }[]} */
  const segRows = [];
  /** @type {{ t: number, label: string, file: string }[]} */
  const cutRows = [];
  let boardFile = null;
  let renderErrorCount = 0;

  await openSession({ task, scale, only });
  try {
    const info = getSession().info;
    const timeline = info.timeline ?? [];
    if (!timeline.length) {
      warn('时间线为空，无法生成评审包');
      return;
    }

    log(`生成评审包：${task} · round-${roundNum}（${timeline.length} 段，samples=${samples}）→ ${path.relative(ROOT, outDir)}`);

    // 1) 每段 0.15 / 0.50 / 0.85 三帧
    for (let i = 0; i < timeline.length; i++) {
      const s = timeline[i];
      const start = Number(s.start ?? 0);
      const end = Number(s.end ?? start);
      const dur = Math.max(0.05, end - start);
      const safeId = String(s.id ?? `seg${i + 1}`).replace(/[^\w.-]+/g, '_');
      const row = { id: String(s.id ?? `seg${i + 1}`), start, end, dur, frames: [] };

      for (const frac of [0.15, 0.5, 0.85]) {
        const t = start + dur * frac;
        const r = await getSession().page.evaluate(
          ([tVal, samp, shut]) => /** @type {any} */ (window).__anim.still(tVal, { samples: samp === 'auto' ? 'auto' : Number(samp), shutter: shut }),
          [t, samples, shutter],
        );
        const tag = String(Math.round(frac * 100)).padStart(2, '0');
        const fname = `${String(i + 1).padStart(2, '0')}_${safeId}_p${tag}.png`;
        const fpath = path.join(framesDir, fname);
        writeFileSync(fpath, Buffer.from(String(r.png).split(',')[1], 'base64'));
        row.frames.push({ frac, t, file: fpath });
        log(`  [${row.id}] p=${tag}% t=${t.toFixed(2)}s (子帧 ${r.samples}) → ${path.relative(ROOT, fpath)}`);
      }
      segRows.push(row);
    }

    // 2) board.png
    const { times: bTimes, labels: bLabels } = planBoard(timeline, { at: 0.5 });
    if (bTimes.length) {
      boardFile = path.join(outDir, 'board.png');
      await writeContactSheet(bTimes, boardFile, { cols: Math.min(4, timeline.length), cell: 420, samples: 1, labels: bLabels });
      log(`  ✓ board → ${path.relative(ROOT, boardFile)}`);
    }

    // 3) cuts 切点接触表（无内部切点时跳过）
    const cuts = [...new Set(
      timeline.map((it) => Number(it.start ?? 0)).filter((t) => t > 0.001).map((t) => Math.round(t * 1000) / 1000),
    )].sort((a, b) => a - b);

    if (cuts.length) {
      const cutsDir = path.join(outDir, 'cuts');
      mkdirSync(cutsDir, { recursive: true });
      const win = 1.5, n = 7, step = (win * 2) / (n - 1);
      for (const c of cuts) {
        const before = timeline.filter((it) => c - 0.001 >= it.start && c - 0.001 < it.end).map((it) => it.id);
        const after = timeline.filter((it) => Math.abs(it.start - c) < 0.02).map((it) => it.id);
        const times = Array.from({ length: n }, (_, idx) => Math.max(0, c - win + step * idx));
        const cfile = path.join(cutsDir, `cut_${c.toFixed(3)}s.png`);
        await writeContactSheet(times, cfile, { samples: 1, shutter, marks: [c] });
        cutRows.push({ t: c, label: `${before.join('+') || '—'} → ${after.join('+') || '—'}`, file: cfile });
      }
      log(`  ✓ cuts → ${cuts.length} 个切点`);
    } else {
      log('  · cuts：无内部切点，已跳过');
    }

    reportErrors(getSession().info);
    const rerr = await collectRenderErrors({ take: false });
    renderErrorCount = rerr.count;
    if (rerr.count) {
      warn(`\n⚠ 刚渲染的帧里有场景异常：${rerr.count} 帧`);
      for (const line of rerr.text.slice(0, 6)) warn('  · ' + line);
      process.exitCode = 1;
    }
  } finally {
    await closeSession();
  }

  // 4) 跑 lint-craft --json --stills
  const craftArgs = [path.join(ROOT, 'tools', 'lint-craft.mjs'), task, '--stills', framesDir, '--json'];
  if (only) craftArgs.push('--only', only);
  const craftRes = spawnSync(process.execPath, craftArgs, { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  let craftData = null;
  try { craftData = JSON.parse(craftRes.stdout ?? ''); } catch { craftData = null; }

  // 5) 可选：事件密度（只有已有 timing.json 且存在 mp4 时跑；否则记 skipped）
  let densityNote = 'skipped（仅在同时存在 audio/timing.json 与成片 mp4 时采集）';
  const hasTiming = existsSync(path.join(ROOT, 'tasks', task, 'audio', 'timing.json'));
  const taskOutDir = path.join(ROOT, 'out', task);
  const mp4 = existsSync(taskOutDir)
    ? readdirSync(taskOutDir).filter((f) => f.endsWith('.mp4') && !/^part_|_stitched|^smoke-/.test(f))
      .sort((a, b) => statSync(path.join(taskOutDir, b)).size - statSync(path.join(taskOutDir, a)).size)[0]
    : null;
  if (hasTiming && mp4) {
    const dRes = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'lint-event-density.mjs'), task, '--file', path.join(taskOutDir, mp4), '--json'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    try {
      const dj = JSON.parse(dRes.stdout ?? '');
      densityNote = `最长静止 ${Number(dj.staticSpan).toFixed(1)}s · 稀薄窗口 ${(Number(dj.thinShare) * 100).toFixed(0)}%` + (dj.problems?.length ? `（⚠ ${dj.problems.join('；')}）` : '（✓）');
    } catch {
      densityNote = 'skipped（lint-event-density 未输出 JSON）';
    }
  }

  // 6) 生成 index.md
  const idxPath = path.join(outDir, 'index.md');
  const lines = [];
  lines.push(`# 评审包：${task} · round-${roundNum}`);
  lines.push('');
  lines.push(`- **生成时间**：${new Date().toISOString()}`);
  lines.push(`- **范围**：${only ? `--only ${only}` : '全片'}（${segRows.length} 段 · samples=${samples}）`);
  lines.push(`- **渲染异常帧**：${renderErrorCount}`);
  lines.push(`- **事件密度**：${densityNote}`);
  lines.push('');
  lines.push('## 一、图片路径表（审查者必须用 Read 逐张看图）');
  lines.push('');
  if (boardFile) lines.push(`- **分镜总览 board**：\`${boardFile.replace(/\\/g, '/')}\``);
  if (cutRows.length) {
    for (const c of cutRows) {
      lines.push(`- **切点 t=${c.t.toFixed(2)}s**（${c.label}）：\`${c.file.replace(/\\/g, '/')}\``);
    }
  } else {
    lines.push('- **切点接触表**：skipped（本范围无内部切点）');
  }
  lines.push('');
  lines.push('| 段名 | 时长 | 入场 15% | 中段 50% | 收尾 85% |');
  lines.push('|---|---:|---|---|---|');
  for (const s of segRows) {
    const f = s.frames;
    lines.push(`| ${s.id} | ${s.dur.toFixed(2)}s | \`${f[0].file.replace(/\\/g, '/')}\` | \`${f[1].file.replace(/\\/g, '/')}\` | \`${f[2].file.replace(/\\/g, '/')}\` |`);
  }

  lines.push('');
  lines.push('## 二、机器读数（`lint-craft`）');
  lines.push('');
  if (!craftData) {
    lines.push(`- skipped（lint-craft 执行异常：${(craftRes.stderr ?? '').trim() || '无输出'}）`);
  } else {
    lines.push(`- **参考分**：${craftData.score}/100 · **命中条数**：${craftData.findings?.length ?? 0}`);
    if (craftData.findings?.length) {
      for (const f of craftData.findings) lines.push(`- ⚠ **[${f.code}]** ${f.msg}`);
    } else {
      lines.push('- ✓ 未发现静态/像素偷懒信号');
    }
    if (craftData.pixelFrames?.length) {
      lines.push('');
      lines.push('| 帧 | 空格占比 (上限55%) | 亮度范围 p95-p5 (下限0.25) | 众数亮度 |');
      lines.push('|---|---:|---:|---:|');
      for (const pf of craftData.pixelFrames) {
        lines.push(`| ${path.basename(pf.file)} | ${(pf.emptyRatio * 100).toFixed(0)}% | ${pf.lumRange.toFixed(2)} | ${pf.modeLum.toFixed(2)} |`);
      }
    }
  }

  lines.push('');
  lines.push('## 三、空白评分表（按 `docs/CRAFT-RUBRIC.md` 填写，起评 3 分）');
  lines.push('');
  lines.push('| 段名 (role) | 1.隐喻 | 2.填充 | 3.层级 | 4.深度 | 5.运动 | 6.连续 | 7.风格 | 8.高光 | 均分 | 过线? | 4-5分点名依据 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|---|');
  for (const s of segRows) {
    lines.push(`| ${s.id} | | | | | | | | | | | |`);
  }

  lines.push('');
  lines.push('## 四、审查者派单模板（已填入本轮路径，直接复制派单）');
  lines.push('');
  lines.push('```text');
  lines.push('你是这支动画片子的独立画面审查者。你的任务是挑毛病，不是夸赞，也不要修改任何代码或文件。');
  lines.push('');
  lines.push('请依次阅读以下文件（使用文件读取工具真实查看每张 PNG 图像，严禁凭空猜测）：');
  lines.push(`1. 评分标准：${path.join(ROOT, 'docs', 'CRAFT-RUBRIC.md').replace(/\\/g, '/')}`);
  lines.push(`2. 正反标杆：${path.join(ROOT, 'docs', 'BAR.md').replace(/\\/g, '/')} 及其中引用的反面样本 PNG`);
  lines.push(`3. 本轮评审包：${idxPath.replace(/\\/g, '/')}`);
  for (const s of segRows) {
    for (const f of s.frames) lines.push(`   - ${f.file.replace(/\\/g, '/')}`);
  }
  lines.push('');
  lines.push('执行纪律：');
  lines.push('- 默认每项从 3 分起评；给出 4 分或 5 分时，必须在表格末尾点名画面上具体是哪个元素做到了。');
  lines.push('- 每段必须与 docs/BAR.md 的反面样本做一次「更像哪一张」的成对比较。');
  lines.push('- 如果机器读数（lint-craft）报了 CRAFT-EMPTY / CRAFT-FLAT / CRAFT-FONT 等发现，必须在对应维度扣分并写进问题清单。');
  lines.push('- 严格按 docs/CRAFT-RUBRIC.md 第三节的格式输出：① 成对比较 ② 逐段评分表 ③ 按时间码排序的几何级修改清单。');
  lines.push('```');

  writeFileSync(idxPath, lines.join('\n') + '\n', 'utf8');
  log(`\n✓ 评审包已生成：${path.relative(ROOT, idxPath)}`);
  log('  下一步：派独立审查者按 index.md 里的模板看图打分。');
}

export { cmdReview as run };
