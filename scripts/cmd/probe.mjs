// @ts-check
import { flag, opt } from "../lib/cli/args.mjs";
import { die, log, warn } from "../lib/cli/log.mjs";
import { pickTask } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
/* ------------------------------------------------------------------ 命令：probe */

/**
 * 按给定顺序渲染一串时刻，看**渲染顺序会不会改变画面**。
 *
 *   node scripts/anim.mjs probe demo --times 4,12
 *
 * 这正是「同一 t 是 t 的纯函数」这条地基的机械检查：正向、反向各渲一遍，
 * 每个 t 两次的指纹必须一样。不一样就说明引擎里藏了跨帧状态（渲染目标的残留、
 * 惰性编译、缓冲没清），而那类问题在成片里表现为"某一帧颜色莫名差一点"。
 */
async function cmdProbe() {
  const task = pickTask();
  const times = (opt('times', opt('t', '0,4,12')) ?? '').split(',').map(Number).filter(Number.isFinite);
  if (!times.length) die('--times 需要给时间，例如 --times 0,4,12');
  await openSession({ task, scale: Number(opt('scale', '0')) || undefined, only: opt('only', undefined) });
  try {
    const seqs = flag('once') ? [times] : [times, [...times].reverse()];
    const rows = [];
    for (const seq of seqs) {
      const r = await getSession().page.evaluate((tt) => /** @type {any} */ (window).__anim.probe(tt), seq);
      rows.push({ seq, r });
      log(`顺序 ${seq.join(',')}`);
      for (const x of r) log(`  t=${x.t.toFixed(3)}  ${x.hash}  mean ${x.mean.toFixed(4)}  max ${x.max.toFixed(3)}`);
    }
    if (rows.length === 2) {
      const [a, b] = rows;
      let bad = 0;
      log('\n两次对比（同一 t 必须一致）：');
      for (let i = 0; i < times.length; i++) {
        const x = a.r[i], y = b.r[times.length - 1 - i];
        const same = x.hash === y.hash;
        if (!same) bad++;
        log(`  t=${x.t.toFixed(3)}  ${same ? '✓ 一致' : `✗ 不一致  ${x.hash} vs ${y.hash}`}`);
      }
      if (bad) {
        warn(`\n✗ 有 ${bad} 个时刻在两种渲染顺序下不一致 —— 引擎里有跨帧状态（见 docs/history/IMPROVEMENTS-1-3.md 第二轮 P1-2「同一时刻、从不同起点开渲结果不同」）`);
        process.exitCode = 1;
      } else log('\n✓ 渲染顺序不影响结果（同一 t 是纯函数）');
    }
  } finally { await closeSession(); }
}
export { cmdProbe as run };
