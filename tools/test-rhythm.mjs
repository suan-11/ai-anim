import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import beat from '../tasks/beat/task.config.mjs';
import demo from '../tasks/demo/task.config.mjs';
import pulse from '../tasks/beat/scenes/pulse.js';
import { rhythmAt, rhythmFrameAt, validateRhythm } from '../src/core/rhythm.js';
import { build } from '../src/timeline.js';
import { rhythmStructure } from '../scripts/lib/rhythm.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = (task) => readFileSync(new URL(`../tasks/${task}/rhythm.json`, import.meta.url), 'utf8');
const fresh = () => JSON.parse(source('beat'));
const codes = (blocks, opts) => validateRhythm(blocks, opts).issues.map((issue) => issue.code);

for (const [name, task] of [['beat', beat], ['demo', demo]]) {
  const timeline = build(task.timeline);
  const duration = task.duration ?? timeline.at(-1).end;
  const report = validateRhythm(source(name), { duration });
  assert.deepEqual(report.issues, [], name);
  assert.equal(new Set(report.blocks.map((b) => b.beat_role)).size, 4, name);
}

for (const bpm of [77, 120, 145]) {
  const timeline = build(beat.timeline, { bpm });
  const releaseTimes = fresh().filter((block) => block.beat_role === 'release').map((block) => block.t_start);
  assert.deepEqual(timeline.slice(1).map((segment) => segment.start), releaseTimes);
  assert.equal(timeline.at(-1).end, 32);
  assert.deepEqual(rhythmStructure(timeline).issues, []);
  assert.deepEqual(rhythmStructure(timeline, { strict: true }).issues.map((issue) => issue.code), ['C5']);
}

assert.deepEqual(codes('['), ['format']);
assert.deepEqual(codes([]), ['format']);
assert.deepEqual(codes(Array(1)), ['format']);
assert.deepEqual(codes(source('beat'), { duration: 33 }), ['coverage']);
for (const patch of [
  { t_start: 1 }, { t_end: 8.1 }, { t_end: 2.99 }, { t_end: Infinity },
  { intensity: 0 }, { info_density: 2.3 }, { resistance: 1.01 },
  { beat_role: 'break' }, { motion_grammar: 1 }, { sound_density: '0.2' },
]) {
  const table = fresh();
  Object.assign(table[0], patch);
  assert.ok(codes(table).includes('format'), JSON.stringify(patch));
}
for (const offset of [-0.1, 0.1]) {
  const table = fresh();
  table[1].t_start += offset;
  assert.deepEqual(codes(table), ['format']);
}

const cases = [
  ['R1', (table) => { for (const block of table.slice(0, 3)) block.intensity = 3; }],
  ['R2', (table) => { table[3].info_density = 4; }],
  ['R2', (table) => { table.at(-1).info_density = 4; }],
  ['R3', (table) => { table[0].resistance = table[1].resistance; }],
  ['R3', (table) => { table[2].resistance = table[1].resistance + 0.01; }],
  ['R3', (table) => { table[0].beat_role = 'release'; }],
  ['R4', (table) => { table[2].attention_target = 'multiple_anchors'; }],
  ['R5', (table) => { for (const block of table) block.beat_role = 'pressure'; }],
];
for (const [code, mutate] of cases) {
  const table = fresh();
  mutate(table);
  assert.ok(codes(table).includes(code), code);
}

const table = fresh();
const { blocks } = validateRhythm(table);
table[2].intensity = 1;
assert.equal(rhythmAt(blocks, 10.7).intensity, 5);
assert.ok(Object.isFrozen(blocks[2]));
for (const [t, role] of [[32, null], [10.7, 'release'], [0, 'pressure'], [10.699, 'hold'], [NaN, null], [-1, null]]) {
  assert.equal(rhythmAt(blocks, t)?.beat_role ?? null, role);
}
assert.equal(rhythmFrameAt(blocks, 10.7).progress, 0);
assert.ok(Math.abs(rhythmFrameAt(blocks, 13.8).progress - 0.5) < 1e-9);

function samplePulse(rhythm) {
  const radii = [];
  const noop = () => {};
  const color = Object.assign([1, 1, 1], { css: () => '#fff' });
  const f = { lt: 1, a: {}, rhythm };
  const post = pulse.render({
    f, gl: { W: 1920, H: 1080, clear: noop }, P: { bg: color, signal: color, bone: color, ember: color },
    text: { clear: noop, upload: noop }, type: { write: noop }, comp: { draw: noop },
    lines: { begin: noop, rect: noop, flush: noop, fillCircle: noop, fillPoly: noop, polyline: noop,
      circle: (_x, _y, radius) => radii.push(radius) },
    music: { bpm: 120, nearestBeat: () => { throw new Error('事件轨依赖了拍点'); } },
  });
  return { radii, bloom: post.bloom };
}
const release = rhythmFrameAt(blocks, 11.1);
const base = samplePulse(release);
assert.ok(samplePulse({ ...release, resistance: 0.8 }).radii[0] < base.radii[0]);
assert.notDeepEqual(samplePulse(rhythmFrameAt(blocks, 14)).radii, samplePulse(rhythmFrameAt(blocks, 15)).radii);
assert.ok(samplePulse({ ...release, intensity: 1 }).bloom < base.bloom);
assert.ok(samplePulse({ ...release, info_density: 1 }).radii.length < base.radii.length);
assert.deepEqual(samplePulse(release), base);

const run = (...args) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 30000 });
const lint = run('tools/lint-rhythm.mjs', 'beat', '--strict', '--json');
const cli = run('scripts/anim.mjs', 'rhythm', 'beat', '--strict', '--json');
assert.equal(lint.status, 0, lint.stderr);
assert.equal(cli.status, 0, cli.stderr);
assert.deepEqual(JSON.parse(cli.stdout), JSON.parse(lint.stdout));
const noTable = run('tools/lint-rhythm.mjs', '_carry-lab', '--strict', '--json');
assert.equal(noTable.status, 1);
assert.equal(JSON.parse(noTable.stdout).declared, false);
const grid = run('tools/lint-cut-beats.mjs', 'beat', '--json');
assert.equal(grid.status, 0, grid.stderr);
assert.equal(JSON.parse(grid.stdout).gridOnly, true);
assert.equal(JSON.parse(grid.stdout).bad, 2);
console.log('PASS 节奏双轨：数据格式、R1–R5、时间查找、三项参数驱动画面、CLI 与 BPM 网格');
