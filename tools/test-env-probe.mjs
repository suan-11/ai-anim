#!/usr/bin/env node
// @ts-check
/**
 * tools/test-env-probe.mjs —— A5 chrome 判定的离线夹具（纯 JS，不起浏览器）。
 * 重点：**装了 playwright-core ≠ 有浏览器**。「只有安装包、没有浏览器」必须判 false。
 */
import assert from 'node:assert/strict';
import { detectChrome } from './lib/env-probe.mjs';

let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓ ' + m); };
const SYS = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PW = 'C:/Users/x/ms-playwright/chromium-1243/chrome-win64/chrome.exe';

// ① 系统 Chrome 在 ⇒ true（不管 playwright）
ok(detectChrome({ paths: [SYS], exists: (p) => p === SYS, resolveExe: () => null }) === true, '系统 Chrome 命中 ⇒ 可用');
// ② 系统 Chrome 不在，但 playwright 指的浏览器真存在 ⇒ true
ok(detectChrome({ paths: [SYS], exists: (p) => p === PW, resolveExe: () => PW }) === true, 'playwright 浏览器真实存在 ⇒ 可用');
// ③ 只有安装包、没有浏览器：playwright 指了个路径但文件不存在 ⇒ false（旧版在这里误判 true）
ok(detectChrome({ paths: [SYS], exists: () => false, resolveExe: () => PW }) === false, '只有安装包、浏览器不存在 ⇒ 不可用');
// ④ playwright 都没装（解析不出）⇒ false
ok(detectChrome({ paths: [SYS], exists: () => false, resolveExe: () => null }) === false, '连 playwright 都解析不出 ⇒ 不可用');
// ⑤ 空路径列表 + 无 resolveExe ⇒ false（不因缺省而误判）
ok(detectChrome({ paths: [], exists: () => true }) === false, '没有任何探测手段 ⇒ 不可用');

console.log('\n✓ env-probe chrome 判定：' + passed + ' 项通过');
