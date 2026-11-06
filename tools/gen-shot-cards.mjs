#!/usr/bin/env node
/**
 * tools/gen-shot-cards.mjs —— 为每个镜头模板生成一张镜头卡（docs/shots/<分类>/<名字>.md）。
 *
 *   node tools/gen-shot-cards.mjs            # 重新生成全部卡片 + 索引
 *   node tools/gen-shot-cards.mjs --check    # 只校验分类是否齐全（进 CI / 预提交）
 *
 * 也能被 CLI 同进程调用（沙箱里 spawn 子进程会 EPERM）：
 *   import { generateShotCards, checkShotCards } from '../tools/gen-shot-cards.mjs'
 *
 * 为什么要有卡片：模板说明散在 docs/ENGINE.md、代码注释、anim shots 的终端输出里，
 * 选镜头时没法按用途查。卡片把每张压成同一形状：
 *   干什么用 / 什么时候用 / 别什么时候用 / 参数表 / 最小示例 / 怎么看效果
 * 并按**叙事功能**分类（开场、主张、数据、流程、界面、装置、风格件、转场、收尾）。
 *
 * 分类轴按功能而不是长相：写片子时问的是「这一段要干什么」，不是「我要画个柱状图」。
 *
 * 卡片是生成物，别手改 —— 改模板 meta / defaults，再跑一次。
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listShots } from '../src/shots/index.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'shots');

/** 叙事功能分类（顺序 = 一支片子里出现的顺序） */
export const CATEGORIES = [
  ['opening', '开场', '片子最先建立的印象：标题、主张的第一句'],
  ['assertion', '主张', '一句话砸下来，让观众只读这一句'],
  ['data', '数据', '让数字 / 对比 / 形态变化成为画面主角'],
  ['flow', '流程', '顺序、路径、分层 —— 一件事接一件事'],
  ['ui', '界面', '讲产品 / 界面 / 一次操作这一层'],
  ['world', '装置', '整屏的场：网格、波形、脉冲、辐射'],
  ['style', '风格件', '手绘、流体、等距 —— 一眼换介质'],
  ['transition', '转场', '两段之间怎么接'],
  ['close', '收尾', '定版、署名、压黑'],
];

/** 模板 → 分类。新增模板必须在这里登记（--check 会拦） */
export const SHOT_CATEGORY = {
  title: 'opening', kinetic: 'opening',
  reveal: 'opening', cascade: 'flow', transform: 'flow',
  deconstruct: 'flow',
  bigtype: 'assertion', quote: 'assertion',
  chart: 'data', counter: 'data', compare: 'data', morph: 'data',
  timeline: 'flow', lineart: 'flow', layers: 'flow',
  device: 'ui', scan: 'ui',
  grid: 'world', wave: 'world', pulse: 'world', radial: 'world',
  cel: 'style', liquid: 'style', isometric: 'style', pixel: 'style', handwrite: 'style',
  whip: 'transition',
  outro: 'close', lockup: 'close',
};

function paramTable(params) {
  if (!params || !params.length) return '_这个模板没有参数。_';
  const head = ['| 参数 | 类型 | 默认 | 说明 |', '|---|---|---|---|'];
  const rows = params.map((p) => {
    const def = p.default === undefined ? '' : '`' + JSON.stringify(p.default) + '`';
    return '| `' + p.name + '` | ' + (p.type || '') + ' | ' + def + ' | ' + (p.desc || '') + ' |';
  });
  return head.concat(rows).join('\n');
}

function example(s) {
  const pick = (s.params || []).filter((p) => p.name !== 'id').slice(0, 3);
  const args = pick.map((p) => p.name + ': ' + JSON.stringify(p.default === undefined ? '...' : p.default));
  return ['```js', "export default shot('" + s.name + "', { " + args.join(', ') + ' });', '```'].join('\n');
}

/** 校验：每个模板都要有分类，且分类表里没有幽灵模板 */
export function checkShotCards() {
  const shots = listShots();
  const missing = shots.filter((s) => !SHOT_CATEGORY[s.name]).map((s) => s.name);
  const stale = Object.keys(SHOT_CATEGORY).filter((n) => !shots.some((s) => s.name === n));
  if (missing.length) {
    console.error('✗ 这些模板没有登记分类（补 SHOT_CATEGORY）：' + missing.join(' / '));
    process.exitCode = 1;
    return false;
  }
  if (stale.length) {
    console.error('✗ SHOT_CATEGORY 里有已经不存在的模板：' + stale.join(' / '));
    process.exitCode = 1;
    return false;
  }
  console.log('✓ 镜头分类齐全（' + shots.length + ' 个模板 / ' + new Set(Object.values(SHOT_CATEGORY)).size + ' 个分类）');
  return true;
}

/** 生成全部卡片 + 索引 */
export function generateShotCards() {
  const shots = listShots();
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  let n = 0;
  for (const s of shots) {
    const cat = SHOT_CATEGORY[s.name];
    if (!cat) { console.error('✗ ' + s.name + ' 没有分类'); process.exitCode = 1; return 0; }
    const catLabel = (CATEGORIES.find((c) => c[0] === cat) || ['', cat])[1];
    mkdirSync(path.join(OUT, cat), { recursive: true });
    const md = [
      '# `' + s.name + '` · ' + (s.summary || ''),
      '',
      '> 分类：**' + catLabel + '**' + (s.energy ? ' · 能量 ' + s.energy : ''),
      '',
      s.notes || '',
      '',
      '## 什么时候用',
      '',
      s.use || '（模板没写 use）',
      '',
      '## 什么时候别用',
      '',
      s.avoid || '（模板没写 avoid —— 空着不代表都能用，出图确认）',
      '',
      '## 参数',
      '',
      paramTable(s.params),
      '',
      '## 最小示例',
      '',
      example(s),
      '',
      '## 看效果',
      '',
      '```sh',
      'node scripts/anim.mjs shots ' + s.name + '                        # 参数全表（唯一权威）',
      'node scripts/anim.mjs still demo -t 2 --only ' + s.name + '      # 出图看',
      '```',
      '',
      '<!-- 生成物：改模板 meta 后跑 node tools/gen-shot-cards.mjs，别手改 -->',
      '',
    ].join('\n');
    writeFileSync(path.join(OUT, cat, s.name + '.md'), md);
    n++;
  }
  const idx = ['# 镜头卡索引（' + shots.length + ' 张）', '', '> 生成物：`node tools/gen-shot-cards.mjs`。按**叙事功能**分组，不是按长相。', ''];
  for (const c of CATEGORIES) {
    const key = c[0];
    const inCat = shots.filter((s) => SHOT_CATEGORY[s.name] === key);
    if (!inCat.length) continue;
    idx.push('## ' + c[1] + '（' + key + '）· ' + inCat.length + ' 张', '', c[2], '');
    idx.push('| 模板 | 干什么 | 能量 |', '|---|---|---|');
    for (const s of inCat) {
      const one = String(s.use || s.summary || '').slice(0, 34).replace(/\|/g, '/');
      idx.push('| [' + s.name + '](' + key + '/' + s.name + '.md) | ' + one + ' | ' + (s.energy || '') + ' |');
    }
    idx.push('');
  }
  idx.push('## 选型纪律', '');
  idx.push('- **先问这一段要干什么**，再按分类找卡；不要从「我想画个柱状图」倒推。');
  idx.push('- 一段里只让观众看一件事（docs/LAYOUT.md）；两张卡叠着用，主体就没了。');
  idx.push('- 相邻两段别用同一张卡 —— 同质化从这里开始。');
  idx.push('- 卡片只是起点：参数调到「除默认值外每项都动过」，通常才不像模板。');
  idx.push('- 卡里没写的效果就是没有：要新视觉回 §3 手写场景，别硬改参数。');
  idx.push('');
  writeFileSync(path.join(OUT, 'README.md'), idx.join('\n'));
  console.log('✓ 生成 ' + n + ' 张镜头卡 → docs/shots/');
  return n;
}

const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) {
  if (process.argv.includes('--check')) checkShotCards();
  else generateShotCards();
}
