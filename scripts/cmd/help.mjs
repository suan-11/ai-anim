// @ts-check
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { log } from "../lib/cli/log.mjs";
import { CLI_ENTRY_URL } from "../lib/cli/paths.mjs";
/* ------------------------------------------------------------------ help */

function help() {
  // 打印文件头那段 JSDoc（新增命令时只要改头部，help 自动跟上）
  const src = readFileSync(fileURLToPath(CLI_ENTRY_URL), 'utf8');
  const start = src.indexOf('/**');
  const end = src.indexOf('*/', start);
  log(src.slice(start + 3, end).split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim());
}
export { help as run };
