// @ts-check
/**
 * narration-error —— 旁白表「配了但加载不了」的**判定**（BACKLOG 复盘 A-2，纯函数离线可测）。
 *
 * 旁白表（`task.config.mjs` 的 `narration: './xxx.narration.json'`）加载失败时，页面侧只
 * console.warn 一句就继续（`src/app.js` 的 try/catch）——成片照常渲、check 照样绿，
 * 作者根本不知道 `ctx.narration` 是空的：字幕不出现、`dur: { vo }` 解不出来，
 * 这些"画面上什么都不显示"的失败没有一张图能看出来。
 *
 * 所以 `anim check` 在 Node 侧**直接验证配置指向的文件**（不起浏览器）：
 *   · config 里没有 narration 字段 ⇒ null（没配 = 正确，不算失败）
 *   · narration 不是字符串（内联表对象是合法用法，AGENTS §6.5）⇒ null
 *   · 文件不存在 / 不是合法 JSON / JSON.parse 抛错 ⇒ { file, reason }
 *
 * 路径解析与页面侧同一条规则：相对 task.config.mjs 所在目录（`src/tasks.js` 的 taskUrl）。
 */

import * as fsSync from 'node:fs';

/**
 * 判定一个任务的旁白表配置能不能加载。
 * @param {Record<string, any>} cfg 已加载的 task.config.mjs 导出（或 JSON）
 * @param {{ taskDir: string }} io 任务目录（绝对路径），narration 相对它解析
 * @param {{ existsSync?: (p: string) => boolean, readFileSync?: (p: string) => string }} [fsd]
 *        文件系统注入（测试用；缺省用 node:fs）
 * @returns {{ file: string, reason: string } | null} null = 没问题（包括"没配"）
 */
export function narrationConfigProblem(cfg, io, fsd = {}) {
  // 缺省 fs 用同步的 node:fs（测试经 fsd 注入假 fs；箭头缺省不能 async —— 返回 Promise 会让判定全歪，实测踩过）
  const exists = fsd.existsSync ?? ((p) => fsSync.existsSync(p));
  const read = fsd.readFileSync ?? ((p) => fsSync.readFileSync(p, 'utf8'));
  const n = cfg?.narration;
  // 没配 / 内联表（对象）/ 显式 null：都不是"文件加载失败"这一类
  if (!n || typeof n !== 'string') return null;
  // 路径解析：相对任务目录；URL 形式（http/https）不在 Node 侧验证（页面侧 fetch）
  if (/^https?:/i.test(n)) return null;
  const abs = /^[A-Za-z]:[\\/]|^\//.test(n) ? n : `${io.taskDir.replace(/[\\/]$/, '')}/${n.replace(/^\.\//, '')}`;
  let ok = true;
  try { ok = !!exists(abs); } catch { ok = false; }
  if (!ok) return { file: n, reason: '文件不存在' };
  let text = '';
  try { text = String(read(abs)); } catch (e) { return { file: n, reason: `读不出来（${e && e.message}）` }; }
  try { JSON.parse(text); } catch (e) {
    return { file: n, reason: `不是合法 JSON（${String(e && e.message).split('\n')[0]}）` };
  }
  return null;
}

/** check 的一行人读文案（测试钉住，DIAGNOSIS 按原句登记）。 */
export function describeNarrationError(p) {
  return `旁白表 ${p.file} 加载失败（${p.reason}）—— ctx.narration 会是空的：字幕 / dur:{vo} / 卡点全部不工作`;
}
