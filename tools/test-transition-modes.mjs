#!/usr/bin/env node
// @ts-check
/**
 * **参数化转场**（`src/core/trans.js` + `src/core/transition-frag.js`）—— 离线单测。
 * 不需要 GPU / 浏览器 / Vite：
 *
 *   node tools/test-transition-modes.mjs
 *
 * 钉的是 BACKLOG **1-13**：`wipe` / `iris` / `glitch` / `pixel` / `dissolve` 五种新转场 +
 * 原有的 `push` / `mix` / `none`。这份单测证的四件事（都是我们自己能负责的）：
 *
 *   ① **模式表是唯一的真话**：`TRANSITION_MODES` 里的每个名字都有一支可用的 shader
 *      （或者明确不走 Pass），反过来 `TRANSITION_FRAG` 里也没有表外的孤儿；
 *   ② **写错当场抛**，而且报错里列出可用清单（静默回落成甩镜 = 画面照样出、check 照样绿）；
 *   ③ **`push` 的源码一个字符都没变** —— 已交付片子的画面一个像素都不许动；
 *   ④ 每支 shader 都遵守约定：共用那 6 个 uniform、`fragColor` 的 alpha 语义是"旧帧还剩多少"、
 *      并且**不重复声明** GLSL_COMMON 已经提供的东西（踩过：自写 `vnoise` ⇒ 编译失败）。
 *
 * 最后一段是接线自检：engine 真的读了 `item.transition`、kit 转发了两样东西、
 * 两份文档都点了名（判据对了但没接线，`tools/test-layout.mjs` 已经踩过一次）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TRANSITION_MODES, resolveTransitionMode, isPassTransition, transitionFadeAt, transitionPass,
} from '../src/core/trans.js';
import { TRANSITION_FRAG } from '../src/core/transition-frag.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** Pass 构造函数不碰 gl（program 到第一次 render 才编译），空对象就够。 */
const NO_GL = /** @type {any} */ ({});

let passed = 0;
const failed = [];
/** @param {string} name @param {() => void} fn */
function t(name, fn) {
  try { fn(); passed++; }
  catch (err) {
    failed.push('  x ' + name + '\n      '
      + String(err && err.message ? err.message : err).split('\n').join('\n      '));
  }
}

/* ═══════════════ 1. 模式表本身 ═══════════════ */

t('TRANSITION_MODES 覆盖 10 个模式（3 个老 + 6 个新 + relay），没有重复、都是非空字符串', () => {
  assert.ok(Array.isArray(TRANSITION_MODES));
  assert.equal(new Set(TRANSITION_MODES).size, TRANSITION_MODES.length, '有重复的模式名');
  for (const m of TRANSITION_MODES) {
    assert.equal(typeof m, 'string');
    assert.ok(m.length > 0);
  }
  const expected = ['carousel', 'dissolve', 'glitch', 'iris', 'mix', 'none', 'pixel', 'push', 'relay', 'shatter', 'spin', 'sweep', 'swirl', 'wipe'];
  assert.deepEqual([...TRANSITION_MODES].sort(), expected);
});

t('每个模式要么有一支 shader、要么明确不走 Pass —— 两边不许有孤儿', () => {
  for (const m of TRANSITION_MODES) {
    const hasFrag = Object.prototype.hasOwnProperty.call(TRANSITION_FRAG, m);
    const goesThroughPass = isPassTransition(m);
    assert.equal(hasFrag, goesThroughPass,
      `模式 ${m}：有 shader = ${hasFrag}，但 isPassTransition = ${goesThroughPass}（两张表不一致）`);
  }
  for (const m of Object.keys(TRANSITION_FRAG)) {
    assert.ok(TRANSITION_MODES.includes(m), `TRANSITION_FRAG 里有表外的孤儿 ${m}`);
  }
});

t('mix / none / relay 不走 Pass（各有各的实现：compositor.mixTo / 什么都不做 / engine 的 relay 分支）', () => {
  assert.equal(isPassTransition('mix'), false);
  assert.equal(isPassTransition('none'), false);
  assert.equal(isPassTransition('relay'), false);
  for (const m of ['push', 'wipe', 'iris', 'glitch', 'pixel', 'dissolve']) {
    assert.equal(isPassTransition(m), true, m + ' 应该走 Pass');
  }
});

/* ═══════════════ 2. 校验：写错就抛 ═══════════════ */

t('不写 transition ⇒ 解析成 push（老行为，且不抛）', () => {
  assert.equal(resolveTransitionMode(undefined), 'push');
  assert.equal(resolveTransitionMode(null), 'push');
});

t('写错模式名 ⇒ 抛，且报错里列出可用清单（不静默回落成甩镜）', () => {
  assert.throws(() => resolveTransitionMode('wipee'), (err) => {
    assert.ok(/没有转场模式/.test(err.message), '报错要说清是模式名错了');
    assert.ok(err.message.includes('wipee'), '报错要点名那个错的名字');
    for (const m of TRANSITION_MODES) {
      assert.ok(err.message.includes(m), `报错里缺可用值 ${m}`);
    }
    return true;
  });
});

t('非字符串 ⇒ 抛（类型错与拼写错分开说）', () => {
  assert.throws(() => resolveTransitionMode(42), /必须是字符串/);
  assert.throws(() => resolveTransitionMode({ mode: 'wipe' }), /必须是字符串/);
});

t('where 参数会出现在报错里（多段片子要能定位到是哪一段）', () => {
  assert.throws(() => resolveTransitionMode('nope', '段 hook 的 transition'),
    /段 hook 的 transition/);
});

/* ═══════════════ 3. fadeAt 默认值 ═══════════════ */

t('push 的默认 fadeAt 仍是 0.55 —— 老片子的画面一个像素都不许动', () => {
  assert.equal(transitionFadeAt('push'), 0.55);
  assert.equal(transitionFadeAt(undefined), 0.55);
});

t('掩码型转场（wipe/iris/glitch/pixel/dissolve）的 fadeAt 都在 [0.55, 1] 内', () => {
  for (const m of ['wipe', 'iris', 'glitch', 'pixel', 'dissolve']) {
    const v = transitionFadeAt(m);
    assert.ok(v >= 0.55 && v <= 1, `${m} 的 fadeAt = ${v} 越界（应该在 [0.55, 1]）`);
  }
});

/* ═══════════════ 4. 每支 shader 都守约定 ═══════════════ */

const UNIFORMS = ['under', 'k', 'dir', 'push', 'blur', 'fadeAt'];

t('每支 shader 都声明了同一组 uniform（引擎只换 mode，不换调用方式）', () => {
  for (const [m, src] of Object.entries(TRANSITION_FRAG)) {
    for (const u of UNIFORMS) {
      const re = new RegExp('uniform\\s+\\w+\\s+[^;]*\\b' + u + '\\b');
      assert.ok(re.test(src),
        `${m} 的 shader 里没有声明 uniform ${u} —— 引擎喂它的时候会静默保持 0`);
    }
  }
});

t('每支 shader 都写 fragColor（否则整帧是上一帧的内容，而且不报错）', () => {
  for (const [m, src] of Object.entries(TRANSITION_FRAG)) {
    assert.ok(/fragColor\s*=/.test(src), `${m} 的 shader 没写 fragColor`);
  }
});

t('没有 shader 重复声明 GLSL_COMMON 已提供的名字（踩过：自写 vnoise ⇒ 编译失败）', () => {
  const RESERVED = ['vnoise', 'fbm', 'hash12', 'hash22', 'sat', 'luma', 'aaFill', 'pxLine'];
  for (const [m, src] of Object.entries(TRANSITION_FRAG)) {
    for (const name of RESERVED) {
      const def = new RegExp('(^|\\n)\\s*(float|vec[234]|void)\\s+' + name + '\\s*\\(');
      assert.ok(!def.test(src),
        `${m} 的 shader 重复声明了 ${name}（GLSL_COMMON 已经有，编译会失败）`);
    }
  }
});

t('故障（glitch）与像素（pixel）里的随机量都由 t / 坐标决定 —— 没有帧号或墙钟', () => {
  for (const m of ['glitch', 'pixel']) {
    const src = TRANSITION_FRAG[m];
    assert.ok(!/\bidx\b|uSeed/.test(src), `${m} 用了帧号类的东西（任意 seek 会变样）`);
  }
});

/* ═══════════════ 5. transitionPass 的接线 ═══════════════ */

t('不传 mode ⇒ Pass 的 key 仍是 trans_push（缓存键不变 = 老片子不重编译）', () => {
  const p = transitionPass(NO_GL);
  assert.equal(p.key, 'trans_push');
  assert.equal(p.mode, 'push');
  assert.equal(p.u.fadeAt.value, 0.55);
});

t('传 mode ⇒ key 带上模式名（每种模式一支 Pass，共用会互相覆盖 uniform）', () => {
  for (const m of ['wipe', 'iris', 'glitch', 'pixel', 'dissolve']) {
    const p = transitionPass(NO_GL, { mode: m });
    assert.equal(p.key, 'trans_' + m);
    assert.equal(p.mode, m);
    assert.equal(p.u.fadeAt.value, transitionFadeAt(m));
  }
});

t('显式 fadeAt 仍然优先于模式默认值（作者的手写值不许被覆盖）', () => {
  const p = transitionPass(NO_GL, { mode: 'wipe', fadeAt: 0.33 });
  assert.equal(p.u.fadeAt.value, 0.33);
});

t('victimRatio 在任一模式下仍然生效（与 mode 正交，互不干扰）', () => {
  const p = transitionPass(NO_GL, { mode: 'iris', victimRatio: 0.45 });
  assert.equal(p.u.fadeAt.value, 0.45);
  assert.ok(p.collision);
  assert.equal(p.collision.clamped, false);
});

t('mode 写错 ⇒ 建 Pass 的时候就抛（不留到渲染时才怪）', () => {
  assert.throws(() => transitionPass(NO_GL, { mode: 'wipee' }), /没有转场模式/);
});

/* ═══════════════ 6. 接线自检 ═══════════════ */

const ENGINE = read('src/core/engine.js');
const KIT_WORLD = read('src/kit/world.js');
const KIT_INDEX = read('src/kit/index.js');
const TIMELINE = read('src/timeline.js');

t('engine.js 真的读了 item.transition，并把模式传给 _pushTransition', () => {
  assert.ok(/item\.transition\s*\?\?\s*item\._scene\?\.transition/.test(ENGINE),
    'engine 没读段上的 transition —— 配置档节点上写 transition 不会生效');
  assert.ok(/resolveTransitionMode\(/.test(ENGINE), 'engine 没有校验模式名（写错就静默了）');
  assert.ok(/_pushTransition\(outTex, under, tin, t, subDt, transMode\)/.test(ENGINE),
    '_pushTransition 没收到模式 —— 所有模式都会退化成甩镜');
});

t('engine 按模式缓存 Pass（每帧新建 Pass 会把编译时间乘进渲染时间）', () => {
  assert.ok(/this\._transPasses\s*\?\?=/.test(ENGINE), 'engine 没有按模式缓存 Pass');
});

t('kit 转发了模式表与校验函数（场景里想自己判断时不用 import core）', () => {
  assert.ok(/TRANSITION_MODES/.test(KIT_WORLD) && /resolveTransitionMode/.test(KIT_WORLD),
    'kit/world.js 没转发模式表');
  assert.ok(/TRANSITION_MODES/.test(KIT_INDEX), 'kit/index.js 没再导出 TRANSITION_MODES');
});

t('timeline 的 TIMELINE_KEYS 里仍有 transition（否则配置档会被当成模板参数抛出去）', () => {
  assert.ok(/\x27transition\x27/.test(TIMELINE), 'TIMELINE_KEYS 少了 transition');
});

t('regress-all 挂上了这条回归（加测试只改清单）', () => {
  assert.ok(/test-transition-modes\.mjs/.test(read('tools/regress-all.mjs')),
    'regress-all.mjs 里没有 test-transition-modes');
});

t('两份文档都点了名（AGENTS.md 的 transition 字段 + docs/MOTION.md）', () => {
  assert.ok(/wipe/.test(read('AGENTS.md')), 'AGENTS.md 里没提新的转场模式');
  assert.ok(/wipe|iris/.test(read('docs/MOTION.md')), 'docs/MOTION.md 里没提新的转场模式');
});

/* ═══════════════ 汇总 ═══════════════ */

if (failed.length) {
  console.log(`test-transition-modes: ${passed} 项通过，${failed.length} 项失败`);
  for (const f of failed) console.log(f);
  process.exit(1);
}
console.log(`test-transition-modes: ${passed} 项通过`);
