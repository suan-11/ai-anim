#!/usr/bin/env node
// @ts-check
/**
 * 引擎改动的**爆炸半径**（BACKLOG 1-45 细化）—— 纯逻辑回归，几毫秒跑完。
 *
 *   node tools/test-engine-graph.mjs
 *
 * 这一层错了不会报错，只会**悄悄复用旧画面**（画面错、日志全绿），所以每条都要钉：
 *   ① 地基（core / style / app / timeline / public）一改 ⇒ 整批；
 *   ② 通用件（kit / shots）一改 ⇒ 只波及**真实 import 到它的**文件；
 *   ③ 注释里的示例 import **不算边**（假边比漏边更贵：它让实验白做）；
 *   ④ 解析不出来的（动态 import / glob）一律退回整批；
 *   ⑤ 删掉的文件也要让签名变。
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  GLOBAL_PREFIXES, isGlobalSource, stripComments, parseImports, resolveSpecifier,
  buildImportGraph, affectedBy, entryEngineDeps, walkSources,
} from '../scripts/lib/engine-graph.mjs';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('✓', name); };
const root = mkdtempSync(path.join(tmpdir(), 'anim-enggraph-'));
/** 写一个文件（自动建目录） */
function W(rel, body) {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, body);
  return p;
}

/* ---------------------------------------------------------------- 地基判定 */
ok('地基前缀表覆盖 core / style / app / timeline / public', () => {
  for (const p of ['src/core/', 'src/style/', 'src/app.js', 'src/timeline.js', 'public/']) {
    assert.ok(GLOBAL_PREFIXES.includes(p), '缺了 ' + p);
  }
});

ok('isGlobalSource：地基 true，通用件 false（这是"能不能按依赖收窄"的分界线）', () => {
  assert.equal(isGlobalSource('src/core/util.js'), true);
  assert.equal(isGlobalSource('src/style/index.js'), true);
  assert.equal(isGlobalSource('src/app.js'), true);
  assert.equal(isGlobalSource('src/timeline.js'), true);
  assert.equal(isGlobalSource('public/fonts/fonts.css'), true);
  assert.equal(isGlobalSource('vite.config.mjs'), true);
  assert.equal(isGlobalSource('src/kit/index.js'), false, 'kit 不能被当全局（否则细化白做');
  assert.equal(isGlobalSource('src/shots/chart.js'), false);
});

/* ---------------------------------------------------------------- 注释剥离 */
ok('stripComments：注释里的 import 不计入（文档示例不算依赖）', () => {
  const src = [
    "/** 用法：import x from './fake-a.js' */",
    "// import y from './fake-b.js'",
    "import real from './real.js';",
  ].join('\n');
  const { paths } = parseImports(src);
  assert.equal(paths.length, 1, '只该抓到真实那条，实抓到 ' + JSON.stringify(paths));
  assert.equal(paths[0], './real.js');
});

ok('stripComments：字符串里的 // 不被当成注释（URL 那种）', () => {
  const src = "const u = 'http://x/y';\nimport a from './a.js';";
  const { paths } = parseImports(src);
  assert.equal(paths.length, 1);
  assert.equal(paths[0], './a.js');
});

/* ---------------------------------------------------------------- 动态标记 */
ok('动态导入 / glob ⇒ dynamic，调用方据此退回整批', () => {
  assert.equal(parseImports("const m = await import('./x.js')").dynamic, true);
  assert.equal(parseImports("const g = import.meta.glob('./*.js')").dynamic, true);
  assert.equal(parseImports("import a from './a.js'").dynamic, false);
});

/* ---------------------------------------------------------------- 反图 */
ok('反向图 + 可达集：改了 B，只有 import 了 B 的才受影响', () => {
  // 用**真实相对路径**写 import（与仓库里的 214 条 import 同一形态；绝对路径不是本仓的写法）
  const u = W('src/core/util.js', "export const css = 1;\n");
  const a = W('src/kit/a.js', "export const a = 1;\n");
  const b = W('src/kit/index.js', "export { a } from './a.js';\n");
  const s1 = W('tasks/t1/scenes/one.js', "import { a } from '../../../src/kit/index.js';\n");
  const s2 = W('tasks/t1/scenes/two.js', "import { css } from '../../../src/core/util.js';\n");
  const g = buildImportGraph([a, b, s1, s2, u].map((p) => path.resolve(p)));
  const hitA = affectedBy(g.importers, [path.resolve(a)]);
  assert.ok(hitA.has(path.resolve(b)), 'a → b');
  assert.ok(hitA.has(path.resolve(s1)), 'a → b → one.js');
  assert.ok(!hitA.has(path.resolve(s2)), 'two.js 没 import a，不该被波及');
  // 改 core/util.js 则两个场景都波及（地基文件本来就该全连）
  const hitU = affectedBy(g.importers, [path.resolve(u)]);
  assert.ok(hitU.has(path.resolve(s2)), 'core 改动应波及所有 import 它的场景');
  // one.js 只 import 了 kit/index.js，而 kit/index.js 没 import core ⇒ 不该被 core 波及
  assert.ok(!hitU.has(path.resolve(s1)), 'one.js 不依赖 core，core 改了不该波及它');
});

ok('entryEngineDeps：只收非地基文件，且不含 core/style', () => {
  W('src/core/util.js', "export const css = 1;\n");
  W('src/kit/a.js', "export const a = 1;\n");
  const scene = W('tasks/t2/scenes/one.js',
    "import { a } from '../../../src/kit/a.js';\n"
    + "import { css } from '../../../src/core/util.js';\n");
  const { deps, unresolved } = entryEngineDeps([scene], root);
  const d = deps.get('tasks/t2/scenes/one.js');
  assert.ok(d, '要有这个入口');
  assert.ok(d.has('src/kit/a.js'), 'kit 件应进表');
  assert.ok(!d.has('src/core/util.js'), '地基文件不进（走全局签名）');
  assert.equal(unresolved.size, 0);
});

/* ---------------------------------------------------------------- 删文件 */
ok('walkSources 只收源文件、跳过 out / node_modules', () => {
  const files = walkSources(root).map((p) => path.relative(root, p).split(path.sep).join('/'));
  assert.ok(files.includes('src/kit/a.js'));
  assert.ok(!files.some((f) => f.includes('node_modules')), '不该扫 node_modules');
});



/* ---------------------------------------------------------------- barrel 收窄 */

ok('镜头模板 barrel：按 shot("chart") 的字面量只跟 chart 那一支', () => {
  const dir = path.join(root, 'src/exshots');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'chart.js'), 'export function chartShot(o){return o;}\nchartShot.meta = { name: "chart" };');
  writeFileSync(path.join(dir, 'pixel.js'), 'export function pixelShot(o){return o;}\n' + 'pixelShot.meta = { name: "pixel" };');
  writeFileSync(path.join(dir, 'index.js'), [
    'export { chartShot } from "./chart.js";',
    'export { pixelShot } from "./pixel.js";',
    'const REG = { chartShot, pixelShot };',
    'export const SHOTS = REG;',
    'export function shot(name, opts = {}) { return REG[name](opts); }',
  ].join('\n'));
  const scene = path.join(root, 'btasks/t/scenes/c.js');
  mkdirSync(path.dirname(scene), { recursive: true });
  writeFileSync(scene, [
    'import { shot } from "../../../src/exshots/index.js";',
    'export default shot("chart", {});',
  ].join('\n'));
  const { deps, unresolved } = entryEngineDeps([scene], root);
  const d = deps.get('btasks/t/scenes/c.js');
  assert.ok(d.has('src/exshots/chart.js'), 'chart 这一支要进依赖');
  assert.ok(!d.has('src/exshots/pixel.js'), 'pixel 没被用到，不该进依赖（本条的判据）');
  assert.equal(unresolved.size, 0, '字面量判得出就不该进 unresolved');
});

ok('对照：判不出字面量（变量传参）⇒ 退回整表并记 unresolved（不猜）', () => {
  const scene = path.join(root, 'btasks/t2/scenes/d.js');
  mkdirSync(path.dirname(scene), { recursive: true });
  writeFileSync(scene, [
    'import { shot } from "../../../src/exshots/index.js";',
    'export default shot(pick(), {});',
  ].join('\n'));
  const { deps, unresolved } = entryEngineDeps([scene], root);
  const d = deps.get('btasks/t2/scenes/d.js');
  assert.ok(d.has('src/exshots/chart.js') && d.has('src/exshots/pixel.js'), '判不出就必须全跟（保守）');
  assert.ok(unresolved.has('btasks/t2/scenes/d.js'), '必须点名，调用方据此判整批');
});

ok('纯 re-export barrel（kit 那类）：只要 makeShot，不把整个库拉进来', () => {
  const dir = path.join(root, 'src/exkit');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'shot.js'), 'export function makeShot(){};');
  writeFileSync(path.join(dir, 'views.js'), 'export function instrumented(){};');
  writeFileSync(path.join(dir, 'pixel.js'), 'export function paletteOf(){};');
  writeFileSync(path.join(dir, 'index.js'), [
    'export { makeShot } from "./shot.js";',
    'export { instrumented } from "./views.js";',
    'export { paletteOf } from "./pixel.js";',
  ].join('\n'));
  const scene = path.join(root, 'tasks/t3/scenes/e.js');
  mkdirSync(path.dirname(scene), { recursive: true });
  writeFileSync(scene, 'import { makeShot } from "../../../src/exkit/index.js";');
  const { deps } = entryEngineDeps([scene], root);
  const d = deps.get('tasks/t3/scenes/e.js');
  assert.ok(d.has('src/exkit/shot.js'), 'makeShot 的来源要进');
  assert.ok(!d.has('src/exkit/views.js'), 'views 没被 import，不该进（否则收窄白做）');
  assert.ok(!d.has('src/exkit/pixel.js'), 'pixel 同理');
});

rmSync(root, { recursive: true, force: true });
console.log(`\n${n}/${n} 通过`);
