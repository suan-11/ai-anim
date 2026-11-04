#!/usr/bin/env node
/**
 * tools/test-anti-ppt.mjs —— 反 PPT 判据的离线回归（纯 JS）。
 *
 * 断言的是**判据本身**：好的段表必须过、坏的必须被抓（包括「只动透明度」这种最容易被放过的）。
 */
import assert from 'node:assert/strict';
import { analyzeSegments, SOFT_TOKENS, HARD_TOKENS } from './lint-anti-ppt.mjs';

let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓ ' + m); };
const notOk = (c, m) => { assert.ok(!c, m); passed++; console.log('  ✓ ' + m); };

const good = [
  { id: 'title', start: 0, end: 4, state: { from: ['empty'], to: ['title'], diff: ['visibility', 'light'] }, relayTo: 'baseline' },
  { id: 'chart', start: 4, end: 9, state: { from: ['baseline'], to: ['bars'], diff: ['shape', 'text'] }, relayTo: 'pen' },
  { id: 'kinetic', start: 9, end: 12, state: { from: ['pen'], to: ['headline'], diff: ['text', 'material'] }, relayTo: 'line' },
  { id: 'whip', start: 12, end: 13.1, overlap: 0.45, handlesTransition: true, state: { from: ['line'], to: ['empty'], diff: ['position', 'space'] }, relayTo: 'sig' },
  { id: 'outro', start: 13.1, end: 16, state: { from: ['sig'], to: ['sig'], diff: ['light'] } },
];
const run = (segs, opts) => analyzeSegments(segs, opts);

console.log('好的段表');
{
  const r = run(good);
  notOk(r.problems.length, '全绿：' + (r.problems.join(' ／ ') || '没有问题'));
}

console.log('C1 状态差');
{
  const bad = good.map((s) => ({ ...s, state: { ...s.state, diff: ['opacity', 'scale'] } }));
  const r = run(bad);
  ok(r.problems.some((p) => p.includes('透明度') || p.includes('状态差不成立')), '只动透明度/缩放 ⇒ 抓出来');
  ok(SOFT_TOKENS.has('opacity') && SOFT_TOKENS.has('scale'), 'opacity/scale 在软集合里');
  ok(HARD_TOKENS.has('light') && HARD_TOKENS.has('material'), 'light/material 在硬集合里');
}
{
  const r = run(good.map((s) => ({ ...s, state: undefined })));
  ok(r.problems.some((p) => p.includes('状态差声明率')), '整条都没声明 ⇒ 报声明率');
}

console.log('C2 接力物');
{
  const r = run(good.map((s) => ({ ...s, relayTo: null })));
  ok(r.problems.some((p) => p.includes('接力物断了')), '连续 3 段以上没有 relayTo ⇒ 失败');
}
{
  const mixed = good.map((s, i) => ({ ...s, relayTo: i % 3 === 0 ? 'x' : null }));
  const r = run(mixed);
  ok(!r.problems.some((p) => p.includes('接力物断了')), '隔一段有 relayTo ⇒ 不算断链');
}

console.log('C3 转场');
{
  const r = run(good.map((s, i) => (i === 1 ? { ...s, transition: 'mix' } : s)));
  ok(r.problems.some((p) => p.includes('淡出')), 'transition: mix ⇒ 透明度淡出，失败');
  const r2 = run(good.map((s, i) => (i === 1 ? { ...s, overlap: 0.5, handlesTransition: false } : s)));
  ok(r2.problems.some((p) => p.includes('没声明 handlesTransition')), '有 overlap 没声明 handlesTransition ⇒ 失败');
}

console.log('C4 节奏 / C5 钩子');
{
  const flat = good.map((s) => ({ ...s, end: s.start + 4 }));
  const r = run(flat);
  ok(r.problems.some((p) => p.includes('时长太均匀')), '四秒一段到底 ⇒ CoV 太低被抓');
  const noHook = good.map((s) => ({ ...s, state: { ...s.state, diff: ['visibility'] } }));
  const r2 = run(noHook);
  ok(r2.problems.some((p) => p.includes('钩子')), '没有冲击段/光照变化/特殊转场 ⇒ 钩子不足');
}

console.log('歌词片豁免');
{
  const lyric = [
    { id: 'k1', start: 0, end: 3, params: { mode: 'mask' }, state: { diff: ['text'] } },
    { id: 'k2', start: 3, end: 6, params: { mode: 'karaoke' }, state: { diff: ['text'] } },
    { id: 'k3', start: 6, end: 9, params: { mode: 'karaoke' }, state: { diff: ['text'] } },
    { id: 'k4', start: 9, end: 12, params: { mode: 'glitch' }, state: { diff: ['text', 'material'] } },
  ];
  const r = run(lyric);
  ok(!r.problems.some((p) => p.includes('时长太均匀') || p.includes('钩子')), '过半段带 params.mode ⇒ 节奏/钩子不 gate（拍子由歌决定）');
}

console.log('\n✓ 反 PPT 判据：' + passed + ' 项通过');
