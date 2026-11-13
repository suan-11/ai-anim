// @ts-check
import path from "node:path";
import { opt } from "../lib/cli/args.mjs";
import { planBoard } from "../lib/cli/board.mjs";
import { reportErrors } from "../lib/cli/gates.mjs";
import { log } from "../lib/cli/log.mjs";
import { ROOT, pickTask, taskOut } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
import { writeContactSheet } from "../lib/cli/sheet.mjs";
/**
 * `anim board <任务>` —— 分镜板（C2）：每段抽一格（默认段中点，--at 调段内位置 0..1），
 * 每格压一行「id · 时长 · note」，草稿分辨率，出 out/<任务>/board.png。
 * 既是「写场景前先对齐意图」的占位确认，也可当已有片子的全片缩略图总览。
 */
async function cmdBoard() {
  const task = pickTask();
  const at = Number(opt('at', '0.5'));
  const cols = Math.max(1, Number(opt('cols', '4')));
  const cell = Number(opt('cell', '420'));
  const out = path.resolve(ROOT, opt('out', opt('o', taskOut(task, 'board.png'))));
  await openSession({ task, only: opt('only', undefined) });
  try {
    const segs = getSession().info.timeline ?? [];
    const { times, labels } = planBoard(segs, { at });
    if (!times.length) { log('这条时间线是空的，没得分镜'); return; }
    log(`分镜板 ${segs.length} 段 · 段内位置 ${at} · ${cols} 列`);
    await writeContactSheet(times, out, { cols, cell, samples: 1, labels });
    log(`✓ ${path.relative(ROOT, out)}`);
    reportErrors(getSession().info);
  } finally { await closeSession(); }
}
export { cmdBoard as run };
