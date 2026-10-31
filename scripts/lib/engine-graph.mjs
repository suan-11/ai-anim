// @ts-check
/**
 * `engine-graph.mjs` —— **引擎改动的爆炸半径**（纯函数，不碰 GPU / 文件系统状态）。
 *
 * 背景（BACKLOG 1-45 的第一版）：块签名的做法是「把 `src/` 下所有文件的 mtime 拼成一个
 * 引擎签名，塞进每一块」⇒ 改一行引擎注释 = **整片重渲**。对一个三分钟、70 分钟的片子，
 * 这条规则把「改一个镜头」和「改一个底层函数」的代价拉平了 —— 后者本来就该整批重渲，
 * 前者不该。
 *
 * 这里做的是**按真实 import 图算爆炸半径**：
 *
 *   · 一条 import 边 `A -> B` 表示「改了 B，A 的画面可能变」；
 *   · 从被改的文件出发，沿反向边求可达集 —— 那就是受影响的文件集合；
 *   · 一个块要重渲 ⇔ 它用到的文件（场景 / 模板 / kit 件）里，有任何一个落在受影响集合里。
 *
 * ## 三条保守规则（少算 = 拿旧块冒充新画面，比多渲一块贵得多）
 *
 * 1. **引擎地基一律全局**：`src/core/`、`src/style/`、`src/app.js`、`src/timeline.js`
 *    这些被所有块依赖，它们的改动直接判「整批失效」，不进图算（省时间也更不容易错）。
 * 2. **解析不出来的 import 当作"依赖一切"**：动态 `import()`、`import.meta.glob`、
 *    指到 `node_modules` 的、路径拼不出来的一律标示成 `*`，调用方据此退回整批。
 * 3. **删掉的文件也算改动**：mtime 表里消失的路径必须能被发现（否则删一个模板文件会被当成没变）。
 *
 * @module
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseImportSymbols, parseExports, shotLiterals } from './barrel-follow.mjs';

/** 不算源文件（产物 / 素材 / 依赖） */
const SKIP_DIRS = new Set(['node_modules', 'out', '.git', 'audio', 'fonts']);
/** 会进模块图的扩展名 */
export const SOURCE_EXT = /\.(js|mjs|json|css|html|woff2?|ttf|otf)$/i;

/**
 * **引擎地基**：这些路径（前缀）一改，任何块都可能变 ⇒ 整批重渲，不试图细算。
 *
 * 为什么把 `src/kit/` 与 `src/shots/` 排除在外：它们是**建在地基上的通用件**，
 * 只有真正 import 了它们的场景 / 模板才受影响（实测：`src/core` 与 `src/style`
 * 对 `src/kit` 的引用是 0 条，唯一的反向依赖是 `src/timeline.js -> src/shots/index.js`，
 * 而 timeline 本来就在地基名单里）。
 */
export const GLOBAL_PREFIXES = [
  'src/core/',
  'src/style/',
  'src/app.js',
  'src/main.js',
  'src/timeline.js',
  'src/tasks.js',
  'src/layout.js',
  'vite.config.mjs',
  'public/',
];

/** @param {string} rel 相对 root、用 `/` 分隔的路径 */
export function isGlobalSource(rel) {
  return GLOBAL_PREFIXES.some((p) => rel.startsWith(p) || rel === p);
}

/**
 * 递归收集源文件（跳过产物与素材目录）。
 * @param {string} dir
 * @param {RegExp} accept
 * @param {string[]} [out]
 * @returns {string[]}
 */
export function walkSources(dir, accept = SOURCE_EXT, out = []) {
  let ents = [];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkSources(p, accept, out);
    } else if (accept.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * 剥掉注释、保留代码正文（字符串原样保留 —— @from '...' 的路径要靠它）。
 *
 * 为什么必须先剥：文档注释里天天写着示例 import，直接拿正则扫全文，那些示例会被算成
 * 真实依赖 —— 轻则解析失败被标成"动态"（整批失效、白重渲），重则把不该连的文件连上。
 * **注释里的假边比漏边更贵**（它让实验白做）。
 */
export function stripComments(src) {
  const text = String(src ?? '');
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '/' && n === '/') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      out += c;
      i++;
      while (i < text.length) {
        if (text[i] === '\\') { out += text[i]; i++; if (i < text.length) { out += text[i]; i++; } continue; }
        out += text[i];
        if (text[i] === c) { i++; break; }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * 从一份源码里解析静态 import / re-export 的**路径**（不含包名）。
 *
 * 认这几种写法：
 *   `import x from './a.js'` / `import {y} from '../b.js'` / `export {z} from './c.js'`
 *   `export * from './d.js'` / `import './e.js'`（副作用导入）
 *
 * **不认**（保守起见记成"依赖一切"）：`import(` 动态导入、`import.meta.glob`、
 * 以及任何不带 `./` `../` 前缀的说明符（包名 / 裸路径）。
 *
 * @returns {{ paths: string[], dynamic: boolean }}
 */
export function parseImports(src) {
  const text = stripComments(src);
  const paths = [];
  let dynamic = false;
  // 动态导入 / 构建期 glob：解析不出来 ⇒ 调用方退回整批
  if (/\bimport\s*\('/.test(text)) dynamic = true;
  if (/\bimport\.meta\.(glob|globEager|globDeep)/.test(text)) dynamic = true;
  // 静态形式：import/export ... from '<spec>'
  for (const m of text.matchAll(/\b(?:import|export)\s*(?:[^'";]*?)\sfrom\s*'([^']+)'/g)) {
    push(m[1]);
  }
  // 副作用导入：import './a.js'
  for (const m of text.matchAll(/\bimport\s*'([^']+)'/g)) push(m[1]);
  function push(spec) {
    if (/^\s*(js|ts)\b/.test(spec)) return; // 防止把 "import js ..." 这类误抓
    paths.push(spec);
  }
  return { paths, dynamic };
}

/**
 * 把一条 import 说明符解析成绝对路径（解析不出来返回 null）。
 * 支持省略扩展名（`./a` → `./a.js`），与 Vite 的解析习惯一致。
 * @param {string} fromFile 绝对路径
 * @param {string} spec
 * @returns {string|null}
 */
export function resolveSpecifier(fromFile, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null; // 包名 / 裸路径：不追
  // 绝对路径（`/` 开头）在 Vite 里指项目根；这里按 rootDir 解析。
  // ⚠ 本仓当前 214 条 import 全是相对路径，但工具被别的项目 / 未来写法复用时不该静默失效。
  const dir = path.dirname(fromFile);
  const base = spec.startsWith('/') ? path.resolve(ROOT_HINT(f), spec.slice(1)) : path.resolve(dir, spec);
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of ['.js', '.mjs', '.json', '.css']) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

/**
 * 绝对说明符（`/src/x.js`）的项目根：从 `fromFile` 往上找最近的 `src` 目录。
 * 找不到就退两层 —— 只为"不崩"，真实仓库的写法都是相对路径。
 * @param {string} fromFile
 */
function ROOT_HINT(fromFile) {
  const parts = fromFile.split(path.sep);
  const idx = parts.indexOf('src');
  if (idx > 0) return parts.slice(0, idx).join(path.sep);
  return path.dirname(path.dirname(fromFile));
}

/**
 * 建**反向依赖图**：`被依赖文件的绝对路径 -> [依赖它的文件]`。
 *
 * 之所以建反向图：问的是「改了 B，谁会跟着变」，沿着反向边做一次可达集就够了，
 * 不必每次从所有入口正着搜。
 *
 * @param {string[]} files 绝对路径列表（要参与分析的全部源文件）
 * @param {(f: string) => string} [read] 读文件（测试可注入）
 * @returns {{ importers: Map<string, string[]>, dynamicFiles: Set<string> }}
 */
export function buildImportGraph(files, read = (f) => readFileSync(f, 'utf8')) {
  /** @type {Map<string, string[]>} */
  const importers = new Map();
  /** @type {Set<string>} */
  const dynamicFiles = new Set();
  for (const f of files) {
    let src = '';
    try { src = read(f); } catch { dynamicFiles.add(f); continue; }
    const { paths, dynamic } = parseImports(src);
    if (dynamic) dynamicFiles.add(f); // 解析不全 ⇒ 这个文件本身算"可能依赖一切"
    for (const spec of paths) {
      const abs = resolveSpecifier(f, spec);
      if (!abs) { dynamicFiles.add(f); continue; }
      const list = importers.get(abs) ?? [];
      list.push(f);
      importers.set(abs, list);
    }
  }
  return { importers, dynamicFiles };
}

/**
 * 从若干被改文件出发，沿反向边求**受影响集合**（含它们自己）。
 *
 * @param {Map<string, string[]>} importers 反向图
 * @param {string[]} changed 绝对路径
 * @returns {Set<string>}
 */
export function affectedBy(importers, changed) {
  const seen = new Set();
  const stack = [...changed];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const up of importers.get(f) ?? []) stack.push(up);
  }
  return seen;
}

/**
 * 每个入口场景文件**传递依赖**到的非地基引擎文件（`src/kit/` `src/shots/` 这些）。
 *
 * 这是「块签名只收窄到用得到的引擎件」的输入：某个块的场景 import 了 `shot('chart')`，
 * 那么 `src/shots/chart.js` 变 ⇒ 这块重渲；而 `src/shots/pixel.js` 变 ⇒ 与它无关。
 *
 * 返回的集合里**不含地基文件**（`src/core/` 等走全局签名，见 `GLOBAL_PREFIXES`）。
 * 解析不出依赖的入口会在 `unresolved` 里点名，调用方据此退回"全部进"。
 *
 * @param {string[]} entries 入口（场景文件）绝对路径
 * @param {?{ importers: Map<string,string[]>, dynamicFiles: Set<string> }} _graph 未用（保留签名一致性）
 * @param {(f: string) => string} [read] 读文件（测试可注入）
 * @returns {{ deps: Map<string, Set<string>>, unresolved: Set<string> }}
 *   `deps` 的键是入口的**相对路径**（`/` 分隔、相对 root），值是相对路径集合
 */
export function entryEngineDeps(entries, rootDir, read = (f) => readFileSync(f, 'utf8')) {
  /** @type {Map<string, Set<string>>} */
  const deps = new Map();
  /** @type {Set<string>} */
  const unresolved = new Set();
  const relOf = (abs) => path.relative(rootDir, abs).split(path.sep).join('/');

  /**
   * 跟着一个文件往下走。`wanted` 是「调用方要的符号」：
   *   · `null` = 全都要（默认导入 / 命名空间导入 / 首层入口 / 副作用导入）；
   *   · 具体名字集 = 只跟进这些名字在 barrel 里指向的那几支。
   */
  /**
   * 展开**镜头模板 barrel**：按 `shot('chart')` 的字面量，只把该模板文件算作依赖。
   * 判不出字面量（变量 / 模板串 / 根本没有）⇒ 退回整表 + 记 unresolved（保守）。
   */
  function expandShotBarrel(file, exports, src, ctx, seen, relDeps, entryRel) {
    setShotRegistry(file, exports, src);
    // barrel 文件本身必须算依赖：改 index.js（登记表 / 分派逻辑）会让所有块重渲
    const relSelf = relOf(file);
    if (!isGlobalSource(relSelf)) relDeps.add(relSelf);
    const ref = ctx?.referrerShots;
    const seenFromScene = !!ref || ctx?.referrerOpaque;
    const own = shotLiterals(src);
    const literal = ref && ref.size ? ref : own.literal;
    // 场景侧说过"判不出"（opaque）⇒ 这里必须也判不出；否则退回看 barrel 自己的（通常 false）
    const opaque = seenFromScene ? !!ctx?.referrerOpaque : own.opaque;
    const importAll = () => {
      for (const spec of [...exports.fromFile.values(), ...exports.starFrom]) {
        const abs = resolveSpecifier(file, spec);
        if (!abs || !isSrcPath(abs, rootDir)) continue;
        const rel = relOf(abs);
        if (!isGlobalSource(rel)) relDeps.add(rel);
        walk(abs, null, seen, relDeps, entryRel, {});
      }
    };
    // ref 为空 = 走到 barrel 的那条链上**没有任何场景写过 shot('x')**（例如从 timeline.js
    // 直接进来的登记路径）。这不算"判不出"：真正的场景块会在自己的入口上带字面量。
    // 只有当这条链**本应**有字面量却判成 opaque 时，才退回整表。
    if (opaque || (literal.size === 0 && seenFromScene)) { unresolved.add(entryRel); importAll(); return; }
    for (const name of literal) {
      const spec = shotRegistrySpec(file, name);
      if (!spec) { unresolved.add(entryRel); importAll(); continue; }
      const abs = resolveSpecifier(file, spec);
      if (!abs || !isSrcPath(abs, rootDir)) { unresolved.add(entryRel); continue; }
      const rel = relOf(abs);
      if (!isGlobalSource(rel)) relDeps.add(rel);
      walk(abs, null, seen, relDeps, entryRel, {});
    }
  }

  function walk(file, wanted, seen, relDeps, entryRel, ctx) {
    // ctx.shotNames：**入口场景里写死的模板名**（`shot('chart')`）。
    // 为什么从入口带下来：`shot()` 的分派发生在场景文件里，barrel 自己只声明了
    // `function shot(name)` —— 拿 barrel 源码去解字面量必然判成 opaque（会退回整表）。
    const key = file + '|' + (wanted === null ? '*' : [...wanted].sort().join(',')) + '|'
      + (ctx?.shotNames ? [...ctx.shotNames].sort().join(',') : '*');
    if (seen.has(key)) return;
    seen.add(key);
    let src = '';
    try { src = read(file); } catch { unresolved.add(entryRel); return; }
    const imports = parseImportSymbols(src);
    const exports = parseExports(src);

    // 本文件解析不了（动态 import / glob）⇒ 整支当"全都要"，交回调用方判重渲。
    // ⚠ 只对**非地基**文件降级：core / style / timeline 这类文件的动态 import 由全局签名
    //   兜着，把它们也算进来会让每一块都变成"全部引擎件"（收窄立刻失效，实测 demo 4 块全退化）。
    if (!isGlobalSource(relOf(file)) && hasUnresolvableImport(src)) { unresolved.add(entryRel); }

    // ⚠ 镜头模板 barrel 必须在**通用循环之前**处理：否则通用循环会先把 `./index.js`
    //   整个展开（25 个模板全连），后面的字面量收窄永远轮不到（实测走的就是这条死路）。
    const shotBarrel = isShotBarrel(file, exports);
    if (shotBarrel) {
      expandShotBarrel(file, exports, src, ctx, seen, relDeps, entryRel);
      return;
    }

    for (const spec of imports.specifiers) {
      const abs = resolveSpecifier(file, spec);
      if (!abs || !isSrcPath(abs, rootDir)) continue;
      // 这个说明符要哪些符号？
      let childWanted = null; // 默认全要
      if (imports.namespaceSpecs.includes(spec) || imports.defaultSpecs.includes(spec) || imports.sideEffectSpecs.includes(spec)) {
        childWanted = null;
      } else {
        // 只取「从这一支 import 进来的名字」；再按调用方 wanted 收一次
        const names = new Set();
        for (const [imported, from] of imports.named) if (from === spec) names.add(imported);
        if (names.size === 0) childWanted = null;
        else childWanted = names;
      }
      const rel = relOf(abs);
      if (!isGlobalSource(rel)) relDeps.add(rel);

      /**
       * **barrel 收窄（通用）**：下层若是「纯 re-export 的 barrel」，不能盲目整个展开，
       * 只跟我们这次真正要的那些名字。
       *
       * 为什么必须在这里做：kit/index.js 把 20 多个 kit 件重新导出，场景只写
       * import { makeShot } from kit/index.js，但下面的 for 循环会把它整个展开
       * ⇒ 整个 kit 库都算进依赖（实测 spectrum / beast 各 24 个引擎件，收窄等于没做）。
       */
      let nextWanted = childWanted;
      if (childWanted !== null) {
        let childSrc = '';
        try { childSrc = read(abs); } catch { /* walk 里会再处理 */ }
        const childExports = parseExports(childSrc);
        if (childExports.fromFile.size && childExports.starFrom.length === 0) {
          const kept = new Set();
          for (const n of childWanted) {
            if (childExports.fromFile.has(n) || childExports.direct.has(n)) kept.add(n);
          }
          nextWanted = kept.size ? kept : childWanted;
        }
      }

      // 当前文件里 shot('x') 的字面量带下去：下层若是 shots barrel 会用到它。
      // 必须覆盖而不是沿用上一层 —— 只有当前文件真的写了 shot('x') 才有 referrerShots。
      const here = shotLiterals(src);
      const childCtx = (here.literal.size || here.opaque) ? { referrerShots: here.literal, referrerOpaque: here.opaque } : {};
      walk(abs, nextWanted, seen, relDeps, entryRel, childCtx);
    }

    /**
     * 当前文件**只被要了几个名字**（wanted !== null）：按这些名字定点跟进它的 re-export。
     *
     * 这段是「纯 re-export barrel」的收窄主干：`kit/index.js` 有 20+ 条 re-export，
     * 但调用方只要 `makeShot` 一个 ⇒ 只跟 `./shot.js` 那一条。没有它，上面那个 for 循环
     * 会把 barrel 的所有 import 都展开（整个 kit 库进依赖，收窄等于没做）。
     */
    if (wanted !== null) {
        if (exports.starFrom.length) unresolved.add(entryRel);   // export * 枚举不出 ⇒ 保守
      for (const name of wanted) {
        const spec = exports.fromFile.get(name);
        if (!spec) continue;                  // 直接声明的符号：本文件已在 relDeps 里
        const abs = resolveSpecifier(file, spec);
        if (!abs || !isSrcPath(abs, rootDir)) continue;
        const rel = relOf(abs);
        if (!isGlobalSource(rel)) relDeps.add(rel);
        walk(abs, null, seen, relDeps, entryRel, {});   // 具体实现文件 ⇒ 内部全要
      }
    }

  }

  for (const entry of entries) {
    const relDeps = new Set();
    const rel = relOf(entry);
    let entrySrc = '';
    try { entrySrc = read(entry); } catch { /* 交给 walk 里报 */ }
    const lit = shotLiterals(entrySrc);
    // 场景侧判不出字面量（变量传参 / 模板串）⇒ 必须让 barrel 退回整表（保守）
    const ctx = (lit.literal.size || lit.opaque) ? { referrerShots: lit.literal, referrerOpaque: lit.opaque } : {};
    walk(entry, null, new Set(), relDeps, rel, ctx);
    relDeps.delete(rel); // 入口自己不算"它依赖的引擎件"
    deps.set(rel, relDeps);
  }
  return { deps, unresolved };
}

/** 静态解析不了的 import（动态 import() / import.meta.glob）。 */
function hasUnresolvableImport(src) {
  const t = stripComments(src);
  return /\bimport\s*\(/.test(t) || /\bimport\.meta\.(glob|globEager|globDeep)/.test(t);
}

/** @param {string} abs @param {string} rootDir */
function isSrcPath(abs, rootDir) {
  const rel = path.relative(rootDir, abs).split(path.sep).join('/');
  return rel.startsWith('src/') || rel.startsWith('public/');
}

/**
 * 一层的完整判定：**这次引擎改动会不会波及一切**。
 *
 * @param {{ changed: string[], dynamicFiles: Set<string> }} o
 *   `changed` 是相对路径（`/` 分隔）
 * @returns {{ global: boolean, reasons: string[], scoped: string[] }}
 */
export function classifyEngineChange({ changed, dynamicFiles }) {
  const reasons = [];
  const scoped = [];
  /** @type {Set<string>} */
  const dyn = new Set([...(dynamicFiles ?? [])].map((f) => f.split(path.sep).join('/')));
  for (const rel of changed) {
    if (isGlobalSource(rel)) { reasons.push(rel + ' 属于引擎地基（core/style/app/timeline/public）'); continue; }
    if (dyn.has(rel)) { reasons.push(rel + ' 里有无法静态解析的 import（动态导入 / glob）'); continue; }
    scoped.push(rel);
  }
  return { global: reasons.length > 0, reasons, scoped };
}

/** 这个文件是不是「镜头模板 barrel」（含 REGISTRY / SHOTS 那套登记）。 */
function isShotBarrel(file, exports) {
  const base = path.basename(file);
  if (base !== 'index.js') return false;
  return exports.direct.has('SHOTS') || exports.direct.has('shot') || exports.direct.has('listShots');
}

/** 缓存：模板名 -> 源文件说明符（每个 barrel 只解一次）。 */
const _registryCache = new Map();   // 键是文件路径（字符串）——WeakMap 不接受字符串键

/**
 * 从 shots barrel 的源码里解出「模板名 -> 相对说明符」。
 *
 * 认的是这套固定写法（本仓 `src/shots/index.js` 的唯一形态）：
 *   import { chartShot } from './chart.js';
 *   const REGISTRY = [ … chartShot … ];
 * 每个工厂自己带 `meta.name`，但那是运行时才有的；这里用**文件名**做保守推断：
 * `chartShot` -> `./chart.js`（解析失败就让调用方退回整表，不猜）。
 */
function setShotRegistry(file, _exports, src) {
  if (_registryCache.has(file)) return;
  const map = new Map();
  // 两种登记写法都要认（真实仓用 export { chartShot } from './chart.js'；老写法是 import 再登记）
  const bindings = [];
  // 单、双引号都要认（只认一种 ⇒ registry 空 ⇒ 静默退回整表）
  for (const m of src.matchAll(/\b(?:import|export)\s*\{([^}]+)\}\s*from\s*(?:'([^']+)'|"([^"]+)")/g)) {
    for (const raw of m[1].split(',')) {
      const sym = raw.trim().split(/\s+as\s+/)[0].trim();
      if (sym) bindings.push([sym, m[2] ?? m[3]]);
    }
  }
  // 模板名 = 来源文件名（chartShot -> ./chart.js -> chart）
  for (const [, spec] of bindings) {
    const base = path.basename(spec).replace(/\.js$/, '');
    map.set(base, spec);
  }
  _registryCache.set(file, map);
}

/** 模板名 -> 说明符（`src/shots/chart.js` 里的 chart）。 */
function shotRegistrySpec(file, name) {
  const map = _registryCache.get(file);
  if (!map) return null;
  return map.get(name) ?? null;
}
