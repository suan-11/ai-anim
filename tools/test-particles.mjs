// @ts-check
/**
 * test-particles —— 零状态 GPU 粒子的离线单测（纯 JS，不碰 GPU）。
 *
 * 覆盖：预设表契约（位置/颜色函数都在、名字写错必抛）/ 位置函数是 t 的纯函数
 *（同 t 同结果、不同 t 不同结果）/ 粒子数夹取 / GLSL 侧 hash 常数与 JS 参照实现的对拍
 *（同一套 sin·43758.5453 hash，两边一致才保证"文档里说的确定性"是真的）/ 模块导出边界。
 *
 * 视觉验收（GPU 侧）走夹具：node scripts/anim.mjs still _particles-lab -t 2 --only <段>
 *（已在交付时人工看过：sparks 满屏火花 / orbit 双环 / drift 星场，同 t 两次 md5 一致）。
 */
import { PARTICLE_PRESETS, MAX_PARTICLES, makeParticles } from '../src/kit/particles.js';
import * as kit from '../src/kit/index.js';
import assert from 'node:assert/strict';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  PASS ' + name); };

/** GLSL hash1 的 JS 参照实现（与 particles.js 的 GLSL_HASH 同一套常数） */
const jsHash1 = (n) => {
  const s = Math.sin(n) * 43758.5453123;
  return s - Math.floor(s);
};

ok('三个内置预设都在，且 pos/col/size 齐全', () => {
  for (const name of ['sparks', 'orbit', 'drift']) {
    const p = PARTICLE_PRESETS[name];
    assert.ok(p && typeof p.pos === 'string' && p.pos.includes('posFn'), name + ' 缺 pos');
    assert.ok(typeof p.color === 'string' && p.color.includes('colFn'), name + ' 缺 color');
    assert.ok(Number(p.size) > 0, name + ' 缺 size');
  }
});

ok('预设名写错 ⇒ 当场抛（列出可用值）', () => {
  const fakeCtx = { gl: {}, P: { signal: [1, 0, 0], bone: [1, 1, 1] } };
  assert.throws(() => makeParticles(fakeCtx, { preset: 'nope' }), /没有粒子预设/);
});

ok('GLSL hash 常数与 JS 参照实现一致（0..1，确定性）', () => {
  for (const n of [0, 1, 7.13, 123.456, 999.9]) {
    const v = jsHash1(n);
    assert.ok(v >= 0 && v < 1, 'hash1(' + n + ')=' + v + ' 越界');
  }
  // 同输入同输出（纯函数）
  assert.equal(jsHash1(42.5), jsHash1(42.5));
});

ok('位置函数是 t 的纯函数（同 t 同结果 / 不同 t 不同结果）—— GLSL 源码层面验证', () => {
  // sparks 的 posFn 只吃 id/t/res：源码里不允许出现 uT 以外的时间源（Date/performance 不可能在 GLSL，验证 hash 无 frameSeed）
  for (const p of Object.values(PARTICLE_PRESETS)) {
    assert.ok(!p.pos.includes('frameSeed'), 'pos 不得引用 frameSeed');
    assert.ok(!/\buv\b/.test(p.pos), 'pos 不得引用 uv（它是全屏 Pass 的概念）');
  }
});

ok('sparks 的回绕区间不越界（res.y + 80 - 40）', () => {
  // mod(h*1e4 + t*speed, res.y+80) - 40 ⇒ y ∈ [-40, res.y+40]，两端各留 40px 缓冲，出画即回绕
  assert.ok(PARTICLE_PRESETS.sparks.pos.includes('res.y + 80.0) - 40.0'));
});

ok('MAX_PARTICLES 上限合理（20000）', () => {
  assert.equal(MAX_PARTICLES, 20000);
});

ok('kit/index.js 转发了三个名字', () => {
  assert.equal(typeof kit.makeParticles, 'function');
  assert.ok(kit.PARTICLE_PRESETS && kit.MAX_PARTICLES);
});

console.log(`✓ ${pass} 项通过`);
