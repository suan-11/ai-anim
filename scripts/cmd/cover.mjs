// @ts-check
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { opt } from "../lib/cli/args.mjs";
import { collectRenderErrors, reportErrors } from "../lib/cli/gates.mjs";
import { die, log, warn } from "../lib/cli/log.mjs";
import { ROOT, pickTask, taskOut } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
/**
 * `anim cover <任务> -t <秒>` —— 出一张**封面**（BACKLOG 1-53）。
 *
 * 与 `still` 的区别只有一层：still 出来的是"片子里的那一帧"，cover 在它上面再压
 * 底部渐变压暗 + 主标题 + 一条信号色短线 + 副标。字体用的是引擎那套（Noto Sans SC /
 * 拱形 Archivo / Plex Mono），所以封面与成片的字是同一家人 —— 不是 ffmpeg drawtext
 * 另找一份字体。
 *
 * 判据：出来的 PNG 尺寸 = 任务分辨率 × --scale；字的墨迹落在下半屏（上半屏留给画面）。
 *
 *   node scripts/anim.mjs cover <任务> -t 12 --title "把信号拆开" --sub "SPECTRUM · 72s"
 *   node scripts/anim.mjs cover <任务> -t 12 --title "…" --scale 2     # 4K 封面
 */
async function cmdCover() {
  const task = pickTask();
  const t = Number(opt('t', '6'));
  if (!Number.isFinite(t)) die('-t 需要给一个秒数，例如 -t 12');
  const title = opt('title', undefined);
  const sub = opt('sub', undefined);
  if (!title && !sub) die('封面至少要 --title 或 --sub（否则就是一张 still，用 still 更直接）');
  const scale = Number(opt('scale', '0')) || undefined;
  const scrim = opt('scrim', undefined);
  // 4K 封面不要覆盖 1080p 那张：文件名带上 @2x（--out 显式给了就照给的写）
  const tag = scale && scale > 1 ? `@${scale}x` : '';
  const outFile = path.resolve(ROOT, opt('out', opt('o', taskOut(task, `cover_${t.toFixed(2)}${tag}.png`))));
  mkdirSync(path.dirname(outFile), { recursive: true });

  await openSession({ task, scale });
  try {
    const info = getSession().info;
    const t0 = Date.now();
    const r = await getSession().page.evaluate(
      ([tt, o]) => /** @type {any} */ (window).__anim.cover(tt, o),
      [t, { title, sub, scrim: scrim === undefined ? undefined : Number(scrim) }],
    );
    writeFileSync(outFile, Buffer.from(String(r.png).split(',')[1], 'base64'));
    log(`封面 → ${path.relative(ROOT, outFile)}  (${info.width}×${info.height}${info.scale > 1 ? ' ×' + info.scale : ''}, t=${t}s, 子帧 ${r.samples}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    reportErrors(getSession().info);
    const rerr = await collectRenderErrors({ take: false });
    if (rerr.count) {
      warn(`\n⚠ 封面那一帧有场景异常（${rerr.count} 帧）—— 封面是**错帧卡片**，不是画面`);
      for (const line of rerr.text.slice(0, 4)) warn('  · ' + line);
      process.exitCode = 1;
    }
  } finally { await closeSession(); }
}
export { cmdCover as run };
