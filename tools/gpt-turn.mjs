#!/usr/bin/env node
// @ts-check
/**
 * tools/gpt-turn.mjs —— 把「信箱里给 GPT 的新消息」变成一轮 Codex 会话。
 *
 *   node tools/gpt-turn.mjs --topic 5b                        # 新会话
 *   node tools/gpt-turn.mjs --topic 5b --session <threadId>   # 续同一个会话（它记得上下文）
 *   node tools/gpt-turn.mjs --topic 5b --session last         # 续最近一次
 *
 * 它做四件事：① 从 out/_mail/mail.jsonl 取这个话题里发给 gpt 的新消息（按游标）；
 * ② 拼一份 delta brief（原任务摘要 + 这些消息 + 沟通协议）；③ 调 codex-delegate 的 relay.mjs；
 * ④ 把游标写回 out/_mail/cursor-<topic>.json。
 *
 * GPT 的回报不走这个脚本 —— 它自己跑 agent-mail send，所以「它先开口」不需要任何长驻进程。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inbox, send } from './agent-mail.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const topic = opt('topic', '5b');
const session = opt('session');
const timeout = opt('timeout', '45m');
const cursorFile = path.join(ROOT, 'out', '_mail', 'cursor-' + topic + '.json');
const cursor = existsSync(cursorFile) ? JSON.parse(readFileSync(cursorFile, 'utf8')) : {};

const fresh = inbox({ for: 'gpt', thread: topic, after: cursor.lastRead });
if (!fresh.length) {
  console.log('（信箱里没有发给 gpt 的新消息；话题 ' + topic + '）');
  process.exit(1);
}

const briefPath = path.join(ROOT, 'out', '_mail', 'brief-' + topic + '.md');
// 任务摘要默认按话题取（out/_handoff/<topic>-brief.md）；没有就退回 5B 那份。
// ⚠ 之前这里写死 5B-brief.md，结果 trans 话题的会话拿到 5B 的工作单，回的也是 5B 的报告。
const base = opt('base')
  || (existsSync(path.join(ROOT, 'out', '_handoff', topic + '-brief.md'))
    ? path.join(ROOT, 'out', '_handoff', topic + '-brief.md')
    : path.join(ROOT, 'out', '_handoff', '5B-brief.md'));
const parts = [];
if (existsSync(base)) parts.push(readFileSync(base, 'utf8'));
parts.push('', '---', '', '## 信箱里给你的新消息（按时间顺序）', '');
for (const m of fresh) parts.push('- [' + m.at.slice(11, 19) + '] ' + m.from + ': ' + m.text + '  (id=' + m.id + ')');
parts.push('', '## 沟通协议（重要）', '');
parts.push('你不是只交一次报告。每完成一个可验证的小步、或需要我拍板时，**主动**写一条：');
parts.push('');
parts.push('    node tools/agent-mail.mjs send --from gpt --to orchestrator --thread ' + topic + ' --text <一句话>');
parts.push('');
parts.push('需要我拍板时，写完再 `node tools/agent-mail.mjs wait --for gpt --thread ' + topic + ' --timeout 900`；');
parts.push('等到回复就继续，超时（退出码 2）就先做不依赖这个决定的部分。');
writeFileSync(briefPath, parts.join(String.fromCharCode(10)) + String.fromCharCode(10));

const home = process.env.USERPROFILE || process.env.HOME || '';
const relay = path.join(home, '.agents', 'skills', 'codex-delegate', 'scripts', 'relay.mjs');
if (!existsSync(relay)) { console.error('找不到 relay.mjs：' + relay); process.exit(2); }
const args = [relay, '--brief', briefPath, '--cd', ROOT, '--timeout', timeout];
if (session === 'last') args.push('--resume-last');
else if (session) args.push('--session', session);

/**
 * **writer 守卫**：同一个 Codex thread 只能有一个会话在写。
 * 踩过：旧会话还没退出时我又派了一次 ⇒ relay 报 `thread already has an active writer`，
 * 而那条纠正消息就此**静默丢失**（我以为是「已发」）。所以派发前先看锁。
 */
const lockFile = path.join(ROOT, 'out', '_mail', 'thread-' + (session || 'new') + '.lock');
if (existsSync(lockFile)) {
  const ageMin = (Date.now() - Number(readFileSync(lockFile, 'utf8') || 0)) / 60000;
  if (ageMin < 120) {
    console.error('✗ 这个 thread 还有会话在写（锁 ' + Math.round(ageMin) + ' 分钟前创建）：' + lockFile);
    console.error('  等它退出，或 kill 掉那个 relay，再派。**不要**并发派 —— 你的消息会静默丢失。');
    process.exit(3);
  }
  console.error('（旧锁已过期 ' + Math.round(ageMin) + ' 分钟，覆盖）');
}
writeFileSync(lockFile, String(Date.now()));
console.log('派发一轮：话题 ' + topic + '，消息 ' + fresh.length + ' 条，' + (session ? '续会话 ' + session : '新会话'));
const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
try { unlinkSync(lockFile); } catch { /* 已经被删了也无所谓 */ }
if (r.status === 1) console.error('（若上面出现 already has an active writer：说明另一个会话还占着这个 thread，本次消息没送达）');

writeFileSync(cursorFile, JSON.stringify({ topic, lastRead: fresh[fresh.length - 1].id, at: new Date().toISOString() }, null, 2) + String.fromCharCode(10));
process.exit(r.status ?? 1);
