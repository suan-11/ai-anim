// @ts-check
/**
 * `barrel-follow.mjs` —— **顺着 barrel 往下只走你用到的那一支**。
 *
 * ## 为什么需要它
 *
 * 仓库里几乎所有场景都写 `import { shot } from '../../../src/shots/index.js'`。
 * `src/shots/index.js` 又把 25 个模板全部 re-export 了 ⇒ 按朴素的 ESM 依赖图，
 * 「改了 chart.js」会波及**每一个用了 shot() 的场景**，按依赖收窄等于没做。
 *
 * 但语义上不是这样：`import { shot }` 只用到 shot 这一个名字，barrel 里其余 24 个
 * re-export 这次根本没参与画面。正确做法是**符号级追踪**：
 *
 *   `import { shot } from './index.js'` ⇒ 找到 index.js 里 `export { shot } from './shot.js'`
 *   ⇒ 只把通向 shot.js 的那一条边算进来，其余 re-export 不计。
 *
 * ## 保守边界（「少算 = 拿旧块冒充新画面」）
 *
 *   · 默认导入 / 命名空间导入（`import * as X`）：拿不到具体符号 ⇒ 整文件全算；
 *   · `export * from './x.js'`：无法枚举再导出名 ⇒ 整文件全算；
 *   · `export { a, b } from './x.js'` 而请求的符号不在其中 ⇒ 不计这一支（正确）；
 *   · `import { shot as s }` 的别名要认出来；
 *   · barrel 文件**本身**变了 ⇒ 整支重算（文件级签名仍然在）。
 */

// 单、双引号都要认（只认一种会让「导出了却查不到」静默退化成整表全跟）
const RE_EXPORT_LIST = /\bexport\s*\{([^}]+)\}\s*from\s*(?:'([^']+)'|"([^"]+)")/g;
const RE_EXPORT_STAR = /\bexport\s*\*\s*from\s*(?:'([^']+)'|"([^"]+)")/g;
const RE_DECL = /\bexport\s*(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
const RE_IMPORT_FROM = /\bimport\s+([^'"]*?)\s+from\s*(?:'([^']+)'|"([^"]+)")/g;
const RE_IMPORT_SIDE = /\bimport\s*(?:'([^']+)'|"([^"]+)")/g;

/**
 * 解析一份文件里的 **named exports → 来源说明符**。
 * @param {string} src
 * @returns {{ direct: Set<string>, fromFile: Map<string,string>, starFrom: string[], hasDefault: boolean }}
 */
export function parseExports(src) {
  const text = String(src ?? '');
  const direct = new Set();
  const fromFile = new Map();
  const starFrom = [];
  let hasDefault = false;
  for (const m of text.matchAll(RE_EXPORT_LIST)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) fromFile.set(name, m[2] ?? m[3]);
    }
  }
  for (const m of text.matchAll(RE_EXPORT_STAR)) starFrom.push(m[1] ?? m[2]);
  for (const m of text.matchAll(RE_DECL)) direct.add(m[1]);
  if (/\bexport\s+default\b/.test(text)) hasDefault = true;
  return { direct, fromFile, starFrom, hasDefault };
}

/**
 * 解析一份文件里的 **import 用到的符号**。
 * @param {string} src
 * @returns {{ named: Map<string,string>, specifiers: string[], namespaceSpecs: string[], defaultSpecs: string[], sideEffectSpecs: string[] }}
 */
export function parseImportSymbols(src) {
  const text = String(src ?? '');
  const named = new Map();
  const specifiers = [];
  const namespaceSpecs = [];
  const defaultSpecs = [];
  const sideEffectSpecs = [];
  for (const m of text.matchAll(RE_IMPORT_FROM)) {
    const clause = m[1].trim();
    const spec = m[2] ?? m[3];   // 单/双引号两种捕获
    specifiers.push(spec);
    if (clause.startsWith('*')) namespaceSpecs.push(spec);
    const braces = /\{([^}]+)\}/.exec(clause);
    if (braces) {
      for (const raw of braces[1].split(',')) {
        const imported = raw.trim().split(/\s+as\s+/)[0].trim();
        if (imported) named.set(imported, spec);
      }
    }
    const outside = clause.replace(/\{[^}]+\}/g, '').replace(/\*\s*as\s*[\w$]+/g, '').trim();
    if (outside) defaultSpecs.push(spec);
  }
  for (const m of text.matchAll(RE_IMPORT_SIDE)) {
    const spec = m[1] ?? m[2];
    sideEffectSpecs.push(spec);
    specifiers.push(spec);
  }
  return { named, specifiers, namespaceSpecs, defaultSpecs, sideEffectSpecs };
}

/**
 * 从一份源码里收集**模板分派的字面量名字**。
 *
 * 为什么需要：`shot()` 是**运行时查表**分派（`const factory = SHOTS[name]`），静态上
 * 「调用了 shot()」就等于依赖整张表 —— 25 个模板全连。但场景里写的是
 * `shot('chart', {...})` 这种**字面量**，编译期就能知道它只会落到 chart 那一个工厂。
 * 这是本仓唯一可靠的收窄点（非字面量一律放弃收窄，退回整表）。
 *
 * @param {string} src
 * @param {string} callee 被调用的名字（默认 `shot`）
 * @returns {{ literal: Set<string>, opaque: boolean }}
 *   `opaque = true` 表示出现了无法判定的调用（变量、模板串、展开）⇒ 调用方退回整表
 */
export function shotLiterals(src, callee = 'shot') {
  const text = stripCommentsLite(src);
  const literal = new Set();
  let opaque = false;
  const re = new RegExp('\\b' + callee + '\\s*\\(' , 'g');
  for (const m of text.matchAll(re)) {
    let i = m.index + m[0].length;
    while (i < text.length && /\s/.test(text[i])) i++;
    const q = text[i];
    if (q === "'" || q === '"' || q === '`') {
      let j = i + 1;
      let val = '';
      while (j < text.length && text[j] !== q) {
        if (text[j] === '\\') { j += 2; continue; }
        if (q === '`' && text[j] === '$' && text[j + 1] === '{') { opaque = true; break; }
        val += text[j];
        j++;
      }
      if (val) literal.add(val);
    } else if (/[A-Za-z_$]/.test(q ?? '')) {
      // 排除 `function shot(name, …) { }` 这种**定义**：它不是一次分派调用，
      // 把参数名当成"变量传参"会让整个 barrel 判成 opaque ⇒ 收窄静默失效
      // （实测 src/shots/index.js 就栽在这条：它当然要声明 shot() 本身）。
      const before = text.slice(Math.max(0, m.index - 24), m.index);
      if (/\bfunction\s+$/.test(before) || /\bfunction\s*\*\s*$/.test(before)) continue;
      opaque = true;
    }
  }
  return { literal, opaque };
}

/** 轻量剥注释（与 engine-graph 的 stripComments 同效，避免循环依赖）。 */
function stripCommentsLite(src) {
  const text = String(src ?? '');
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '/' && n === '/') { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e; continue; }
    if (c === '/' && n === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      out += c; i++;
      while (i < text.length) {
        if (text[i] === '\\') { out += text[i]; i++; if (i < text.length) { out += text[i]; i++; } continue; }
        out += text[i];
        if (text[i] === c) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/**
 * 解析 barrel 里**直接声明**的函数的「函数体用到了哪些本地 import 名字」。
 *
 * 为什么需要：`src/kit/index.js` 把 `makeShot` 直接声明在自己文件里（不是 re-export），
 * 按符号粒度只能判成「本文件自带」。但 `makeShot` 的实现其实只用到 `./shot.js` 的
 * `makeShot`，其余 20 多个 kit 件（views / pixel / stroke / paper …）压根没参与。
 * 不处理这一条，场景 `import { makeShot } from kit/index.js` 会把**整个 kit 库**拉进来
 * （实测 spectrum / beast 各 24 个引擎件，收窄等于没做）。
 *
 * 返回函数体里**引用的本地名 → 它们来自哪个说明符**（取不到就是空 Map，调用方退回整文件）。
 *
 * @param {string} src
 * @param {string} name
 * @returns {Map<string, string>|null} 本地名 -> 说明符；`null` = 判不出来
 */
export function functionLocalRefs(src, name) {
  const text = stripCommentsLite(src);
  // 找到 `export function <name>`（或 `export const <name> =`）的起点
  const decl = new RegExp('\\bexport\\s+(?:async\\s+)?(?:function\\s+' + name + '\\b|(?:const|let|var)\\s+' + name + '\\s*=)').exec(text);
  if (!decl) return null;
  let i = decl.index + decl[0].length;
  // 简单括号配平找函数体（函数体的第一层 `{`）
  while (i < text.length && text[i] === ' ') i++;
  if (decl[0].includes('function')) {
    while (i < text.length && text[i] !== '{') i++;
  }
  if (text[i] !== '{') return null;
  let depth = 0, start = i, end = -1;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const body = text.slice(start, end + 1);
  const { named } = parseImportSymbols(text);
  const used = new Map();
  for (const [local, spec] of named) {
    const re = new RegExp('\\b' + local.replace(/\$/g, '\\$') + '\\b');
    if (re.test(body)) used.set(local, spec);
  }
  return used;
}
