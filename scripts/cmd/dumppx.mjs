// @ts-check
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { opt } from "../lib/cli/args.mjs";
import { log } from "../lib/cli/log.mjs";
import { ROOT, pickTask, taskOut } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
/* ------------------------------------------------------------------ 命令：dumppx */

/**
 * 把浏览器渲染的某一帧的**裸像素**吐到文件（RGBA，自下而上，显示空间）。
 * 排查用：拿它和 `ffmpeg -f rawvideo` 抽出来的帧做各种组合比对，判断差异来自哪里。
 *
 *   node scripts/anim.mjs dumppx demo --times 1.5 --out out/demo/_browser.raw
 */
async function cmdDumpPx() {
  const task = pickTask();
  const times = (opt('times', opt('t', '1')) ?? '1').split(',').map(Number).filter(Number.isFinite);
  const out = path.resolve(ROOT, opt('out', taskOut(task, '_browser.raw')));
  await openSession({ task, scale: Number(opt('scale', '0')) || undefined, only: opt('only', undefined) });
  try {
    for (const t of times) {
      const r = await getSession().page.evaluate(
        (tt) => /** @type {any} */ (window).__anim.framePixels(tt, { samples: 1 }),
        t,
      );
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from(r.pixels, 'base64'));
      log(`t=${t.toFixed(3)}  ${r.bytes} 字节 → ${path.relative(ROOT, out)}`);
    }
  } finally { await closeSession(); }
}
export { cmdDumpPx as run };
