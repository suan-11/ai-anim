#!/usr/bin/env node
// @ts-check
/**
 * tools/test-post-presets.mjs —— 「被拍摄感」预设（C3）离线回归。
 * 重点：零回归（不写 preset 原样返回）+ 覆盖优先级 + 写错当场抛。
 */
import assert from 'node:assert/strict';
import { POST_PRESETS, POST_PRESET_NAMES, resolvePostPreset, applyPostPreset } from '../src/core/post-presets.js';
import { DEFAULT_POST } from '../src/core/post.js';

let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓ ' + m); };

// 预设表本身
ok(POST_PRESET_NAMES.length === 3 && ['filmed', 'filmed-doc', 'filmed-super8'].every((n) => POST_PRESETS[n]), '三个预设 filmed / filmed-doc / filmed-super8');
const VALID = new Set(Object.keys(DEFAULT_POST));
for (const n of POST_PRESET_NAMES) {
  ok(Object.keys(POST_PRESETS[n]).every((k) => VALID.has(k)), n + ' 只组合现有 post 参数（不新增字段）');
}
// resolvePostPreset：写错当场抛并列清单
ok(resolvePostPreset('filmed').grain === POST_PRESETS.filmed.grain, 'resolvePostPreset 返回该预设参数');
let threw = '';
try { resolvePostPreset('nope'); } catch (e) { threw = String(e.message); }
ok(threw.includes('nope') && threw.includes('filmed'), '未知预设名抛错并列出可用清单');

// 零回归：不写 preset，base 原样（仅去掉 preset 键）
{
  // base 已是引擎合并好的结果（含场景 return 的 bloom）；applyPostPreset 只负责 preset 层
  const base = { ...DEFAULT_POST, grain: 0.035, bloom: 0.4 };
  const out = applyPostPreset(base, { ov: { bloom: 0.4 }, itemPost: null, stylePost: null });
  ok(out.grain === 0.035 && out.bloom === 0.4, '不写 preset ⇒ 参数不变（零回归）');
  ok(!('preset' in out), 'preset 键被剥掉（不是后处理参数）');
}
// preset 盖过 base
{
  const base = { ...DEFAULT_POST };
  const out = applyPostPreset(base, { ov: { preset: 'filmed' } });
  ok(out.grain === POST_PRESETS.filmed.grain && out.weave === POST_PRESETS.filmed.weave, 'preset 覆盖 base 的 grain/weave');
}
// 场景 return 显式字段盖过 preset
{
  const base = { ...DEFAULT_POST };
  const out = applyPostPreset(base, { ov: { preset: 'filmed', grain: 0.2 } });
  ok(out.grain === 0.2, '场景 return 显式 grain 盖过 preset');
  ok(out.weave === POST_PRESETS.filmed.weave, '其余字段仍用 preset');
}
// preset 名优先级：场景 return > 时间线 post > 风格包
{
  const base = { ...DEFAULT_POST };
  const out = applyPostPreset(base, { ov: { preset: 'filmed-doc' }, itemPost: { preset: 'filmed-super8' }, stylePost: { preset: 'filmed' } });
  ok(out.grain === POST_PRESETS['filmed-doc'].grain, '场景 return 的 preset 名优先');
  const out2 = applyPostPreset(base, { ov: null, itemPost: { preset: 'filmed-super8' }, stylePost: { preset: 'filmed' } });
  ok(out2.grain === POST_PRESETS['filmed-super8'].grain, '无场景 return 时时间线 post 优先于风格包');
  const out3 = applyPostPreset(base, { ov: null, itemPost: null, stylePost: { preset: 'filmed' } });
  ok(out3.grain === POST_PRESETS.filmed.grain, '风格包 post.preset 也能生效');
}

console.log('\n✓ post 预设：' + passed + ' 项通过');
