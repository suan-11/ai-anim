#!/usr/bin/env node
// @ts-check
/**
 * CLI 渲染硬化的**纯逻辑**回归 —— 几毫秒跑完，不需要 GPU / Chrome / ffmpeg。
 *
 *   node tools/test-cli-hardening.mjs
 *
 * 覆盖三件事（scripts/lib/render-guard.mjs）：
 *   ① BACKLOG 1-24①：--parallel 的冲突开关扫描（不能误伤 --force-gpu / --keep-raw-frames）
 *      与并发度计算 min(cpu-2, 内存/3GiB, 块数) 夹 [2..8]；
 *   ② 复盘 §2 心跳：距上一帧 ≥120s 打警告、之后每 120s 重复、渲满静默；
 *   ③ E-1 渲染锁：pid 探活三态（ok/EPERM=活、ESRCH=死）、锁文件的写/清/残留清理/占用拒绝。
 *
 * 判定函数的 kill / 时钟 / log 都可注入，所以这里全部离线测。
 */

import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  PARALLEL_CONFLICT_FLAGS, conflictingParallelFlags,
  planParallelConcurrency, planParallelChunks,
  FRAME_STALL_INTERVAL_MS, frameStallMessage, createFrameStallWatch,
  RENDER_LOCK_FILE, renderLockRel, renderLockBody, probePid,
  readRenderLock, acquireRenderLock, clearRenderLock,
} from '../scripts/lib/render-guard.mjs';

let fail = 0;
let pass = 0;
/** @param {boolean} cond @param {string} msg */
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); } else { fail++; console.error(`✗ ${msg}`); }
}
/** @param {string} msg */
function section(msg) { console.log(`\n── ${msg} ──`); }

/* ----------------------------------------------- ① 1-24①：--parallel 冲突开关 */

section('--parallel 冲突开关：只认列表里的，前缀相近的不误伤');
ok(JSON.stringify(PARALLEL_CONFLICT_FLAGS) === JSON.stringify(['segments', 'only', 'idle', 'force', 'keep-raw']),
  '冲突清单就是 1-24① 点名的那五个（顺序固定，报错文案可断言）');
ok(JSON.stringify(conflictingParallelFlags(['video', 'demo', '--parallel', '3', '--segments', '10', '--only', 'a,b']))
    === JSON.stringify(['segments', 'only']), '--segments / --only 都被抓到');
ok(JSON.stringify(conflictingParallelFlags(['--force'])) === JSON.stringify(['force']), '--force 裸开关认得');
ok(conflictingParallelFlags(['--force-gpu']).length === 0, '--force-gpu 不误伤（前缀相近）');
ok(conflictingParallelFlags(['--keep-raw-frames', '4']).length === 0, '--keep-raw-frames 不误伤');
ok(conflictingParallelFlags(['--segments=10']).length === 1 && conflictingParallelFlags(['--segments=10'])[0] === 'segments',
  '--segments=10（= 赋值形式）也认');
ok(conflictingParallelFlags(['--parallel', '3']).length === 0, '只给 --parallel 时零冲突（行为不变的前提）');
ok(conflictingParallelFlags(['-t', '1.5', '--segments', 'x']).length === 1, '短选项混着给不影响扫描');

section('并发度：min(cpu-2, 内存/3GiB, 块数) 夹 [2..8]');
const cc = (cpus, gib, chunks) => planParallelConcurrency({ cpus, memoryGiB: gib, chunks });
{
  const r = cc(16, 32, 5);
  ok(r.n === 5, '16 核 / 32GiB / 5 块 → 5（块数是上限）');
  ok(r.capCpu === 14 && r.capMem === 10 && r.capChunks === 5, '三个上限各自算对（14/10/5）');
}
ok(cc(16, 32, 64).n === 8, '块很多时顶到上限 8');
ok(cc(64, 96, 64).n === 8, '机器再大也不超过 8');
ok(cc(4, 8, 9).n === 2, '4 核 / 8GiB → cpu-2=2、内存/3=2 → 2');
ok(cc(2, 2, 9).n === 2, '小机器（cpu≤2、内存<3GiB）夹到下限 2（至少试两条流水）');
ok(cc(8, 33, 2).n === 2, '块数比并发少时块数封顶（2）');
ok(cc(16, 9, 16).n === 3, '内存 9GiB → /3 = 3 是短板');
ok(cc(16, 2, 16).n === 2, '内存不足 3GiB → raw=0 仍夹到 2');

section('切块数：N 是期望，块数 = min(N, floor(片长秒))，至少 1');
ok(planParallelChunks({ from: 0, to: 40, requested: 3 }) === 3, '40s 片子要 3 块 → 3');
ok(planParallelChunks({ from: 0, to: 1.2, requested: 3 }) === 1, '1.2s 的"短片"要 3 块 → 1（别切出 0.4s 的碎块）');
ok(planParallelChunks({ from: 10, to: 12.5, requested: 3 }) === 2, '2.5s → floor=2');
ok(planParallelChunks({ from: 0, to: 0, requested: 3 }) === 1, '0 长度（空转区间）→ 1，不产生 0');

/* ----------------------------------------------- ② 复盘 §2：心跳 */

section('心跳：120s 无新帧打警告，之后每 120s 重复');
ok(FRAME_STALL_INTERVAL_MS === 120_000, '间隔就是 120s（复盘口径）');
ok(frameStallMessage({ stallSec: 120, done: 1260, total: 4550 })
    === '⚠ 120s 没有新帧（已渲 1260/4550）—— 渲染可能卡死；长片子建议 --segments 分块（每块重启浏览器）',
  '警告文案与复盘要求的形状一致（分块路径带 [i/n] 前缀）');
ok(frameStallMessage({ stallSec: 240, done: 3, total: 10, chunk: '2/5' }).startsWith('[2/5] ⚠ 240s'),
  '分块路径带 [2/5] 前缀，读的人知道是哪一块');

{
  const lines = [];
  const w = createFrameStallWatch({ intervalMs: 100, warn: (s) => lines.push(s), total: 1000, startAt: 0 });
  ok(w.check(50) === null, '50ms（< 1 档）不警告');
  ok(w.check(99) === null, '99ms 仍不警告');
  const first = w.check(100);
  ok(first !== null && first.includes('100s') === false && /⚠ 0.1s 没有新帧（已渲 0\/1000）/.test(first),
    '100ms 到档：打第一档（interval 换算成秒，这里用 100ms 代替 120s 加速测试）');
  ok(w.check(150) === null, '同档不重复打');
  ok(w.check(199) === null, '还没到第二档');
  const second = w.check(200);
  ok(second !== null && second.includes('0.2s'), '200ms 打第二档（计数递增）');
  ok(lines.length === 2, '警告真的走了注入的 warn（只走日志通道）');
  w.onFrame(1, 1000, 210);
  ok(w.check(250) === null, '新帧到达后基线重置，250ms（< 100ms 间隔）不警告');
  // 新帧把基线**和档位**一起重置：帧后 100ms 就打新一档（秒数从新基线起算）
  const reWarned = w.check(310);
  ok(reWarned !== null && reWarned.includes('0.1s'), '帧后档位清零：帧后 100ms 就打第一档（秒数从新基线起算）');
  ok(lines.length === 3, '警告条数：两档 + 重打的一条，共 3 条');
  w.onFrame(1000, 1000, 400);
  ok(w.check(900) === null, '渲满（done ≥ total）之后静默 —— 安静是 ffmpeg 写 moov，不是卡死');
  w.stop();
  ok(w.check(99999) === null, 'stop() 之后彻底静默');
}

{
  // 没有任何帧到达：从 startAt 起算（推流起不来也是"没有新帧"）
  const lines = [];
  const w = createFrameStallWatch({ intervalMs: 100, warn: (s) => lines.push(s), total: 10, startAt: 0 });
  ok(w.check(100) !== null, '一帧都没来：基线退到 startAt，到档照样警告');
  ok(lines[0].includes('已渲 0/10'), '已渲 0/total 也说清楚');
}

/* ----------------------------------------------- ③ E-1：渲染锁 */

section('探活判定：kill 三态（ok/EPERM=活，ESRCH=死）');
{
  const noop = () => {};
  ok(probePid(4321, noop).alive === true, 'kill 不抛 = 活着');
  ok(probePid(4321, () => { const e = new Error('x'); e.code = 'EPERM'; throw e; }).alive === true,
    'EPERM = 存在但无权探测 → 视为活着（宁枉勿纵）');
  const dead = probePid(4321, () => { const e = new Error('x'); e.code = 'ESRCH'; throw e; });
  ok(dead.alive === false && dead.why === 'esrch', 'ESRCH = 死进程');
  ok(probePid(0, noop).alive === false && probePid(-3, noop).alive === false, 'pid ≤ 0 视为死');
  ok(probePid(1.5, noop).alive === false, '非整数 pid 视为死');
}

section('锁文件：写 / 清 / 残留清理 / 占用拒绝');
const root = mkdtempSync(path.join(tmpdir(), 'anim-render-lock-'));
const task = 't1';
const logLines = [];
const log = (s) => logLines.push(s);
const lockOf = (t) => path.join(root, t, RENDER_LOCK_FILE);
const writeHolder = (t, pid, extra) => {
  const mkdir = path.join(root, t);
  if (!existsSync(mkdir)) rmSync(mkdir, { recursive: true, force: true });
  const { mkdirSync } = /** @type {any} */ (require0('node:fs'));
  mkdirSync(mkdir, { recursive: true });
  writeFileSync(lockOf(t), JSON.stringify({ pid, task: t, startedAt: '2026-10-31T00:00:00.000Z', cmd: 'anim video ' + t, ...extra }));
};
// （测试文件里不能用 require；写个极小的动态包装）
function require0(name) { return requireShim[name]; }
const requireShim = { 'node:fs': { mkdirSync: (p, o) => rmMkdirShim(p, o) } };
function rmMkdirShim(p, o) { return realMkdirSync(p, o); }
import { mkdirSync as realMkdirSync } from 'node:fs';

ok(renderLockRel('demo') === 'out/demo/.render-lock', '报错里的锁路径固定 out/<任务>/.render-lock');
{
  const body = renderLockBody({ pid: 1, task: 'x', startedAt: 's', cmd: 'c' });
  ok(JSON.stringify(Object.keys(body)) === JSON.stringify(['pid', 'task', 'startedAt', 'cmd']), '锁内容四字段固定');
}

// 没锁 → 直接拿
{
  const r = acquireRenderLock({ root, task, pid: 111, startedAt: 'T1', cmd: 'anim video t1', log });
  ok(r.ok === true, '没有锁 → 直接拿到');
  const onDisk = JSON.parse(readFileSync(r.file, 'utf8'));
  ok(onDisk.pid === 111 && onDisk.task === task && onDisk.startedAt === 'T1' && onDisk.cmd === 'anim video t1',
    '锁内容写全 { pid, task, startedAt, cmd }');
  ok(existsSync(r.file), '锁文件真的落盘');
}
// 自己活着 → 拒绝（探活器注入为"活着"，不依赖真 pid 是否存在）
{
  logLines.length = 0;
  const r = acquireRenderLock({ root, task, pid: 222, startedAt: 'T2', cmd: 'x', log, probe: () => ({ alive: true, why: 'ok' }) });
  ok(r.ok === false && r.holder?.pid === 111, '持有者活着 → 拒绝，并带回持有者信息（调用方 die 点名）');
  ok(existsSync(lockOf(task)), '拒绝时**不删别人的锁**');
  ok(logLines.length === 0, '拒绝路径不多话（报错由调用方统一给）');
}
// 死进程 → 清残留后拿
{
  logLines.length = 0;
  writeHolder(task, 999999999);
  const r = acquireRenderLock({ root, task, pid: 333, startedAt: 'T3', cmd: 'x', log });
  ok(r.ok === true, '持有者已死（ESRCH）→ 清掉残留锁后拿到');
  ok(JSON.parse(readFileSync(r.file, 'utf8')).pid === 333, '锁内容换成了新持有者');
  ok(logLines.some((s) => s.includes('清掉残留锁') && s.includes('999999999')), '打了一行"清掉残留锁"（带旧 pid）');
}
// 损坏内容 → 清掉后拿
{
  logLines.length = 0;
  writeFileSync(lockOf(task), 'not-json{{{');
  const r = acquireRenderLock({ root, task, pid: 444, startedAt: 'T4', cmd: 'x', log });
  ok(r.ok === true, '锁内容损坏 → 按坏锁清掉后拿到');
  ok(logLines.some((s) => s.includes('清掉残留锁') && s.includes('损坏')), '坏锁也说明为什么清');
}
// 缺 pid 的合法 JSON → 同样清
{
  logLines.length = 0;
  writeFileSync(lockOf(task), JSON.stringify({ task }));
  const r = acquireRenderLock({ root, task, pid: 555, startedAt: 'T5', cmd: 'x', log });
  ok(r.ok === true && logLines.some((s) => s.includes('缺 pid')), '合法 JSON 但缺 pid → 清掉后拿到');
}
// EPERM（进程存在但探不到）→ 也当活的拒绝
{
  logLines.length = 0;
  writeHolder(task, 777);
  const r = acquireRenderLock({ root, task, pid: 666, startedAt: 'T6', cmd: 'x', log, probe: () => ({ alive: true, why: 'eperm' }) });
  ok(r.ok === false && r.holder?.pid === 777, 'EPERM 视为活着 → 拒绝（不误清正在渲的锁）');
}
// 注入 probe：死 → 清
{
  logLines.length = 0;
  writeHolder(task, 888);
  const r = acquireRenderLock({ root, task, pid: 999, startedAt: 'T7', cmd: 'x', log, probe: () => ({ alive: false, why: 'esrch' }) });
  ok(r.ok === true, '注入的探活器说死 → 清掉后拿到（离线测试不依赖真 ESRCH）');
}
// 读锁与清锁
{
  const { lock, corrupt } = readRenderLock(lockOf(task));
  ok(lock?.pid === 999 && corrupt === false, 'readRenderLock 读回结构化内容');
  clearRenderLock(lockOf(task));
  ok(!existsSync(lockOf(task)), 'clearRenderLock 删锁');
  ok(readRenderLock(lockOf(task)).corrupt === true, '删掉后再读 = corrupt（不抛）');
  clearRenderLock(lockOf(task)); // 幂等
  ok(true, 'clearRenderLock 幂等（文件已不在也不抛）');
}

/* ---------------------------------------------------------------- 收尾 */

try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
console.log(`\n${fail ? `✗ ${fail} 项失败` : `✓ ${pass} 项全部通过`}（共 ${pass + fail} 项）`);
process.exit(fail ? 1 : 0);
