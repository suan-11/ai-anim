// 离线断言：`out/<任务>/NOTES.json`（BACKLOG 1-29 后半）的读写/校验纯函数。
//
// 直接 import scripts/anim.mjs —— 它带 IS_MAIN 入口门，import 不会执行任何命令、不碰 GPU。
// 这里跑的全是纯函数（不读磁盘、不看时钟：时间戳从参数传进去）。
//
// 用法：node tools/test-notes.mjs
// （原落在 out/_staging/，由主代理搬进 tools/ 并登记进 tools/regress-all.mjs ——
//   `out/**` 会被 `anim clean` 清掉，一次性的断言等于没做；搬移只改了这两处路径。）
import {
  NOTES_SCHEMA, PROTECTED_OUT_FILES, parseNotesJson, serializeNotes, nextNoteId,
  addNote, resolveNote, notesSummary, formatNoteLines, isProtectedOutFile,
} from '../scripts/anim.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? `  ← ${extra}` : ''}`); }
};
const throws = (name, fn, kind) => {
  try { fn(); fail++; console.log(`  FAIL  ${name}  ← 没有抛错`); }
  catch (e) {
    if (kind && e.kind !== kind) { fail++; console.log(`  FAIL  ${name}  ← kind=${e.kind}，期望 ${kind}`); }
    else { pass++; console.log(`  PASS  ${name}（${e.kind ?? 'no-kind'}：${String(e.message).split('\n')[0].slice(0, 60)}…）`); }
  }
};

console.log('\n评论文件 NOTES.json（scripts/anim.mjs 的纯函数）\n');

console.log('§1 正常读：信封 / 裸数组 / 规范化');
{
  const env = {
    schema: NOTES_SCHEMA,
    task: 'demo',
    notes: [
      { id: 'n1', at: 12.5, text: '  这里字幕太小  ', createdAt: '2026-01-01T00:00:00.000Z', resolved: false, resolvedAt: null },
      { id: 'n2', at: '35', text: '音乐太突然', createdAt: '2026-01-01T00:01:00.000Z', resolved: 1, resolvedAt: '2026-01-01T00:02:00.000Z' },
    ],
  };
  const r = parseNotesJson(JSON.stringify(env), { file: 'x/NOTES.json' });
  ok('信封读得动，两条都在', r.notes.length === 2);
  ok('未知字段不报错、warnings 为空', r.warnings.length === 0, JSON.stringify(r.warnings));
  ok('text 去首尾空白', r.notes[0].text === '这里字幕太小');
  ok('at 字符串被收成数字（35 → 35）', r.notes[1].at === 35);
  ok('resolved 真值化（1 → true）', r.notes[1].resolved === true);
  ok('task 读出来', r.task === 'demo');

  const bare = parseNotesJson(JSON.stringify([{ id: 'a', text: '裸数组也认' }]), {});
  ok('裸数组也读得动（手写的文件常见形状）', bare.notes.length === 1 && bare.notes[0].id === 'a');
  ok('裸数组没有 task（null）', bare.task === null);

  const rt = parseNotesJson(serializeNotes({ task: 'demo', notes: r.notes }), {});
  ok('序列化 → 解析 往返一致', JSON.stringify(rt.notes) === JSON.stringify(r.notes));
  ok('写出来的以换行结尾（给人手改）', serializeNotes({ notes: [] }).endsWith('\n'));
  ok('写出来的 schema 是规范的', JSON.parse(serializeNotes({ notes: [] })).schema === NOTES_SCHEMA);
  const order = Object.keys(JSON.parse(serializeNotes({ notes: [r.notes[0]] })).notes[0]);
  ok('条目字段顺序 = {id, at, text, createdAt, resolved, resolvedAt}',
    JSON.stringify(order) === JSON.stringify(['id', 'at', 'text', 'createdAt', 'resolved', 'resolvedAt']), order.join(','));
}

console.log('\n§2 坏文件必须报出来（不许当成"还没有评论"）');
throws('空文件 → empty', () => parseNotesJson('   \n', { file: 'out/demo/NOTES.json' }), 'empty');
throws('半截 JSON（写到一半就断了）→ bad-json', () => parseNotesJson('{"schema":"anim.notes/1","notes":[{"id":"n1","text":"半', { file: 'out/demo/NOTES.json' }), 'bad-json');
throws('语法错（多一个逗号）→ bad-json', () => parseNotesJson('{"notes":[,]}', {}), 'bad-json');
throws('顶层是数字 → bad-shape', () => parseNotesJson('42', {}), 'bad-shape');
throws('信封里 notes 不是数组 → bad-shape', () => parseNotesJson('{"notes":{"a":1}}', {}), 'bad-shape');
throws('某条没有正文 → bad-entry', () => parseNotesJson('[{"id":"n1"}]', {}), 'bad-entry');
throws('某条不是对象 → bad-entry', () => parseNotesJson('["就一句话"]', {}), 'bad-entry');
{
  let msg = '';
  try { parseNotesJson('{"notes":[{"id":"n1"}]}', { file: 'out/demo/NOTES.json' }); } catch (e) { msg = e.message; }
  ok('报错里点名文件与第几条', msg.includes('out/demo/NOTES.json') && msg.includes('第 1 条'), msg);
  let msg2 = '';
  try { parseNotesJson('{"notes":[{"id":"n1","text":"a"},{"id":"n2","text":""}]}', {}); } catch (e) { msg2 = e.message; }
  ok('第 2 条没正文时点名"第 2 条"', msg2.includes('第 2 条'), msg2);
  let msg3 = '';
  try { parseNotesJson('{\n  "notes": [\n    {"id": "n1", "text"', {}); } catch (e) { msg3 = e.message; }
  ok('半截 JSON 的报错带行列（或至少一句人话）', /第 \d+ 行|JSON/.test(msg3), msg3);
}

console.log('\n§3 能修的字段就修，修了什么要说（warnings）');
{
  const r = parseNotesJson(JSON.stringify([
    { text: '没有 id' },
    { id: 'n1', text: '用了 n1' },
    { id: 'n1', text: '又用了一次 n1' },
    { id: 'n3', at: '不是秒数', text: 'at 坏了' },
  ]), {});
  const ids = r.notes.map((n) => n.id);
  ok('4 条一条都没丢', r.notes.length === 4);
  ok('id 全部唯一', new Set(ids).size === 4, ids.join(','));
  ok('显式写的 id 不被自动补的挤走（第 2 条还是 n1）', r.notes[1].id === 'n1', ids.join(','));
  ok('显式写的 id 不被自动补的挤走（第 4 条还是 n3）', r.notes[3].id === 'n3', ids.join(','));
  ok('没有 id 的自动补一个最小的空闲号（n1 已被占用 → n2）', r.notes[0].id === 'n2', ids.join(','));
  ok('真重复的那个改名，且不与任何已用 id 撞车', r.notes[2].id !== 'n1' && ids.filter((x) => x === r.notes[2].id).length === 1, ids.join(','));
  ok('at 坏了 → null（而不是丢掉整条）', r.notes[3].at === null);
  ok('补 id / 改名 / at 坏 三件事都进了 warnings', r.warnings.length === 3, JSON.stringify(r.warnings));
  ok('nextNoteId 给的是没人用的号（单调往上，永不回收）', !ids.includes(nextNoteId(r.notes)), `${nextNoteId(r.notes)} vs ${ids.join(',')}`);
  ok('别人手写的 id 不被当成序号', nextNoteId([{ id: 'abc' }, { id: 'n7' }]) === 'n8');
}

console.log('\n§4 未知字段原样保留（将来加 run 之类不会被人手/旧版抹掉）');
{
  const r = parseNotesJson(JSON.stringify({
    schema: NOTES_SCHEMA, task: 'demo', run: 'r-2026-10-10',
    notes: [{ id: 'n1', text: 'x', run: 'r-1' }],
  }), {});
  ok('信封上的未知键进 extra', r.extra.run === 'r-2026-10-10');
  const out = serializeNotes({ task: r.task, notes: r.notes, extra: r.extra });
  const back = JSON.parse(out);
  ok('写回去时 run 还在（信封）', back.run === 'r-2026-10-10');
  ok('写回去时 run 还在（条目）', back.notes[0].run === 'r-1');
  ok('未知 schema 会 warn 但仍能读', parseNotesJson('{"schema":"anim.notes/9","notes":[]}', {}).warnings.length === 1);
}

console.log('\n§5 追加 / 解决（纯函数，时间从外面传）');
{
  const t1 = '2026-01-01T10:00:00.000Z';
  const a = addNote([], { text: '  第一条  ', at: '12.5', now: t1 });
  ok('追加：id=n1、at=12.5、createdAt=now、未解决', a.note.id === 'n1' && a.note.at === 12.5
    && a.note.createdAt === t1 && a.note.resolved === false && a.note.resolvedAt === null);
  ok('追加：正文去空白', a.note.text === '第一条');
  const b = addNote(a.notes, { text: '没有时刻', now: t1 });
  ok('不传 --at → at 是 null（不是 0）', b.note.at === null);
  throws('正文空 → empty-text', () => addNote([], { text: '   ' }), 'empty-text');
  throws('--at 不是秒数 → bad-at', () => addNote([], { text: 'x', at: '第十二秒' }), 'bad-at');
  throws('--at 负数 → bad-at', () => addNote([], { text: 'x', at: -1 }), 'bad-at');

  const t2 = '2026-01-01T11:00:00.000Z';
  const r1 = resolveNote(b.notes, 'n1', { now: t2 });
  ok('解决：resolved=true、resolvedAt=now、changed=true', r1.note.resolved && r1.note.resolvedAt === t2 && r1.changed === true);
  ok('解决：不动的条目**对象不变**（没有全局副作用）', r1.notes[1] === b.notes[1]);
  const r2 = resolveNote(r1.notes, 'n1', { now: '2026-01-02T00:00:00.000Z' });
  ok('再解决一次：changed=false 且 resolvedAt 不变（幂等，不 churn 文件）',
    r2.changed === false && r2.note.resolvedAt === t2);
  throws('id 不存在 → no-such-id', () => resolveNote(b.notes, 'zzz'), 'no-such-id');
  {
    let msg = '';
    try { resolveNote(b.notes, 'zzz'); } catch (e) { msg = e.message; }
    ok('no-such-id 的报错里列出可用 id', msg.includes('n1') && msg.includes('n2'), msg);
  }
}

console.log('\n§6 人读输出与计数');
{
  const notes = [
    { id: 'n1', at: 12.5, text: '短', createdAt: '2026-01-01T02:00:00.000Z', resolved: false, resolvedAt: null },
    { id: 'n22', at: null, text: '没有时刻', createdAt: '2026-01-01T03:00:00.000Z', resolved: true, resolvedAt: '2026-01-01T04:00:00.000Z' },
  ];
  const lines = formatNoteLines(notes);
  ok('每条一行', lines.length === 2);
  ok('未解决/已解决都能看出来', lines[0].includes('○ 未解决') && lines[1].includes('✓ 已解决'));
  ok('没有时刻的那条写"—"而不是 0.00s', lines[1].includes('—') && !lines[1].includes('0.00s'));
  ok('时间戳是人读形状', /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(lines[0]), lines[0]);
  ok('空表的输出是一句话（不是空数组）', formatNoteLines([]).length === 1);
  const s = notesSummary(notes);
  ok('计数：total/open/resolved', s.total === 2 && s.open === 1 && s.resolved === 1);
}

console.log('\n§7 clean 保护（判据只有一处，且 NOTES.json 不匹配任何删除规则）');
{
  ok('isProtectedOutFile("NOTES.json") 为真', isProtectedOutFile('NOTES.json') === true);
  ok('保护名单就是 NOTES.json 这一个', PROTECTED_OUT_FILES.size === 1 && PROTECTED_OUT_FILES.has('NOTES.json'));
  ok('别的名字不受影响', isProtectedOutFile('demo.parts') === false && isProtectedOutFile('x.nv12') === false);
  // clean 的删除判据（与 cmdClean 同口径）：NOTES.json 一条都不命中
  const name = 'NOTES.json';
  const hits = [
    /\.(yuv|nv12|rgba|raw)$/i.test(name),
    name === '_stitched.mp4' || name === 'concat.txt',
    name.endsWith('.remotion.parts') || name.endsWith('.parts'),
    /^_(frames|dumpframe|determinism|align|via)/.test(name),
    /^_staging-remotion-/.test(name),
    name.endsWith('.mp4'),
    /\.remotion.*\.mp4$/i.test(name),
    /\.remotion\.png$/i.test(name),
  ];
  ok('NOTES.json 不匹配 clean 的任何一条规则（双保险）', hits.every((x) => x === false), JSON.stringify(hits));
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} 项通过${fail ? `，${fail} 项失败` : ''}\n`);
process.exitCode = fail ? 1 : 0;
