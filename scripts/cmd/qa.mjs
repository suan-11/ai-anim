// @ts-check
import { existsSync } from "node:fs";
import path from "node:path";
import { flag, opt } from "../lib/cli/args.mjs";
import { die, log } from "../lib/cli/log.mjs";
import { ROOT, pickTask, taskOut } from "../lib/cli/paths.mjs";
/* ------------------------------------------------------------------ 命令：qa */

/**
 * `anim qa <任务>` —— **成片级技术扫描**（BACKLOG 1-39），纯 ffmpeg：不起 Vite、不起 Chrome、不 import 引擎。
 *
 * 为什么需要它（`docs/REFERENCE-eac-design-world.md` §3）：
 * `check` 每段只采 15% / 50% / 85% 三个点，`rhythm` 是**重新渲染**再差分，`verify` 是若干时刻抽帧比像素 ——
 * 三条都在"渲染/重渲"这一侧，**没有一条读过编码后的文件的每一秒**。切点处 0.3s 的黑闪正好从三点采样之间漏过去。
 *
 * 与 `verify` 的分工（别混）：
 *   · `verify` = 成片 vs 同 t 重渲 → 证明**画面是这一版**（拼错位 / 色彩 / 旧产物）；
 *   · `qa`     = 文件自己的技术读数 → 证明**这份文件没有黑闪 / 冻结 / 静音**，且能解码。
 *
 * ⚠ 默认**只报读数**（warn 不改退出码），因为黑场和静帧都可能是设计如此：
 * 我们的 `outro` 结尾压黑、hold 段本来就不动。`--strict` 才把 warn 当失败。
 *
 * ```sh
 * node scripts/anim.mjs qa demo
 * node scripts/anim.mjs qa demo --strict --freeze 5      # 静帧超过 5s 才算问题
 * node scripts/anim.mjs qa demo --file out/demo/shot_0-3.mp4 --json
 * ```
 */
async function cmdQa() {
  const task = pickTask();
  const file = path.resolve(ROOT, opt('file', opt('o', taskOut(task, `${task}.mp4`))));
  if (!existsSync(file)) die(`没有找到成片 ${path.relative(ROOT, file)}。先跑 video，或用 --file 指定。`);
  const strict = flag('strict');
  const withDecode = !flag('no-decode');
  const head = Number(opt('head', '0.5'));
  const tail = Number(opt('tail', '1.2'));
  const maxFreeze = Number(opt('freeze', '3'));
  for (const [k, v] of Object.entries({ head, tail, maxFreeze })) {
    if (!Number.isFinite(v) || v < 0) die(`--${k === 'maxFreeze' ? 'freeze' : k} 要一个非负秒数（收到 ${JSON.stringify(v)}）`);
  }

  const { scanMediaFile, classifyMediaScan } = await import("../lib/media.mjs");
  const scan = scanMediaFile(file, { decode: withDecode });
  const verdict = classifyMediaScan(scan, { head, tail, maxFreeze });
  const frames = scan.fps ? Math.round(scan.duration * scan.fps) : null;

  if (flag('json')) {
    log(JSON.stringify({ scan, verdict, strict }, null, 2));
    process.exitCode = verdict.errors.length || (strict && verdict.warnings.length) ? 1 : 0;
    return;
  }

  log(`成片技术扫描 ${path.relative(ROOT, file)}  ${scan.width ?? '?'}×${scan.height ?? '?'} @${scan.fps ? scan.fps.toFixed(2) : '?'}fps`
    + `  ${scan.duration.toFixed(3)}s  ${frames ?? '?'} 帧`);
  const th = verdict.thresholds;
  log(`  判据：黑场 ≥${th.blackDur}s（pix_th 0.10）· 静帧 ≥${th.freezeDur}s（-50dB）`
    + ` · 片头 ${th.head}s / 片尾 ${th.tail}s 的黑算设计 · 静帧超过 ${th.maxFreeze}s 才警`);
  log('');

  const label = { error: '✗', warn: '⚠', info: '·' };
  for (const group of [verdict.errors, verdict.warnings, verdict.infos]) {
    for (const it of group) log(`  ${label[it.tier]} ${it.text}`);
  }
  if (!verdict.items.length) log('  ✓ 解码、黑场、静帧、音量四项都没有异常读数');

  log('');
  log(`结论：${verdict.errors.length ? '失败' : (strict && verdict.warnings.length ? '失败（--strict）' : '通过')}`
    + `（${verdict.errors.length} 错 / ${verdict.warnings.length} 警 / ${verdict.infos.length} 条读数`
    + (withDecode ? '' : '；--no-decode：解码这一条没验') + '）');
  if (verdict.warnings.length && !strict) log('  （警告默认不改退出码；要当门用加 --strict）');
  process.exitCode = verdict.errors.length || (strict && verdict.warnings.length) ? 1 : 0;
}
export { cmdQa as run };
