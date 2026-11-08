// tasks --json（1-58）与 --table 表路径（1-23③）的离线回归 —— 纯 JS，不需要 GPU/TTS。
//
//   node tools/test-tasks-meta.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parseTaskMeta, TASKS_SCHEMA } = await import('../scripts/anim.mjs');
const { readCliSource } = await import('./lib/cli-source.mjs');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          -> ' + detail : '')); }
};

console.log('tasks --json 与 --table（1-58 / 1-23③）：');

console.log('');
console.log('§1 parseTaskMeta 的字段');
{
  const cfg = [
    'export default {',
    "  title: '我的片子', width: 1080, height: 1920, fps: 30, scale: 2,",
    "  style: 'paper', captions: true,",
    '  timeline: [],',
    '};',
  ].join('\n');
  const m = parseTaskMeta({ id: 'x', cfgText: cfg });
  check('schema 常量存在', TASKS_SCHEMA === 'anim.tasks/1');
  check('title / width / height / fps / scale', m.title === '我的片子' && m.width === 1080 && m.height === 1920 && m.fps === 30 && m.scale === 2,
    JSON.stringify(m));
  check('style 与 captions', m.style === 'paper' && m.captions === true);
  check('没有 timing ⇒ duration 为 null 且 source 为 null（不猜）', m.duration === null && m.durationSource === null);
  const withTiming = parseTaskMeta({ id: 'y', cfgText: cfg, timingTotal: 42.5 });
  check('有 timing ⇒ duration + source', withTiming.duration === 42.5 && withTiming.durationSource === 'audio/timing.json');
}

console.log('');
console.log('§2 变体块不许污染任务级字段（踩过的假读数）');
{
  const cfg = [
    'export default { title: \'t\', width: 1920, height: 1080, fps: 60 };',
    'export const variants = {',
    "  dark: { style: 'noir', captions: true },",
    "  short: { timeline: [] },",
    '};',
  ].join('\n');
  const m = parseTaskMeta({ id: 'z', cfgText: cfg });
  check('任务级 style 仍是 null（变体里的 noir 不算）', m.style === null, JSON.stringify(m.style));
  check('任务级 captions 仍是 false', m.captions === false);
  check('variants 列出两个名字', JSON.stringify(m.variants) === '["dark","short"]', JSON.stringify(m.variants));
}

console.log('');
console.log('§3 真实任务能解析（不是"扫了个寂寞"）');
{
  const names = ['demo', 'beat', 'spectrum', '_info-lab'];
  let bad = [];
  for (const n of names) {
    const cfg = readFileSync(join(ROOT, 'tasks', n, 'task.config.mjs'), 'utf8');
    const m = parseTaskMeta({ id: n, cfgText: cfg });
    if (!(m.width > 0) || !(m.height > 0) || !(m.fps > 0) || !m.title) bad.push(n + ':' + JSON.stringify(m));
  }
  check('demo/beat/spectrum/_info-lab 都有尺寸/帧率/标题', bad.length === 0, bad.join(' | '));
  const spec = parseTaskMeta({
    id: 'spectrum',
    cfgText: readFileSync(join(ROOT, 'tasks/spectrum/task.config.mjs'), 'utf8'),
    timingTotal: JSON.parse(readFileSync(join(ROOT, 'tasks/spectrum/audio/timing.json'), 'utf8')).total,
  });
  check('spectrum 的 style/captions 读对了', spec.style === 'paper' && spec.captions === true, JSON.stringify(spec));
  check('spectrum 的时长来自 timing.json', spec.duration > 60 && spec.durationSource === 'audio/timing.json');
}

console.log('');
console.log('§4 --table 的接线自检（写另一份表，默认那份不动）');
{
  const say = readFileSync(join(ROOT, 'scripts/lib/say.mjs'), 'utf8');
  check('say.mjs 认 opts.table', /const table = opts\.table \?/.test(say));
  check('默认表名不受影响（table 为空时仍是 timing.json）',
    /const timingName = table \? `\$\{table\}\.timing\.json` : 'timing\.json';/.test(say)
    && /const narrationName = table \? `\$\{table\}\.narration\.json` : 'narration\.json';/.test(say));
  check('表名做了字符白名单（防路径穿越）', /replace\(\/\[\^\\w\.-\]\/g, ''\)/.test(say));
  // 源码视图：anim.mjs +（拆分后）scripts/cmd/*.mjs + scripts/lib/cli/*.mjs
  const cli = readCliSource();
  check('CLI 把 --table / --pin-table 传进 runSay', /table: opt\('table'\)/.test(cli) && /pinTable: opt\('pin-table'\)/.test(cli));
}

console.log('');
console.log(fail ? '+ 有 ' + fail + ' 项失败' : '+ 全部通过（' + pass + ' 项）');
process.exitCode = fail ? 1 : 0;
