// 变体（BACKLOG 1-23）的离线回归 —— 纯 JS，不需要 GPU / 浏览器。
//
// 钉三件事：
//   §1 deepMergeInto 的合并语义（对象递归 / 数组整体替换 / 原始值覆盖）；
//   §2 CLI 侧的接线自检（--variant 进 URL、产物目录 taskOut 带变体子目录）—— 这两条是静默失真的高危点；
//   §3 夹具任务真的声明了 variants，且变体的键符合约定。
//
//   node tools/test-variants.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { deepMergeInto } = await import('../src/core/util.js');
const { readCliSource } = await import('./lib/cli-source.mjs');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          -> ' + detail : '')); }
};

console.log('变体 variants（BACKLOG 1-23）回归：');

console.log('');
console.log('§1 deepMergeInto 的语义');
{
  const target = { style: 'print', width: 1920, palette: { signal: '#f00', ink: '#000' }, timeline: [1, 2, 3] };
  deepMergeInto(target, { style: 'noir', palette: { signal: '#0ff' }, timeline: [9] });
  check('原始值覆盖（style）', target.style === 'noir');
  check('对象递归合并（palette.ink 保留、signal 覆盖）', target.palette.ink === '#000' && target.palette.signal === '#0ff',
    JSON.stringify(target.palette));
  check('数组整体替换（不是拼接）', JSON.stringify(target.timeline) === '[9]', JSON.stringify(target.timeline));
  check('没提到的键原样保留（width）', target.width === 1920);
}
{
  const t2 = { a: { b: { c: 1 } } };
  deepMergeInto(t2, { a: { b: { d: 2 } } });
  check('三层对象递归', t2.a.b.c === 1 && t2.a.b.d === 2, JSON.stringify(t2));
  const t3 = { x: 1 };
  deepMergeInto(t3, { x: { nested: true } });
  check('原始值被对象覆盖（类型可以变）', JSON.stringify(t3.x) === '{"nested":true}');
  const t4 = { x: { nested: true } };
  deepMergeInto(t4, { x: 5 });
  check('对象被原始值覆盖', t4.x === 5);
  const t5 = { arr: [1] };
  deepMergeInto(t5, { arr: [] });
  check('空数组也是整体替换（空也算给了值）', Array.isArray(t5.arr) && t5.arr.length === 0);
  const t6 = { a: 1 };
  check('patch 为 null 时不动', deepMergeInto(t6, null) === t6 && t6.a === 1);
}

console.log('');
console.log('§2 CLI 接线自检（静默失真的高危点）');
{
  // 源码视图：anim.mjs +（拆分后）scripts/cmd/*.mjs + scripts/lib/cli/*.mjs
  const cli = readCliSource();
  check('openSession 把 --variant 放进 URL', /params\.set\('variant', String\(opt\('variant'\)\)\)/.test(cli));
  check('taskOut() 读到 --variant 才加子目录', /function taskOut\(task, \.\.\.parts\)[\s\S]{0,400}opt\('variant', ''\)/.test(cli));
  const sites = (cli.match(/taskOut\(task/g) ?? []).length;
  check('产物目录都走 taskOut（>= 10 处）', sites >= 10, 'sites=' + sites);
  // ⚠ 注释里会提到这个字面形状（解释"为什么 helper 里要写 String(task)"），只查代码行
  const codeOnly = cli.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  const leftover = (codeOnly.match(/path\.join\('out', task,/g) ?? []).length;
  check('代码里没有漏掉的 path.join(out, task, ...) 写法', leftover === 0, 'leftover=' + leftover);
}

console.log('');
console.log('§3 夹具声明了 variants');
{
  const src = readFileSync(join(ROOT, 'tasks/_info-lab/task.config.mjs'), 'utf8');
  check('_info-lab 导出了 variants', /export const variants = \{/.test(src));
  check('夹具里有两个变体（dark / paper）', /dark: \{/.test(src) && /paper: \{/.test(src));
  check('paper 变体整条替换 timeline（验数组语义）', /paper: \{[\s\S]{0,200}timeline: \[/.test(src));
}

console.log('');
console.log(fail ? '+ 有 ' + fail + ' 项失败' : '+ 全部通过（' + pass + ' 项）');
process.exitCode = fail ? 1 : 0;