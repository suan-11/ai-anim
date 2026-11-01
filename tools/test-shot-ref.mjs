// @ts-check
/**
 * test-shot-ref —— 段间引用（BACKLOG 1-15）的离线单测。
 *
 * Engine 依赖 WebGL，GPU 路径由夹具验收（tasks/_ref-lab：画中画出图看过、同 t 两次 md5 一致、
 * check 0 红）。这里测的是**不碰 GL 也要对**的部分：源码契约（递归保护存在、错误信息带可用段表、
 * ctx.renderShot 挂在 ctx 与 f 两处、成本注记在文件头）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(ROOT, 'src/core/engine.js'), 'utf8');

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  PASS ' + name); };

ok('renderShotAt 存在且带递归保护（_refDepth）', () => {
  assert.ok(src.includes('renderShotAt(id, t)'), '方法没找到');
  assert.ok(src.includes('this._refDepth'), '递归保护标志没找到');
  assert.ok(/不允许嵌套/.test(src), '嵌套报错文案没找到');
});

ok('未知 id 的报错列出可用段表', () => {
  assert.ok(/可用：\$\{this\.timeline\.map/.test(src.replace(/\n/g, '')) || src.includes('.map((i) => i.id)'), '报错没带可用段表');
});

ok('ctx.renderShot 同时挂在 ctx 与 f 上（两条取用路径都在）', () => {
  // f 上定义一次
  assert.ok(src.includes('renderShot: (refId, refT, o = {})'), 'f.renderShot 定义没找到');
  // ctx 上转发一次
  assert.ok(src.includes('renderShot: f.renderShot'), 'ctx.renderShot 转发没找到');
});

ok('引用渲染只渲 1 个子帧（没有嵌套自适应）', () => {
  // renderShotAt 内部不许出现自适应循环的调用
  const m = src.match(/renderShotAt\(id, t\) \{[\s\S]*?\n  \}/);
  assert.ok(m, '方法体没截出来');
  assert.ok(!m[0].includes('_sampleError'), '引用渲染里出现了自适应误差采样');
  assert.ok(!m[0].includes('BASE_SAMPLES'), '引用渲染里出现了自适应档位');
});

ok('comp.draw 的 rect 用数组形式（gl.js :1085 契约）', () => {
  assert.ok(/rect: \[o\.x \?\? 0, o\.y \?\? 0, w, h\]/.test(src), 'rect 不是数组形式');
});

ok('成本注记在 JSDoc 里（每次调用 = 一次完整单段渲染）', () => {
  assert.ok(/成本是一次完整的单段渲染/.test(src), '成本注记没找到');
});

console.log(`✓ ${pass} 项通过`);
