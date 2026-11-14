#!/usr/bin/env node
// @ts-check
/**
 * tools/agent-mail.mjs —— 两个 agent 之间的信箱（append-only JSONL）。
 *
 * 为什么不是「让 GPT 直接调我的工具」：codex 那边只有 shell，没有反向 MCP 通道；
 * 而一个 append-only 的 JSONL 两个进程都能读能写，不需要服务、不需要端口、不需要登录。
 *
 *   node tools/agent-mail.mjs send --from gpt --to orchestrator --text "拆到一半：cmdCheck 太长"
 *   node tools/agent-mail.mjs inbox --for orchestrator
 *   node tools/agent-mail.mjs wait  --for gpt --timeout 600     # 阻塞等新消息（给会话循环用）
 *   node tools/agent-mail.mjs thread --name 5b
 *
 * 约定：信箱在 out/_mail/mail.jsonl（out/ 已被 gitignore，不进仓库）；
 * 每条一行 JSON：{ id, at, from, to, text, thread?, replyTo? }；
 * wait 是轮询（1s），不依赖文件系统事件 —— 跨沙箱跨平台都稳；
 * 退出码：inbox 有消息 0 / 空 1；wait 等到 0 / 超时 2（超时不算错，方便写循环）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'out', '_mail');
const BOX = path.join(DIR, 'mail.jsonl');

/** 读出信箱里全部消息（坏行跳过 —— 并发写可能留半行） */
export function readBox(file = BOX) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* 半行，跳过 */ }
  }
  return out;
}

/** 追加一条消息；返回它（含生成的 id） */
export function send({ from, to, text, thread, replyTo, file = BOX }) {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  const msg = {
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    at: new Date().toISOString(),
    from: String(from),
    to: String(to),
    text: String(text),
    ...(thread ? { thread: String(thread) } : {}),
    ...(replyTo ? { replyTo: String(replyTo) } : {}),
  };
  appendFileSync(file, JSON.stringify(msg) + '\n');
  return msg;
}

/** 某个收件人的消息（可按话题过滤、按 id 之后过滤） */
export function inbox({ for: who, thread, after } = {}) {
  const all = readBox();
  const idx = after ? all.findIndex((m) => m.id === after) : -1;
  const tail = idx >= 0 ? all.slice(idx + 1) : all;
  return tail.filter((m) => (!who || m.to === who) && (!thread || m.thread === thread));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const fmt = (m) => '[' + m.at.slice(11, 19) + '] ' + m.from + ' -> ' + m.to + (m.thread ? ' (' + m.thread + ')' : '')
    + '\n  ' + m.text.split('\n').join('\n  ') + '\n  id=' + m.id;

  if (cmd === 'send') {
    const ti = argv.indexOf('--text');
    const text = opt('text') ?? (ti >= 0 ? argv.slice(ti + 1).join(' ') : '');
    if (!text || !opt('to')) { console.error('用法：send --from <a> --to <b> --text "…" [--thread t]'); process.exit(2); }
    const m = send({ from: opt('from', 'me'), to: opt('to'), text, thread: opt('thread'), replyTo: opt('reply-to') });
    console.log('sent ' + m.id);
  } else if (cmd === 'inbox') {
    const list = inbox({ for: opt('for'), thread: opt('thread'), after: opt('after') });
    if (!list.length) { console.log('（没有新消息）'); process.exit(1); }
    for (const m of list) console.log(fmt(m) + '\n');
  } else if (cmd === 'wait') {
    const who = opt('for');
    const timeout = Number(opt('timeout', '300')) * 1000;
    /**
     * 游标：没有游标时 `wait` 会把**历史消息再吐一次** —— 守望任务醒来看到的是一条早就处理过的消息。
     * 三种取法：显式 --after <id> / --cursor（记在 out/_mail/cursor-watch-<for>.json）/ 都不给（老行为，会把历史都算上）。
     */
    const cursorFile = path.join(DIR, 'cursor-watch-' + (who || 'any') + '.json');
    const useCursor = argv.includes('--cursor');
    let after = opt('after');
    if (!after && useCursor && existsSync(cursorFile)) {
      try { after = JSON.parse(readFileSync(cursorFile, 'utf8')).lastSeen; } catch { after = undefined; }
    }
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const list = inbox({ for: who, thread: opt('thread'), after });
      if (list.length) {
        for (const m of list) console.log(fmt(m) + '\n');
        if (useCursor) {
          if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
          writeFileSync(cursorFile, JSON.stringify({ lastSeen: list[list.length - 1].id, at: new Date().toISOString() }, null, 2) + '\n');
        }
        process.exit(0);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.log('（等了 ' + Math.round(timeout / 1000) + 's 没有新消息）');
    process.exit(2);
  } else if (cmd === 'thread') {
    const list = inbox({ thread: opt('name') });
    for (const m of list) console.log(fmt(m) + '\n');
    if (!list.length) process.exit(1);
  } else {
    console.error('子命令：send | inbox | wait | thread');
    process.exit(2);
  }
}
