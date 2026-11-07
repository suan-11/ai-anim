// @ts-check
/**
 * `scripts/lib/render-stamp.mjs` —— **成片版本戳**：这份 mp4 是用哪一版引擎 / 哪一版场景渲的。
 *
 * ## 为什么要有它（以及它**不**用来干什么）
 *
 * 引擎一改，`--segments` 会按块签名判定"这块的依赖变了" ⇒ 整批重渲。那是**缓存失效**规则，
 * 对"正在渲的这支片子"是对的（否则会拼出半新半旧的画面）。
 * 但它被误读成了"**已交付的片子必须重渲**" —— 交付物就交付了，引擎往前走不等于旧片子作废。
 *
 * 所以这一层只做一件事：**把"这份成片是旧版本渲的"记下来**，而不是让所有人以为它必须重来。
 * 记录比 mtime 猜得准 —— mtime 在 `git clone` / `checkout` 之后会集体刷新，
 * 那时"成片比源码旧"的推断会给出完全错误的答案。
 *
 * ## 三条纪律
 *
 *   ① **按内容算，不按 mtime 算**。mtime 跨机器、跨 clone 不可比；这一层的签名进 git，
 *      必须**逐字节可复现**。
 *   ② **戳只写进 `tasks/<任务>/`**（跟着任务走、跟着版本控制走），不写进 `out/`
 *      —— `out/` 是 gitignore 的产物目录，戳写在那里等于没写。
 *   ③ **戳不是门**。版本不一致只影响"报告里怎么说"，不阻塞提交、不阻塞出片。
 *      —— 「旧版本」是一条**事实**，不是一个**错误**。
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 戳文件在任务目录里的**固定**名字（改它就要同步 `scripts/anim.mjs` 与 `tools/precommit-report.mjs` 的排除表） */
export const STAMP_FILE = 'render-stamp.json';
/**
 * 「渲于版本戳之前」的哨兵值。
 *
 * 老片子（这一层落地之前渲的）**没有**引擎签名可查，而编一个出来是假读数。
 * 所以显式记成这个哨兵：它表示「引擎版本未知」，比对结果仍然是 `engine-drift`
 * —— 想跟上就重渲，但**交付物不作废**。`anim stamp --legacy` 就是给这些片子补这一笔。
 */
export const LEGACY_ENGINE = 'legacy-unknown';
/** 载荷版本号：形状一变就 +1，老戳会被当成"读不懂"而不是被误读 */
export const STAMP_SCHEMA = 'anim.render-stamp/1';

/** 不算源文件（产物 / 依赖 / 运行时素材） */
const SKIP_DIRS = new Set(['node_modules', 'out', '.git', 'fonts']);
/** 进签名的**源码**扩展名（音频二进制不算：它们不进画面；`audio/*.json` 会进 —— 字幕表改了画面就变） */
const SOURCE_EXT = /.(js|mjs|json|css|html|woff2?|ttf|otf)$/i;
/** 引擎地基（与 `scripts/lib/engine-graph.mjs` 的 GLOBAL_PREFIXES 同口径：它们一改，任何片子都可能变） */
const ENGINE_DIRS = ['src', 'public'];
const ENGINE_FILES = ['vite.config.mjs'];

/**
 * 递归收集文件。
 * @param {string} dir
 * @param {RegExp} accept
 * @param {string[]} [out]
 * @returns {string[]}
 */
function walk(dir, accept, out = []) {
  let ents = [];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, accept, out);
    } else if (accept.test(e.name)) {
      // 戳自己永远不进签名（它每次渲染都变，进了就是自指、永远"不一致"）
      if (e.name === STAMP_FILE) continue;
      out.push(p);
    }
  }
  return out;
}

/** 一个文件的**内容**哈希（sha256 的前 16 位十六进制；够用：只比"变没变"） */
export function fileHash(file) {
  try { return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16); }
  catch { return 'missing'; }
}

/**
 * 把一组文件压成一个可复现的签名。
 * 逐字节可复现的关键：**排序 + 只写相对路径与内容哈希**，不带 mtime、不带绝对路径。
 * @param {string} root
 * @param {string[]} files
 * @returns {string}
 */
export function sigOf(root, files) {
  const rows = files
    .map((f) => path.relative(root, f).split(path.sep).join('/') + ':' + fileHash(f))
    .sort();
  return createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 16);
}

/** **引擎签名**：`src/**` + `public/**` + `vite.config.mjs`（与 engine-graph 的地基名单同口径） */
export function engineSig(root) {
  const files = [];
  for (const d of ENGINE_DIRS) walk(path.join(root, d), SOURCE_EXT, files);
  for (const f of ENGINE_FILES) {
    const p = path.join(root, f);
    if (existsSync(p)) files.push(p);
  }
  return sigOf(root, files);
}

/**
 * **任务签名**：任务目录里的源码（含 `audio/*.json` 与 `audio/timing.mjs`）。
 * 跨任务 import 的场景（`import … from '../别的任务/scenes/x.js'`）也算进来 ——
 * 那正是「改了源任务，派生任务看起来没变」的那个坑（`blocksig.mjs` 的 `shared`）。
 * @param {string} root
 * @param {string} task
 */
export function taskSig(root, task) {
  const files = walk(path.join(root, 'tasks', task), SOURCE_EXT);
  const cfg = path.join(root, 'tasks', task, 'task.config.mjs');
  if (existsSync(cfg)) {
    try {
      const src = readFileSync(cfg, 'utf8');
      for (const m of src.matchAll(/from\s+['"](\.[^'"]*\.js)['"]/g)) {
        const abs = path.resolve(path.dirname(cfg), m[1]);
        if (existsSync(abs) && !files.includes(abs)) files.push(abs);
      }
    } catch { /* 读不到就当没有跨任务依赖 */ }
  }
  return sigOf(root, files);
}

/** 戳文件路径 */
export function stampPath(root, task) { return path.join(root, 'tasks', task, STAMP_FILE); }

/**
 * 读一个任务的戳。读不懂（缺文件 / JSON 坏 / schema 不认识）一律返回 `null`
 * —— **不猜**，由调用方说"没有记录"。
 * @param {string} root
 * @param {string} task
 */
export function readStamp(root, task) {
  const f = stampPath(root, task);
  if (!existsSync(f)) return null;
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    if (j?.schema !== STAMP_SCHEMA) return null;
    if (typeof j.engine !== 'string' || typeof j.scene !== 'string') return null;
    return j;
  } catch { return null; }
}

/**
 * 写一个任务的戳。
 * @param {string} root
 * @param {string} task
 * @param {Record<string, any>} payload
 */
export function writeStamp(root, task, payload) {
  const row = {
    schema: STAMP_SCHEMA,
    task,
    at: new Date().toISOString(),
    ...payload,
  };
  writeFileSync(stampPath(root, task), JSON.stringify(row, null, 2) + '\n');
  return row;
}

/**
 * 比对「戳」与「现在」。
 *
 * @param {any} stamp 读出来的戳（`null` = 没有记录）
 * @param {{ engine: string, scene: string }} now
 * @returns {{ state: 'current' | 'engine-drift' | 'scene-drift' | 'missing', note: string }}
 *   · `current` —— 这份成片正是当前代码渲的；
 *   · `engine-drift` —— 引擎动过了（**不**意味着要重渲，只意味着它不是最新引擎的样子）；
 *   · `scene-drift` —— 这支片子自己的文件动过了（这条才真的需要重渲才能看到效果）；
 *   · `missing` —— 没戳（老片子 / 从没跑过 `anim video`）。
 */
export function compareStamp(stamp, now) {
  if (!stamp) return { state: 'missing', note: '没有版本记录（这份成片渲于这一层之前，或从没跑过 video）' };
  const engineMoved = stamp.engine !== now.engine;
  const sceneMoved = stamp.scene !== now.scene;
  if (sceneMoved) {
    return {
      state: 'scene-drift',
      note: '这支片子自己的文件改过了（成片是 ' + (stamp.at ?? '?') + ' 渲的）—— 要看效果得重渲',
    };
  }
  if (engineMoved) {
    if (stamp.engine === LEGACY_ENGINE) {
      return {
        state: 'engine-drift',
        note: '成片渲于版本戳之前（引擎版本未知）—— 交付物不作废；想知道现在长什么样再重渲',
      };
    }
    return {
      state: 'engine-drift',
      note: '成片是旧引擎渲的（引擎 ' + stamp.engine + ' → ' + now.engine + '）—— 交付物不作废，想跟上再重渲',
    };
  }
  return { state: 'current', note: '成片就是当前这一版渲的' };
}
