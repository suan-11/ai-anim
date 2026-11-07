#!/usr/bin/env node
/**
 * tools/test-motion-persona.mjs —— 运动人格 + 缓动方向两个判据的离线回归（纯 JS）。
 *
 * 断言的是**判据本身**：该报的报、该豁免的豁免、**没声明时不假装通过**。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMotion, overshootOf, easingRole, easingAllowed, PERSONA_NAMES } from '../src/kit/motion-persona.js';
import { scanProgSpans, scanEaseNames, scanSprings, inlineAllows } from './lint-motion-persona.mjs';
import { scanDirection } from './lint-easing-direction.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 跑一个判据 CLI，返回 { code, out } */
const run = (args) => {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
};

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
eq(easingRole('sine'), 'unknown', 'sine 不是引擎里的缓动名（ease 表没有它，写它会静默退化成 linear）');
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
eq(scanEaseNames("prog(t, 0, Math.min(0.42, x), 'outCubic')"), ['outCubic'], '嵌套括号里也取得到缓动名（第 4 参）');
eq(scanEaseNames("keys(t, [[0, 0], [1, 1, 'inOutQuart']])"), ['inOutQuart'], 'keys 表里的缓动名');
{
  // 引擎签名是 spring(elapsed, target = 1, stiffness = 90, damping = 18) —— 四参调用才是常态。
  const s = scanSprings('const a = spring(dt, 1, 140, 12);');
  eq(s, [{ stiffness: 140, damping: 12, target: 1, line: 1 }], '四参 spring：stiffness 取第 3 位、damping 第 4 位');
}
{
  const s = scanSprings('x = spring(t)');
  eq(s, [{ stiffness: 90, damping: 18, target: 1, line: 1 }], '省略后三参 ⇒ 引擎默认值 90 / 18');
}
{
  const s = scanSprings('x = spring(t, 1, k, d)');
  eq(s, [{ unjudged: true, line: 1 }], '参数是表达式 ⇒ 标成「判不了」，不拿默认值顶上去');
}
{
  // 回归：曾经把 spring(dt, 1, 140, 12) 读成 (1, 140)，ζ = 70 ⇒ 永远判 0 回弹。
  const bad = scanSprings('x = spring(dt, 1, 140, 12)')[0];
  ok(overshootOf(bad.stiffness, bad.damping) > 0.1, '真实调用 spring(dt, 1, 140, 12) 判得出回弹（' + (overshootOf(bad.stiffness, bad.damping) * 100).toFixed(1) + '%）');
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
{
  // 回归：正则版 /prog(([^)]*))/ 在第一个 ')' 处断掉 ⇒ 缓动名落空 ⇒ 误报 D1。
  const files = [{ file: 'a.js', src: "const k = prog(t, 0, Math.min(0.42, x), 'outCubic') * dx;" }];
  eq(scanDirection(files).issues.length, 0, '嵌套括号里写对了缓动名 ⇒ 不误报 D1');
}
{
  const files = [{ file: 'a.js', src: 'const k = prog(t, 0, Math.min(0.42, x), "outCubic") * dx;' }];
  eq(scanDirection(files).issues.length, 0, '双引号缓动名同样认');
}
{
  const files = [{ file: 'a.js', src: 'const k = prog(t, 0, Math.min(0.42, x)) * dx;' }];
  ok(scanDirection(files).issues.some((i) => i.rule === 'D1'), '嵌套括号里没给缓动名 ⇒ 照样抓 D1');
}

console.log('CLI 三档退出码（空 ≠ 干净）');
{
  // 没声明 motion ⇒ 2（没得判），不是 0
  const r = run(['tools/lint-motion-persona.mjs', 'demo']);
  ok(r.code === 2, '没声明 motion ⇒ 退出码 2（不是「通过」）');
}
{
  // 纯配置档任务：扫到的文件里 0 处 prog ⇒ 2，不是 0
  const r = run(['tools/lint-easing-direction.mjs', 'nuomi']);
  ok(r.code === 2 && /没得判/.test(r.out), '扫到文件但 0 处 prog ⇒ 退出码 2 + 明说「没得判」（不是 ✓）');
}
{
  const r = run(['tools/lint-easing-direction.mjs', 'nekohome-intro-ja']);
  ok(r.code === 0 && /✓/.test(r.out), '真有 prog 且方向都对 ⇒ 退出码 0 + ✓');
}
{
  const r = run(['tools/lint-motion-persona.mjs', '_persona-probe', '--strict']);
  ok(r.code === 1 && /回弹超过上限/.test(r.out), '夹具 _persona-probe：spring(1,140,12) 的 16% 回弹被 --strict 拦住（旧版恒判 0%）');
}
{
  const r = run(['tools/lint-motion-persona.mjs', '_persona-probe']);
  ok(r.code === 0 && /判不了/.test(r.out), '不写 --strict ⇒ 只报不拦（退出码 0），但「判不了」照样点名');
}
{
  const r = run(['tools/lint-concurrency.mjs', 'demo', '--cellz', '4']);
  ok(r.code === 2 && /认不出/.test(r.out), '写错选项名 ⇒ 退出码 2（不静默无效）');
}

console.log('\n✓ 运动人格 + 缓动方向：' + passed + ' 项通过');
