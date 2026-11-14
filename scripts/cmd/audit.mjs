// @ts-check
import { flag, opt } from "../lib/cli/args.mjs";
import { reportErrors } from "../lib/cli/gates.mjs";
import { log } from "../lib/cli/log.mjs";
import { pickTask } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
/**
 * 背景守门的原始数据（排查用）：每个交叠段在交叠期画了几次、画了什么。
 *
 *   node scripts/anim.mjs audit demo
 */
async function cmdAudit() {
  const task = pickTask();
  await openSession({ task, only: opt('only', undefined) });
  try {
    const r = await getSession().page.evaluate(() => /** @type {any} */ (window).__anim.worldAudit());
    // 两个采样时刻都要露出来（BACKLOG 头部 ⑦）：交叠窗中点（判"铺没铺底"）+ 交叠窗之后的中点
    // （"那一秒到底黑没黑"）。以前只打一个时刻，于是交叠窗之外的部分在这张表里根本不存在。
    const dump = (x) => {
      log(`  ${String(x.id).padEnd(14)} handlesTransition=${x.handlesTransition ? 'Y' : 'n'}  world=${x.declaredWorld}`
        + `${x.selfBase ? '  ← 声明 world: false：不判铺底，只给读数' : ''}`
        + `${x.missing ? '   ← 没铺满整帧（这一段的底是黑的）' : ''}${x.error ? '  错误: ' + x.error : ''}`);
      for (const s of x.samples ?? []) {
        log(`      ${s.error
          ? `t=${s.t.toFixed(2)}s  渲染出错: ${s.error}`
          : `t=${s.t.toFixed(2)}s  整帧覆盖 ${String(s.full).padStart(3)} 次  本帧总绘制 ${String(s.any).padStart(3)} 次  亮度 ${s.mean.toFixed(3)}`}`);
      }
      if (flag('debug') && x.trace) log(`      整帧覆盖来自: ${(x.trace ?? []).join('  ///  ')}`);
    };
    log(`时间线 ${r.timeline} 段；与前一段交叠、**判铺底**的 ${r.results.length} 段`
      + `（各采两个时刻）；另有 ${(r.selfBase ?? []).length} 段声明了 world: false（不判铺底）：`);
    for (const x of r.results) dump(x);
    if ((r.selfBase ?? []).length) {
      log('');
      for (const x of r.selfBase) dump(x);
    }
    reportErrors(getSession().info);
  } finally { await closeSession(); }
}
export { cmdAudit as run };
