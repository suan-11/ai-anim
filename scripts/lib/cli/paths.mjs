// @ts-check
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { opt, positional } from "./args.mjs";
import { die } from "./log.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/* ------------------------------------------------------------------ 参数解析 */




/**
 * 产物目录：`out/<任务>`，带 `--variant` 时是 `out/<任务>/<变体>`（BACKLOG 1-23）。
 *
 * **为什么必须分目录**：同一支片子的两个变体，成片、分块缓存、stills、hashes 基线全都不同；
 * 挤在一个目录里会互相覆盖/串味（最隐蔽的是 `video --segments` 的块缓存：改了两句词却
 * 复用了另一个变体的块，画面对不上还查不出来）。
 */
function taskOut(task, ...parts) {
  const v = opt('variant', '');
  // ⚠ 这里刻意写成 String(task)：这条 helper 是被一次全局替换生成出来的，
  //    用 path.join('out', task, …) 的字面形状会被替换脚本连自己一起改掉（踩过一次，自递归爆栈）。
  const root = path.join('out', String(task));
  return v ? path.join(root, v, ...parts) : path.join(root, ...parts);
}

/* ------------------------------------------------------------------ 任务发现 */

function taskNames() {
  const dir = path.join(ROOT, 'tasks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, 'task.config.mjs')))
    .map((d) => d.name)
    .sort();
}

function pickTask() {
  const t = positional(0) ?? opt('task');
  const names = taskNames();
  if (t) {
    if (!names.includes(t)) die(`没有任务 "${t}"。现有：${names.join(', ') || '(空)'}`);
    return t;
  }
  if (names.length === 1) return names[0];
  if (!names.length) die('还没有任何任务。先跑：node scripts/anim.mjs new 我的第一个动画');
  die(`有多个任务，请指定一个：${names.join(', ')}`);
}

/* ------------------------------------------------------------------ 命令：clean */

/** 递归算一个目录的总大小（字节）与文件数。 */
function dirStats(dir) {
  let bytes = 0, files = 0;
  const walk = (d) => {
    let ents = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { bytes += statSync(p).size; files++; } catch { /* ignore */ } }
    }
  };
  walk(dir);
  return { bytes, files };
}

/** 人类可读的大小。 */
function mb(bytes) { return `${(bytes / 1048576).toFixed(1)} MB`; }

const CLI_ENTRY_URL = new URL('../../anim.mjs', import.meta.url).href;

export { CLI_ENTRY_URL, ROOT, dirStats, mb, pickTask, taskNames, taskOut };
