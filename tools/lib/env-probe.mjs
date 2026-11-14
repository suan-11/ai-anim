// @ts-check
/**
 * tools/lib/env-probe.mjs —— 回归前置依赖体检的**可测**核心（A5）。
 *
 * 从 regress-all.mjs 抽出来，是为了能用夹具离线测「chrome 到底算不算可用」：
 * 旧版把 `node_modules/playwright-core` 目录存在就当成有浏览器 —— **装了包 ≠ 有浏览器**。
 * 受控夹具「只有安装包、没有浏览器」必须判 false，否则缺浏览器的机器会跑出一屏 ENOENT。
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/** 系统 Chrome 的常见安装位（引擎走 channel: 'chrome'，用的是系统 Chrome） */
export const CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

/** 问 playwright-core 它指的浏览器可执行文件在哪（没装 / 解析不出返回 null）。不真启动。 */
export function resolvePlaywrightExe(root) {
  try {
    const r = spawnSync(process.execPath,
      ['-e', "try{process.stdout.write(require('playwright-core').chromium.executablePath())}catch(e){}"],
      { cwd: root, encoding: 'utf8', timeout: 15000 });
    return (r.stdout || '').trim() || null;
  } catch { return null; }
}

/**
 * chrome 是否可用：系统 Chrome 路径命中，或 playwright 真能指到一个**存在的**可执行文件。
 * 依赖全部可注入 ⇒ 离线夹具能模拟「只有安装包、没有浏览器」。
 * @param {{ paths?: string[], exists?: (p:string)=>boolean, resolveExe?: ()=>(string|null) }} [deps]
 */
export function detectChrome({ paths = CHROME_PATHS, exists = existsSync, resolveExe } = {}) {
  if (paths.some((p) => p && exists(p))) return true;
  const exe = resolveExe ? resolveExe() : null;
  return !!exe && exists(exe);
}
