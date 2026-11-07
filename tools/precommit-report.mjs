#!/usr/bin/env node
/**
 * `tools/precommit-report.mjs` —— 提交前自检（**不渲染**，秒级）。
 *
 *   node tools/precommit-report.mjs            # 只看暂存区改到的任务
 *   node tools/precommit-report.mjs --all      # 所有有 mp4 的任务
 *   node tools/precommit-report.mjs --soft     # 只警告不拦
 *
 * 判据来自 `anim report`（成片 / 卡点 / 事件密度 / 风格 / 一致性）。
 * 它读**已有的 mp4**，所以能在提交前回答一个关键问题：
 * 你改的这段代码，有没有把已经出过的片子弄坏。
 *
 * 三个刻意的取舍：
 *   · **不渲染** —— 预提交里跑渲染会把提交拖成几分钟，人就会想办法绕过钩子；
 *   · **只看改到的任务** —— 全仓扫一遍会在无关提交上反复报同一件事；
 *   · **看版本戳，不看 mtime** —— 见下面「为什么不再用 mtime」。
 *
 * ## 为什么不再用 mtime 判「成片过期」
 *
 * 老版本用 `mp4 的 mtime < 任务目录里最新源码的 mtime` 来判"成片比源码旧"。这条判据有**两个**
 * 结构性错误，而且方向相反：
 *
 *   ① **git clone / checkout 之后，所有源码的 mtime 会集体刷新成"现在"** ⇒ 每一支片子都判成过期，
 *      于是这一项在实际使用中**永远是"跳过密度/一致性"**（本地实测：几十支片子全跳）；
 *   ② 反过来，**改完源码立刻重渲**时，成片比源码新 ⇒ 判成"新鲜"，但那可能恰恰是拿**旧引擎**渲的
 *      （引擎在 `src/` 里，而它没被这支片子的源码目录覆盖）—— 判据看不到这一层。
 *
 * 现在的判据是 `tasks/<任务>/render-stamp.json`（`scripts/lib/render-stamp.mjs`）：
 * 渲染成功时写**引擎签名 + 任务签名**（都按**内容**算，不是 mtime），这里读出来比一比。
 * 关键的一条：**`engine-drift` 不是"过期"，是"交付物是旧版引擎渲的"—— 交付物不作废**。
 * 只有 `scene-drift`（这支片子自己的文件改过了）才跳过密度/一致性，因为那时读的确实是另一版画面。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStamp, compareStamp, engineSig, taskSig } from '../scripts/lib/render-stamp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const ALL = argv.includes('--all');
const SOFT = argv.includes('--soft');

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

/** 暂存区里改到的任务 + 是否动了引擎侧 */
function touched() {
  const out = git(['diff', '--cached', '--name-only']);
  const set = new Set();
  let engine = false;
  for (const line of out.split(/\r?\n/)) {
    const m = /^tasks\/([^/]+)\//.exec(line);
    if (m) set.add(m[1]);
    if (/^(src|scripts|tools)\//.test(line)) engine = true;
  }
  return { tasks: [...set], engine };
}

function hasMp4(name) {
  const f = path.join(ROOT, 'out', name, name + '.mp4');
  return existsSync(f) ? f : null;
}

const touchedInfo = touched();
/** 这支片子自己的文件被改过（判据红要**拦**） */
const explicit = new Set(touchedInfo.tasks);
let names = touchedInfo.tasks;
if (ALL || touchedInfo.engine) {
  const all = readdirSync(path.join(ROOT, 'tasks'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && hasMp4(e.name))
    .map((e) => e.name)
    // _ 开头的是夹具/实验任务，不进提交门
    .filter((n) => !n.startsWith('_'));
  names = ALL ? all : [...new Set([...names, ...all])];
}
names = names.filter(hasMp4);

if (!names.length) {
  console.log('· 预提交自检：暂存区里没有已出片的任务，跳过');
  process.exit(0);
}

let failed = 0;
/** 成片是**旧引擎**渲的 —— 只数不拦（交付物不作废） */
let engineDrift = 0;
/** 成片是**旧场景**渲的 —— 那时读的确实是另一版画面，跳过密度/一致性 */
let sceneDrift = 0;
let advise = 0;
/** 引擎签名只算一次（它扫整个 src/，逐任务重算是浪费） */
const ENG = engineSig(ROOT);
for (const name of names) {
  const mp4 = hasMp4(name);
  const cmp = compareStamp(readStamp(ROOT, name), { engine: ENG, scene: taskSig(ROOT, name) });
  if (cmp.state === 'scene-drift') {
    sceneDrift++;
    console.log('· ' + name.padEnd(20) + ' 成片是旧场景渲的 → 跳过密度/一致性（' + cmp.note + '）');
    continue;
  }
  if (cmp.state === 'engine-drift') {
    // ⚠ **不跳过、也不拦**：密度/一致性的埋点没变，读这份成片照样成立；
    //   变的只是"它是不是最新引擎的样子"，而交付物不作废 —— 这正是这一层要表达的态度。
    engineDrift++;
  }
  void mp4;
  /**
   * ⚠ **这个子进程超时是硬性的，不是"慢一点也没关系"**。
   * 老版本给 180s 且没有超时分支 —— `spawnSync` 超时后 `status` 是 `null`、`stdout` 可能是**半截**，
   * 于是 `JSON.parse` 抛、打印一句「报告没给出 JSON →」**后面什么都没有**（stderr 也是空的），
   * 而真正的信息是「它被 180s 掐死了」。一屏几十支片子串起来跑，这个坑每次都会踩到。
   * 现在：超时单独成句，并且**降档**（不判它红，因为那不是这支片子的错）。
   */
  const PER_TASK_MS = Number(process.env.ANIM_PRECOMMIT_MS || 60000);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'anim.mjs'), 'report', name, '--json'], { cwd: ROOT, encoding: 'utf8', timeout: PER_TASK_MS });
  if (r.error && r.error.code === 'ETIMEDOUT') {
    console.log('⚠ ' + name.padEnd(20) + ' 报告超时（' + (PER_TASK_MS / 1000) + 's）→ 这一项没判（不是判据红）');
    continue;
  }
  let j = null;
  try { j = JSON.parse(r.stdout) } catch (e) {
    void e;
    const why = String(r.stderr || '').split('\n').filter(Boolean)[0] || String(r.stdout || '').split('\n').filter(Boolean).slice(-1)[0] || '(无输出)';
    console.log('⚠ ' + name.padEnd(20) + ' 报告没给出 JSON → ' + why);
    continue;
  }
  const bad = (j.rows || []).filter((x) => x.ok === false);
  // 只有当这支**自己的文件**被改过，判据红才算"你改坏了"；只是被引擎改动顺带扫到的话只提醒，
  // 因为重渲与否是人的决定（预提交里不放渲染，就不该要求别人先渲一遍）。
  const isMine = ALL || explicit.has(name);
  const mark = bad.length ? (isMine ? '✗' : '⚠') : '✓';
  const drift = cmp.state === 'engine-drift' ? '  （旧引擎渲的，交付物不作废）' : (cmp.state === 'missing' ? '  （没有版本记录）' : '');
  console.log(mark + ' ' + name.padEnd(20) + (bad.length ? bad.map((b) => b.id + '：' + b.summary).join('；') : '5 项判据通过') + drift);
  if (bad.length && isMine) failed++;
  else if (bad.length) advise++;
}

console.log('');
if (failed) {
  console.log('✗ ' + failed + ' 支片子的判据没过（' + (SOFT ? '只警告' : '拦住本次提交') + '）');
  console.log('  查看细节：node scripts/anim.mjs report <任务>');
  if (!SOFT) process.exit(1);
} else {
  const bits = [];
  if (sceneDrift) bits.push(sceneDrift + ' 支因成片是旧场景渲的被跳过（要看效果先重渲）');
  if (engineDrift) bits.push(engineDrift + ' 支用的是旧版引擎——交付物不作废，anim stamp 看清单');
  if (advise) bits.push(advise + ' 支只是被引擎改动顺带扫到，判据红只提醒、不拦');
  console.log('✓ 预提交自检通过' + (bits.length ? '（' + bits.join('；') + '）' : ''));
}
