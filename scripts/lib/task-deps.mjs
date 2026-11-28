// @ts-check
/**
 * 递归收集一个任务依赖的其他 tasks/ 源文件（例如 tasks/_shared/）。
 * 只处理相对静态 import；解析到任务目录之外、但仍在 tasks/ 下的 .js/.mjs 会进入结果。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseImports, resolveSpecifier } from './engine-graph.mjs';

const SOURCE_EXT = /\.(?:js|mjs)$/i;
const SKIP_DIRS = new Set(['node_modules', 'out', '.git']);

/** @param {string} parent @param {string} file */
function isWithin(parent, file) {
  const rel = path.relative(parent, file);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

/** @param {string} dir @param {string[]} out */
function walkTaskSources(dir, out) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkTaskSources(file, out);
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
      out.push(file);
    }
  }
  return out;
}

/**
 * @param {string} root Repository root.
 * @param {string} task Task directory name (not an absolute path).
 * @returns {string[]} Sorted, unique repository-relative paths using `/` separators.
 */
export function taskLocalDeps(root, task) {
  const repoRoot = path.resolve(root);
  const tasksRoot = path.resolve(repoRoot, 'tasks');
  const taskDir = path.resolve(tasksRoot, task);
  if (!isWithin(tasksRoot, taskDir) || taskDir === tasksRoot) return [];

  const pending = walkTaskSources(taskDir, []);
  const seen = new Set();
  const shared = new Set();
  while (pending.length) {
    const file = path.resolve(pending.pop());
    if (seen.has(file)) continue;
    seen.add(file); // Also breaks cycles among task-local/shared modules.

    let source = '';
    try { source = readFileSync(file, 'utf8'); } catch { continue; }
    for (const spec of parseImports(source).paths) {
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
      const resolved = resolveSpecifier(file, spec);
      if (!resolved || !SOURCE_EXT.test(resolved)) continue;
      const dep = path.resolve(resolved);
      if (isWithin(tasksRoot, dep) && !isWithin(taskDir, dep)) {
        shared.add(path.relative(repoRoot, dep).split(path.sep).join('/'));
      }
      if (!seen.has(dep)) pending.push(dep);
    }
  }
  return [...shared].sort();
}
