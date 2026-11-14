// @ts-check
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { flag, rest } from "../lib/cli/args.mjs";
import { die, log, warn } from "../lib/cli/log.mjs";
import { CLI_ENTRY_URL, taskNames } from "../lib/cli/paths.mjs";
import { children } from "../lib/cli/session.mjs";
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
  const self = fileURLToPath(CLI_ENTRY_URL);
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
export { cmdQueue as run };
