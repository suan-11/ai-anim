// @ts-check
/**
 * `tools/lib/cli-source.mjs` —— CLI 的**拼接源码视图**（拆分前后都成立的那个"逻辑文件"）。
 *
 * ## 为什么需要它
 *
 * 有一批测试做的是**接线自检**（判据对了、接线没接上 = 白测）：它们直接读
 * `scripts/anim.mjs` 的源码文本，用正则 / includes 钉住"某个函数真的被调用了"。
 * 名单：`test-carry` `test-layout` `test-motion-assert` `test-motion-caps`
 * `test-segment-cuts` `test-shots` `test-tasks-meta` `test-tier-estimate`
 * `test-timeline-audit` `test-variants` `test-media-qa`。
 *
 * `scripts/anim.mjs`（8025 行）要拆成 `scripts/cmd/*.mjs` + `scripts/lib/cli/*.mjs`
 * （见 `docs/WORKORDER-gpt-2026-11-08.md` Stage 5）。拆完这些测试会全红 ——
 * 不是因为接线断了，而是因为它们只认那一个文件。这个模块把「CLI 的全部源码」变成一个
 * 逻辑文件：测试改读它之后，**拆分前后都成立**。
 *
 * ## 契约（三条）
 *
 * 1. **顺序确定**：`scripts/anim.mjs` 打头，然后 `scripts/cmd/*.mjs`、`scripts/lib/cli/*.mjs`；
 *    两个目录内部按**文件名字典序**（`Array#sort()` 的 code unit 序，**不是** `localeCompare` ——
 *    后者随 ICU / locale 机器间不同，不可复现）。
 * 2. **每段前面一行锚**：`// ---- <相对路径> ----`（`/` 分隔、相对仓库根）。
 *    ⚠ 加了这行 ⇒ **行号不再稳定**。要按行号断言的测试必须改成**按内容**匹配
 *    （本仓库这批接线自检本来就只做内容匹配；5B 搬函数时也不许新写行号断言）。
 * 3. **可选目录允许不存在**：`scripts/cmd/`、`scripts/lib/cli/` 现在就不存在 ——
 *    这时视图 = `anim.mjs` 全文（前面多一行注释锚），对内容的断言与旧的
 *    `readFileSync('scripts/anim.mjs', 'utf8')` **等价**。
 *
 * **空视图不算"干净"**：`scripts/anim.mjs` 读不到就直接抛，不返回空串
 * （否则所有接线自检会在一份空文本上静默变绿 —— "没跑 ≠ 通过"）。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根（`tools/lib/` 往上两级）。 */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** CLI 入口 —— 一定存在；缺了说明仓库本身就坏了。 */
export const CLI_ENTRY = 'scripts/anim.mjs';

/** 拆分后新增的两个目录，按**拼接顺序**给出；不存在就跳过（现在是这种情况）。 */
export const CLI_SPLIT_DIRS = ['scripts/cmd', 'scripts/lib/cli'];

/** 每段前面那行注释锚：`// ---- <相对路径> ----` */
export const segmentAnchor = (relPath) => `// ---- ${relPath} ----`;

/** 目录下的 `*.mjs` **文件名**（字典序）；目录不存在 / 不是目录 ⇒ 空数组（不是错误）。 */
function listMjs(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.mjs'))
    .map((e) => e.name)
    .sort();
}

/**
 * CLI 的源码片段清单（相对仓库根的 posix 路径，**按拼接顺序**）。
 * 拆分后只会多、不会少 —— 5B 的「命令表 ↔ 文件双向覆盖」也可以读它。
 *
 * @param {string} [root] 仓库根（默认本模块所在仓库）
 * @returns {string[]}
 */
export function cliSourceFiles(root = REPO_ROOT) {
  const entryPath = path.join(root, CLI_ENTRY);
  if (!statSync(entryPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`cli-source: 找不到 CLI 入口 ${CLI_ENTRY}（root=${root}）`);
  }
  const files = [CLI_ENTRY];
  for (const dir of CLI_SPLIT_DIRS) {
    for (const name of listMjs(path.join(root, dir))) files.push(`${dir}/${name}`);
  }
  return files;
}

/**
 * CLI 的**拼接源码视图**：`scripts/anim.mjs` + `scripts/cmd/*.mjs` + `scripts/lib/cli/*.mjs`，
 * 每段前面一行 `// ---- <相对路径> ----`，段间用一个换行接起来。
 *
 * 只按**内容**（正则 / includes / indexOf）断言的测试改读它，拆分前后都成立；
 * 按行号断言的一律改成按内容 —— 锚行与段数都会随拆分变化。
 *
 * @param {string} [root] 仓库根（默认本模块所在仓库）
 * @returns {string}
 */
export function readCliSource(root = REPO_ROOT) {
  return cliSourceFiles(root)
    .map((rel) => `${segmentAnchor(rel)}\n${readFileSync(path.join(root, rel), 'utf8')}`)
    .join('\n');
}
