#!/usr/bin/env node
// @ts-check
/**
 * **相机接力（relay，BACKLOG 1-12）**—— 离线单测（纯 Node，零 GPU / 零浏览器）：
 *
 *   node tools/test-relay.mjs
 *
 * 风格照抄 tools/test-cam-math.mjs —— 摄影机是纯函数，一切可离线断言。钉的是：
 *   ① poseFromCamera3 / poseToCamera3 互逆（roundtrip ≤ 1e-9，pitch 顶格除外）
 *   ② blendPose：端点恒等 / look 直线 / dist 与 tan(fov/2) 几何插值 / yaw 最短路径 + 恒定角速度
 *   ③ e 非有限当场抛（NaN 相机 = 整屏白，AGENTS.md §5.5 的老教训）
 *   ④ relayHandover 边界与单调；MOVES 两条曲线；resolveRelayMove 未知名抛错
 *   ⑤ trans.js 的 'relay' 在表里、写错照抛、不进 _pushTransition（防御抛错）
 *   ⑥ timeline 的 transitionOpts 两种写法（cut / 配置档）build 后落到段上
 *   ⑦ relayPose 是 t 的纯函数（不同 t 允许不同值）+ 引擎探针不缓存（静态断言）
 *   ⑧ openFrame 的 relay 跳过 / makeThreeShot 的 drive / kit 再导出（静态断言）
 *   ⑨ relay.js 零 GPU / 零 ctx / 无随机无时钟（确定性铁律，静态断言）
 */
import { strict as A } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  poseFromCamera3, poseToCamera3, blendPose, relayHandover,
  HANDOVER_GLIDE, MOVES, resolveRelayMove, relayPose3,
} from '../src/kit/index.js';
import { TRANSITION_MODES, resolveTransitionMode, isPassTransition } from '../src/core/trans.js';
import { Engine } from '../src/core/engine.js';
import { build, cut, seq } from '../src/timeline.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const RELAY_SRC = read('src/core/relay.js');
const ENGINE = read('src/core/engine.js');
const WORLD = read('src/kit/world.js');
const THREE = read('src/kit/three.js');
const KIT_INDEX = read('src/kit/index.js');
const DEG = Math.PI / 180;

let n = 0;
const failed = [];
function ok(name, fn) {
  try { fn(); n++; console.log('  ✓ ' + name); }
  catch (err) {
    failed.push(name);
    console.log('  ✗ ' + name);
    console.log('      ' + String(err && err.message ? err.message : err).split('\n').join('\n      '));
  }
}
function near(a, b, eps, what) {
  A.ok(Math.abs(a - b) <= eps, what + ': 期望 ' + b + ' ± ' + eps + '，实际 ' + a);
}

console.log('相机接力（relay）数学与接线单测');

/* ══════════════ ① 位姿换算与 roundtrip ══════════════ */

ok('poseFromCamera3 手算例①：pos[0,0,-5]→target[3,4,-5]：dist=5 / pitch=asin(0.8) / yaw=90°', () => {
  const p = poseFromCamera3({ pos: [0, 0, -5], target: [3, 4, -5] });
  near(p.dist, 5, 1e-12, 'dist');
  near(p.pitch, Math.asin(0.8) / DEG, 1e-9, 'pitch（asin(0.8) 转度）');
  near(p.yaw, 90, 1e-9, 'yaw（朝 +x）');
  near(p.look[0], 3, 1e-12, 'look.x');
  near(p.look[1], 4, 1e-12, 'look.y');
  near(p.look[2], -5, 1e-12, 'look.z');
  near(p.fov, 34, 1e-12, 'fov 缺省 34（与 camera3 一致）');
  near(p.roll, 0, 1e-12, 'roll 缺省 0');
});

ok('poseFromCamera3 手算例②：pos[5,0,0]→原点：yaw=-90° / pitch=0 / fov·roll 原样带走', () => {
  const p = poseFromCamera3({ pos: [5, 0, 0], target: [0, 0, 0], fov: 50, roll: 0.03 });
  near(p.yaw, -90, 1e-9, 'yaw（朝 -x）');
  near(p.pitch, 0, 1e-12, 'pitch');
  near(p.dist, 5, 1e-12, 'dist');
  near(p.fov, 50, 1e-12, 'fov 原样');
  near(p.roll, 0.03, 1e-12, 'roll 原样（弧度不换算）');
});

ok('roundtrip（5 组机位，含 pitch ≈ 89.4° 的大角度）：误差 ≤ 1e-9', () => {
  const cases = [
    { pos: [0, 0, -5], target: [0, 0, 0], fov: 40, roll: 0 },
    { pos: [4, 3, 6], target: [0, 0.9, 0], fov: 38, roll: -0.05 },
    { pos: [-10, 2, -30], target: [5, -3, 12], fov: 60, roll: 0.4 },
    { pos: [0, 0, -1], target: [0, 100, 0], fov: 34, roll: 0 },   // pitch ≈ 89.4°，未顶格
    { pos: [1, -7, 2], target: [1, 3, 2], fov: 24, roll: 3.1 },   // 近正上方 + 大 roll
  ];
  for (const [i, c] of cases.entries()) {
    const fwd = poseFromCamera3(c);
    const back = poseFromCamera3(poseToCamera3(fwd));
    for (let a = 0; a < 3; a++) near(back.look[a], fwd.look[a], 1e-9, 'case ' + i + ' look[' + a + ']');
    near(back.dist, fwd.dist, 1e-9, 'case ' + i + ' dist');
    near(back.yaw, fwd.yaw, 1e-9, 'case ' + i + ' yaw');
    near(back.pitch, fwd.pitch, 1e-9, 'case ' + i + ' pitch');
    near(back.fov, fwd.fov, 1e-9, 'case ' + i + ' fov');
    near(back.roll, fwd.roll, 1e-9, 'case ' + i + ' roll');
  }
});

ok('pitch 顶格（±90° 机位）被夹到 ±89.9°：不产出退化的基', () => {
  near(poseFromCamera3({ pos: [0, 0, 0], target: [0, 10, 0] }).pitch, 89.9, 1e-9, '正上方 → 89.9');
  near(poseFromCamera3({ pos: [0, 0, 0], target: [0, -10, 0] }).pitch, -89.9, 1e-9, '正下方 → -89.9');
});

ok('pos 与 target 重合 ⇒ 抛（没有朝向可言）', () => {
  A.throws(() => poseFromCamera3({ pos: [1, 1, 1], target: [1, 1, 1] }), /重合/);
});

/* ══════════════ ② blendPose ══════════════ */

const mk = (look, dist, yaw, pitch, fov, roll) => ({ look, dist, yaw, pitch, fov, roll });
const A0 = mk([0, 0, 0], 1, 170, -10, 30, 0.1);
const B0 = mk([10, 4, -6], 4, -170, 20, 60, -0.2);

ok('e=0 恒等 A、e=1 恒等 B（六个字段逐位）', () => {
  const z = blendPose(A0, B0, 0), o = blendPose(A0, B0, 1);
  for (let i = 0; i < 3; i++) { near(z.look[i], A0.look[i], 1e-12, 'e=0 look[' + i + ']'); near(o.look[i], B0.look[i], 1e-12, 'e=1 look[' + i + ']'); }
  near(z.dist, A0.dist, 1e-12, 'e=0 dist'); near(z.yaw, A0.yaw, 1e-12, 'e=0 yaw');
  near(z.pitch, A0.pitch, 1e-12, 'e=0 pitch'); near(z.fov, A0.fov, 1e-12, 'e=0 fov'); near(z.roll, A0.roll, 1e-12, 'e=0 roll');
  near(o.dist, B0.dist, 1e-12, 'e=1 dist'); near(o.yaw, B0.yaw, 1e-12, 'e=1 yaw');
  near(o.pitch, B0.pitch, 1e-12, 'e=1 pitch'); near(o.fov, B0.fov, 1e-12, 'e=1 fov'); near(o.roll, B0.roll, 1e-12, 'e=1 roll');
});

ok('look 三轴线性 lerp', () => {
  const m = blendPose(A0, B0, 0.25);
  for (let i = 0; i < 3; i++) near(m.look[i], A0.look[i] + (B0.look[i] - A0.look[i]) * 0.25, 1e-12, 'look[' + i + ']');
});

ok('dist 几何插值：1→4 的中点是 2，不是 2.5', () => {
  const a = mk([0, 0, 0], 1, 0, 0, 34, 0), b = mk([0, 0, 0], 4, 0, 0, 34, 0);
  near(blendPose(a, b, 0.5).dist, 2, 1e-12, '中点');
  near(blendPose(a, b, 0.25).dist, 4 ** 0.25, 1e-12, 'e=0.25 → 4^(1/4)');
});

ok('tan(fov/2) 几何插值：fov 30→60 的中点 = 2·atan(√(tan15°·tan30°))，不是线性中点 45', () => {
  const m = blendPose(mk([0, 0, 0], 5, 0, 0, 30, 0), mk([0, 0, 0], 5, 0, 0, 60, 0), 0.5);
  near(m.fov, 2 * Math.atan(Math.sqrt(Math.tan(15 * DEG) * Math.tan(30 * DEG))) / DEG, 1e-9, 'fov 中点');
  A.ok(m.fov < 45 && m.fov > 30, '落在 30 与 45 之间（不是 45）');
});

ok('yaw 最短路径：170→-170 的中点是 180° 附近，不是 0°', () => {
  near(blendPose(mk([0, 0, 0], 3, 170, 0, 34, 0), mk([0, 0, 0], 3, -170, 0, 34, 0), 0.5).yaw, 180, 1e-9, '中点 180°');
  const rev = blendPose(mk([0, 0, 0], 3, -170, 0, 34, 0), mk([0, 0, 0], 3, 170, 0, 34, 0), 0.5).yaw;
  near(rev, -180, 1e-9, '反方向中点 -180°');
  A.ok(Math.abs(rev) > 90, '不在 0° 附近（那条是长路）');
});

ok('blendPose 角速度恒定：yaw 对 e 线性（170→-170 斜率 = +20°/单位 e）', () => {
  const blend = (e) => blendPose(mk([0, 0, 0], 3, 170, 0, 34, 0), mk([0, 0, 0], 3, -170, 0, 34, 0), e).yaw;
  for (const e of [0, 0.1, 0.25, 0.5, 0.75, 0.9]) near(blend(e), 170 + 20 * e, 1e-9, 'yaw(' + e + ')');
  near((blend(0.75) - blend(0.25)) / 0.5, 20, 1e-9, '任意区间斜率一致');
  // e=1 端点恒等（等价角 190° ≡ −170°，数值上精确取 b.yaw —— blendPose 的端点特判）
  near(blend(1), -170, 1e-12, 'e=1 端点恒等');
  // 与 e→1 的连续性（模 360）：blend(0.9) 再走 0.1 的 20°/单位 = 190° ≡ −170°
  const d = (((blend(1) - (blend(0.9) + 2)) % 360) + 540) % 360 - 180;
  near(d, 0, 1e-9, 'e→1 连续（模 360 等价角）');
});

ok('pitch / roll 线性', () => {
  const m = blendPose(A0, B0, 0.3);
  near(m.pitch, A0.pitch + (B0.pitch - A0.pitch) * 0.3, 1e-12, 'pitch');
  near(m.roll, A0.roll + (B0.roll - A0.roll) * 0.3, 1e-12, 'roll');
});

ok('e 越界 sat 到 [0,1]：-0.5 ⇒ A、1.5 ⇒ B', () => {
  near(blendPose(A0, B0, -0.5).dist, A0.dist, 1e-12, 'e<0 夹到 A');
  near(blendPose(A0, B0, 1.5).dist, B0.dist, 1e-12, 'e>1 夹到 B');
});

ok('e 非有限当场抛（NaN / ±Inf / undefined / null / 字符串），报出收到的值', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, '0.5']) {
    A.throws(() => blendPose(A0, B0, bad), (err) => {
      A.ok(err instanceof TypeError, '是 TypeError');
      A.ok(String(err.message).includes(String(bad)), '报错里带收到的值 ' + bad);
      return true;
    }, 'e=' + String(bad) + ' 应当抛');
  }
});

/* ══════════════ ③ 换手窗与运动曲线 ══════════════ */

ok('HANDOVER_GLIDE = [0.35, 0.65]；边界外恒 0 / 1，窗中点 = 0.5', () => {
  A.deepEqual([...HANDOVER_GLIDE], [0.35, 0.65]);
  near(relayHandover(0), 0, 0, 'k=0');
  near(relayHandover(0.3), 0, 1e-12, 'k<w0');
  near(relayHandover(0.35), 0, 1e-12, 'k=w0');
  near(relayHandover(0.5), 0.5, 1e-12, '窗中点');
  near(relayHandover(0.65), 1, 1e-12, 'k=w1');
  near(relayHandover(0.8), 1, 1e-12, 'k>w1');
  near(relayHandover(1), 1, 0, 'k=1');
});

ok('relayHandover 单调不减，且是 smoothstep（x²(3-2x)）', () => {
  let prev = -1;
  for (let k = 0; k <= 1.0001; k += 0.01) {
    const v = relayHandover(k);
    A.ok(v >= prev - 1e-12, 'k=' + k.toFixed(2) + ' 单调');
    prev = v;
  }
  for (const k of [0.4, 0.45, 0.55, 0.6]) {
    const x = (k - 0.35) / 0.3;
    near(relayHandover(k), x * x * (3 - 2 * x), 1e-12, 'k=' + k);
  }
});

ok('relayHandover 自定义窗生效（[0.2, 0.8]）', () => {
  near(relayHandover(0.5, [0.2, 0.8]), 0.5, 1e-12, '中点');
  near(relayHandover(0.15, [0.2, 0.8]), 0, 1e-12, '窗前');
  near(relayHandover(0.85, [0.2, 0.8]), 1, 1e-12, '窗后');
});

ok('MOVES.glide：端点 0/1、中点 0.5、单调、对称（inOutSine 解析式）', () => {
  near(MOVES.glide(0), 0, 1e-12, 'glide(0)');
  near(MOVES.glide(0.5), 0.5, 1e-12, 'glide(0.5)');
  near(MOVES.glide(1), 1, 1e-12, 'glide(1)');
  let prev = -1;
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const v = MOVES.glide(p);
    A.ok(v >= prev - 1e-12, 'glide(' + p.toFixed(2) + ') 单调');
    prev = v;
  }
  near(MOVES.glide(0.3), 1 - MOVES.glide(0.7), 1e-12, '对称（glide(1-x) = 1 − glide(x)）');
});

ok('MOVES.whip：端点 0/1、0.5 处 = 0.5^2.4、越界 sat', () => {
  near(MOVES.whip(0), 0, 1e-12, 'whip(0)');
  near(MOVES.whip(0.5), 0.5 ** 2.4, 1e-12, 'whip(0.5)');
  near(MOVES.whip(1), 1, 1e-12, 'whip(1)');
  near(MOVES.whip(-3), 0, 1e-12, '负值夹 0');
  near(MOVES.whip(7), 1, 1e-12, '>1 夹 1');
});

ok('resolveRelayMove：缺省 = glide、合法名返回曲线、未知名/非字符串抛并列清单', () => {
  A.equal(resolveRelayMove(undefined), MOVES.glide, 'undefined → glide');
  A.equal(resolveRelayMove(null), MOVES.glide, 'null → glide');
  A.equal(resolveRelayMove('whip'), MOVES.whip);
  A.throws(() => resolveRelayMove('glid'), (err) => {
    A.ok(/没有接力运动曲线/.test(err.message), '报错说清是曲线名错了');
    A.ok(err.message.includes('glid'), '报错点名错名');
    A.ok(err.message.includes('glide') && err.message.includes('whip'), '报错列出可用值');
    return true;
  });
  A.throws(() => resolveRelayMove(42), /接力运动曲线/);
});

/* ══════════════ ④ trans.js 的 'relay' ══════════════ */

ok("TRANSITION_MODES 里有 'relay'（11 个）；isPassTransition('relay') === false（无 shader）", () => {
  A.ok(TRANSITION_MODES.includes('relay'), '表里有 relay');
  A.equal(TRANSITION_MODES.length, 11, '一共 11 个模式');
  A.equal(isPassTransition('relay'), false, 'relay 不走 transitionPass');
});

ok("transition 写错照抛，报错清单自动带上 'relay'", () => {
  A.throws(() => resolveTransitionMode('wipee'), (err) => {
    A.ok(err.message.includes('relay'), '可用清单里有 relay');
    return true;
  });
});

ok("'relay' 不会进 _pushTransition：防御性抛错（真调 Engine 的方法验证）", () => {
  A.throws(
    () => Engine.prototype._pushTransition.call({ gl: null }, null, null, 0.5, 0, 1 / 60, 'relay'),
    /relay/,
    'mode=relay 走到 _pushTransition 必须抛',
  );
  A.ok(/_pushTransition\(outTex, under, k, t, dt, mode = 'push'\) \{[\s\S]{0,400}?mode === 'relay'/s.test(ENGINE),
    '_pushTransition 的 relay 防御在方法开头（碰 this.gl 之前）');
  A.ok(/let relayed = false;[\s\S]*?relayed = true;[\s\S]*?if \(!relayed && k > 0 && !scene\.handlesTransition && under\)/s.test(ENGINE),
    'relay 换手分支在 push/mix guard 之前（独立分支）');
});

/* ══════════════ ⑤ timeline 的 transitionOpts 接线 ══════════════ */

ok("cut() 写法：{ transition: 'relay', transitionOpts } 经 build 落到段对象", () => {
  const sceneA = { id: 'relay_a', render() {} };
  const sceneB = { id: 'relay_b', render() {} };
  const items = build(seq([
    cut(sceneA, { dur: 4 }),
    cut(sceneB, { dur: 6, overlap: 0.6, transition: 'relay', transitionOpts: { move: 'whip' } }),
  ]));
  A.equal(items[1].transition, 'relay');
  A.deepEqual(items[1].transitionOpts, { move: 'whip' });
});

ok("配置档节点写法：{ type, transition: 'relay', transitionOpts } 一样落位（不被当模板参数抛）", () => {
  const items = build([
    { type: 'outro', dur: 2, transition: 'relay', transitionOpts: { move: 'glide', handover: [0.2, 0.8] } },
  ]);
  A.equal(items[0].transition, 'relay');
  A.deepEqual(items[0].transitionOpts, { move: 'glide', handover: [0.2, 0.8] });
  A.equal(typeof items[0].scene?.render, 'function', '展开出的场景还在');
});

ok('没写 transitionOpts 时段上是 undefined（engine 侧走默认 glide / HANDOVER_GLIDE）', () => {
  const sceneA = { id: 'ra', render() {} };
  const sceneB = { id: 'rb', render() {} };
  const items = build(seq([cut(sceneA, { dur: 2 }), cut(sceneB, { dur: 2, overlap: 0.5, transition: 'relay' })]));
  A.equal(items[1].transitionOpts, undefined);
});

/* ══════════════ ⑥ 探针协议：relayPose 是 t 的纯函数 + 引擎不缓存 ══════════════ */

ok('relayPose 纯函数语义：同一个场景对象，t=10 与 t=11 允许返回不同位姿', () => {
  const scene = {
    id: 'drift',
    // 夹具式写法：位姿随 t 漂移（确定性 —— 只吃 t）
    relayPose(ctx) { return { pos: [ctx.f.t * 2, 0, -5], target: [0, 0, 0], fov: 34 }; },
  };
  const p10 = scene.relayPose({ f: { t: 10 } });
  const p11 = scene.relayPose({ f: { t: 11 } });
  A.notEqual(p10.pos[0], p11.pos[0], '不同 t 的位姿不同（动态飞行）');
  A.deepEqual(scene.relayPose({ f: { t: 10 } }), p10, '同一 t 逐位相同（纯函数）');
});

ok('engine._probeRelayPose：探针 ctx 形状正确（f.t/lt/p/idx、W/H/P/params）且结果随 t 变', () => {
  const seen = [];
  const scene = {
    relayPose(ctx) { seen.push(ctx); return { pos: [ctx.f.t, 0, -5], target: [0, 0, 0] }; },
  };
  const fake = { gl: { w: 1920, h: 1080 }, P: { ink: [0, 0, 0] } };
  const item = { id: 'x', start: 10, end: 14, params: { variant: 'grid' }, _scene: scene };
  const p1 = Engine.prototype._probeRelayPose.call(fake, item, 11, 660);
  const p2 = Engine.prototype._probeRelayPose.call(fake, item, 12, 720);
  A.deepEqual(seen[0].f, { t: 11, lt: 1, p: 0.25, idx: 660 }, '探针 ctx.f 的形状与值');
  A.equal(seen[0].W, 1920);
  A.equal(seen[0].H, 1080);
  A.equal(seen[0].P, fake.P);
  A.deepEqual(seen[0].params, { variant: 'grid' });
  A.equal(p1.pos[0], 11, '第一次探针用 t=11');
  A.equal(p2.pos[0], 12, '第二次探针用新 t（现探现算）');
  A.equal(Engine.prototype._probeRelayPose.call(fake, { id: 'y', _scene: {} }, 0, 0), null, '没有 relayPose 的段返回 null');
});

ok('引擎探针无记忆化（静态）：composite 里现探现算，relay.js 无缓存表', () => {
  A.ok(/this\._probeRelayPose\(prev, t, idx\)/.test(ENGINE), 'A 侧探针带当前 t');
  A.ok(/this\._probeRelayPose\(item, t, idx\)/.test(ENGINE), 'B 侧探针带当前 t');
  A.ok(!/_relayMemo|relayPoseCache|_probeCache/.test(ENGINE), 'engine 没有 relay 探针缓存表');
  A.ok(!/new Map\(\)/.test(RELAY_SRC), 'relay.js 没有缓存 Map');
});

/* ══════════════ ⑦ ctx.relay 消费面（静态接线断言） ══════════════ */

ok('engine 暴露 ctx.relay（pose/k/from/to），非 relay 段恒 null', () => {
  A.ok(/ctx\.relay = relayPose \? \{ pose: poseToCamera3\(relayPose\), k: tin, from: relayFrom, to: relayTo \} : null;/.test(ENGINE),
    'ctx.relay 的赋值形状（非 relay 段 = null）');
  A.ok(/item\._relayPose = relayPose;/.test(ENGINE), 'item._relayPose 每子帧更新（诊断用）');
});

ok('engine 的换手权重来自 relayHandover（k 方向 0=under / 1=outTex，与 mix 分支同形状）', () => {
  A.ok(/mixTo\(this\.gl, under, outTex, relayHandoverK, this\.mixRT\)/.test(ENGINE), 'mixTo(under, outTex, relayHandoverK, mixRT)');
});

ok('world.js openFrame 有 relay 跳过分支：只铺背景、不甩上一帧', () => {
  A.ok(/if \(c\?\.relay\?\.pose\) \{[\s\S]{0,400}?return c\.under \? sat\(c\.f\.tin\) : 1;/s.test(WORLD),
    'relay 分支：铺背景 + 返回 k，跳过 openTransitionFrame');
  A.ok(WORLD.indexOf('c?.relay?.pose') < WORLD.indexOf('openTransitionFrame(c, { pass, background: world'),
    'relay 分支在老路径之前');
});

ok('makeThreeShot 有 relayPose（cameraPose 或回读）与 drive 分支', () => {
  A.ok(/relayPose\(ctx\) \{[\s\S]*?spec\.cameraPose[\s\S]*?position\.toArray\(\)/s.test(THREE),
    'relayPose：cameraPose 优先，否则回读相机');
  A.ok(/if \(ctx\.relay\?\.pose\) api\.setCamera\(ctx\.relay\.pose\);/.test(THREE),
    'render 里的 drive：外来位姿替换自己的相机');
  A.ok(THREE.indexOf('spec.update.call(this, ctx, api)') < THREE.indexOf('if (ctx.relay?.pose)'),
    'drive 在 spec.update 之后（relay 最后说了算）');
});

ok('kit/index.js 再导出 relay 全部公共函数 + relayPose3 助手', () => {
  for (const name of ['poseFromCamera3', 'poseToCamera3', 'blendPose', 'relayHandover', 'HANDOVER_GLIDE', 'MOVES', 'resolveRelayMove']) {
    A.ok(KIT_INDEX.includes(name), 'kit/index.js 导出 ' + name);
  }
  A.ok(/export function relayPose3\(ctx, home\) \{[\s\S]*?ctx\?\.relay\?\.pose[\s\S]*?return p \?\? home;/.test(KIT_INDEX),
    'relayPose3 = ctx?.relay?.pose ?? home');
});

ok('relayPose3 助手：有 relay.pose 用它，没有（/ctx 为空）原样返回 home', () => {
  const home = { pos: [1, 2, 3], target: [0, 0, 0], fov: 34, roll: 0 };
  const pose = { pos: [9, 9, 9], target: [5, 5, 5], fov: 40, roll: 0.1 };
  A.equal(relayPose3({ relay: { pose } }, home), pose, '有 pose ⇒ pose');
  A.equal(relayPose3({ relay: null }, home), home, 'relay=null ⇒ home');
  A.equal(relayPose3({}, home), home, '没有 relay ⇒ home');
  A.equal(relayPose3(undefined, home), home, 'ctx 缺失 ⇒ home');
});

/* ══════════════ ⑧ 确定性铁律（静态断言） ══════════════ */

ok('relay.js 零 GPU / 零 ctx / 无随机 / 无时钟', () => {
  // 剥掉注释再查 —— 头注释里会**提到**这些禁词（讲纪律），代码里出现才是违规
  const code = RELAY_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');
  A.ok(!/Math\.random|Date\.now|performance\.now/.test(code), '无随机无时钟（代码，不含注释）');
  A.ok(!/getContext|requestAnimationFrame|gl\.js/.test(code), '零 GPU 依赖');
  A.ok(!/ctx\./.test(code), '零 ctx 依赖（纯参数进纯值出）');
  A.ok(!/new Map|memo|cache/i.test(code), '无缓存/无记忆化');
});

ok('形状契约（静态）：场景 relayPose 是 camera3 形状，引擎做 Pose 换算', () => {
  A.ok(/poseFromCamera3\(rawA\)/.test(ENGINE) && /poseFromCamera3\(rawB\)/.test(ENGINE), '探针结果换算成 Pose 再混合');
  A.ok(/pose: poseToCamera3\(relayPose\)/.test(ENGINE), '混合结果转回 camera3 形状给场景消费');
});

/* ══════════════ 汇总 ══════════════ */

const total = n + failed.length;
if (failed.length) {
  console.log('\ntest-relay: 失败 ' + failed.length + '/' + total + ' 项：');
  for (const f of failed) console.log('  x ' + f);
  process.exit(1);
}
console.log('\n' + n + '/' + total + ' 项全绿');
