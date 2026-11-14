// @ts-check
import { flag } from "../lib/cli/args.mjs";
import { log } from "../lib/cli/log.mjs";
/** `anim icons` —— 列出内置矢量图标（层 1 素材库） */
async function cmdIcons() {
  const { ICON_NAMES } = await import("../../src/kit/icons.js");
  if (flag('json')) { console.log(JSON.stringify({ icons: ICON_NAMES }, null, 2)); return; }
  log('内置矢量图标（' + ICON_NAMES.length + ' 个，24×24 折线定义，src/kit/icons.js）');
  log('');
  for (let i = 0; i < ICON_NAMES.length; i += 6) log('  ' + ICON_NAMES.slice(i, i + 6).map((n) => n.padEnd(14)).join(''));
  log('');
  log('看长什么样：node scripts/anim.mjs still _icon-sheet -t 1');
  log('用法：import { drawIcon } from \'../kit/icons.js\' → drawIcon(lines, \'cat\', x, y, 48, color)');
}
export { cmdIcons as run };
