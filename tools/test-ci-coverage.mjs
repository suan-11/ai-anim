// CI 覆盖守门（2026-10-30）：.github/workflows/verify.yml 跑的东西必须就是清单里那批。
//
//   node tools/test-ci-coverage.mjs
//
// 为什么要有这个文件：
//   2026-10-30 发现一个真事故 —— `anim say` 的节拍回落被改坏（`resolveBeat` 漏了
//   「没有 analysis 就回落 narration.mjs 的 BPM」那一支），本地 `regress-all --only unit`
//   红 3 项，而 **CI 全绿**：因为 verify.yml 里手抄了 4 条测试，清单里已经有 43 条 unit。
//   手抄必然漂移，而且漂移的方向永远是「少跑」—— 少跑是**看不见**的，没有任何输出会提醒你。
//
// 所以这里钉死五条：
//   ① CI 的测试步骤必须调 `tools/regress-all.mjs --ci`，不许再手抄一串 node 命令；
//   ② 组内（unit:/meta:/harness:/say:）的每一项，要么被 CI 收，要么带 `ciExclude + ciWhy`；
//   ③ `ciWhy` 不许是空话（要 >= 8 个字）；
//   ④ **反向**：CI 收的项数不许突然掉下来（`MIN_CI_ITEMS`）—— 防止有人一口气排掉一堆。
//   ⑤ **needs 声明**（A5，2026-11-13）：依赖 ffmpeg/ffprobe/Chrome 的项必须显式声明 `needs`，
//     否则缺依赖时前置体检认不出它，又会回到满屏 ENOENT 堆栈（PLAN-2026-11-08 §0 那次事故）。
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WF = path.join(ROOT, '.github', 'workflows', 'verify.yml');
const REGRESS = path.join(ROOT, 'tools', 'regress-all.mjs');

let pass = 0, fail = 0;
/** `run:` 里出现的、疑似手抄的 node 命令（等清单解析出来之后再判到底抄没抄） */
let handCopiedCmds = [];
/** 清单解析结果（(2) 里解析，(5) 的 needs 守门也要用） */
let parsedItems = [];
const NL = String.fromCharCode(10);
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  PASS  ' + name + (detail ? '   ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? NL + '          -> ' + detail : '')); }
};

/** 清单里 2026-10-30 这个时点的下限。只会往上长；掉下来必须有人解释（改这个常量就是解释）。 */
const MIN_CI_ITEMS = 45;

/**
 * 从 regress-all.mjs 的源码里切出 `const ITEMS = [ ... ];` 这一段，再**按括号配平**切成条目。
 *
 * 为什么不用正则一把梭：第一版就是这么写的（/\{\s*name:...([\s\S]*?)\n\s*\},?\n/），
 * 结果只解析出 2 项 —— 条目里既有 `},` 也有嵌套对象，缩进还各不相同。
 * 配平器 20 行，但它**不会**随排版变化静默失效（正则解析器会）。
 */
function extractItems(src) {
  const start = src.indexOf('const ITEMS = [');
  if (start < 0) return [];
  const open = src.indexOf('[', start);
  let depth = 0, i = open, end = -1;
  // 跳过字符串（条目里有大量中文与引号，必须先剔掉）
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return [];
  const inner = src.slice(open + 1, end);

  // 再按顶层逗号切（跳过字符串与注释）
  const out = [];
  let d = 0, cur = "", j = 0;
  for (; j < inner.length; j++) {
    const c = inner[j];
    if (c === "'" || c === '"' || c === '`') {
      const q = c; cur += c; j++;
      while (j < inner.length && inner[j] !== q) { cur += inner[j]; if (inner[j] === '\\') { j++; cur += inner[j]; } j++; }
      cur += q; continue;
    }
    if (c === '/' && inner[j + 1] === '/') { while (j < inner.length && inner[j] !== '\n') j++; cur += '\n'; continue; }
    if (c === '[' || c === '{' || c === '(') d++;
    else if (c === ']' || c === '}' || c === ')') d--;
    if (c === ',' && d === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

console.log('CI 覆盖守门：');

/* -- (1) verify.yml 必须调 --ci，不许手抄 -- */
if (!existsSync(WF)) {
  check('verify.yml 存在', false, WF + ' 不见了');
} else {
  const yml = readFileSync(WF, 'utf8');
  // 只留**真的会被执行的东西**：`run:` 后面的命令，以及 `run: |` 那一段的正文。
  //
  // ⚠ 这里踩过一次：第一版把整个文件（去掉注释行）拿去匹配 `regress-all.mjs --ci`，
  //   结果**步骤名**里写着「纯 JS 回归（tools/regress-all.mjs --ci）」就把判据骗过去了 ——
  //   我把 run 换成手抄的 test-say 之后，这一条依然 PASS。判据必须落在会执行的字符串上。
  const runCmds = [];
  const lines = yml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const inline = m[2].trim();
    if (inline === '|' || inline === '>' || inline === '|-' || inline === '>-') {
      // 块标量：收下比 `run:` 缩进更深的行
      for (let j = i + 1; j < lines.length; j++) {
        const ln = lines[j];
        if (ln.trim() === '') { runCmds.push(''); continue; }
        const ind = ln.match(/^\s*/)[0].length;
        if (ind <= indent) break;
        runCmds.push(ln.trim());
      }
    } else if (inline) {
      runCmds.push(inline.replace(/^['"]|['"]$/g, ''));
    }
  }
  const exec = runCmds.join(NL);

  check('verify.yml 真的执行 regress-all.mjs --ci', /(^|[\s;&|])node\s+tools\/regress-all\.mjs\s+--ci\b/.test(exec),
    'CI 必须按清单跑，不许手抄一串 node 命令（手抄必然漂移，且只会少跑）。只认 `run:` 里的命令，步骤名不算');

  // ⚠ 手抄的判据（「run: 里出现了清单内的工具」）放在下面 (2) 之后 —— 它要先知道清单里有哪些工具。
  handCopiedCmds = [...exec.matchAll(/^\s*(.*\bnode\s+tools\/(?:test|smoke)-[\w.-]+\.mjs[^\n]*)$/gm)]
    .map((m) => m[1].trim())
    .filter((cmd) => cmd.indexOf("regress-all") < 0);
}

/* -- (2)(3) 组内每一项：要么被收，要么写明理由 -- */
if (!existsSync(REGRESS)) {
  check('regress-all.mjs 存在', false);
} else {
  const src = readFileSync(REGRESS, 'utf8');
  const groupsM = /const CI_GROUPS = \[([^\]]*)\]/.exec(src);
  check('CI_GROUPS 可解析', !!groupsM, groupsM ? '' : '拿不到 CI_GROUPS 常量 —— 判据会静默失效');
  const groups = groupsM
    ? [...groupsM[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    : [];

  const entries = extractItems(src);
  const items = entries.map((body) => {
    const m = /name:\s*'([^']+)'/.exec(body);
    return m ? { name: m[1], body } : null;
  }).filter(Boolean);
  parsedItems = items;
  check('清单项可解析', items.length > 50, '解析到 ' + items.length + ' / ' + entries.length + ' 条');

  const inGroup = items.filter((it) => groups.some((g) => it.name.indexOf(g) === 0));
  const excluded = inGroup.filter((it) => /ciExclude:\s*true/.test(it.body));
  const covered = inGroup.length - excluded.length;

  console.log('    组内 ' + inGroup.length + ' 项：CI 收 ' + covered + '、显式排除 ' + excluded.length);
  check('组内每一项都有交代（收 or 排除）', covered + excluded.length === inGroup.length);

  const missingWhy = excluded.filter((it) => {
    const m = /ciWhy:\s*'((?:[^'\\]|\\.)*)'/.exec(it.body);
    return !m || m[1].trim().length < 8;
  });
  check('被排除的项都写了 ciWhy（>= 8 字）', missingWhy.length === 0,
    missingWhy.map((it) => it.name + '（没写理由或理由太短）').join(', '));

  check('CI 收的项数不低于下限 ' + MIN_CI_ITEMS, covered >= MIN_CI_ITEMS,
    '现在 ' + covered + ' 项。掉下来通常是「顺手排掉一批」，那会让 CI 变成假绿灯');

  // ---- (4) 手抄判据：verify.yml 的 `run:` 里**不许出现清单内的工具** ----
  //
  // 只认**清单里真有**的那些：`tools/test-ci-coverage.mjs` 自己、`gen-shot-cards`、`lint-agents-*`
  // 都不在清单里，单列它们是合理的，不该判红（第一版没做这个区分，把自己判红了）。
  const listTools = new Set(items.flatMap((it) => [
    ...(it.body.match(/tools\/[\w./-]+\.mjs/g) ?? []),
  ]));
  const dup = handCopiedCmds.filter((cmd) => {
    const m = /tools\/[\w./-]+\.mjs/.exec(cmd);
    if (!m || !listTools.has(m[0])) return false;
    // ⚠ 自己是例外：这个守门工具**也在**回归清单里（`unit:ci-coverage`），
    //   verify.yml 必须单独跑它 —— 否则就成了「用一个可能已经失效的 --ci 去验 --ci 有没有效」。
    //   它不依赖清单是否被篡改，所以单列是安全的；其它工具单列才会随清单漂移。
    if (m[0] === 'tools/test-ci-coverage.mjs') return false;
    return true;
  });
  check('verify.yml 没有手抄清单里的工具', dup.length === 0,
    dup.length ? '这些已经由 --ci 跑到，别再单独列（会漂移）：' + NL + '            ' + dup.join(NL + '            ') : '');
}

/* -- (5) needs 声明守门（A5，2026-11-13）：依赖 ffmpeg/ffprobe/Chrome 的项必须显式声明 needs --
 *
 * 启发式（宁可多点名、不可漏）：工具源码（去注释）里出现 ffmpeg/ffprobe 字样，或
 * playwright / probe-page / openSession / anim.mjs 这类「会起浏览器/CLI」的引用 ⇒ 必须写 needs。
 * 确属纯 JS 的源码文本自检显式写 needs: []（声明「没有外部依赖」也是声明，作者负责）。
 * 前置体检按 needs 把缺依赖的项记 skipped(env) —— 漏标就会回到满屏 ENOENT 堆栈。
 * 自己是例外：本文件的判据代码里就含这些词（同 (4) 的先例）。
 */
const KNOWN_DEPS = ['ffmpeg', 'ffprobe', 'chrome'];
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const needsProblems = [];
for (const it of parsedItems) {
  const cmdM = /cmd:\s*\[\s*'([^']+)'/.exec(it.body);
  if (!cmdM || cmdM[1] === 'tools/test-ci-coverage.mjs') continue;
  let tsrc = '';
  try { tsrc = readFileSync(path.join(ROOT, cmdM[1]), 'utf8'); }
  catch { needsProblems.push(it.name + '：工具文件读不到 ' + cmdM[1]); continue; }
  const code = stripComments(tsrc);
  const ff = /\bffmpeg\b|\bffprobe\b/.test(code);
  const ch = /playwright|probe-page|launchBrowser|openSession|startVite|anim\.mjs/.test(code);
  if (!ff && !ch) continue;
  const needsM = /needs:\s*\[([^\]]*)\]/.exec(it.body);
  if (!needsM) {
    needsProblems.push(it.name + '：源码含 ' + (ff ? 'ffmpeg/ffprobe ' : '') + (ch ? '浏览器/CLI ' : '') + '引用但没写 needs（确属纯 JS 就显式写 needs: []）');
    continue;
  }
  const deps = [...needsM[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const bad = deps.filter((d) => !KNOWN_DEPS.includes(d));
  if (bad.length) needsProblems.push(it.name + '：needs 里有不认识的依赖 ' + bad.join(', ') + '（可用：' + KNOWN_DEPS.join('/') + '）');
}
check('依赖项都显式声明了 needs（漏标 ⇒ 缺依赖时满屏 ENOENT）', needsProblems.length === 0,
  needsProblems.join(NL + '            '));

console.log('');
console.log(fail ? '✗ ' + fail + ' 项失败（共 ' + (pass + fail) + ' 项）' : '✓ ' + pass + ' 项全部通过（共 ' + pass + ' 项）');
process.exitCode = fail ? 1 : 0;
