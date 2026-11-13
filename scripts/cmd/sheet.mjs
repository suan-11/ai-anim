// @ts-check
import path from "node:path";
import { opt } from "../lib/cli/args.mjs";
import { reportErrors } from "../lib/cli/gates.mjs";
import { log } from "../lib/cli/log.mjs";
import { ROOT, pickTask, taskOut } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
import { writeContactSheet } from "../lib/cli/sheet.mjs";
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
    reportErrors(getSession().info);
  } finally { await closeSession(); }
}
export { cmdSheet as run };
