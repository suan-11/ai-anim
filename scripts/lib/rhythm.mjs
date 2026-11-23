import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateRhythm } from '../../src/core/rhythm.js';
import { analyzeSegments } from '../../tools/lint-anti-ppt.mjs';
import { ROOT } from './cli/paths.mjs';

export function readRhythmSource(dir) {
  try { return readFileSync(path.join(dir, 'rhythm.json'), 'utf8'); }
  catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export function readTaskRhythm(task) {
  try {
    const source = readRhythmSource(path.join(ROOT, 'tasks', task));
    return source === null ? null : validateRhythm(source);
  } catch (err) {
    return { blocks: [], issues: [{ code: 'format', block: null, message: `读不到 rhythm.json（${err.code ?? err.message}）` }] };
  }
}

export function formatRhythmIssue({ code, block, message }) {
  return `[${code}] ${block === null ? '' : `第 ${block} 块 · `}${message}`;
}

export function rhythmReportLines(report) {
  if (!report) return ['节奏事件轨：未声明 rhythm.json'];
  const { blocks, issues } = report;
  const roles = [...new Set(blocks.map((block) => block.beat_role))];
  return [
    `节奏事件轨：${blocks.length} 块 · ${roles.join(' / ') || '无可读块'} · ${issues.length ? `${issues.length} 条问题` : 'R1–R5 通过'}`,
    ...issues.map(formatRhythmIssue),
  ];
}

export function rhythmStructure(timeline, { strict = false } = {}) {
  const { stats, codes, problems } = analyzeSegments(timeline, { coverage: 0.7, hookMiss: strict ? 0 : 0.25 });
  const { cov, breatheMissing, hookWindows, hookMisses } = stats;
  if (!hookMisses) return { lines: ['C4/C5：无时间线'], issues: [] };
  return {
    lines: [
      `C4 镜头长度 CoV ${cov.toFixed(2)} · 缺呼吸镜头 ${breatheMissing.length} 窗`,
      `C5 强事件覆盖 ${hookWindows - hookMisses.length}/${hookWindows} 窗`
        + (hookMisses.length ? ` · 缺 ${hookMisses.join(' / ')}` : ''),
    ],
    issues: problems.flatMap((message, i) => ['C4', 'C5'].includes(codes[i]) ? [{ code: codes[i], message }] : []),
  };
}

export function printRhythmReport(task, report, { strict = false, json = false } = {}) {
  if (json) {
    console.log(JSON.stringify({ task, declared: report !== null, ...(report ?? { blocks: [], issues: [] }) }, null, 2));
  } else {
    for (const line of rhythmReportLines(report)) console.log(line);
    for (const block of report?.blocks ?? []) {
      console.log(`  ${block.t_start}–${block.t_end}s  ${block.beat_role}  强度 ${block.intensity} / 密度 ${block.info_density} / 阻力 ${block.resistance}`);
    }
  }
  if (strict && (!report || report.issues.length)) process.exitCode = 1;
}
