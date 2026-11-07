#!/usr/bin/env node
// @ts-check
/**
 * 成片版本戳（`scripts/lib/render-stamp.mjs`）—— **纯逻辑**回归，毫秒级、不需要 GPU。
 *
 *   node tools/test-render-stamp.mjs
 *
 * 三件事错了**不会报错，只会给出错误结论**（而这层存在的意义就是给出一条可信的结论）：
 *   ① 签名按**内容**算 —— 否则 `git clone` 之后 mtime 集体刷新，整仓都会判成"改过了"；
 *   ② 戳**不含自己** —— 否则每次渲染戳都变，下一次比对永远"不一致"；
 *   ③ `compareStamp` 的三档语义 —— `engine-drift` 不等于「要重渲」，`scene-drift` 才是。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  STAMP_FILE, STAMP_SCHEMA, engineSig, taskSig, fileHash, sigOf,
  readStamp, writeStamp, compareStamp, stampPath,
} from '../scripts/lib/render-stamp.mjs';

let fail = 0;
let pass = 0;
/** @param {boolean} cond @param {string} msg */
function ok(cond, msg) {
  if (cond) { pass++; console.log('✓ ' + msg); } else { fail++; console.error('✗ ' + msg); }
}
/** @param {string} msg */
function section(msg) { console.log('\n── ' + msg + ' ──'); }

const root = mkdtempSync(path.join(tmpdir(), 'anim-stamp-'));
const task = 't1';
const taskDir = path.join(root, 'tasks', task);
const scenes = path.join(taskDir, 'scenes');
mkdirSync(scenes, { recursive: true });
mkdirSync(path.join(root, 'src', 'core'), { recursive: true });
writeFileSync(path.join(root, 'vite.config.mjs'), 'export default {};\n');
writeFileSync(path.join(root, 'src', 'core', 'gl.js'), 'export const a = 1;\n');
writeFileSync(path.join(scenes, 'a.js'), "export default { id: 'a' };\n");

section('内容签名，不是 mtime');
{
  const f = path.join(scenes, 'a.js');
  const s1 = taskSig(root, task);
  // 只改 mtime、内容不变 —— 签名**不许**变（git clone / checkout 就是这个效果）
  utimesSync(f, 2000, 2000);
  ok(taskSig(root, task) === s1, '只动 mtime、内容不变 ⇒ 签名不变（clone 之后不会集体误判）');
  // 改内容 —— 必须变
  writeFileSync(f, "export default { id: 'a', x: 2 };\n");
  ok(taskSig(root, task) !== s1, '改了内容 ⇒ 签名变');
}

section('戳自己不进签名');
{
  const before = taskSig(root, task);
  writeStamp(root, task, { engine: engineSig(root), scene: before });
  const after = taskSig(root, task);
  ok(after === before, STAMP_FILE + ' 写进任务目录之后，任务签名不变（不自指）');
  ok(engineSig(root) === engineSig(root), '引擎签名是纯函数（同样输入同样输出）');
}

section('引擎签名只看引擎');
{
  const e0 = engineSig(root);
  writeFileSync(path.join(scenes, 'b.js'), "export default { id: 'b' };\n");
  ok(engineSig(root) === e0, '加一个场景文件 ⇒ 引擎签名不变');
  writeFileSync(path.join(root, 'src', 'core', 'gl.js'), 'export const a = 2;\n');
  ok(engineSig(root) !== e0, '改引擎源码 ⇒ 引擎签名变');
}

section('读写戳');
{
  const now = { engine: engineSig(root), scene: taskSig(root, task) };
  const w = writeStamp(root, task, now);
  ok(w.schema === STAMP_SCHEMA, '戳带 schema=' + STAMP_SCHEMA);
  const r = readStamp(root, task);
  ok(r && r.engine === now.engine && r.scene === now.scene, '读回来的两个签名与写进去的一致');
  ok(r && typeof r.at === 'string' && r.at.length > 0, '戳带时间戳（人说"这份是哪天渲的"要用它）');
}

section('读不懂就返回 null，不猜');
{
  const p = stampPath(root, task);
  const good = readStamp(root, task);
  writeFileSync(p, '{ not json');
  ok(readStamp(root, task) === null, 'JSON 坏了 ⇒ null（由调用方说「没有记录」）');
  writeFileSync(p, JSON.stringify({ schema: 'anim.render-stamp/0', engine: 'x', scene: 'y' }));
  ok(readStamp(root, task) === null, 'schema 不认识 ⇒ null（不把老戳当新戳读）');
  writeFileSync(p, JSON.stringify({ schema: STAMP_SCHEMA, engine: 5, scene: 'y' }));
  ok(readStamp(root, task) === null, '字段类型不对 ⇒ null');
  writeStamp(root, task, { engine: good.engine, scene: good.scene });
  ok(readStamp(root, task) !== null, '写回去就恢复');
}

section('三档语义');
{
  const stamp = { schema: STAMP_SCHEMA, engine: 'e1', scene: 's1', at: '2026-01-01T00:00:00.000Z' };
  ok(compareStamp(stamp, { engine: 'e1', scene: 's1' }).state === 'current', '两个都对得上 ⇒ current');
  ok(compareStamp(stamp, { engine: 'e2', scene: 's1' }).state === 'engine-drift', '只动引擎 ⇒ engine-drift');
  ok(compareStamp(stamp, { engine: 'e1', scene: 's2' }).state === 'scene-drift', '只动本任务 ⇒ scene-drift');
  ok(compareStamp(stamp, { engine: 'e2', scene: 's2' }).state === 'scene-drift', '两个都动 ⇒ 报更重的那一档（scene-drift）');
  ok(compareStamp(null, { engine: 'e1', scene: 's1' }).state === 'missing', '没有戳 ⇒ missing（不是"不一致"）');
  const drift = compareStamp(stamp, { engine: 'e2', scene: 's1' });
  ok(/不作废/.test(drift.note), 'engine-drift 的说明里明写「交付物不作废」——这是这一层的立意');
  ok(/重渲/.test(compareStamp(stamp, { engine: 'e1', scene: 's2' }).note), 'scene-drift 的说明里点明「要重渲」');
}

section('签名工具');
{
  const f = path.join(scenes, 'a.js');
  ok(fileHash(f).length === 16, 'fileHash 是 16 位十六进制（sha256 前缀）');
  ok(fileHash(path.join(scenes, 'nope.js')) === 'missing', '读不到 ⇒ missing（不让签名静默相等）');
  const one = [f];
  ok(sigOf(root, one) === sigOf(root, [...one].reverse()), 'sigOf 排序 ⇒ 文件顺序不影响签名');
}

rmSync(root, { recursive: true, force: true });
console.log('');
if (fail) { console.error('✗ ' + fail + ' 项失败 / ' + (pass + fail) + ' 项'); process.exitCode = 1; }
else console.log('✓ 成片版本戳：' + pass + ' 项通过');
