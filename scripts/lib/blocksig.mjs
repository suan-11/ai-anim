// @ts-check
/**
 * 分块增量重渲的**判据**（BACKLOG 1-45）—— 纯函数，不碰 GPU、不碰 CLI 状态。
 *
 * 为什么单独一个模块：这两件事最容易"静默错"，而它们错了的表现是**画面错**而不是报错：
 *   ① `sceneFileIndex()` 把段 id 映射到源文件 —— 映射漏了 ⇒ 改了场景却复用旧块（拿旧画面冒充新画面）；
 *   ② `blockSignature()` 决定"这一块能不能复用" —— 多算 ⇒ 白重渲；少算 ⇒ 静默用旧块。
 * 所以它们必须是可以在 Node 里直接测的纯函数（`tools/test-block-sig.mjs`）。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** 不算"源文件"的目录（产物与运行时素材不影响画面签名） */
const SKIP_DIRS = new Set(['node_modules', 'out', '.git', 'audio', 'fonts']);
/** 场景签名关心的扩展名（字体换了画面就变，所以字体也算） */
const SOURCE_EXT = /\.(js|mjs|json|css|woff2?|ttf|otf)$/i;
/** id 只可能出现在这几种文件里 */
const JS_EXT = /\.(js|mjs)$/i;

/**
 * 递归收集文件（跳过产物/素材目录）。
 * @param {string} dir
 * @param {RegExp} accept
 * @param {string[]} [out]
 * @returns {string[]}
 */
export function walk(dir, accept, out = []) {
  let ents = [];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, accept, out);
    } else if (accept.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}


/**
 * **配置档任务的按段签名**（BACKLOG 1-59）。
 *
 * 问题：配置档任务（B 档）把十几段全写在同一个 `task.config.mjs` 里，而段 id → 源文件是
 * **文件粒度**的 —— 改任意一段的文案，那个文件的 `size:mtime` 就变，于是**所有**引用它的段
 * 签名一起变 ⇒ 12 块里 10 块重渲（2026-10-26 实测）。
 *
 * 做法：按 `id: 'xxx'` 找到它所属的**对象字面量**，用括号配平截出这一段源码，取它的哈希。
 * 于是"改 A 段"只让 A 段的签名变。截不出来（写法太野）就**不返回**，调用方退回整文件 mtime ——
 * 宁可多渲一块，也不拿旧块冒充新画面（与 1-45 同一条纪律）。
 *
 * @param {string} src 配置文件源码
 * @returns {Map<string, string>} id → 片段哈希
 */
export function configNodeHashes(src) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const text = String(src ?? '');
  // 只认行内 "id: 'xxx'"；先确认这一行的引号是配对的开引号（排除字符串里出现的 id:）
  for (const m of text.matchAll(/\bid\s*:\s*'([\w.-]+)'/g)) {
    const id = m[1];
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const before = text.slice(lineStart, m.index);
    // 落在字符串内部就不算键：把**单、双**引号一起数，
    // 任何一个奇数都说明此刻正处于某个字符串里（第一版只数单引号，sub: "id: 'fake'" 就漏了）
    const sq = (before.match(/'/g) ?? []).length;
    const dq = (before.match(/"/g) ?? []).length;
    if (sq % 2 === 1 || dq % 2 === 1) continue;
    const start = findEnclosingBrace(text, m.index);
    if (start < 0) continue;
    const end = matchBrace(text, start);
    if (end < 0) continue;
    const slice = text.slice(start, end + 1);
    out.set(id, hash32(slice));
  }
  return out;
}

/** 从 `at` 往回找最近的、未闭合的 `{`。 */
function findEnclosingBrace(text, at) {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    const c = text[i];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/** 从 `start` 那个 `{` 起，配平到对应的 `}`。 */
function matchBrace(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** FNV-1a 32 位（够用：只比"变没变"，不是安全哈希）。 */
function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * 段 id → 场景源文件（静态扫任务目录下的 `.js`）。
 *
 * 为什么靠扫而不是靠运行时：场景是**浏览器侧用 Vite 的 `import.meta.glob` 加载的**，
 * CLI 手上只有时间线（段 id / 起止 / 参数），拿不到模块路径。但每个场景文件里必然写着它的 id：
 * `id: 'chart'`、`makeShot('chart', …)`、`shot('chart', …)` 三种写法。
 *
 * ⚠ 扫不到的段**不猜**：`blockSignature()` 会记一个永远不匹配的 `?<id>`，
 * 于是包含它的块每次都重渲 —— 宁可多渲一块，也不要拿旧块冒充新画面。
 *
 * @param {string} taskDir 任务目录（绝对路径）
 * @param {string} root 仓库根（用来生成相对路径；不传就用 taskDir）
 * @returns {{ byId: Map<string, string[]>, all: string[] }}
 */
export function sceneFileIndex(taskDir, root = taskDir) {
  const files = walk(taskDir, JS_EXT);
  /** @type {Map<string, string[]>} */
  const byId = new Map();
  for (const f of files) {
    let src = '';
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    const rel = path.relative(root, f).split(path.sep).join('/');
    const ids = new Set();
    for (const m of src.matchAll(/\bid:\s*['"`]([\w.-]+)['"`]/g)) ids.add(m[1]);
    for (const m of src.matchAll(/\b(?:makeShot|shot)\(\s*['"`]([\w.-]+)['"`]/g)) ids.add(m[1]);
    for (const id of ids) {
      const list = byId.get(id) ?? [];
      list.push(rel);
      byId.set(id, list);
    }
  }
  // 配置档任务：同一文件里有很多段 ⇒ 再算一份"按段切片"的哈希（BACKLOG 1-59）
  /** @type {Map<string, string>} */
  const configHashes = new Map();
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    if (!/task\.config\.mjs$/.test(rel)) continue;
    let src = '';
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    for (const [id, h] of configNodeHashes(src)) configHashes.set(rel + '#' + id, h);
  }
  /**
   * **跨任务 import 的场景文件**：像 `tasks/nekohome-intro-ja` 这样只写配置、
   * 用 `import … from '../nekohome-intro/scenes/cards.js'` 复用别人场景的任务，
   * 上面那套 `walk(taskDir)` 一个文件都扫不到 —— 于是改源任务的场景，块签名不变、
   * 整批复用，画面上是**旧版本**（实测：给日文版加高光条，10 块全部「签名一致」跳过）。
   * 所以把配置里 `../` 开头的 .js import 解析出来，一起进签名。
   */
  const shared = [];
  for (const f of files) {
    if (!/task\.config\.mjs$/.test(f)) continue;
    let src = '';
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/from\s+['"](\.[^'"]*\.js)['"]/g)) {
      const abs = path.resolve(path.dirname(f), m[1]);
      if (!existsSync(abs)) continue;
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (!shared.includes(rel)) shared.push(rel);
    }
  }
  return {
    byId,
    all: files.map((x) => path.relative(root, x).split(path.sep).join('/')),
    configHashes,
    shared,
  };
}

/**
 * 一个**块**的签名：渲染参数 + 引擎 + 这一块覆盖到的段的场景文件与段参数。
 *
 * 保守规则（都写进 `docs/BACKLOG.md` 1-45 的判据）：
 *   · 引擎签名进每一块 ⇒ `src/` 一改，整批失效（引擎影响所有画面）；
 *   · 段查不到源文件 ⇒ `?<id>` ⇒ 这一块永远重渲；
 *   · 段的时间边界**不放宽**（第一版放宽 0.5s，结果"改一个镜头重渲三块"）。
 *
 * @param {{
 *   root: string,
 *   engineSig: string,
 *   paramsText: string,
 *   timeline: Array<{ id: string, start: number, end: number, params?: any }>,
 *   index: { byId: Map<string, string[]> },
 *   from: number,
 *   to: number,
 *   stat?: (p: string) => { size: number, mtimeMs: number },
 * }} o
 * @returns {string}
 */
export function blockSignature(o) {
  const stat = o.stat ?? ((p) => statSync(p));
  const segs = (o.timeline ?? []).filter((it) => it.end > o.from && it.start < o.to);
  const parts = [`p:${o.paramsText}`, `e:${o.globalSig ?? o.engineSig}`];
  /**
   * 这一块**真正依赖**的引擎通用件（`src/kit/` `src/shots/` 之类）。
   *
   * 以前这里只有 `e:<整仓 src/ 的 mtime 总和>` 一项 ⇒ 改一行引擎注释就整片重渲。
   * 现在按依赖图收窄：只把**这些段的场景真的 import 到**的引擎文件拼进来。
   *
   * ⚠ 拿不到某个场景的依赖（解析失败 / 跨任务 import 里指向包名）时**不猜**：
   * 设 `allEngine = true`，退回到"整仓引擎签名"的老行为 —— 宁可白重渲，也不拿旧块冒充新画面。
   */
  const usedEngine = new Set();
  let allEngine = false;
  for (const it of segs) {
    const files = o.index.byId.get(it.id);
    if (!files || !files.length) { parts.push(`?:${it.id}`); continue; }
    for (const rel of files) {
      // 配置档文件用**按段切片**的哈希：改 A 段不影响 B 段（BACKLOG 1-59）。
      // 切片截不出来就不进这张表，退回下面的整文件 mtime（保守）。
      const slice = o.index.configHashes?.get(rel + '#' + it.id);
      if (slice) { parts.push(`${rel}#${it.id}:slice:${slice}`); continue; }
      try {
        const st = stat(path.join(o.root, rel));
        parts.push(`${rel}:${st.size}:${Math.round(st.mtimeMs)}`);
      } catch { parts.push(`${rel}:missing`); }
      // 这个场景**传递依赖**到的引擎文件（由 engine-graph 的正向闭包算好传进来）
      const deps = o.engineDeps?.get(rel);
      if (!deps) { allEngine = true; } else { for (const d of deps) usedEngine.add(d); }
    }
    // 段参数（时间线上的 params）改了一样要重渲这一块
    parts.push(`params:${it.id}:${JSON.stringify(it.params ?? null)}`);
  }
  // 引擎通用件的原子签名：只有用得到的才进签名（allEngine = 退回"全部进"）
  if (o.engineAtoms) {
    const keys = allEngine ? [...o.engineAtoms.keys()] : [...usedEngine];
    for (const k of keys) parts.push('a:' + o.engineAtoms.get(k));
  } else if (allEngine) {
    // 没有原子表的老调用方：保持老行为（整仓签名已在 parts 里）
  }
  // 字幕（narration）改了画面就变了：字幕层是引擎画的，不是 ffmpeg 烧的 ——
  // 不把它算进签名，改完旁白文字会「5.8 秒渲完」却还是旧字幕（实测踩过）。
  // 跨任务 import 进来的场景文件（见 sceneFileIndex 的 shared）
  for (const rel of o.index.shared ?? []) {
    try {
      const st = stat(path.join(o.root, rel));
      parts.push('shared:' + rel + ':' + st.size + ':' + Math.round(st.mtimeMs));
    } catch { parts.push('shared:' + rel + ':missing'); }
  }
  if (o.narrationFile) {
    try {
      const st = stat(o.narrationFile);
      parts.push('narration:' + st.size + ':' + Math.round(st.mtimeMs));
    } catch { parts.push('narration:missing'); }
  }
  parts.sort();
  return parts.join('|');
}
