#!/usr/bin/env node
/**
 * tools/test-motion-persona.mjs —— 运动人格 + 缓动方向两个判据的离线回归（纯 JS）。
 *
 * 断言的是**判据本身**：该报的报、该豁免的豁免、**没声明时不假装通过**。
 */
import assert from 'node:assert/strict';
import { resolveMotion, overshootOf, easingRole, easingAllowed, PERSONA_NAMES } from '../src/kit/motion-persona.js';
import { scanProgSpans, scanEaseNames, scanSprings, inlineAllows } from './lint-motion-persona.mjs';
import { scanDirection } from './lint-easing-direction.mjs';

let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓ ' + m); };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); passed++; console.log('  ✓ ' + m); };

console.log('声明解析');
eq(resolveMotion({}), null, '没写 motion ⇒ null（判据该进 skipped，不是通过）');
ok(PERSONA_NAMES.length === 4, '四档人格：' + PERSONA_NAMES.join(' / '));
{
  const r = resolveMotion({ motion: { personality: 'premium', emotion: 'calm' } });
  ok(r && r.persona === 'premium', '解析出人格');
  ok(r.budgets.durations.standard[0] < r.budgets.durations.standard[1], '时长是**区间**而不是定值');
  ok(r.budgets.overshoot[1] <= 0.04, 'premium 的回弹上限 4%');
}
{
  const r = resolveMotion({ motion: { personality: 'premium', intensity: 0.5 } });
  ok(Math.abs(r.budgets.durations.standard[1] - 0.4) < 1e-6, 'intensity 0.5 把区间整体收一半');
}
let threw = null;
try { resolveMotion({ motion: { personality: 'cinematic' } }); } catch (e) { threw = e; }
ok(threw && /不认识/.test(threw.message), '未知人格当场抛（并列出可选值）');
threw = null;
try { resolveMotion({ motion: { personality: 'premium', intensity: 0 } }); } catch (e) { threw = e; }
ok(threw && /正数/.test(threw.message), 'intensity 非正数要抛');

console.log('回弹估算');
ok(overshootOf(90, 18) < 0.001, '默认 spring(90,18) 几乎不回弹（' + overshootOf(90, 18).toFixed(5) + '）');
ok(overshootOf(90, 40) === 0, '过阻尼 ⇒ 精确 0 回弹');
ok(overshootOf(120, 12) > 0.1, '欠阻尼 ⇒ 有回弹（' + overshootOf(120, 12).toFixed(3) + '）');
ok(overshootOf(120, 12) > overshootOf(120, 18), '阻尼越大回弹越小');

console.log('缓动分类');
eq(easingRole('outCubic'), 'entry', 'out* = 入场');
eq(easingRole('inQuad'), 'exit', 'in* = 出场');
eq(easingRole('inOutQuart'), 'onScreen', 'inOut* = 屏上');
eq(easingRole('linear'), 'loop', 'linear = 循环/匀速');
eq(easingRole('outCubicc'), 'entry', '拼错的名字按前缀归类（由 persona 判据单独点名）');
eq(easingRole('bouncy'), 'unknown', '完全认不出的 ⇒ unknown');
{
  const r = resolveMotion({ motion: { personality: 'corporate' } });
  ok(easingAllowed(r.budgets, 'outCubic'), 'corporate 允许 outCubic');
  ok(!easingAllowed(r.budgets, 'outElastic'), 'corporate 不允许 outElastic（回弹族）');
}

console.log('源码扫描');
eq(scanProgSpans("prog(t, 0.2, 0.7)"), [0.5], '字面量跨度 = b-a');
eq(scanProgSpans("prog(t, 0.2, Math.min(0.42, x))"), [], '有表达式就跳过（不猜）');
eq(scanEaseNames("prog(t, 0, 1, 'outCubic')"), ['outCubic'], 'prog 的缓动名');
eq(scanEaseNames("keys(t, [[0, 0], [1, 1, 'inOutQuart']])"), ['inOutQuart'], 'keys 表里的缓动名');
{
  const s = scanSprings('const a = spring(dt, 120, 12);');
  eq(s, [{ stiffness: 120, damping: 12 }], 'spring 的 stiffness/damping 字面量');
}
eq(inlineAllows('// motion:allow duration easing\nx();'), ['duration', 'easing'], '行内豁免');

console.log('缓动方向');
{
  const files = [{ file: 'a.js', src: 'const p = prog(t, 0, 1) * dx;' }];
  const { issues } = scanDirection(files);
  ok(issues.some((i) => i.rule === 'D1'), 'D1：位移配线性被抓');
}
{
  const files = [{ file: 'a.js', src: "const k = prog(f.lt, 0, 1, 'inCubic'); // tin" }];
  const { issues } = scanDirection(files);
  ok(issues.some((i) => i.rule === 'D2'), 'D2：入场用 ease-in 被抓');
}
{
  const files = [{ file: 'a.js', src: "const k = prog(f.tout, 0, 1, 'outCubic');" }];
  const { issues } = scanDirection(files);
  ok(issues.some((i) => i.rule === 'D3'), 'D3：出场用 ease-out 被抓');
}
{
  const files = [{ file: 'a.js', src: 'const p = prog(t, 0, 1) * dx;' }];
  eq(scanDirection(files, { exempt: ['easing'] }).issues.length, 0, 'motion.exempt 含 easing ⇒ 全跳过');
}
{
  const files = [{ file: 'a.js', src: 'const p = prog(t, 0, 1) * dx; // motion:allow easing' }];
  eq(scanDirection(files).issues.length, 0, '行内 // motion:allow easing 也跳过');
}
{
  const files = [{ file: 'a.js', src: "const k = prog(t, 0, 1, 'outCubic') * dx;" }];
  eq(scanDirection(files).issues.length, 0, '位移配 ease-out ⇒ 不报（方向对）');
}

console.log('\n✓ 运动人格 + 缓动方向：' + passed + ' 项通过');
