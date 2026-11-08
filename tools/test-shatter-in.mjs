import assert from 'node:assert/strict';
import { h2, fract, shatterPlan } from '../src/kit/shatter.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

t('fract 与 GLSL 一致（负数也落在 [0,1)）', () => {
  assert.equal(fract(1.25), 0.25);
  assert.equal(fract(-0.25), 0.75);
  assert.ok(fract(-1234.75) >= 0 && fract(-1234.75) < 1);
});

t('h2 只吃 (cx, cy, seed)，同输入同输出', () => {
  assert.deepEqual(h2(3, 4, 7), h2(3, 4, 7));
  assert.notDeepEqual(h2(3, 4, 7), h2(3, 4, 8));
  for (const v of h2(3, 4, 7)) assert.ok(v >= 0 && v < 1);
});

t('k 的方向：t=0 → 1，t=dur → 0，t>dur 仍是 0（不会变负）', () => {
  assert.equal(shatterPlan({ t: 0, dur: 2 }).k, 1);
  assert.equal(shatterPlan({ t: 2, dur: 2 }).k, 0);
  assert.equal(shatterPlan({ t: 9, dur: 2 }).k, 0);
});

t('片数与格点一一对应；fly/angle 随 k 收缩', () => {
  const a = shatterPlan({ seed: 3, shards: 4, t: 0, dur: 1, power: 1 });
  assert.equal(a.cells.length, 16);
  assert.deepEqual(a.cells[0].cell, [0, 0]);
  assert.deepEqual(a.cells[0].center, [0.125, 0.125]);
  const b = shatterPlan({ seed: 3, shards: 4, t: 1, dur: 1, power: 1 });
  assert.equal(b.k, 0);
  assert.deepEqual(b.cells[0].fly, [0, 0]);
  assert.equal(b.cells[0].angle, 0);
});

t('与 shader 同一条哈希：手算 (1,2) 的 h2 前 6 位小数', () => {
  const [a, b] = h2(1, 2, 7);
  const expectA = fract(Math.sin(1 * 127.1 + 2 * 311.7 + 7) * 43758.5453);
  const expectB = fract(Math.sin(1 * 269.5 + 2 * 183.3 + 7) * 43758.5453);
  assert.equal(a.toFixed(6), expectA.toFixed(6));
  assert.equal(b.toFixed(6), expectB.toFixed(6));
});

console.log('test-shatter-in: ' + n + ' 项通过');
