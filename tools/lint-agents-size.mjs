#!/usr/bin/env node
// AGENTS.md 体积守门。
//
// 为什么存在：AGENTS.md 是被 system-reminder **每轮强制注入**的。工作区指令有硬预算
// （65536 B），超出时注入器按整段截断 —— 尾部的内容会**静默消失**，日志里只有一行
// "truncated AGENTS.md from N to M bytes"。2026-10 实测已到 65055 B（余量 481 B），
// 也就是"下次谁再加一条规则，被砍掉的就是文件末尾"。
//
// 两条线：
//   · HARD 65536 —— 平台预算，超了必定截断（exit 1）
//   · SOFT 40960 —— 工程目标线。超过它就说明"又有人把查表内容写进契约文件了"（warn）
//
// 输出还给出「最肥的几节」，因为瘦身的抓手永远在最大的那几节里。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HARD = 65536;
/**
 * **注入预算**（PLAN A2）：有的宿主只把 AGENTS.md 的前 ~24 KB 塞进上下文，超出部分 agent 看不到。
 * 所以 §4「铁律」这张表的**末尾**必须落在这个偏移之内 —— 否则最要命的那几条规则在那些宿主上等于不存在。
 * 实测本机截断点 23,975 B，取 24,000 作判据。
 */
const INJECT_BUDGET = 24000;
const SOFT = 40960;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function analyze(md) {
  const total = Buffer.byteLength(md, 'utf8');
  const lines = md.split('\n');
  const secs = [];
  let cur = null;
  for (const ln of lines) {
    const m = ln.match(/^##\s+(.*)$/);
    if (m) { if (cur) secs.push(cur); cur = { title: m[1], body: [] }; }
    else if (cur) cur.body.push(ln);
  }
  if (cur) secs.push(cur);
  const rows = secs.map(s => ({
    title: s.title,
    bytes: Buffer.byteLength(s.body.join('\n'), 'utf8'),
    lines: s.body.length,
  })).sort((a, b) => b.bytes - a.bytes);
  return { total, lines: lines.length, secs: rows };
}

if (process.argv[1]?.endsWith('lint-agents-size.mjs')) {
  const p = path.join(ROOT, 'AGENTS.md');
  const { total, lines, secs } = analyze(fs.readFileSync(p, 'utf8'));
  const pct = (total / HARD * 100).toFixed(1);
  console.log(`AGENTS.md：${total} B / ${HARD} B（${pct}%，余 ${HARD - total} B）· ${lines} 行`);

  if (total > HARD) {
    console.log(`\n✗ 超过平台预算 ${HARD} B —— 注入时尾部会被静默截断，agent 看不到最后那几节。`);
  } else if (total > HARD - 2048) {
    console.log(`\n⚠ 余量不足 2 KB —— 下一条规则就可能顶掉文件末尾。`);
  }

  console.log('\n最肥的 5 节：');
  for (const s of secs.slice(0, 5)) {
    const p = (s.bytes / total * 100).toFixed(1).padStart(4);
    console.log(`  ${String(s.bytes).padStart(6)} B ${p}%  ${s.lines} 行  ${s.title.slice(0, 42)}`);
  }

  if (total > HARD) process.exit(1);
  if (total > SOFT) console.log(`\n（软线 ${SOFT} B：这只是工程目标，不阻塞；超了说明查表内容该下沉到 docs/）`);

/**
 * 注入截断判据：§4 铁律表的**末尾**字节偏移必须 ≤ INJECT_BUDGET。
 * 为什么盯 §4：它是「写错不报错」的清单，被截掉就等于 agent 从来没看见过这 8 条。
 */
{
  const src = fs.readFileSync(p, 'utf8');
  const i4 = src.indexOf('## 4. 铁律');
  const i45 = src.indexOf('## 4.5');
  if (i4 < 0 || i45 < 0) {
    console.log('\n⚠ 找不到 §4 / §4.5 的边界，注入截断判据没跑（不算通过）');
    process.exitCode = 2;
  } else {
    const end = Buffer.byteLength(src.slice(0, i45), 'utf8');
    const ok = end <= INJECT_BUDGET;
    console.log(`\n注入截断判据：§4 铁律表末尾在 ${end} B（预算 ${INJECT_BUDGET} B）`
      + (ok ? '  ✓ 截断也不会切掉铁律' : `  ✗ 超了 ${end - INJECT_BUDGET} B —— 只注入前 24 KB 的宿主会看不到部分铁律，把 §4 之前的查表内容继续下沉`));
    if (!ok) process.exitCode = 1;
  }
}
}
