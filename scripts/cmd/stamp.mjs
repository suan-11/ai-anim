// @ts-check
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { flag, opt, positional } from "../lib/cli/args.mjs";
import { log } from "../lib/cli/log.mjs";
import { ROOT, pickTask } from "../lib/cli/paths.mjs";
import { LEGACY_ENGINE, compareStamp, engineSig as stampEngineSig, readStamp, taskSig as stampTaskSig, writeStamp } from "../lib/render-stamp.mjs";
/**
 * `anim stamp <任务>`（或 `anim stamp`，全任务）—— **成片版本戳**：这份 mp4 是哪一版渲的。
 *
 *   node scripts/anim.mjs stamp [<任务>] [--json]
 *
 * 回答的是「**交付物还是不是当前这一版的样子**」，**不是**「要不要重渲」：
 *   · `current` —— 成片就是当前代码渲的；
 *   · `engine-drift` —— 引擎动过了。**交付物不作废**，想跟上再重渲；
 *   · `scene-drift` —— 这支片子自己的文件改过了，要看效果得重渲；
 *   · `missing` —— 没记录（渲于这一层之前 / 从没跑过 `video`）。
 *
 * 只读，不起浏览器。退出码恒为 0（除 `--strict` 且出现 `scene-drift`）——
 * 「旧版本」是一条**事实**，不是一个**错误**。
 */
async function cmdStamp() {
  // ⚠ 这里不能直接用 pickTask()：不传任务时它**直接 die**，而 stamp 的默认语义是"扫全部"。
  const t0 = positional(0) ?? opt('task');
  const only = t0 ? pickTask() : null;
  const asJson = flag('json');
  const strict = flag('strict');
  /**
   * `--legacy`：给**版本戳落地之前**渲的片子补一笔「引擎版本未知」的记录。
   *
   * 为什么需要它：那些片子没有引擎签名可查，而现编一个是假读数。记成 `LEGACY_ENGINE`
   * 之后，`anim stamp` 与预提交自检都能给出**准确**的话（"渲于版本戳之前"），
   * 而不是一句含糊的"没有记录"。场景签名是真的（按当前内容算），所以
   * 「这支片子自己的文件后来改过没有」这一半仍然是准的。
   */
  const legacy = flag('legacy');
  const now = { engine: stampEngineSig(ROOT) };
  const tasksDir = path.join(ROOT, 'tasks');
  const hasMp4 = (t) => existsSync(path.join(ROOT, 'out', t, t + '.mp4'));
  const names = only
    ? [only]
    : readdirSync(tasksDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      // 默认只列**有成片**的任务：版本戳说的是"这份 mp4 是哪一版渲的"，
      // 没出过片的任务在这张表里只会是噪音（它们也没有 mp4 可以交付）。
      .filter(hasMp4)
      // 下划线开头是夹具 / 实验任务（与 precommit-report 的排除表同口径）—— 它们不是交付物
      .filter((n) => !n.startsWith('_'))
      .sort();
  /** @type {any[]} */
  const rows = [];
  let filled = 0;
  for (const t of names) {
    const taskDir = path.join(tasksDir, t);
    if (!existsSync(path.join(taskDir, 'task.config.mjs'))) continue;
    let stamp = readStamp(ROOT, t);
    // --legacy：**只补没有记录的**，绝不覆盖真戳（那是把准确的信息换成大概的信息）。
    // 下划线开头的是夹具 / 实验任务（与 precommit-report 的排除表同口径）：它们本来就要频繁重渲，
    // 补记一笔只会让清单变吵，而且它们不是交付物。
    if (legacy && !stamp && !t.startsWith('_')) {
      const mp4 = existsSync(path.join(ROOT, 'out', t, t + '.mp4'));
      if (mp4) {
        stamp = writeStamp(ROOT, t, {
          engine: LEGACY_ENGINE,
          scene: stampTaskSig(ROOT, t),
          video: 'out/' + t + '/' + t + '.mp4',
          note: '补记：这支片子渲于版本戳落地之前，引擎版本未知（场景签名按当前内容算）',
        });
        filled++;
      }
    }
    const scene = stampTaskSig(ROOT, t);
    const cmp = compareStamp(stamp, { engine: now.engine, scene });
    rows.push({ task: t, state: cmp.state, note: cmp.note, at: stamp?.at ?? null, engine: stamp?.engine ?? null, scene: stamp?.scene ?? null });
  }
  if (legacy) log('\n· --legacy 补记了 ' + filled + ' 支片子的「引擎版本未知」记录（没有覆盖任何已有的真戳）');
  if (asJson) {
    console.log(JSON.stringify({ engine: now.engine, rows }, null, 2));
  } else {
    const counts = { current: 0, 'engine-drift': 0, 'scene-drift': 0, missing: 0 };
    log('');
    log('成片版本戳 —— 引擎 ' + now.engine);
    for (const r of rows) {
      counts[r.state] = (counts[r.state] ?? 0) + 1;
      const mark = { current: '✓', 'engine-drift': '·', 'scene-drift': '⚠', missing: '·' }[r.state] ?? '·';
      log('  ' + mark + ' ' + r.task.padEnd(22) + r.state.padEnd(14) + r.note);
    }
    log('');
    log('  ✓ current ' + counts.current + ' · · engine-drift ' + counts['engine-drift']
      + ' · ⚠ scene-drift ' + counts['scene-drift'] + ' · · missing ' + counts.missing);
    log('  「engine-drift」**不需要重渲**：交付物已经交出去了，引擎往前走不等于旧片子作废。');
    log('  只有「scene-drift」（这支片子自己的文件改了）才值得为了看效果重渲一遍。');
  }
  if (strict && rows.some((r) => r.state === 'scene-drift')) process.exitCode = 1;
}
export { cmdStamp as run };
