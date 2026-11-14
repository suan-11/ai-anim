#!/usr/bin/env node
// @ts-check
/**
 * 1-19「空 ≠ 干净」与 1-3「守门措辞」的**离线单测**（不需要 GPU / 不需要浏览器 / 不起 Vite）。
 *
 * 跑法：
 *   node tools/test-check-skipped.mjs
 *
 * 这份测试原本落在 `out/_staging/`（并行批次里子代理不许改别人负责的文件），由主代理搬进
 * `tools/`：只动了三处路径（跑法说明 / `ROOT` / `import`），断言一条没改。搬进来是为了
 * **不被 `anim clean` 清掉**，并进 `tools/regress-all.mjs` 的清单 —— 1-19 的守门要长期有效，
 * 一次性的测试等于没做。
 *
 * 覆盖两件事：
 *   ① 纯函数行为：`formatSkipped` / `checkVerdictLine` / `decideGateFailure` / `gateFailureLines`；
 *   ② **静态接线自检**：直接读 `scripts/anim.mjs` 的源码，证明那些"没跑成"的落点**真的**
 *      调了 `pushSkipped`，而且 `check` 的结论行里真的带上了 skipped 计数。
 *      （①过了但②没接线 = 功能等于没做，这正是 1-19 要防的那种"看起来做了"。）
 */
import assert from 'node:assert/strict';
import { readCliSource } from './lib/cli-source.mjs';

const {
  IS_MAIN, pushSkipped, formatSkipped, checkVerdictLine,
  decideGateFailure, gateFailureLines, knownCauseHeadline, firstLine,
} = await import(new URL('../scripts/anim.mjs', import.meta.url).href);

/** `scripts/anim.mjs` 的源码文本 —— 静态接线自检用（第 3 节，但要先声明）。 */
const src = readCliSource();

let passed = 0;
const cases = [];
/** @param {string} name @param {() => void} fn */
function t(name, fn) {
  try { fn(); passed++; cases.push(`  ✓ ${name}`); }
  catch (err) { cases.push(`  ✗ ${name}\n      ${String(err.message).split('\n').join('\n      ')}`); throw Object.assign(new Error(name), { cause: err }); }
}

/* ---------------------------------------------------------------- 0. import 不许跑 CLI */

t('import 本模块不会执行 CLI（IS_MAIN=false，纯函数可被单测）', () => {
  assert.equal(IS_MAIN, false, 'IS_MAIN 在 import 场景下必须是 false，否则单测会顺手跑一条命令');
  assert.equal(typeof formatSkipped, 'function');
  assert.equal(typeof decideGateFailure, 'function');
});

/* ---------------------------------------------------------------- 1. skipped 收集/渲染 */

t('pushSkipped 收集 { what, why }，且 why 只取第一行（多行异常不灌进报告）', () => {
  const list = [];
  pushSkipped(list, '背景守门（worldAudit）', new Error('boom\n  at foo\n  at bar'));
  assert.deepEqual(list, [{ what: '背景守门（worldAudit）', why: 'boom' }]);
  pushSkipped(list, '旁白复述检查', '   ');
  assert.equal(list.length, 2);
  assert.equal(list[1].why, '(没有说明)', '空原因必须落成"(没有说明)"，不能变成空字符串');
});

t('formatSkipped([]) 也必须说话 —— "全跑了"要能和"这一段没执行"区分开', () => {
  const lines = formatSkipped([]);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^skipped: 无/);
});

t('formatSkipped 有内容时：标题带条数，每条同时写清 what 与 why', () => {
  const lines = formatSkipped([
    { what: '背景守门（worldAudit）', why: 'worldAudit is not a function' },
    { what: '多子帧路径（hook t=1.20s）', why: 'Target closed' },
  ]);
  assert.match(lines[0], /^skipped: 2 项没跑/);
  assert.match(lines[0], /没有验过/, '标题必须点明"这些地方没有验过"');
  assert.equal(lines[1], '  · 背景守门（worldAudit）：worldAudit is not a function');
  assert.equal(lines[2], '  · 多子帧路径（hook t=1.20s）：Target closed');
  assert.match(lines.at(-1), /--strict/);
});

t('formatSkipped 按 what 聚合（同一件事失败 N 次写 ×N）—— 否则页面一崩就是几十行没人读', () => {
  const lines = formatSkipped([
    { what: '多子帧路径（成片走的那条）', why: '[hook t=1.20s] Target closed' },
    { what: '多子帧路径（成片走的那条）', why: '[hook t=3.60s] Target closed' },
    { what: '多子帧路径（成片走的那条）', why: '[hook t=6.00s] Target closed' },
  ]);
  assert.match(lines[0], /^skipped: 3 项没跑/, '条数按**项**数，不按去重后的行数');
  assert.equal(lines.length, 3, '三件同一件事必须只占一行（聚合只动显示，不动收集）');
  assert.equal(lines[1], '  · 多子帧路径（成片走的那条） ×3：[hook t=1.20s] Target closed');
});

t('pushSkipped 的 what 里**不带时刻**（否则聚合失效）—— 源码自检', () => {
  const cmdCheckSrc = src.slice(src.indexOf('async function cmdCheck('), src.indexOf('/** 把若干时刻渲染成一张接触表'));
  assert.match(cmdCheckSrc, /pushSkipped\(skipped, '多子帧路径（成片走的那条）', `\[\$\{it\.id\} t=\$\{t\.toFixed\(2\)\}s\] /);
  assert.match(cmdCheckSrc, /pushSkipped\(skipped, '非有限值扫描（NaN\/Inf）', `\[\$\{it\.id\} t=\$\{t\.toFixed\(2\)\}s\] /);
  assert.ok(!/pushSkipped\(skipped, `[^`]*\$\{t\.toFixed/.test(cmdCheckSrc), 'what 里出现了时刻 ⇒ 聚合会失效');
});

t('checkVerdictLine：结论行必须体现「N 项跳过」，两种结论都要有', () => {
  assert.match(checkVerdictLine({}), /^✓ 没有发现问题/);
  assert.match(checkVerdictLine({}), /skipped: 无/);
  const ok = checkVerdictLine({ skipped: 3 });
  assert.match(ok, /^✓ 没有发现问题/);
  assert.match(ok, /3 项\*\*没跑\*\*/);
  const bad = checkVerdictLine({ problems: 2, skipped: 1 });
  assert.match(bad, /^✗ 有 2 个问题/);
  assert.match(bad, /1 项\*\*没跑\*\*/);
});

/* ------------------------------------------------ 2. 守门失败分类（已知 / 未知，1-3） */

/** 直接把 `checkVideoFile()` 的返回串喂进来（判据只吃已经算好的事实）。 */
const classify = (problems, ctx) => decideGateFailure({ problems, ...ctx });

t('拼接：帧数少 3 帧 ⇒ 已知原因、确定性、**明确劝阻重跑**，并指向 apad/-shortest', () => {
  const d = classify(['out/x.mp4：ffprobe 数出 15237 帧，期望 15240 帧（差 -3）'], { phase: 'stitch', expected: 15240 });
  assert.equal(d.kind, 'stitch');
  assert.equal(d.known, true);
  assert.equal(d.retryWorthwhile, false, '拼接这一步是确定性的，retryWorthwhile 必须是 false');
  assert.match(d.headline, /已知原因/);
  assert.match(d.headline, /重跑不会有不同结果/);
  const all = d.next.join('\n');
  assert.match(all, /apad/, '必须点名 -af apad');
  assert.match(all, /-shortest/);
  assert.match(all, /-copyts/, '必须点名 concat 的 -copyts');
  assert.match(d.retryLine, /不要直接重跑/);
  assert.ok(!/重跑即可/.test(all), '不能再出现"重跑即可"这种把人指偏的说法');
});

t('拼接：帧率不对（fps 漂）⇒ 已知原因，归到拼接这一类', () => {
  const d = classify(['out/x.mp4：帧率 60.08 ≠ 期望 60'], { phase: 'stitch', expected: 720 });
  assert.equal(d.kind, 'stitch');
  assert.equal(d.known, true);
  assert.equal(d.retryWorthwhile, false);
});

t('半截流（没写 moov / 0 字节）⇒ 已知原因，且给的是"先核对帧数与封装"，不是"重跑"', () => {
  const a = classify(['第 1 块：ffprobe 打不开：moov atom not found（流是半截的，ffmpeg 没 finalize）'], { phase: 'chunk', reusable: true });
  assert.equal(a.kind, 'encode');
  assert.equal(a.known, true);
  assert.match(a.next.join('\n'), /没有 finalize|没写完/);
  const b = classify(['第 2 块：文件是 0 字节'], { phase: 'chunk', reusable: true });
  assert.equal(b.kind, 'encode');
  assert.equal(b.known, true);
});

t('ffprobe 起不来（ENOENT）≠ 已知原因：那是环境问题，必须落进"可能瞬时"这一类', () => {
  const d = classify(['out/x.mp4：ffprobe 退出码 -1：spawn ffprobe ENOENT'], { phase: 'final', expected: 720 });
  assert.equal(d.kind, 'unknown', '工具缺失不是"文件坏了"，不能冒充已知原因');
  assert.match(d.headline, /原因未知|可能/);
  assert.match(d.next.join('\n'), /可能是瞬时的/);
  assert.ok(!/不要直接重跑/.test(d.retryLine), '未知原因这一档说"重跑会得到同样的结果"是自相矛盾的');
  assert.match(d.retryLine, /重跑\*\*可能\*\*有用/);
});

t('措辞自洽：headline 与收尾那句不能说反话（样例输出里抓到过一处矛盾）', () => {
  const cases = [
    [['out/x.mp4：ffprobe 数出 15237 帧，期望 15240 帧（差 -3）'], { phase: 'stitch', expected: 15240 }],
    [['out/x.mp4：ffprobe 退出码 -1：spawn ffprobe ENOENT'], { phase: 'final', expected: 720 }],
    [['第 1 块：文件是 0 字节'], { phase: 'chunk', reusable: true }],
    [['第 3 块：ffprobe 数出 118 帧，期望 120 帧（差 -2）'], { phase: 'chunk', reusable: true, expected: 120, got: 118 }],
    [['某种从没见过的问题'], { phase: 'final', expected: 10 }],
  ];
  for (const [problems, ctx] of cases) {
    const d = classify(problems, ctx);
    if (d.kind === 'unknown') {
      assert.match(d.headline, /原因未知/);
      assert.ok(!/得到\*\*同样的\*\*结果/.test(d.retryLine), `未知原因却断言重跑结果相同：${problems}`);
    } else {
      assert.match(d.headline, /已知原因/);
      assert.match(d.headline, /重跑不会有不同结果/);
      assert.ok(!/重跑\*\*可能\*\*有用/.test(d.retryLine), `已知原因却说"重跑可能有用"：${problems}`);
    }
  }
});

t('分块：这一块自己少渲了帧 ⇒ 已知原因，但**重跑真的有意义**（已渲好的块会跳过）', () => {
  const d = classify(['第 3 块：ffprobe 数出 118 帧，期望 120 帧（差 -2）'], {
    phase: 'chunk', reusable: true, expected: 120, got: 118,
  });
  assert.equal(d.kind, 'scene');
  assert.equal(d.known, true);
  assert.equal(d.retryWorthwhile, true, '分块路径下重跑只补这一块，重跑是有意义的');
  const all = d.next.join('\n');
  assert.match(all, /check <任务>/, '必须给出定位命令');
  assert.match(all, /still <任务>/, '必须给出看图命令');
  assert.match(all, /已渲好的块会跳过/);
  assert.match(d.retryLine, /重跑有意义/);
});

t('分块但**不可复用**（--force）：重跑就是全部重渲，不再说成免费', () => {
  const d = classify(['第 3 块：ffprobe 数出 118 帧，期望 120 帧（差 -2）'], {
    phase: 'chunk', reusable: false, expected: 120, got: 118,
  });
  assert.equal(d.retryWorthwhile, false);
  assert.match(d.retryLine, /不要直接重跑/);
});

t('直播整片少渲（frames<total）⇒ 不匹配任何已知签名，落进"可能瞬时"，但先要求看原始报错', () => {
  const d = classify(['只渲染了 152/2880 帧'], { phase: 'render', expected: 2880, got: 152 });
  assert.equal(d.kind, 'unknown');
  assert.match(d.next.join('\n'), /先看那条原始报错/);
});

t('无法归类的报错：绝不出现"重跑即可"这种空话，必须给出带条件的下一步', () => {
  const d = classify(['某种从没见过的问题'], { phase: 'final', expected: 10 });
  assert.equal(d.kind, 'unknown');
  assert.equal(d.known, false);
  const all = [...d.next, d.retryLine].join('\n');
  assert.ok(!/^ *重跑即可/m.test(all));
  assert.match(all, /确认.*磁盘|磁盘还有空间/);
});

t('hint 覆盖：checkTimestamps 那类文案（帧数对、帧距不齐）也归到拼接', () => {
  const d = classify(['帧距不齐：第 12 帧处差了 0.53ms（期望 1/60s = 16.67ms）'], { phase: 'stitch', hint: 'stitch' });
  assert.equal(d.kind, 'stitch');
  const auto = classify(['帧距不齐：第 12 帧处差了 0.53ms'], { phase: 'stitch' });
  assert.equal(auto.kind, 'stitch', '没有 hint 时也应当能从文案认出来');
});

t('gateFailureLines：问题列表原样保留 + 分类 + 下一步，且带 chunk 编号', () => {
  const lines = gateFailureLines(
    { title: '第 3 块的产物验收不通过，已删掉它：', problems: ['第 3 块：ffprobe 数出 118 帧，期望 120 帧（差 -2）'] },
    { phase: 'chunk', reusable: true, chunk: { i: 3, n: 12, range: '20.00–30.00s' }, expected: 120, got: 118, note: '渲染侧收到 118/120 帧，ffmpeg 退出码 0' },
  );
  assert.equal(lines[0], '第 3 块的产物验收不通过，已删掉它：');
  assert.equal(lines[1], '  · 第 3 块：ffprobe 数出 118 帧，期望 120 帧（差 -2）', 'ffprobe 的原始问题串必须原样保留（不许改写/吞掉）');
  assert.match(lines.join('\n'), /渲染侧收到 118\/120 帧/);
  assert.match(lines.join('\n'), /第 3\/12 块（20\.00–30\.00s）/);
  assert.match(lines.join('\n'), /下一步/);
});

t('knownCauseHeadline：场景异常 / 中途断流两条都是"已知原因（确定性）"', () => {
  assert.match(knownCauseHeadline('scene'), /已知原因.*确定性/);
  assert.match(knownCauseHeadline('scene'), /抛异常/);
  assert.match(knownCauseHeadline('interrupted'), /已知原因.*确定性/);
  assert.match(knownCauseHeadline('interrupted'), /渲染到一半/);
});

t('firstLine：拿到的永远是一行、非空', () => {
  assert.equal(firstLine(new Error('a\nb')), 'a');
  assert.equal(firstLine(undefined), '(没有说明)');
  assert.equal(firstLine('   '), '(没有说明)');
});

/* ------------------------------------------- 3. 静态接线自检（防"函数写了但没接上"） */

t('源码自检：四个"没跑成"的落点都真的调了 pushSkipped', () => {
  const sites = [
    ['背景守门（worldAudit）', 2],        // catch（不可用）+ 返回 0 段（没东西可查）
    ['旁白复述检查（lint-narration-dup）', 3], // status 2 / 其他非零 / 工具不存在或 spawn 被拒
    ['多子帧路径', 1],
    ['非有限值扫描', 1],
  ];
  for (const [needle, min] of sites) {
    const n = src.split(needle).length - 1;
    assert.ok(n >= min, `"${needle}" 出现 ${n} 次，期望 ≥ ${min} —— 有落点没接进 skipped 收集器`);
  }
});

t('源码自检：cmdCheck 的结论行必须带 skipped 计数，并且 --strict 只加码不放松', () => {
  const start = src.indexOf('async function cmdCheck(');
  // ⚠ 终点锚锚在**函数定义**上，别锚注释文本：2026-10-16 把 writeContactSheet 的 JSDoc 改成多行，
  //   原来那句 '/** 把若干时刻…' 当场失配 —— 三处测试一起报「定位不到 cmdCheck 函数体」。
  const end = src.indexOf('async function writeContactSheet', start);
  assert.ok(start > 0 && end > start, '定位不到 cmdCheck 函数体');
  const body = src.slice(start, end);
  assert.match(body, /const skipped = \[\]/);
  assert.match(body, /const skippedLines = formatSkipped\(skipped\);/);
  assert.match(body, /if \(skipped\.length\) \{ warn\(''\); for \(const line of skippedLines\) warn\(line\); \}/);
  assert.match(body, /else log\(`\\n\$\{skippedLines\[0\]\}`\)/);
  assert.match(body, /checkVerdictLine\(\{ problems: errs\.length, skipped: skipped\.length \}\)/);
  assert.match(body, /checkVerdictLine\(\{ skipped: skipped\.length \}\)/);
  assert.match(body, /if \(strict && skipped\.length\)/);
  // skipped 不许自己把退出码设成 1（只能在 --strict 下、和 errs 那条并列的那一行设）
  const strictBlock = body.slice(body.indexOf('if (strict && skipped.length)'));
  assert.match(strictBlock.slice(0, 200), /process\.exitCode = 1/);
  const beforeStrict = body.slice(0, body.indexOf('if (strict && skipped.length)'));
  assert.ok(!/skipped\.length[\s\S]{0,80}process\.exitCode\s*=\s*1/.test(beforeStrict),
    'skipped 在 --strict 之外不许影响退出码（tools/regress-all.mjs 的 10 个 check:* 依赖它）');
});

t('源码自检：--quick 下结论行不许说"两条路径都验过了"（没跑就说没跑）', () => {
  // 2026-10-10 主代理跑 `check demo --quick` 抓到：--quick **只跑单子帧**，结论行却无条件写着
  // "（单子帧与多子帧两条路径都验过了）"。那正是 1-19 要消灭的东西 —— 没跑却说跑了。
  const start = src.indexOf('async function cmdCheck(');
  // ⚠ 终点锚锚在**函数定义**上，别锚注释文本：2026-10-16 把 writeContactSheet 的 JSDoc 改成多行，
  //   原来那句 '/** 把若干时刻…' 当场失配 —— 三处测试一起报「定位不到 cmdCheck 函数体」。
  const end = src.indexOf('async function writeContactSheet', start);
  const body = src.slice(start, end);
  const at = body.indexOf('checkVerdictLine({ skipped: skipped.length })');
  assert.ok(at > 0, '定位不到结论行');
  const verdict = body.slice(at, at + 400);
  assert.match(verdict, /\$\{quick/, '结论行的"验了哪些路径"没按 --quick 分档');
  assert.ok(verdict.includes('只验了单子帧'), '--quick 分支没有如实说"只验了单子帧"');
  assert.ok(!/checkVerdictLine\(\{ skipped: skipped\.length \}\)\}（单子帧与多子帧两条路径都验过了）/.test(body),
    '又出现了"没跑多子帧却说两条路径都验过了"的写法');
});

t('源码自检：1-3 的三处措辞都换了（不再有"修好之后重跑同一条命令即可"）', () => {
  // 只看**输出串**（die(`…`) 里的内容），不看解释性注释
  assert.ok(!/`  修好之后重跑同一条命令即可/.test(src), '`--parallel` 那句"重跑即可"还在');
  assert.ok(!/`  修好之后重跑同一条命令：其他块会跳过/.test(src), '分块那句无条件的"重跑即可"还在');
  // 分块路径必须仍然说清"重跑只补这一块"（那是**真的**，别一刀切删掉）
  assert.match(src, /其他已渲好的块会保留：确认上面那些之后重跑同一条命令，只会重渲这一块/);
  // `--parallel` 那条必须**同时**给出"输入性 / 资源性"两类判据与降并发建议
  assert.match(src, /输入性（已知原因、确定性）/);
  assert.match(src, /资源性（可能是瞬时）/);
  assert.match(src, /--parallel \$\{Math\.max\(1, Math\.floor\(n \/ 2\)\)\}/);
  assert.match(src, /步骤没有可复用的块|这一步没有可复用的块/);
});

t('源码自检：产物守门四处都走 gateFailureLines/decideGateFailure', () => {
  const callSites = [
    /die\(gateFailureLines\(\s*\{ title: `第 \$\{i \+ 1\} 块的产物验收不通过/,
    /die\(gateFailureLines\(\s*\{ title: `产物验收不通过，已删除 \$\{path\.relative\(ROOT, out\)\}/,
    /\{ title: '并行拼接后的产物不合格：'/,
    /\{ title: `第 \$\{i \+ 1\} 段的产物验收不通过：`/,
  ];
  for (const re of callSites) assert.match(src, re, `有一处产物守门没接进统一措辞：${re}`);
  const n = src.split('gateFailureLines(').length - 1;
  assert.ok(n >= 6, `gateFailureLines 调用点只有 ${n} 处，期望 ≥ 6（分块/拼接/直播/并行逐段/并行拼接/并行时间戳）`);
});

/* ------------------------------------------------------------------ 汇总 */

console.log(cases.join('\n'));
console.log(`\n✓ ${passed}/${passed} 条断言通过（node tools/test-check-skipped.mjs）`);
