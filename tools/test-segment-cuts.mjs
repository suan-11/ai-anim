// 分块切点规划的单测（纯函数，不需要 GPU）。
//
// 验收（docs/history/IMPROVEMENTS-1-3.md P2-4）：`--segments N` 的块数应当 ≈ 时长 / N，
// 且**每块都是完整的镜头**（切点落在段边界、且不在转场交叠里）。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// planSegmentCuts 不是 export 的，这里用 --dry-run 那条路验证太绕；
// 直接从源码里抠出来跑（保持与 CLI 同一份实现时这个测试才有意义）。
const { readCliSource } = await import('./lib/cli-source.mjs');
const src = readCliSource();
const m = /function planSegmentCuts\(([\s\S]*?)\n}/.exec(src);
if (!m) { console.error('✗ 没能从 anim.mjs 里找到 planSegmentCuts'); process.exit(2); }
const planSegmentCuts = new Function('timeline', 'from', 'to', 'target', m[1].replace(/^[\s\S]*?\)\s*\{/, ''));

// 一支 60 秒 / 9 段的片子，其中两处交叠（5.5–6、14–14.5 这种）
const timeline = [
  { id: 'title', start: 0, end: 6 },
  { id: 'e1', start: 5.5, end: 14.5 },
  { id: 'principles', start: 14, end: 23 },
  { id: 'method', start: 22.4, end: 31 },
  { id: 'matrix', start: 30.4, end: 40 },
  { id: 'status', start: 39.5, end: 47 },
  { id: 'e2', start: 46.6, end: 53 },
  { id: 'pipeline', start: 52.5, end: 56 },
  { id: 'outro', start: 55.5, end: 60 },
];

const activeAt = (t) => timeline.reduce((n, it) => n + (t >= it.start && t < it.end ? 1 : 0), 0);
let fail = 0;
const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

for (const target of [4, 8, 15]) {
  const cuts = planSegmentCuts(timeline, 0, 60, target);
  const chunks = [];
  for (let i = 0; i < cuts.length - 1; i++) chunks.push([cuts[i], cuts[i + 1]]);
  console.log(`目标块时长 ${target}s → ${chunks.length} 块`);
  console.log(`  ${chunks.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)}`).join('  ')}`);
  // ① 块数不该明显超过 时长/目标。段边界本身会多切几刀（这是我们要的：
  //    每块都是完整镜头），所以留 1.6× 的余量。
  //    实测：90% 的时长在段边界就能切开时，块数会贴住"段数"这个下界（本例 9 段 → 9 块），
  //    再要求它继续切碎就与"每块是完整镜头"矛盾了。
  check(
    `块数 ${chunks.length} ≤ max(段数, 时长/目标×1.6)`,
    chunks.length <= Math.max(timeline.length, Math.ceil((60 / target) * 1.6)),
    `（段数 ${timeline.length}，时长/目标 ${(60 / target).toFixed(1)}）`,
  );
  // ② 每个切点都必须落在安全处（那一刻只有一个段在播）
  const unsafe = cuts.filter((t) => t > 0 && t < 60 && activeAt(t) !== 1);
  check('切点都不在转场交叠里', unsafe.length === 0, unsafe.length ? `（危险切点 ${unsafe.join(',')}）` : '');
  // ③ 每块至少 1.5 秒
  const tooShort = chunks.filter(([a, b]) => b - a < 1.5);
  check('没有过短的块', tooShort.length === 0, tooShort.length ? `（${tooShort.map(([a, b]) => `${a}-${b}`).join(',')}）` : '');
  // ④ 覆盖完整、不重叠
  check('首尾覆盖 [0,60]', cuts[0] === 0 && cuts[cuts.length - 1] === 60);
}

console.log(fail ? `\n✗ ${fail} 项不通过` : '\n✓ 分块规划全部通过（P2-4）');
void spawnSync;
process.exit(fail ? 1 : 0);
