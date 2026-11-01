// P1-5 回归：口播/旁白这一层（docs/NARRATION.md A 档）。
//
// 验收口径来自 docs/NARRATION.md §5：
//   ① 叠句检查（相邻两句不许重叠）
//   ② 每段最后一句说完之后还有留白（这里验"能不能算出来"）
//   ③ 说话占比可打印
//   ④ `dur: { vo: id }` 能按句长定时长，且**名字写错必须抛错**（不许静默退回 4 秒）
//   ⑤ 场景侧查询（at / current / progress / typed）是 t 的纯函数
//
// 前四条是纯 JS，直接跑；第五条要真引擎，所以走 `probe-narration` 子命令（CLI）。
//
//   node tools/test-narration.mjs
import { spawn } from 'node:child_process';
import { makeNarration, makeNarrationReader, TAIL } from '../src/core/narration.js';
import { seq, cut, build } from '../src/timeline.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const say = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const spec = {
  source: './audio/vo.mp3',
  lines: [
    { id: 'hook-1', text: '这是第一句旁白', start: 1.0, dur: 3.2 },
    { id: 'hook-2', text: '这是第二句', start: 4.6, dur: 2.8 },
    { id: 'body-1', text: '第三句在这里', start: 8.0, dur: 4.0 },
  ],
};

console.log('P1-5 旁白层：');
const n = makeNarration(spec, { duration: 20 });

console.log('\n① 派生量与体检');
say(n.lines.length === 3, `归一出 ${n.lines.length} 句`);
say(n.lines[0].end === 4.2, `end 正确（1.0 + 3.2 = ${n.lines[0].end}）`);
say(Math.abs(n.lines[0].gapToNext - 0.4) < 1e-9, `gapToNext 正确（4.6 − 4.2 = ${n.lines[0].gapToNext}）`);
say(n.lastEnd === 12, `最后一句说完在 ${n.lastEnd}s`);
say(Math.abs(n.totalSpeech - 10) < 1e-9, `说话总时长 ${n.totalSpeech}s（3.2+2.8+4.0）`);
say(Math.abs(n.speechRatio - 0.5) < 1e-9, `说话占比 ${n.speechRatio}（10/20）`);
say(n.warnings.length === 0, `干净的表现在没有告警（${n.warnings.length} 条）`);
say(n.source === './audio/vo.mp3', `source 带过来了：${n.source}`);

console.log('\n② 叠句 / 越界 / 负数 必须报出来');
const bad = makeNarration({
  lines: [
    { id: 'a', text: 'A', start: 0, dur: 5 },
    { id: 'b', text: 'B', start: 4.5, dur: 2 },   // 与 a 叠了 0.5s
    { id: 'c', text: 'C', start: -1, dur: 0 },    // 负数 + dur=0
    { id: 'd', text: 'D', start: 25, dur: 1 },    // 超出 20s 的片子
  ],
}, { duration: 20 });
say(bad.warnings.some((w) => /叠句/.test(w) && /\[a\]/.test(w)), '叠句被点名（含是哪两句）');
say(bad.warnings.some((w) => /dur=0/.test(w)), 'dur=0 被点名');
say(bad.warnings.some((w) => /负数/.test(w)), '负起点被点名');
say(bad.warnings.some((w) => /超出了片子时长/.test(w)), '越界被点名');

console.log('\n③ 场景侧查询是 t 的纯函数');
const r = makeNarrationReader(n);
say(r.current(0.5) === null, '没在说话时 current 返回 null');
say(r.current(2.0)?.id === 'hook-1', `t=2.0 在说 hook-1`);
say(r.progress(2.0) !== null && Math.abs(r.progress(2.0) - 0.3125) < 1e-6, `t=2.0 念到 ${(r.progress(2.0) * 100).toFixed(1)}%（(2−1)/3.2）`);
const at = r.at(2.0);
say(at && at.p === r.progress(2.0), 'at(t).p 与 progress(t) 一致');
say(at && at.typedText.length === Math.floor(at.p * at.text.length), `typedText 长度 = ${at.typedText.length}（"${at.typedText}"）`);
say(at && at.restText.length + at.typedText.length === at.text.length, 'typedText + restText = 原文');
say(r.durOf('hook-1') === 3.2, `durOf('hook-1') = ${r.durOf('hook-1')}`);
say(r.line('nope') === null, 'line(不存在的 id) 返回 null（不抛）');
say(r.in(2.0, 'hook-1') === true && r.in(2.0, 'hook-2') === false, 'in(t, id) 判"此刻念的是不是这句"');
// 同一个 t 反复问必须一样（纯函数）
const a1 = JSON.stringify(r.at(2.0)), a2 = JSON.stringify(r.at(2.0));
say(a1 === a2, '同一 t 查两次结果完全一样');

console.log('\n④ 没有配旁白时也要安全（场景可以无条件调用）');
const empty = makeNarrationReader(null);
say(empty.at(1) === null && empty.current(1) === null && empty.progress(1) === null, '空实现全部返回 null');
say(empty.durOf('x') === null && empty.in(1, 2, 3) === false, '空实现的 durOf / in 也安全');
say(makeNarration(null) === null && makeNarration({ lines: [] }) === null, '空表返回 null 而不是抛错');

console.log('\n⑤ dur: { vo: id } 按句长定时长，名字写错必须抛');
const shot = { id: 'shot', render() {} };
{
  const tl = build(seq([cut(shot, { dur: { vo: 'hook-1' } }), cut(shot, { dur: { vo: 'hook-2' } })]), { narration: n });
  say(Math.abs((tl[0].end - tl[0].start) - 3.2) < 1e-9, `第一段时长 = ${(tl[0].end - tl[0].start).toFixed(3)}s（= hook-1 的 3.2s）`);
  say(Math.abs(tl[1].start - 3.2) < 1e-9, `第二段接着第一段起（${tl[1].start.toFixed(3)}s）`);
}
{
  let threw = null;
  try { build(seq([cut(shot, { dur: { vo: 'hoook-1' } })]), { narration: n }); } catch (e) { threw = e; }
  say(!!threw, '句子 id 写错 → 抛错（不静默退回默认 4 秒）');
  say(threw && /hook-1/.test(threw.message), '报错里列出了正确的 id 候选');
}
{
  let threw = null;
  try { build(seq([cut(shot, { dur: { vo: 'x' } })]), {}); } catch (e) { threw = e; }
  say(!!threw && /没有配 narration/.test(threw.message), '没配旁白表时说清了原因');
}
{
  const tl = build(seq([cut(shot, { dur: { vo: 'hook-1', tail: 1.0 } })]), { narration: n });
  say(Math.abs((tl[0].end - tl[0].start) - 4.2) < 1e-9, `dur: { vo, tail } 会加上留白（3.2 + 1.0 = ${(tl[0].end - tl[0].start).toFixed(2)}s）`);
}
{
  // tail 写错必须当场抛，不许 NaN 静默进段表（2026-11-01：旧实现 Number('x') 直接返回 NaN）
  let e1 = null, e2 = null, e3 = null;
  try { build(seq([cut(shot, { dur: { vo: 'hook-1', tail: 'x' } })]), { narration: n }); } catch (e) { e1 = e; }
  try { build(seq([cut(shot, { dur: { vo: 'hook-1', tail: NaN } })]), { narration: n }); } catch (e) { e2 = e; }
  try { build(seq([cut(shot, { dur: { vo: 'hook-1', tail: -0.5 } })]), { narration: n }); } catch (e) { e3 = e; }
  say(!!e1 && /tail 必须是有限数/.test(e1.message), `tail: 'x' → 抛「tail 必须是有限数」`);
  say(!!e2 && /tail 必须是有限数/.test(e2.message), 'tail: NaN → 同样抛');
  say(!!e3 && /tail 不能是负数/.test(e3.message), `tail: -0.5 → 抛「tail 不能是负数」（段不许比旁白本身短）`);
  say(!!e1 && /hook-1/.test(e1.message), '报错里带段用的 vo id（能定位到哪一句）');
}
{
  // dur 直接写 NaN / ±Inf 也必须抛（普通数字路径），不许把 NaN 段表交给下游
  let eN = null, eI = null, eOk = null;
  try { build(seq([cut(shot, { dur: NaN })]), {}); } catch (e) { eN = e; }
  try { build(seq([cut(shot, { dur: Infinity })]), {}); } catch (e) { eI = e; }
  let tl2 = null;
  try { tl2 = build(seq([cut(shot, { dur: 2 })]), {}); } catch (e) { eOk = e; }
  say(!!eN && /有限数/.test(eN.message), 'dur: NaN → 抛');
  say(!!eI && /有限数/.test(eI.message), 'dur: Infinity → 抛');
  say(!eOk && tl2 && tl2[0].end === 2, '正常数字 dur 不受影响（2s 照旧）');
}

console.log(`\n（TAIL 默认 = ${TAIL}s，与 docs/NARRATION.md §5.2 的「≥1.0s」一致）`);

console.log('\n⑥ 刚刚说完的那句（字幕不该在话音落下那一瞬消失）');
say(r.recent(1.0, 1.2) === null, 't=1.0（还没人说完）→ null');
say(r.recent(4.4, 1.2)?.id === 'hook-1', `t=4.4 刚说完 hook-1（括号里是 end=4.2）`);
say(r.recent(6.0, 1.2) === null, 't=6.0 已经超过 hold（4.2 + 1.2 = 5.4）→ null');
say(r.recent(4.4, 1.2)?.id === r.recent(4.4, 1.2)?.id, '同一 t 反复问结果一样');
say(empty.recent(1, 1) === null, '没配旁白时 recent 也安全');

console.log('\n⑦ 词级时间戳（C 档，喂 type.karaoke）');
const wspec = {
  lines: [
    // 只给 words、不给 start/dur —— 起点与时长应当由词级时间戳推出来
    { id: 'w1', text: '代码即素材', words: [
      { w: '代码', start: 2.0, end: 2.6 },
      { w: '即', start: 2.6, end: 2.8 },
      { w: '素材', start: 2.8, end: 3.6 },
    ] },
  ],
};
const wn = makeNarration(wspec, { duration: 10 });
say(wn.lines[0].start === 2.0, `start 由第一个词推出来（${wn.lines[0].start}）`);
say(Math.abs(wn.lines[0].dur - 1.6) < 1e-9, `dur 由词级时间戳推出来（${wn.lines[0].dur} = 3.6 − 2.0）`);
say(wn.lines[0].words.length === 3, `words 带到了行上（${wn.lines[0].words.length} 段）`);
say(wn.warnings.length === 0, `拼得上的表没有告警（${wn.warnings.length} 条）`);
const wr = makeNarrationReader(wn);
say(wr.at(2.7)?.words?.length === 3, 'at(t) 里也拿得到 words（场景直接喂给 type.karaoke）');
say(wr.line('w1')?.words?.length === 3, 'line(id).words 拿得到（字幕整行重画时用）');

const wbad = makeNarration({ lines: [
  { id: 'bad', text: '代码即素材', start: 0, dur: 2, words: [{ w: '代码即素', start: 0, end: 2 }] },
] });
say(wbad.warnings.some((w) => /拼起来不等于文本/.test(w)), '词级时间戳与文本对不上 → 必须告警（karaoke 位置会错）');
const wapprox = makeNarration({ lines: [
  { id: 'ap', text: '近似', words: [{ w: '近', start: 0, end: 0.2, approx: true }, { w: '似', start: 0.2, end: 0.4 }] },
] });
say(wapprox.lines[0].wordsApprox === true, '近似切分的表会被标成 wordsApprox（不许冒充真时间戳）');

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 全部通过：旁白表的派生量、体检、查询、定时长、词级时间戳都成立');
process.exit(fails ? 1 : 0);
