#!/usr/bin/env node
// @ts-check
/**
 * 1-40 的**离线单测**：`anim subs` 导出的 ASS 文本转义与时间取整
 *（不需要 GPU / 不需要浏览器 / 不起 Vite，只需要 import `scripts/anim.mjs` 的纯函数）。
 *
 * 跑法：
 *   node tools/test-subs.mjs
 *
 * 为什么值得单独测：这条命令的输出**没有画面可看** —— 转义坏掉时 ffmpeg 不报错、
 * 平台也不报错，只是字幕和画面里烧进去的那句不是一回事。所以判据只能落在纯函数上：
 *   ① `assText` 把 `\` / `{` / `}` / 换行 / 控制字符变成 ASS 认的写法；
 *   ② `assTime` 向上取整且**百分秒字段恒为两位**（旧的 `1.999` → `.100` 是三位的坏值）；
 *   ③ **接线自检**：`cmdSubs` 真的调了 `assText`（纯函数对了但没接上 = 等于没做）。
 */
import assert from 'node:assert/strict';
import { readCliSource } from './lib/cli-source.mjs';

const { IS_MAIN, assText, assTime } = await import(new URL('../scripts/anim.mjs', import.meta.url).href);

let passed = 0;
const lines = [];
/** @param {string} name @param {() => void} fn */
function t(name, fn) {
  try { fn(); passed++; lines.push(`  ✓ ${name}`); }
  catch (err) { lines.push(`  ✗ ${name}\n      ${String(err.message).split('\n').join('\n      ')}`); throw Object.assign(new Error(name), { cause: err }); }
}

/* ---------------------------------------------------------------- 0. import 不许跑 CLI */

t('import 本模块不会执行 CLI（IS_MAIN=false）', () => {
  assert.equal(IS_MAIN, false);
  assert.equal(typeof assText, 'function');
  assert.equal(typeof assTime, 'function');
});

/* ---------------------------------------------------------------- 1. ASS 文本转义 */

t('反斜杠：`\\N` 不再是两字符序列（后面插了 U+2060）', () => {
  const out = assText('C:\\new\\table');
  assert.ok(!/(?<!\u2060)\\N/.test(out), `输出里还有未被隔断的 \\N：${JSON.stringify(out)}`);
  assert.equal(out, 'C:\\\u2060new\\\u2060table');
});

t('花括号：转成 libass 的字面量转义，不再被当成覆盖块', () => {
  assert.equal(assText('{blur8}标题'), '\\{blur8\\}标题');
});

t('换行：统一成 ASS 的硬换行 `\\N`（文本行内没有裸换行）', () => {
  assert.equal(assText('第一行\r\n第二行'), '第一行\\N第二行');
  assert.equal(assText('a\u2028b'), 'a\\Nb');
});

t('控制字符与制表符：删掉 / 换成空格（ASS 会把它们画成方块）', () => {
  assert.equal(assText('a\tb'), 'a b');
  assert.equal(assText('a\u0000b\u0007c'), 'abc');
});

t('正常中文旁白：原样通过（转义不许多加一个字符）', () => {
  assert.equal(assText('这串「嗷呜啊」，叫「兽语」。'), '这串「嗷呜啊」，叫「兽语」。');
});

t('空值不炸：null / undefined / 数字都收成字符串', () => {
  assert.equal(assText(null), '');
  assert.equal(assText(undefined), '');
  assert.equal(assText(42), '42');
});

/* ---------------------------------------------------------------- 2. 时间取整 */

t('assTime：常规值两位百分秒', () => {
  assert.equal(assTime(0), '0:00:00.00');
  assert.equal(assTime(1.234), '0:00:01.24');   // 向上取整，宁可晚 10ms
  assert.equal(assTime(61.5), '0:01:01.50');
  assert.equal(assTime(3599.999), '1:00:00.00');
});

t('assTime：跨秒 / 跨分的进位不留三位小数（旧的 `1.999` → `.100` 已修）', () => {
  assert.equal(assTime(1.999), '0:00:02.00');
  assert.equal(assTime(59.999), '0:01:00.00');
  for (const sec of [0, 0.001, 0.994, 0.995, 1.999, 59.999, 3599.999]) {
    assert.match(assTime(sec), /^\d+:\d{2}:\d{2}\.\d{2}$/, `格式不对：${sec} → ${assTime(sec)}`);
  }
});

t('assTime：负数夹到 0（不产出 `-1:-1` 这种坏时间戳）', () => {
  assert.equal(assTime(-3), '0:00:00.00');
});

/* ---------------------------------------------------------------- 3. 接线自检 */

t('接线：cmdSubs 的 Dialogue 行真的走了 `rows.map(assText)`', () => {
  const src = readCliSource();
  assert.ok(src.includes('rows.map(assText).join'), 'cmdSubs 里没有把每一行过 assText —— 转义函数等于没接上');
  assert.ok(!/[^)]rows\.join\('\\\\N'\)/.test(src), '还留着未转义的 `rows.join(\'\\\\N\')`');
});

/* ---------------------------------------------------------------- 汇总 */

console.log(`\nanim subs 的 ASS 转义 / 时间取整（1-40） —— ${passed} 项\n`);
for (const line of lines) console.log(line);
console.log('');
