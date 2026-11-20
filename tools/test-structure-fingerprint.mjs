#!/usr/bin/env node
// @ts-check
import assert from 'node:assert/strict';
import { fingerprint, dimSimilarity, convergence, FINGERPRINT_DIMS } from '../scripts/lib/structure-fingerprint.mjs';
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓ ' + m); };
const seg = (dur, transition) => ({ dur, transition });
console.log('fingerprint');
{
  const fp = fingerprint([seg(4,'push'),seg(4,'push'),seg(4,'push'),seg(4,'push')]);
  ok(fp.segCount === 4 && fp.totalDur === 16, '段数/总时长');
  ok(fp.durCov === 0, '全等长 ⇒ CoV 0');
  ok(fp.durSpread === 1, '全等长 ⇒ 离散度 1');
  ok(Math.abs(fp.transDist.push - 1) < 1e-9, '转场分布归一');
}
{
  const fp = fingerprint([seg(2,'wipe'),seg(6,'push'),seg(4,'iris')]);
  ok(fp.durCov > 0.3, '长短不一 ⇒ CoV 高');
  ok(fp.durSpread === 3, 'max/min = 6/2 = 3');
}
console.log('dimSimilarity');
{
  const a = fingerprint([seg(4,'push'),seg(4,'push'),seg(4,'push'),seg(4,'push')]);
  const sims = dimSimilarity(a, a);
  ok(FINGERPRINT_DIMS.every((d) => sims[d]), '自己 vs 自己 全维同构');
}
{
  const a = fingerprint([seg(4,'push'),seg(4,'push'),seg(4,'push'),seg(4,'push')]);
  const b = fingerprint([seg(2,'wipe'),seg(8,'iris'),seg(3,'glitch'),seg(9,'pixel'),seg(5,'wipe'),seg(7,'iris')]);
  const sims = dimSimilarity(a, b);
  ok(!sims.durCov, 'CoV 差很多 ⇒ 不同构');
  ok(!sims.transDist, '转场分布差很多 ⇒ 不同构');
}
console.log('convergence');
{
  const cur = fingerprint([seg(4,'push'),seg(4,'push'),seg(4,'push'),seg(4,'push')]);
  const same = { name: 'old', fingerprint: fingerprint([seg(4,'push'),seg(4,'push'),seg(4,'push'),seg(4,'push')]) };
  const diff = { name: 'other', fingerprint: fingerprint([seg(2,'wipe'),seg(8,'iris'),seg(3,'glitch'),seg(9,'pixel'),seg(5,'wipe'),seg(7,'iris')]) };
  const r = convergence(cur, [same, diff]);
  ok(r.converged === true, '跟一支全同构 ⇒ 收敛');
  ok(r.matches[0].name === 'old' && r.matches[0].similarDims === 5, '命中那支 5 维');
  ok(!r.matches.some((m) => m.name === 'other'), '结构不同的不命中');
}
{
  const cur = fingerprint([seg(4,'push'),seg(4,'push'),seg(4,'push'),seg(4,'push')]);
  const r = convergence(cur, []);
  ok(r.converged === false, '没有历史 ⇒ 不收敛');
}
{
  const cur = fingerprint([seg(4,'push'),seg(4,'push'),seg(4,'push'),seg(4,'push')]);
  const near = { name: 'near', fingerprint: fingerprint([seg(4.2,'push'),seg(4.2,'push'),seg(4.2,'push')]) };
  const r = convergence(cur, [near], { minDims: 4 });
  ok(r.converged === true, '段数±1/时长接近/同转场 ⇒ ≥4 维同构判收敛');
}
{
  const cur = fingerprint([seg(26, 'push')]);
  const other = { name: 'another-single', fingerprint: fingerprint([seg(20, 'push')]) };
  const r = convergence(cur, [other]);
  ok(r.applicable === false && r.converged === false, '单段片指纹退化 ⇒ 明说不适用，不误报收敛');
}
console.log('\n✓ 结构反收敛判据：' + passed + ' 项通过');
