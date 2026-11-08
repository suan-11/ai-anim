// @ts-check
/**
 * CLI 参数层：opt / flag / pickTask（从 scripts/anim.mjs 抽出，函数体逐字未改）。
 *
 * rest 原来是 anim.mjs 的模块级常量；搬出来之后改成一次性注入（setRest），
 * 避免两个模块各自算一份 argv —— 那是「改一处漏一处」的开始。
 */
import { positional, taskNames, die } from '../../anim.mjs';

export let rest = [];

/** 由 anim.mjs 在解析完 argv 之后调用一次 */
export function setRest(argv) { rest = argv; }
export function opt(name, def) {
  const i = rest.indexOf(`--${name}`);
  if (i >= 0) return rest[i + 1];
  // 单字母短选项：-t 2.5 / -o dir / -n 12
  if (name.length === 1) {
    const j = rest.indexOf(`-${name}`);
    if (j >= 0) return rest[j + 1];
  }
  return def;
}

export function flag(name) { return rest.includes(`--${name}`); }

export function pickTask() {
  const t = positional(0) ?? opt('task');
  const names = taskNames();
  if (t) {
    if (!names.includes(t)) die(`没有任务 "${t}"。现有：${names.join(', ') || '(空)'}`);
    return t;
  }
  if (names.length === 1) return names[0];
  if (!names.length) die('还没有任何任务。先跑：node scripts/anim.mjs new 我的第一个动画');
  die(`有多个任务，请指定一个：${names.join(', ')}`);
}
