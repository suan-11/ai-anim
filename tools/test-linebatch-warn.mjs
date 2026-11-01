// @ts-check
/**
 * test-linebatch-warn —— D-1（flush 后画线要报）的离线单测。
 *
 * LineBatch 依赖 WebGL（构造里就 createBuffer），全对象单测不现实；
 * 这里测两条不碰 GL 也必须对的线：
 *   ① 源码契约：_push 有孤儿判定（drawing !== true 丢弃并计数）、flush 把计数交给 gl.paint、
 *      paint 形状有 orphanLines 槽、engine 把 orphanLines 转成 ctx.warnings；
 *   ② 语义对照：正确用法（begin→seg→flush）在旧版与新版的关键语句逐条还在（不许删）。
 * 端到端（真渲染出一个孤儿警告）由夹具跑 check 人工验证——正式夹具要写一个"故意错"的场景，
 * 会让 check 变红，不适合进常规回归。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const glSrc = readFileSync(path.join(ROOT, 'src/core/gl.js'), 'utf8');
const engSrc = readFileSync(path.join(ROOT, 'src/core/engine.js'), 'utf8');

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  PASS ' + name); };

ok('_push 在未 begin（drawing!==true）时丢弃并计数', () => {
  const m = glSrc.match(/_push\([\s\S]*?\n  \}/);
  assert.ok(m, '_push 方法没截出来');
  assert.ok(m[0].includes('this.drawing !== true'), '没有孤儿判定');
  assert.ok(m[0].includes('orphanCount'), '没有孤儿计数');
  // 计数后必须 return（不许把数据写进缓冲）
  const after = m[0].slice(m[0].indexOf('orphanCount'));
  assert.ok(/return this;/.test(after.slice(0, 200)), '计数后没有立刻 return');
});

ok('flush 把孤儿计数交给 gl.paint.orphanLines 并清零', () => {
  const m = glSrc.match(/flush\(target = null\) \{[\s\S]*?\n  \}/);
  assert.ok(m, 'flush 方法没截出来');
  assert.ok(m[0].includes('orphanLines'), '没有汇给 paint');
  assert.ok(m[0].includes('this.orphanCount = 0'), '没有清零');
});

ok('beginPaint 的 paint 形状有 orphanLines 槽', () => {
  assert.ok(glSrc.includes('orphanLines: 0'), 'paint 形状没有这个字段');
});

ok('正确用法的关键语句没被删（begin 置 true / flush 置 false）', () => {
  assert.ok(/begin\(\) \{[\s\S]*?this\.offset = 0; this\.drawing = true; return this;/.test(glSrc), 'begin 的 drawing=true 没了');
  assert.ok(/this\.drawing = false;/.test(glSrc), 'flush 的 drawing=false 没了');
});

ok('engine 把 orphanLines 转成 ctx.warnings（带去重）', () => {
  assert.ok(engSrc.includes('paint?.orphanLines'), 'engine 没读 orphanLines');
  assert.ok(engSrc.includes('ctx.warnings.includes(msg)'), '没有按帧去重');
  assert.ok(engSrc.includes('没进画面'), '警告文案没找到');
});

console.log(`✓ ${pass} 项通过`);
