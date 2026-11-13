// @ts-check
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flag, opt } from "../lib/cli/args.mjs";
import { log, warn } from "../lib/cli/log.mjs";
import { ROOT, pickTask, taskOut } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
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
    const segs = (await getSession().page.evaluate(() => /** @type {any} */ (window).__anim.info())).timeline;
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

export { formatChapterTime, planChapters };
export { cmdChapters as run };
