// @ts-check
import { log } from "../lib/cli/log.mjs";
/* ------------------------------------------------------------------ 命令：styles / subs */

/**
 * `anim styles` —— 列出全部风格包（`docs/STYLE.md`）。
 *
 * 为什么值得单独一条命令：风格是"整片观感"的开关，而它以前**没有任何入口**
 * （审计结论：8 个**老**镜头模板是 `demo` + `beat` 两支片子的逐像素冻结副本，2026-10-16 起镜头库共 11 个（新加的 quote / counter / compare 是新写的）；默认调色板就是
 * `tasks/pdoom-lab` 那一支的配色；三份入口文档印着同一段起手场景）。有了这张清单，
 * "下一支换一套"才可能真的发生。
 */
async function cmdStyles() {
  const { listStyles } = await import("../../src/style/index.js");
  const all = listStyles();
  log(`风格包（src/style/，共 ${all.length} 套）—— task.config.mjs 里写 style: '<名字>' 就行\n`);
  const w = Math.max(...all.map((s) => s.name.length));
  for (const s of all) {
    log(`  ${s.name.padEnd(w)}  ${s.label}   [背景母题 ${s.motif}]`);
    log(`  ${' '.repeat(w)}  ${s.note}`);
    log(`  ${' '.repeat(w)}  底色 ${s.palette.ink} · 正文 ${s.palette.bone} · 强调 ${s.palette.signal}`);
    log('');
  }
  log('细则（合并优先级 / 反审美疲劳的两条纪律 / 每片必须换掉的三项）：docs/STYLE.md');
  log('想看看同一段画面在几套风格下各长什么样：node scripts/anim.mjs still style-sampler -t 2,6,10');
}
export { cmdStyles as run };
