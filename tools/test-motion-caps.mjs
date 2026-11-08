// 运动上限静态扫描（BACKLOG 1-33）的离线回归 —— 纯 JS，不需要 GPU。
//
// 钉四件事：
//   §1 判据口径与 waterfallOver 一致（items × stagger > 0.5 才算超限，等号不算）；
//   §2 元素个数怎么读出来的（字符串字面量 / const 字符串 / 数组字面量）—— 别抓错样式值；
//   §3 读不出就进 unchecked（空不等于干净；简写 stagger 也算没验）；
//   §4 接线自检：check 里真的调了它，且 --strict 会把它变成红（夹具 _motion-lab 是红证明）。
//
//   node tools/test-motion-caps.mjs
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readCliSource } from './lib/cli-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { scanMotionCaps, maskComments, charCount, collectConsts, MAX_STAGGER_SPAN } =
  await import('../tools/lint-motion-caps.mjs');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          -> ' + detail : '')); }
};
const scan = (text, cap) => scanMotionCaps([{ file: 'x.js', text }], cap == null ? {} : { cap });

console.log('运动上限静态扫描（tools/lint-motion-caps.mjs）回归：');

console.log('');
console.log('§1 判据口径（与 waterfallOver 一致）');
{
  const over = scan("type.write('一二三四五六七八九', 0, 0, { stagger: 0.09 });");
  check('9 字 × 0.09 = 0.81 ⇒ 超限', over.over.length === 1, JSON.stringify(over.over));
  check('超限行号指向 stagger 那一行', over.over[0] && over.over[0].line === 1);
  const ok = scan("type.write('一二三四五六七八九', 0, 0, { stagger: 0.05 });");
  check('9 字 × 0.05 = 0.45 ⇒ 合规', ok.over.length === 0 && ok.checked.length === 1);
  const edge = scan("type.write('一二三四五六七八九十', 0, 0, { stagger: 0.05 });");
  check('10 字 × 0.05 = 0.50 = 上限 ⇒ 不算超（等号不越线）', edge.over.length === 0, JSON.stringify(edge.over));
  const just = scan("type.write('一二三四五六七八九十', 0, 0, { stagger: 0.051 });");
  check('10 字 × 0.051 = 0.51 ⇒ 超', just.over.length === 1);
  check('MAX_STAGGER_SPAN 导出且是 0.5', MAX_STAGGER_SPAN === 0.5);
}

console.log('');
console.log('§2 元素个数怎么读（别抓错样式值）');
{
  // 关键回归：窗口里 family: 'sans' 比正文更靠后 —— 抓最后一个字符串会读成 4 个字
  const tricky = "type.write(T, 200, 520, { size: 96, family: 'sans', stagger: 0.09 });\nconst T = '一二三四五六七';\n";
  const r1 = scan(tricky);
  check('const 字符串：读 7 个字（不是 sans 的 4）', r1.over.length === 1 && r1.over[0].items === 7, JSON.stringify(r1.over));
  const r2 = scan("const items = [1, 2, 3, 4, 5];\ntype.write(items.length, 0, 0, { stagger: 0.12 });");
  check('数组字面量：读 5 项 ⇒ 0.6 超限', r2.over.length === 1 && r2.over[0].items === 5, JSON.stringify(r2.over));
  const c = collectConsts("const A = 0.03; const B = '三字'; const C = [1, 2];");
  check('collectConsts：数字 / 字符串字数 / 数组项数',
    c.nums.get('A') === 0.03 && c.texts.get('B') === 2 && c.texts.get('C') === 2,
    JSON.stringify([...c.nums, ...c.texts]));
  check('charCount 按码点算（CJK 一字一个）', charCount('把复杂的东西') === 6);
}

console.log('');
console.log('§3 读不出 ⇒ unchecked（空不等于干净）');
{
  const u = scan('type.write(someVariable, 0, 0, { stagger: 0.12 });');
  check('实参是变量 ⇒ unchecked', u.unchecked.length === 1 && u.checked.length === 0 && u.over.length === 0);
  const sh = scan('type.write(t, 0, 0, { stagger, staggerDur: 0.4 });');
  check('简写 stagger（无冒号）⇒ 也算没验', sh.unchecked.length === 1, JSON.stringify(sh.unchecked));
  const cmt = scan("// type.write('九个字九个字啊', 0, 0, { stagger: 0.09 });\ntype.write('三个', 0, 0, { stagger: 0.02 });");
  check('注释里的不算（先抹注释）', cmt.over.length === 0 && cmt.checked.length === 1, JSON.stringify(cmt));
  check('maskComments 保留行号', maskComments('a\n// x\nb').split('\n').length === 3);
}

console.log('');
console.log('§3.5 辉光峰值（1-33 ②：只认显式 halo 声明）');
{
  const over = scan('const s = { halo: { peak: 0.62 } };');
  check('halo.peak 0.62 > 0.45 ⇒ 超限', over.over.length === 1 && over.over[0].kind === 'halo', JSON.stringify(over.over));
  const ok = scan('const s = { halo: { peak: 0.30 } };');
  check('halo.peak 0.30 ⇒ 合规', ok.over.length === 0 && ok.checked.length === 1);
  const edge = scan('const s = { halo: { peak: 0.45 } };');
  check('正好 0.45 ⇒ 不算超（等号不越线）', edge.over.length === 0);
  const bare = scan('const s = { halo: 0.5 };');
  check('halo 直接给数字也认', bare.over.length === 1, JSON.stringify(bare.over));
  const konst = scan('const PEAK = 0.7;\nconst s = { halo: { peak: PEAK } };');
  check('peak 用 const 也认', konst.over.length === 1 && konst.over[0].peak === 0.7);
  const nan = scan('const s = { halo: { peak: something } };');
  check('读不出值 ⇒ unchecked（不是通过）', nan.unchecked.length === 1 && nan.unchecked[0].kind === 'halo');
  const plain = scan("type.write('三个', 0, 0, { stagger: 0.02 });");
  check('没有 halo 的场景不算"没验辉光"（设计上没做辉光）', plain.unchecked.length === 0);
}

console.log('');
console.log('§4 接线自检（check 真的调了它，且 --strict 会红）');
{
  // 源码视图：anim.mjs +（拆分后）scripts/cmd/*.mjs + scripts/lib/cli/*.mjs
  const cli = readCliSource();
  check('cmdCheck 里 spawn 了 lint-motion-caps',
    /lint-motion-caps\.mjs/.test(cli) && /spawnSync\(process\.execPath, \[lint, task, '--json'\]/.test(cli));
  check('有命中时进 staticErrs（--strict 才红）', /staticErrs\.push\('\[运动上限\]/.test(cli));
  check('没有可判对象时进 skipped', /运动上限（stagger 跨度）/.test(cli));
  let strictExit = 0, out = '';
  try {
    out = execFileSync(process.execPath, ['scripts/anim.mjs', 'check', '_motion-lab', '--quick', '--strict'],
      { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
    strictExit = 0;
  } catch (e) {
    strictExit = e.status ?? 1;
    out = String(e.stdout ?? '') + String(e.stderr ?? '');
  }
  check('红证明：_motion-lab --strict 以非零退出', strictExit !== 0, 'exit=' + strictExit);
  check('红证明：输出里点名 over.js 的那一行', /over\.js:28/.test(out), out.slice(-400));
  check('红证明：输出里点名辉光那一条', /halo\.peak 0\.62/.test(out), out.slice(-600));
}

console.log('');
console.log(fail ? '+ 有 ' + fail + ' 项失败' : '+ 全部通过（' + pass + ' 项）');
process.exitCode = fail ? 1 : 0;
