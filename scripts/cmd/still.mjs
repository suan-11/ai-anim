// @ts-check
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { opt } from "../lib/cli/args.mjs";
import { collectRenderErrors, reportErrors } from "../lib/cli/gates.mjs";
import { die, log, warn } from "../lib/cli/log.mjs";
import { ROOT, pickTask, taskOut } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
/* ------------------------------------------------------------------ 命令：still / sheet */

async function cmdStill() {
  const task = pickTask();
  const times = (opt('t', '1') ?? '1').split(',').map(Number).filter((x) => Number.isFinite(x));
  if (!times.length) die('-t 需要给时间，例如 -t 0,1.5,3');
  const outDir = path.resolve(ROOT, opt('out', opt('o', taskOut(task, 'stills'))));
  mkdirSync(outDir, { recursive: true });
  const samples = opt('samples', '1');
  const scale = Number(opt('scale', '0')) || undefined;

  if (samples === '1') {
    warn('· samples=1：这是单子帧，**只代表静止画面**，不代表成片的运动模糊。查运动质量用 `sheet`/`shot`，或加 --samples auto。');
  }

  await openSession({ task, scale, only: opt('only', undefined) });
  try {
    const info = getSession().info;
    log(`渲染 ${times.length} 帧 → ${outDir}  (${info.width}×${info.height}${info.scale > 1 ? ' ×' + info.scale : ''}, samples=${samples})`);
    for (const t of times) {
      const t0 = Date.now();
      const r = await getSession().page.evaluate(
        ([t, samples, shutter]) => /** @type {any} */ (window).__anim.still(t, { samples: samples === 'auto' ? 'auto' : Number(samples), shutter }),
        [t, samples, Number(opt('shutter', '0.5'))],
      );
      const file = path.join(outDir, `f_${t.toFixed(3).padStart(8, '0')}.png`);
      writeFileSync(file, Buffer.from(String(r.png).split(',')[1], 'base64'));
      log(`  t=${t.toFixed(3)}s  ${((Date.now() - t0) / 1000).toFixed(1)}s  子帧 ${r.samples}  ${path.relative(ROOT, file)}`);
    }
    reportErrors(getSession().info);
    // P0-3：出图这条路也必须响。错帧卡片是一张"看起来有内容"的 PNG，
    // 不点名的话它会被当成画面本身（beast 那次就是靠人眼抽帧才看出来的）。
    const rerr = await collectRenderErrors({ take: false });
    if (rerr.count) {
      warn(`\n⚠ 刚渲染的帧里有场景异常：${rerr.count} 帧`);
      for (const line of rerr.text.slice(0, 6)) warn('  · ' + line);
      warn('  → 上面那些 PNG 是**错帧卡片**（暗红底 + 红框 + ✗ SCENE ERROR），不是画面内容。');
      process.exitCode = 1;
    }
    log('\n下一步：用 Read 工具看这些 PNG，然后改场景再出一次。');
  } finally { await closeSession(); }
}
export { cmdStill as run };
