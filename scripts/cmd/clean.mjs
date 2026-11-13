// @ts-check
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { flag } from "../lib/cli/args.mjs";
import { firstLine } from "../lib/cli/gates.mjs";
import { die, log, warn } from "../lib/cli/log.mjs";
import { isProtectedOutFile, notesSummary, parseNotesJson } from "../lib/cli/notes.mjs";
import { ROOT, dirStats, mb, pickTask } from "../lib/cli/paths.mjs";
/**
 * 清理 `out/<任务>/` 下的中间产物（`docs/history/IMPROVEMENTS-1-3.md` P2-5）。
 *
 * 背景：做 beast 那轮 `out/beast/` 峰值 ≈ 3.8 GB（分块）+ 650 MB 成片 + 284 MB 分发版
 * + 86 MB stills + 我手工产生的 `*.yuv`（每个 400 MB），**没有任何清理提示**。
 *
 * 默认只删"能重新生成、且重新生成很贵但确实只是中间物"的东西：
 *   `*.parts/`（分块，删了要重渲）、`*.yuv`/`*.nv12`、`*.rgba`、`_stitched.mp4`、`concat.txt`。
 * **不删**成片、stills、接触表、hash 基线 —— 那些是产物或验收证据。
 * `--all` 才连成片一起删（那要显式要求）。
 * `--dry-run` 只列清单不动手。
 *
 * ⚠ **`NOTES.json` 也绝不删**（BACKLOG 1-29 后半）：它是"第 12.5 秒这里字幕太小"这类反馈的
 * **唯一落点**，删掉就是不可恢复地丢反馈 —— 它不是中间产物，是项目文件。保护方式有两条：
 *   ① 结构上：下面每个分支都先过 `isProtectedOutFile()`（判据只有一处，将来加规则也不会漏）；
 *   ② 输出上：只要这个文件在，收尾就**明说"评论保留"**（读的人不必去读代码才知道它被保护了）。
 */
function cmdClean() {
  const task = pickTask();
  const dir = path.join(ROOT, 'out', task);
  if (!existsSync(dir)) die(`没有 out/${task}/（还没渲过什么东西）`);
  const dry = flag('dry-run');
  const all = flag('all');

  // 评论（NOTES.json）：既不进 targets，也不受 --all 影响，而且要说出来（见函数头 ②）
  const notesFile = path.join(dir, 'NOTES.json');
  let notesLine = null;
  if (existsSync(notesFile)) {
    const rel = path.relative(ROOT, notesFile).replace(/\\/g, '/');   // 与文档里的 `out/<任务>/NOTES.json` 一致
    try {
      const s = notesSummary(parseNotesJson(readFileSync(notesFile, 'utf8'), { file: rel }).notes);
      notesLine = `评论保留：${rel}（${s.total} 条，其中 ${s.open} 条未解决）`
        + ` —— 评论是项目文件，clean${all ? '（含 --all）' : ''} 不删它；看/记：node scripts/anim.mjs note ${task} --list`;
    } catch (err) {
      // 读不动也照样不删：坏文件留给 `anim note` 报行列（它才知道怎么修）
      notesLine = `评论保留：${rel}（读不动：${firstLine(err)}）—— clean 不删它，用 anim note 看它到底哪里坏了`;
    }
  }

  const targets = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (isProtectedOutFile(e.name)) continue;   // ← 评论永不删（判据只有一处）
    if (e.isDirectory()) {
      // 分块目录 / 诊断用的裸帧目录
      if (/\.parts$/.test(e.name) || /^_(frames|dumpframe|determinism|align|via)/.test(e.name)) {
        targets.push({ p, why: /\.parts$/.test(e.name) ? '分块（断点续渲用，删了要重渲）' : '诊断中间产物' });
      }
      continue;
    }
    if (/\.(yuv|nv12|rgba|raw)$/i.test(e.name)) targets.push({ p, why: '裸帧中间产物' });
    else if (e.name === '_stitched.mp4' || e.name === 'concat.txt') targets.push({ p, why: '分块拼接的中间文件' });
    else if (all && e.name.endsWith('.mp4')) targets.push({ p, why: '成片（--all 才会删）' });
  }

  // parts 目录里的 raw 也算上（上面按目录整体处理了，这里只算体积）
  let freed = 0;
  const rows = [];
  for (const t of targets) {
    const st = statSync(t.p);
    const s = st.isDirectory() ? dirStats(t.p) : { bytes: st.size, files: 1 };
    freed += s.bytes;
    rows.push({ ...t, ...s });
  }
  if (!rows.length) {
    log(`out/${task}/ 没有可清理的中间产物（成片与 stills 都保留）。`);
    if (notesLine) log(notesLine);
    return;
  }
  rows.sort((a, b) => b.bytes - a.bytes);
  log(`out/${task}/ 可清理的中间产物（${rows.length} 项，共 ${mb(freed)}）：`);
  for (const r of rows) {
    log(`  ${mb(r.bytes).padStart(10)}  ${String(r.files).padStart(4)} 个文件  ${path.relative(ROOT, r.p)}  —— ${r.why}`);
  }
  if (notesLine) log(`\n${notesLine}`);
  if (dry) { log(`\n（--dry-run：什么都没删）`); return; }
  for (const r of rows) {
    try { rmSync(r.p, { recursive: true, force: true }); } catch (err) { warn(`  删不掉 ${path.relative(ROOT, r.p)}：${err.message}`); }
  }
  const after = dirStats(dir);
  log(`\n✓ 已清理，释放 ${mb(freed)}；out/${task}/ 现在 ${mb(after.bytes)}（${after.files} 个文件）`);
  if (existsSync(notesFile)) log(`  ${path.relative(ROOT, notesFile)} 还在（评论没有被清掉）。`);
  if (rows.some((r) => /\.parts$/.test(r.p))) {
    log(`  ⚠ 分块已删：下次 \`video --segments\` 会全部重渲。`);
  }
}
export { cmdClean as run };
