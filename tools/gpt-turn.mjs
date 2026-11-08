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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
const base = path.join(ROOT, 'out', '_handoff', '5B-brief.md');
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

console.log('派发一轮：话题 ' + topic + '，消息 ' + fresh.length + ' 条，' + (session ? '续会话 ' + session : '新会话'));
const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });

writeFileSync(cursorFile, JSON.stringify({ topic, lastRead: fresh[fresh.length - 1].id, at: new Date().toISOString() }, null, 2) + String.fromCharCode(10));
process.exit(r.status ?? 1);
