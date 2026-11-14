// @ts-check

/* --------------------------------------- 评论文件（out/<任务>/NOTES.json，BACKLOG 1-29）：纯函数区 */

/**
 * `out/<任务>/NOTES.json` 的**规范形状**（`anim note` 读写的那份文件）。
 *
 * 为什么评论要是一个**普通项目文件**（而不是某个 UI 的数据库）：外部参考项目
 * （`docs/REFERENCE-hypit.md` §5.5 的 `FEEDBACK.json`、`docs/REFERENCE-agent-video-projects.md`）
 * 的 Studio 就是这么做的 —— 读写都走文件、不轮询、不重编译。于是：
 * agent 和你都能用一条命令往里写"第 12.5 秒这里字幕太小"，而**不需要**跑一次渲染。
 *
 * ```json
 * { "schema": "anim.notes/1", "task": "demo",
 *   "notes": [ { "id": "n1", "at": 12.5, "text": "这里字幕太小",
 *                "createdAt": "2026-10-10T14:10:00.000Z", "resolved": false, "resolvedAt": null } ] }
 * ```
 *
 * ⚠ **BACKLOG 1-29 原文里写的是 `{id, run, at, text, resolved}`** —— 其中的 `run`
 * （"这条评论是对哪一次渲染说的"）**这一版没有实现**：渲染产物目前没有 run id。
 * 读进来时它会作为"未知字段"**原样保留**（`parseNotesJson` 的 `extra` / 条目上的未知键），
 * 所以将来加它不会抹掉已经手写进去的值。
 */
const NOTES_SCHEMA = 'anim.notes/1';

/**
 * `anim clean` **永远不许删**的 `out/` 文件名（评论是项目文件，不是渲染中间产物）。
 * 判据放在这里、`cmdClean` 每个分支都过一遍 —— 而不是"靠它没被写进白名单"。
 */
const PROTECTED_OUT_FILES = new Set(['NOTES.json']);

/**
 * @typedef {{ id: string, at: number|null, text: string, createdAt: string|null,
 *             resolved: boolean, resolvedAt: string|null }} Note
 */

/** 造一个带 `kind` 的错（调用方靠 `kind` 分档，不解析文案）。 */
function notesErr(kind, msg) {
  const e = new Error(msg);
  /** @type {any} */ (e).kind = kind;
  return e;
}

/** 给人看的类型名（报错用：`undefined` / `null` / 数组 / 对象 / 字符串 …）。 */
function shapeOf(x) {
  if (x === null) return 'null';
  if (Array.isArray(x)) return '数组';
  return { undefined: 'undefined', string: '字符串', number: '数字', boolean: '布尔值', object: '对象' }[typeof x] ?? typeof x;
}

/**
 * JSON 解析失败 → 能直接定位的一句（`第 4 行第 5 列：Unexpected token }`）。
 *
 * 为什么要自己算行列：V8 的报错文案这些年换过好几版（有的给 `at position 12`、
 * 有的给 `(line 1 column 6)`、回车的半截文件只给 `Unexpected end of JSON input`），
 * 而"文件被写了一半"这件事**必须让读的人一眼看出来**（评论的唯一落点，不能静默丢）。
 */
function jsonErrorWhere(text, err) {
  const msg = String((err && err.message) || err).replace(/^JSON\.parse:\s*/, '');
  const lc = /line (\d+) column (\d+)/.exec(msg);
  if (lc) return `第 ${lc[1]} 行第 ${lc[2]} 列：${msg.replace(/\s*\(line \d+ column \d+\)/, '')}`;
  const pos = /position (\d+)/.exec(msg);
  if (pos) {
    const before = String(text).slice(0, Number(pos[1]));
    const line = before.split('\n').length;
    const col = Number(pos[1]) - before.lastIndexOf('\n');
    return `第 ${line} 行第 ${col} 列：${msg.replace(/\s*at position \d+/, '')}`;
  }
  return msg;
}

/**
 * 读一份 `NOTES.json` 文本 → 结构化评论表（**纯函数**：不碰磁盘、不看时钟，可离线断言）。
 *
 * 三条刻意的设计（都是为了"评论不能悄悄消失"）：
 *   ① **坏文件必须报得出来，而且报到行列**：空文件 / 半截 JSON / 形状不对 / 某条没正文，
 *      一律抛**自己写的** `Error`（`err.kind` ∈ `empty|bad-json|bad-shape|bad-entry`），
 *      绝不把 V8 的 `SyntaxError` 原样丢出去。把它们读成"还没有评论"就是静默丢反馈
 *      —— 和 BACKLOG 1-19 的「空 ≠ 干净」是同一条纪律。
 *   ② **能修的字段就修，修了什么要说**（`warnings`）：条目没有 `id` 自动补一个、
 *      `id` 重复自动改名、`at` 不是 ≥0 的秒数就按"没有时刻"算。都比"这一条不显示了"好。
 *   ③ **认得出两种形状**：信封 `{ schema, task, notes: [...] }` 与**裸数组** `[...]`
 *      （手写的文件常常只有数组）。写回去时一定是信封（见 `serializeNotes`）。
 *
 * @param {string} text 文件内容（调用方用 utf8 读进来）
 * @param {{ file?: string }} [opts] `file` 只用于报错文案（给相对路径更好读）
 * @returns {{ schema: string, task: string|null, notes: Note[],
 *             extra: Record<string, any>, warnings: string[] }}
 * @throws {Error} `err.kind` 见上
 */
function parseNotesJson(text, opts = {}) {
  const file = opts.file ?? 'NOTES.json';
  const raw = String(text ?? '');
  if (!raw.trim()) {
    throw notesErr('empty', `${file} 是空的（0 字节）—— 半截写入或被清空过。\n`
      + `  它不是"还没有评论"（空 ≠ 干净）：要么把它修回来，要么删掉它（评论会一起丢）再重来。`);
  }
  let data;
  try { data = JSON.parse(raw); } catch (err) {
    throw notesErr('bad-json', `${file} 不是合法 JSON —— ${jsonErrorWhere(raw, err)}\n`
      + `  文件可能被写了一半。修好它，或删掉它（评论会一起丢）再重来。`);
  }
  const envelope = !!data && typeof data === 'object' && !Array.isArray(data);
  const list = envelope ? data.notes : data;
  if (!Array.isArray(list)) {
    throw notesErr('bad-shape', `${file} 的形状不对：`
      + (envelope ? '`notes` 必须是数组' : '顶层必须是数组，或 `{ schema, task, notes: [...] }`')
      + `（实际是${shapeOf(list)}）。`);
  }

  const warnings = [];
  /** @type {Note[]} */
  const notes = [];
  /**
   * ① **先把显式、不重复的 id 占住**（两遍走）。
   * 为什么：手写进文件的 id 是"人已经引用过的名字"（`--resolve n1` 指的就是它），
   * 不能被上面自动补的挤走 —— 一遍走的话，"第 1 条忘写 id"就会顺手占掉 `n1`，
   * 把第 2 条真正写着 `n1` 的那条改名成 `n2`。
   */
  const taken = new Set();
  for (const n of list) {
    const id = n && typeof n === 'object' && !Array.isArray(n) && typeof n.id === 'string' ? n.id.trim() : '';
    if (id && !taken.has(id)) taken.add(id);
  }
  /** 从最小的空闲编号里取一个（`nextNoteId` 是给"追加"用的：单调往上，永不回收旧号）。 */
  const allocId = () => {
    let i = 1;
    while (taken.has(`n${i}`)) i++;
    const id = `n${i}`;
    taken.add(id);
    return id;
  };
  const seen = new Set();
  list.forEach((n, i) => {
    const where = `第 ${i + 1} 条`;
    if (!n || typeof n !== 'object' || Array.isArray(n)) {
      throw notesErr('bad-entry', `${file} 的${where}不是对象（实际是${shapeOf(n)}）。`);
    }
    const body = typeof n.text === 'string' ? n.text.trim() : '';
    if (!body) {
      throw notesErr('bad-entry', `${file} 的${where}没有正文（\`text\` 必须是非空字符串）——`
        + `评论的正文不能丢：补上它，或者删掉这一条。`);
    }
    let id = typeof n.id === 'string' ? n.id.trim() : '';
    if (!id || seen.has(id)) {
      const fixed = allocId();
      warnings.push(id
        ? `${where}的 id "${id}" 与前面重复 → 自动改名为 ${fixed}（--resolve 时按新的来）`
        : `${where}没有 id → 自动补一个 ${fixed}`);
      id = fixed;
    }
    seen.add(id);
    let at = null;
    if (n.at !== null && n.at !== undefined && n.at !== '') {
      const v = Number(n.at);
      if (Number.isFinite(v) && v >= 0) at = v;
      else warnings.push(`${where}的 at=${JSON.stringify(n.at)} 不是 ≥0 的秒数 → 按"没有时刻"处理`);
    }
    notes.push({
      ...n,
      id,
      at,
      text: body,
      createdAt: typeof n.createdAt === 'string' && n.createdAt ? n.createdAt : null,
      resolved: !!n.resolved,
      resolvedAt: typeof n.resolvedAt === 'string' && n.resolvedAt ? n.resolvedAt : null,
    });
  });

  const schema = envelope && typeof data.schema === 'string' && data.schema ? data.schema : NOTES_SCHEMA;
  if (schema !== NOTES_SCHEMA) {
    warnings.push(`schema="${schema}" 不是 ${NOTES_SCHEMA} —— 照当前形状读（未知字段原样留着，含义不保证）`);
  }
  /** 信封上不认识的键（例如将来 1-29 想加的 `run`）：原样带着走，别抹掉别人写的字段。 */
  const extra = {};
  if (envelope) {
    for (const k of Object.keys(data)) if (k !== 'schema' && k !== 'task' && k !== 'notes') extra[k] = data[k];
  }
  const task = envelope && typeof data.task === 'string' && data.task ? data.task : null;
  return { schema: NOTES_SCHEMA, task, notes, extra, warnings };
}

/**
 * 评论表 → `NOTES.json` 的文本（**纯函数**）。写回去时**一定是信封**（裸数组只被读、不被写）。
 * 2 空格缩进 + 末尾换行 —— 这个文件是给人手改的，diff 要干净。
 * @param {{ task?: string|null, notes?: Note[], extra?: Record<string, any> }} o
 */
function serializeNotes(o = {}) {
  const env = {
    ...(o.extra ?? {}),
    schema: NOTES_SCHEMA,
    task: o.task ?? null,
    notes: (o.notes ?? []).map((n) => ({
      ...n,
      id: String(n.id),
      at: Number.isFinite(n.at) ? n.at : null,
      text: String(n.text),
      createdAt: n.createdAt ?? null,
      resolved: !!n.resolved,
      resolvedAt: n.resolvedAt ?? null,
    })),
  };
  return `${JSON.stringify(env, null, 2)}\n`;
}

/** 下一个没被用过的 id（`n1` `n2` …；只认自己发的这种形状，别人写的 id 一律不碰）。 */
function nextNoteId(notes) {
  let max = 0;
  for (const n of notes ?? []) {
    const m = /^n(\d+)$/.exec(String(n?.id ?? ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `n${max + 1}`;
}

/**
 * 追加一条评论（**纯函数**，可离线断言：`now` 从外面传进来）。
 * @param {Note[]} notes
 * @param {{ text?: string, at?: any, now?: string }} o
 * @returns {{ notes: Note[], note: Note }}
 * @throws {Error} `kind` ∈ `'empty-text' | 'bad-at'`
 */
function addNote(notes, o = {}) {
  const list = Array.isArray(notes) ? notes : [];
  const text = String(o.text ?? '').trim();
  if (!text) throw notesErr('empty-text', '评论正文是空的 —— 给一句话，例如 "第 12.5 秒这里字幕太小"。');
  let at = null;
  if (o.at !== undefined && o.at !== null && o.at !== '') {
    const v = Number(o.at);
    if (!Number.isFinite(v) || v < 0) {
      throw notesErr('bad-at', `--at 要一个 ≥0 的秒数（例如 --at 12.5），给的是 "${o.at}"。`);
    }
    at = v;
  }
  const note = {
    id: nextNoteId(list),
    at,
    text,
    createdAt: o.now ?? new Date().toISOString(),
    resolved: false,
    resolvedAt: null,
  };
  return { notes: [...list, note], note };
}

/**
 * 把某条标记成已解决（**纯函数**）。已经解决过的**不重写 `resolvedAt`**（幂等，不churn 文件）。
 * @param {Note[]} notes
 * @param {string} id
 * @param {{ now?: string }} [o]
 * @returns {{ notes: Note[], note: Note, changed: boolean }}
 * @throws {Error} `kind === 'no-such-id'`（文案里列出所有可用 id —— 否则只能靠 `--list` 再跑一次）
 */
function resolveNote(notes, id, o = {}) {
  const list = Array.isArray(notes) ? notes : [];
  const want = String(id ?? '').trim();
  const i = list.findIndex((n) => String(n?.id) === want);
  if (i < 0) {
    const have = list.length
      ? list.map((n) => `${n.id}${n.resolved ? '(已解决)' : ''}`).join(' / ')
      : '(一条都没有)';
    throw notesErr('no-such-id', `没有 id 为 "${want}" 的评论。现有的：${have}`);
  }
  const cur = list[i];
  const changed = !cur.resolved;
  const note = changed
    ? { ...cur, resolved: true, resolvedAt: o.now ?? new Date().toISOString() }
    : { ...cur };
  const out = list.slice();
  out[i] = note;
  return { notes: out, note, changed };
}

/** 评论表的计数（纯函数）：`{ total, open, resolved }`。 */
function notesSummary(notes) {
  const list = Array.isArray(notes) ? notes : [];
  let open = 0;
  for (const n of list) if (!n?.resolved) open++;
  return { total: list.length, open, resolved: list.length - open };
}

/** ISO 时间戳 → `2026-10-10 22:10`（本机时区；读不动就原样返回）。 */
function fmtStamp(iso) {
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 评论表 → `--list` 的那几行（**纯函数**）。顺序 = 写入顺序（先记的在上面）。
 * @param {Note[]} notes
 * @returns {string[]}
 */
function formatNoteLines(notes) {
  const list = Array.isArray(notes) ? notes : [];
  if (!list.length) return ['  （还没有评论）'];
  const w = Math.max(...list.map((n) => String(n.id).length));
  return list.map((n) => {
    const at = Number.isFinite(n.at) ? `${n.at.toFixed(2)}s`.padStart(8) : '       —';
    const mark = n.resolved ? '✓ 已解决' : '○ 未解决';
    const when = n.createdAt ? `  ${fmtStamp(n.createdAt)}` : '';
    const done = n.resolved && n.resolvedAt ? ` → ${fmtStamp(n.resolvedAt)}` : '';
    return `  ${String(n.id).padEnd(w)}  ${at}  ${mark}  ${n.text}${when}${done}`;
  });
}

/** 这个 `out/<任务>/` 里的文件名**永远不许被 clean 删**吗？（纯函数；判据的唯一来源） */
function isProtectedOutFile(name) {
  return PROTECTED_OUT_FILES.has(String(name));
}

export { NOTES_SCHEMA, PROTECTED_OUT_FILES, addNote, formatNoteLines, isProtectedOutFile, nextNoteId, notesSummary, parseNotesJson, resolveNote, serializeNotes };
