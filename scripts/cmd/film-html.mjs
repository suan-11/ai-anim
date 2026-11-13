// @ts-check
import { spawnSync } from "node:child_process";
import path from "node:path";
import { flag, opt } from "../lib/cli/args.mjs";
import { ROOT, pickTask } from "../lib/cli/paths.mjs";
async function cmdFilmHtml() {
  const task = pickTask();
  const out = opt('out', '');
  const args = [task];
  if (out) args.push('--out', out);
  if (opt('max-audio', '')) args.push('--max-audio', opt('max-audio', ''));
  if (flag('no-audio')) args.push('--no-audio');
  // 单文件播放器要 esbuild 打包 + 内联音轨，交给 tools/film-html.mjs（同一份逻辑，别抄两遍）
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'film-html.mjs'), ...args], { stdio: 'inherit' });
  if (r.status !== 0) process.exitCode = r.status ?? 1;
}
export { cmdFilmHtml as run };
