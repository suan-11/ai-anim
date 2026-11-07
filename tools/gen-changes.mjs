#!/usr/bin/env node
/**
 * tools/gen-changes.mjs —— 相对上游基线的改动清单，从 git 自动生成。
 *
 *   node tools/gen-changes.mjs              # 重新生成 docs/CHANGES-vs-upstream.md
 *   node tools/gen-changes.mjs --check      # 只校验：和磁盘上那份不一致 ⇒ 退出码 1
 *   node tools/gen-changes.mjs --base 237e985 --out docs/CHANGES-vs-upstream.md
 *
 * 为什么要有它：那份文档原来手写，写着写着停在「37 提交 / 381 文件」，而仓库已经 59 个提交。
 * 过期文档比没有更糟 —— 它会让人以为改动就那么点。生成 + --check 之后它不可能再漂。
 *
 * 结构：数据段（总量 / 提交一览 / 按目录）自动生成；
 * 「六块改动」这类必须人写的放在 manual:start 与 manual:end 之间，重新生成时原样保留。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const BASE = opt('base', '237e985');
const OUT = path.resolve(ROOT, opt('out', 'docs/CHANGES-vs-upstream.md'));
const check = argv.includes('--check');

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const gitRaw = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const range = BASE + '..HEAD';

// 浅克隆里基线提交根本不在本地 —— 那不是「清单过期」，是「CI 拿不到基线」。
// 报成未知 revision 会让一次真事故（verify.yml 漏了 fetch-depth: 0）变成一句看不懂的 git 报错。
const hasBase = (() => {
  try { execFileSync('git', ['cat-file', '-e', BASE], { cwd: ROOT, stdio: 'pipe' }); return true; }
  catch { return false; }
})();
if (!hasBase) {
  const shallow = (() => { try { return git('rev-parse', '--is-shallow-repository') === 'true'; } catch { return false; } })();
  console.error('✗ 拿不到基线提交 ' + BASE + '（' + (shallow ? '这是浅克隆：fetch-depth=1 只带 HEAD 一个提交' : '本地没有这个提交') + '）。');
  console.error('  · CI：.github/workflows/verify.yml 的 actions/checkout 必须写 fetch-depth: 0；');
  console.error('  · 本地：git fetch origin ' + BASE + '（或 git fetch --unshallow）。');
  console.error('  这一项**没验**（退出码 2），不是「清单过期」。');
  process.exit(2);
}

// ⚠ **PR 的 CI 上 HEAD 是 GitHub 现造的 merge commit**（`Merge pull request #N from ...`，或
// `Merge <sha> into <sha>`）。它与本地生成物里的 HEAD 必然不同 —— 于是 --check 在任何 PR 上
// 都会红，而红的原因不是「清单过期」，是「比对基准是个临时对象」。
// 所以计数、提交一览与「当前 HEAD」这一行都只看 `--no-merges` 的最后一个真提交。
const commits = git('log', '--no-merges', '--format=%h%x1f%ad%x1f%s', '--date=short', range).split('\n').filter(Boolean)
  .map((l) => { const p = l.split('\x1f'); return { h: p[0], d: p[1], s: p[2] }; });
const numstat = gitRaw('diff', '--numstat', range).split('\n').filter(Boolean);
const byDir = new Map();
let addAll = 0, delAll = 0;
for (const line of numstat) {
  const p = line.split('\t');
  if (!p[2]) continue;
  const add = p[0] === '-' ? 0 : Number(p[0]);
  const del = p[1] === '-' ? 0 : Number(p[1]);
  addAll += add; delAll += del;
  const top = p[2].includes('/') ? p[2].split('/')[0] : '(root)';
  const cur = byDir.get(top) ?? { files: 0, add: 0, del: 0 };
  cur.files++; cur.add += add; cur.del += del;
  byDir.set(top, cur);
}
const dirs = [...byDir.entries()].sort((a, b) => b[1].add - a[1].add);
const totalFiles = numstat.length;
// 同上：跳过 merge commit，否则 PR 的 CI 会看到多一个提交（差异只有那一行）。
const headLine = git('log', '--no-merges', '-1', '--format=%h %s');

let manual = '';
if (existsSync(OUT)) {
  const old = readFileSync(OUT, 'utf8');
  const m = old.match(/<!-- manual:start -->([\s\S]*?)<!-- manual:end -->/);
  if (m) manual = m[1];
}

const out = [];
const P = (s) => out.push(s);
P('# 我们在上游 main 之上做了什么');
P('');
P('> **这份文件是生成的**（node tools/gen-changes.mjs），--check 会拦住过期版本。');
P('> 数据段自动统计；「改动分块」这类必须人写的留在 manual 标记之间。');
P('>');
P('> 复现：git log --oneline ' + range + ' · git diff --stat ' + range);
P('');
P('## 一、总量');
P('');
P('```');
P(commits.length + ' 个提交 · ' + totalFiles + ' 个文件 · +' + addAll.toLocaleString('en-US') + ' / −' + delAll.toLocaleString('en-US') + ' 行');
P('基线 ' + BASE + '　当前 ' + headLine);
P('```');
P('');
P('| 目录 | 文件 | 新增行 | 删除行 |');
P('|---|---:|---:|---:|');
for (const d of dirs) P('| ' + d[0] + ' | ' + d[1].files + ' | ' + d[1].add.toLocaleString('en-US') + ' | ' + d[1].del.toLocaleString('en-US') + ' |');
P('');
P('## 二、提交一览');
P('');
P('| 提交 | 日期 | 内容 |');
P('|---|---|---|');
for (const c of commits) P('| ' + c.h + ' | ' + c.d + ' | ' + c.s.replace(/\|/g, '\\|') + ' |');
P('');
P('## 三、改动分块（人写）');
P('');
P('<!-- manual:start -->');
P(manual.trim() ? manual.trim() : '（这一段是人写的：按「引擎 / 工作台 / 模板 / 风格 / 判据 / 流程」分组说明改动。重新生成时原样保留。）');
P('<!-- manual:end -->');
P('');
const text = out.join('\n') + '\n';

if (check) {
  const old = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  // 宽松一档：允许落后一个提交（这份文档自己也会被下一个提交带上）
  const prevRange = BASE + '..HEAD^';
  const prevCommits = (() => { try { return git('rev-list', '--count', prevRange); } catch { return -1; } })();
  const oneBehind = prevCommits >= 0 && old.includes(prevCommits + ' 个提交');
  if (old !== text && !oneBehind) {
    console.error('✗ ' + path.relative(ROOT, OUT) + ' 已过期 —— 跑 node tools/gen-changes.mjs 重新生成');
    process.exitCode = 1;
  } else {
    console.log('✓ 改动清单是最新的（' + commits.length + ' 提交 / ' + totalFiles + ' 文件）');
  }
} else {
  writeFileSync(OUT, text);
  console.log('✓ ' + path.relative(ROOT, OUT) + '  ·  ' + commits.length + ' 提交 / ' + totalFiles + ' 文件 / +' + addAll + ' −' + delAll);
}
