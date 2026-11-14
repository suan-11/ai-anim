// @ts-check
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { flag } from "../lib/cli/args.mjs";
import { log } from "../lib/cli/log.mjs";
import { ROOT } from "../lib/cli/paths.mjs";
/** `anim assets [--json]` —— 校验共享素材库（层 2）。只读文件，不起浏览器。 */
async function cmdAssets() {
  const man = path.join(ROOT, 'assets', 'manifest.json');
  if (!existsSync(man)) { console.error('没有 assets/manifest.json —— 见 docs/ASSETS.md 层 2'); process.exitCode = 2; return; }
  const j = JSON.parse(readFileSync(man, 'utf8'));
  const REQUIRED = ['id', 'path', 'kind', 'license', 'source'];
  const rows = [];
  const seen = new Set();
  let bad = 0;
  for (const a of j.assets ?? []) {
    const errs = [];
    for (const f of REQUIRED) if (!a[f]) errs.push('缺字段 ' + f);
    if (a.id && seen.has(a.id)) errs.push('id 重复');
    if (a.id) seen.add(a.id);
    const p = a.path ? path.join(ROOT, 'assets', a.path) : null;
    if (p && !existsSync(p)) errs.push('文件不存在：' + a.path);
    rows.push({ id: a.id ?? '(无)', kind: a.kind ?? '-', license: a.license ?? '-',
      size: p && existsSync(p) ? (statSync(p).size / 1024).toFixed(0) + ' KB' : '-', errs });
    if (errs.length) bad++;
  }
  if (flag('json')) { console.log(JSON.stringify({ count: rows.length, bad, rows }, null, 2)); if (bad) process.exitCode = 1; return; }
  log('共享素材库 assets/（' + rows.length + ' 条）');
  log('');
  for (const r of rows) {
    log('  ' + (r.errs.length ? '✗' : '✓') + ' ' + r.id.padEnd(22) + r.kind.padEnd(10) + r.license.padEnd(12) + r.size);
    for (const e of r.errs) log('      ' + e);
  }
  log('');
  log(bad ? '✗ ' + bad + ' 条不合法（四个字段 + 文件都要在，见 docs/ASSETS.md）' : '✓ 全部合法');
  log('用法：import { loadAsset, drawAsset } from \'../kit/assets.js\'（只能在 setup 里 load）');
  if (bad) process.exitCode = 1;
}
export { cmdAssets as run };
