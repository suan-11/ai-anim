// @ts-check
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flag, opt, rest } from "../lib/cli/args.mjs";
import { firstLine } from "../lib/cli/gates.mjs";
import { die, log, warn } from "../lib/cli/log.mjs";
import { NOTES_SCHEMA, addNote, formatNoteLines, notesSummary, parseNotesJson, resolveNote, serializeNotes } from "../lib/cli/notes.mjs";
import { ROOT, pickTask } from "../lib/cli/paths.mjs";
/* ------------------------------------------------------------------ 命令：note（评论） */

/** `out/<任务>/NOTES.json` 的绝对路径。 */
function notesPath(task) {
  return path.join(ROOT, 'out', task, 'NOTES.json');
}

/** 落盘（**utf8**：评论里有中文；这是评论唯一的写入点）。 */
function writeNotes(file, o) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, serializeNotes(o), 'utf8');
}

/**
 * `anim note` 的裸参数：任务名 / 正文（跳过 `--xxx <值>` 的"值"）。
 *
 * 为什么不能直接用 `positional()`：`--at 12.5` 里的 `12.5` 不以 `-` 开头，
 * 会被当成"位置参数"混进正文里。要彻底绕开这套推断就写 `--text "…"`。
 */
function noteWords() {
  const VALUE_FLAGS = new Set(['--at', '--text', '--id', '--resolve', '--unresolve', '--task', '--out', '-o']);
  const words = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (VALUE_FLAGS.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    words.push(a);
  }
  return words;
}

/**
 * `anim note` —— 给一支片子的某一秒留一句评论（`out/<任务>/NOTES.json`，BACKLOG 1-29 后半）。
 *
 *   node scripts/anim.mjs note demo "第 12.5 秒这里字幕太小" --at 12.5   # 追加（--at 是秒，可省）
 *   node scripts/anim.mjs note demo --list [--json]                      # 列出（未解决在前 …按写入顺序）
 *   node scripts/anim.mjs note demo --resolve n1                         # 标记已解决
 *
 * 为什么是**文件**而不是别的东西：外部参考项目的 Studio 把评论做成普通项目文件
 * （`docs/REFERENCE-hypit.md` §5.5 的 `FEEDBACK.json`）—— 读写走文件、**不轮询、不重编译**。
 * 所以"这里字幕太小"是一条命令的事，不需要跑一次渲染；agent 与人都读写同一份数据。
 * 放 `out/<任务>/` 还有个副作用是对的：`out/**` 是 Vite 明确忽略的目录，
 * 渲染期间写它**不会**触发 HMR（AGENTS.md §7 那条"渲染期间一个文件都别写"的唯一例外）。
 *
 * 读写都走 `scripts/anim.mjs` 前部那组**纯函数**（`parseNotesJson` / `addNote` / `resolveNote` …），
 * 所以"这份文件到底长什么样、坏了会怎么报"可以离线断言，不用真的出一次片。
 */
function cmdNote() {
  const task = pickTask();
  const file = notesPath(task);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');   // 与文档里的 `out/<任务>/NOTES.json` 长得一样

  const words = noteWords();
  const textArg = String(opt('text') ?? (words[0] === task ? words.slice(1).join(' ') : words.join(' '))).trim();
  const ri = rest.indexOf('--resolve');
  const resolveId = ri >= 0 ? rest[ri + 1] : null;

  // 读：文件不存在 = 全新（不是错）；存在但坏了 → 报行列 + 修法（绝不当成"没有评论"）
  let cur = { notes: [], extra: {}, task };
  const hasFile = existsSync(file);
  if (hasFile) {
    let raw;
    try { raw = readFileSync(file, 'utf8'); } catch (err) { die(`${rel} 读不动：${firstLine(err)}`); }
    try { cur = parseNotesJson(raw, { file: rel }); } catch (err) { die(String(err.message)); }
    for (const w of cur.warnings ?? []) warn(`⚠ ${w}`);
    if (cur.task && cur.task !== task) warn(`⚠ ${rel} 里的 task 是 "${cur.task}"，不是 "${task}"（原样留着，没有改它）`);
  }

  // --list
  if (flag('list')) {
    const s = notesSummary(cur.notes);
    if (flag('json')) {
      log(JSON.stringify({
        schema: NOTES_SCHEMA, task, file: rel, exists: hasFile,
        total: s.total, open: s.open, resolved: s.resolved, notes: cur.notes,
      }, null, 2));
      return;
    }
    // 说清"文件还没建"与"文件在、但没有条目"的区别：它的**空**和它的**坏**都不是"干净"（BACKLOG 1-19 的同一条纪律）
    log(`${rel} —— ${s.total} 条（${s.open} 条未解决${s.resolved ? `，${s.resolved} 条已解决` : ''}）`
      + (hasFile ? '' : ' · 文件还没建（第一条评论会建它）'));
    for (const l of formatNoteLines(cur.notes)) log(l);
    if (!s.total) log(`\n  记一条：node scripts/anim.mjs note ${task} "第 12.5 秒这里字幕太小" --at 12.5`);
    return;
  }

  // --resolve <id>
  if (ri >= 0) {
    if (!resolveId || resolveId.startsWith('-')) die('--resolve 后面要给一个 id（先 --list 看 id）。');
    if (!cur.notes.length) die(`${rel} 里一条评论都没有，没什么可解决的。`);
    let r;
    try { r = resolveNote(cur.notes, resolveId, { now: new Date().toISOString() }); } catch (err) { die(String(err.message)); }
    if (!r.changed) {
      log(`· ${r.note.id} 本来就是已解决（resolvedAt 不变）—— ${rel} 没有改动。`);
      return;
    }
    writeNotes(file, { task, notes: r.notes, extra: cur.extra });
    const s = notesSummary(r.notes);
    log(`✓ ${r.note.id} 标记为已解决 → ${rel}（还剩 ${s.open} 条未解决）`);
    return;
  }

  // 追加
  if (!textArg) {
    die(`anim note 要做什么？三种用法（<任务> 必给，评论落在 out/<任务>/NOTES.json）：\n`
      + `  node scripts/anim.mjs note ${task} "第 12.5 秒这里字幕太小" --at 12.5   记一条（--at 是秒，可省）\n`
      + `  node scripts/anim.mjs note ${task} --list [--json]                      列出全部评论\n`
      + `  node scripts/anim.mjs note ${task} --resolve n1                         把某条标记成已解决\n`
      + `  （正文也可以用 --text "…"；多词不加引号时按空格拼起来）`);
  }
  let added;
  try { added = addNote(cur.notes, { text: textArg, at: opt('at'), now: new Date().toISOString() }); } catch (err) { die(String(err.message)); }
  writeNotes(file, { task, notes: added.notes, extra: cur.extra });
  const s = notesSummary(added.notes);
  log(`✓ 记下 ${added.note.id}  ${added.note.at === null ? '（没有时刻）' : `${added.note.at.toFixed(2)}s`}  ${added.note.text}`);
  log(`  → ${rel}（共 ${s.total} 条，${s.open} 条未解决；anim clean 不会删它）`);
  log(`  看全部：node scripts/anim.mjs note ${task} --list`);
}
export { cmdNote as run };
