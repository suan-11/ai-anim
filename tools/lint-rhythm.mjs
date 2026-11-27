#!/usr/bin/env node
import { taskNames } from '../scripts/lib/cli/paths.mjs';
import { printRhythmReport, readTaskRhythm } from '../scripts/lib/rhythm.mjs';

const args = process.argv.slice(2);
const task = args.find((arg) => !arg.startsWith('-'));
if (!task || !taskNames().includes(task)) {
  console.error('用法：node tools/lint-rhythm.mjs <现有任务> [--strict] [--json]');
  process.exitCode = 2;
} else {
  printRhythmReport(task, readTaskRhythm(task), { strict: args.includes('--strict'), json: args.includes('--json') });
}
