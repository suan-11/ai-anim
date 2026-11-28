// @ts-check
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeNarration } from '../../src/core/narration.js';
import { buildFrameTimeline } from '../../packages/remotion/timeline.mjs';
import { evaluateTask, normalizeAudio } from '../../packages/remotion/task-eval.mjs';
import { blankJsComments } from './js-source.mjs';
import { ROOT } from './cli/paths.mjs';

export const REGISTRY_REL = path.join('packages', 'remotion', 'registry.json');
export const BRIDGES_REL = path.join('packages', 'remotion', 'bridges.generated.tsx');

const VALID_KINDS = new Set(['native', 'custom-bridge', 'bridge']);
const VALID_EVALS = new Set(['config-only', 'task-eval']);
const COMP_ID_RE = /^[a-zA-Z0-9-]+$/;

/**
 * 把任务名洗成 Remotion 合法的 Composition ID（只允许 [a-zA-Z0-9-]）。
 * 与 existingIds 碰撞时附加任务名短哈希，保证唯一且确定性。
 * @param {string} taskName
 * @param {Set<string>} [existingIds]
 * @returns {string}
 */
export function compositionIdForTask(taskName, existingIds = new Set()) {
  const cleaned = String(taskName ?? '')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'task';
  const base = `Task-${cleaned}`;
  if (!existingIds.has(base)) return base;
  const hash = createHash('sha256').update(String(taskName)).digest('hex').slice(0, 6);
  let candidate = `${base}-${hash}`;
  let n = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${hash}-${n++}`;
  }
  return candidate;
}

/**
 * 读取并校验 packages/remotion/registry.json。
 * @param {string} [root]
 * @returns {{ schema: string, tasks: Record<string, { composition: string, kind: 'native'|'custom-bridge'|'bridge', eval: 'config-only'|'task-eval', audio: boolean, samples: number|'auto' }> }}
 */
export function readRegistry(root = ROOT) {
  const file = path.join(root, REGISTRY_REL);
  if (!existsSync(file)) {
    throw new Error(`找不到 Remotion 登记表 ${REGISTRY_REL}`);
  }
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (!raw || typeof raw !== 'object' || raw.schema !== 'remotion.registry/1') {
    throw new Error(`${REGISTRY_REL} 的 schema 必须是 "remotion.registry/1"`);
  }
  if (!raw.tasks || typeof raw.tasks !== 'object' || Array.isArray(raw.tasks)) {
    throw new Error(`${REGISTRY_REL} 缺少合法的 tasks 对象`);
  }
  for (const [task, entry] of Object.entries(raw.tasks)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${REGISTRY_REL} 中任务 "${task}" 必须是对象`);
    }
    if (!VALID_KINDS.has(entry.kind)) {
      throw new Error(`${REGISTRY_REL} 中任务 "${task}" 的 kind "${entry.kind}" 不合法`);
    }
    if (!VALID_EVALS.has(entry.eval)) {
      throw new Error(`${REGISTRY_REL} 中任务 "${task}" 的 eval "${entry.eval}" 不合法`);
    }
    if (typeof entry.composition !== 'string' || !COMP_ID_RE.test(entry.composition)) {
      throw new Error(`${REGISTRY_REL} 中任务 "${task}" 的 composition "${entry.composition}" 不合法（仅允许 [a-zA-Z0-9-]）`);
    }
  }
  return raw;
}

/**
 * 按任务名排序后写回 registry.json。
 * @param {{ schema?: string, tasks: Record<string, any> }} reg
 * @param {string} [root]
 */
export function writeRegistry(reg, root = ROOT) {
  const sortedTasks = {};
  for (const name of Object.keys(reg.tasks).sort((a, b) => a.localeCompare(b))) {
    sortedTasks[name] = reg.tasks[name];
  }
  const out = { schema: 'remotion.registry/1', tasks: sortedTasks };
  const file = path.join(root, REGISTRY_REL);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
  return out;
}

/**
 * 当 task.config.mjs 在无完整仓库上下文的临时目录中无法 import 时，用文本正则兜底提取字段。
 * @param {string} src
 */
export function parseConfigTextFallback(src) {
  const clean = blankJsComments(src);
  const spec = {};
  const narrM = /(^|[,{[\s])narration\s*:\s*(['"])([^'"]+)\2/.exec(clean);
  if (narrM) spec.narration = narrM[3];
  const analM = /(^|[,{[\s])analysis\s*:\s*(['"])([^'"]+)\2/.exec(clean);
  if (analM) spec.analysis = analM[3];
  const audioM = /(^|[,{[\s])audio\s*:\s*(\{[^}]*\}|'[^']*'|"[^"]*")/.exec(clean);
  if (audioM) {
    const raw = audioM[2];
    if (raw.startsWith('{')) {
      spec.audio = {};
      for (const kv of raw.slice(1, -1).split(',')) {
        const mm = /(\w+)\s*:\s*['"]([^'"]+)['"]/.exec(kv);
        if (mm) spec.audio[mm[1]] = mm[2];
      }
    } else {
      spec.audio = raw.slice(1, -1);
    }
  }
  return spec;
}

/**
 * 探测任务的旁白、节奏表、音频分析与音频是否存在。
 * @param {string} taskName
 * @param {string} [root]
 */
export async function detectTaskFiles(taskName, root = ROOT) {
  const taskDir = path.join(root, 'tasks', taskName);
  const configPath = path.join(taskDir, 'task.config.mjs');
  let spec = null;
  let mod = null;
  if (existsSync(configPath)) {
    try {
      const mtime = statSync(configPath).mtimeMs;
      mod = await import(`${pathToFileURL(configPath).href}?m=${mtime}`);
      spec = mod.default ?? mod;
    } catch {
      spec = parseConfigTextFallback(readFileSync(configPath, 'utf8'));
    }
  }
  const toRel = (rel) => `./${String(rel).replace(/^\.\//, '').replace(/\\/g, '/')}`;
  const existsRel = (rel) => {
    if (!rel || typeof rel !== 'string') return null;
    const clean = rel.trim().replace(/^\.\//, '');
    return clean && existsSync(path.join(taskDir, clean)) ? toRel(clean) : null;
  };

  const narrationRel = typeof spec?.narration === 'string' ? existsRel(spec.narration) : null;
  const rhythmRel = existsRel('rhythm.json');

  const normAudio = normalizeAudio(spec?.audio);
  const analysisCandidates = [];
  if (typeof spec?.analysis === 'string') analysisCandidates.push(spec.analysis);
  if (normAudio.analysis) {
    const clean = normAudio.analysis.replace(/^\.\//, '');
    analysisCandidates.push(clean.replace(/\.[^./\\]+$/, '.analysis.json'));
    analysisCandidates.push(path.posix.join('audio', path.basename(clean).replace(/\.[^./\\]+$/, '.analysis.json')));
  }
  let analysisRel = null;
  for (const cand of analysisCandidates) {
    const hit = existsRel(cand);
    if (hit) { analysisRel = hit; break; }
  }

  const audioDir = path.join(taskDir, 'audio');
  const hasAudioDirFile = existsSync(audioDir)
    && readdirSync(audioDir).some((f) => /\.(mp3|wav|m4a|flac|ogg)$/i.test(f));
  const hasAudio = Boolean(spec?.audio) || hasAudioDirFile;

  return { mod, spec, narrationRel, rhythmRel, analysisRel, hasAudio };
}

/**
 * 按 registry.json 生成 packages/remotion/bridges.generated.tsx 源码（字节级确定性）。
 * @param {{ schema: string, tasks: Record<string, any> }} registry
 * @param {string} [root]
 * @returns {Promise<string>}
 */
export async function renderBridgesSource(registry, root = ROOT) {
  const entries = Object.entries(registry.tasks)
    .filter(([, meta]) => meta.kind === 'bridge')
    .sort(([a], [b]) => a.localeCompare(b));

  const lines = [
    '// @ts-nocheck',
    '/**',
    ' * 自动生成文件 — 请勿手工编辑。',
    ' * 来源：packages/remotion/registry.json（运行 node tools/gen-remotion-registry.mjs 更新）。',
    ' */',
    "import React from 'react';",
    "import { EngineBridge } from './shots/EngineBridge';",
    "import { evaluateTask } from '@/rm/task-eval';",
    "import { makeNarration } from '@/engine/narration';",
    '',
  ];

  const metas = [];
  for (let i = 0; i < entries.length; i++) {
    const [task, meta] = entries[i];
    const files = await detectTaskFiles(task, root);
    const taskImportBase = `../../tasks/${task}`;
    lines.push(`import * as mod_${i} from ${JSON.stringify(`${taskImportBase}/task.config.mjs`)};`);
    if (files.narrationRel) {
      lines.push(`import narr_${i} from ${JSON.stringify(`${taskImportBase}/${files.narrationRel.replace(/^\.\//, '')}`)};`);
    }
    if (files.rhythmRel) {
      lines.push(`import rhythm_${i} from ${JSON.stringify(`${taskImportBase}/${files.rhythmRel.replace(/^\.\//, '')}`)};`);
    }
    if (files.analysisRel) {
      lines.push(`import analysis_${i} from ${JSON.stringify(`${taskImportBase}/${files.analysisRel.replace(/^\.\//, '')}`)};`);
    }
    metas.push({ i, task, meta, files });
  }

  lines.push('');
  for (const { i, task, meta, files } of metas) {
    const defaultSamples = meta.samples === 1 ? '1' : JSON.stringify(meta.samples ?? 'auto');
    lines.push(`const spec_${i} = (mod_${i} as any).default ?? mod_${i};`);
    if (files.narrationRel) {
      lines.push(`const narrData_${i} = makeNarration(narr_${i}, { duration: spec_${i}.duration });`);
    }
    const narrExpr = files.narrationRel ? `narrData_${i}` : 'undefined';
    const musicExpr = files.analysisRel ? `analysis_${i}` : 'undefined';
    const rhythmExpr = files.rhythmRel ? `rhythm_${i}` : 'undefined';
    lines.push(`const eval_${i} = evaluateTask(${JSON.stringify(task)}, mod_${i}, { ${[
      files.narrationRel ? `narrationData: ${narrExpr}` : '',
      files.analysisRel ? `music: ${musicExpr}` : '',
    ].filter(Boolean).join(', ')} });`);
    lines.push(`const Bridge_${i}: React.FC<{ samples?: number | 'auto'; shutter?: number }> = ({ samples = ${defaultSamples}, shutter }) => (`);
    lines.push(`  <EngineBridge`);
    lines.push(`    taskId=${JSON.stringify(task)}`);
    lines.push(`    taskMod={mod_${i}}`);
    if (files.narrationRel) lines.push(`    narrationData={${narrExpr}}`);
    if (files.rhythmRel) lines.push(`    rhythm={${rhythmExpr}}`);
    if (files.analysisRel) lines.push(`    analysis={${musicExpr}}`);
    lines.push(`    samples={samples}`);
    lines.push(`    shutter={shutter ?? (samples === 1 ? undefined : 0.5)}`);
    lines.push(`  />`);
    lines.push(`);`);
    lines.push('');
  }

  lines.push('export type GeneratedBridgeEntry = {');
  lines.push('  task: string;');
  lines.push('  id: string;');
  lines.push('  width: number;');
  lines.push('  height: number;');
  lines.push('  fps: number;');
  lines.push('  durationInFrames: number;');
  lines.push("  component: React.FC<{ samples?: number | 'auto'; shutter?: number }>;");
  lines.push('};');
  lines.push('');
  lines.push('export const BRIDGES: GeneratedBridgeEntry[] = [');
  for (const { i, task, meta } of metas) {
    lines.push('  {');
    lines.push(`    task: ${JSON.stringify(task)},`);
    lines.push(`    id: ${JSON.stringify(meta.composition)},`);
    lines.push(`    width: eval_${i}.width,`);
    lines.push(`    height: eval_${i}.height,`);
    lines.push(`    fps: eval_${i}.fps,`);
    lines.push(`    durationInFrames: eval_${i}.durationInFrames,`);
    lines.push(`    component: Bridge_${i},`);
    lines.push('  },');
  }
  lines.push('];');

  return lines.join('\n') + '\n';
}

/**
 * 检查或写入 packages/remotion/bridges.generated.tsx。
 * @param {string} [root]
 * @param {{ checkOnly?: boolean }} [opts]
 */
export async function syncBridges(root = ROOT, { checkOnly = false } = {}) {
  const reg = readRegistry(root);
  const expected = await renderBridgesSource(reg, root);
  const outPath = path.join(root, BRIDGES_REL);
  const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
  const stale = current !== expected;
  if (checkOnly) {
    return { ok: !stale, stale, registry: reg, outPath };
  }
  if (stale) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, expected, 'utf8');
  }
  return { ok: true, changed: stale, registry: reg, outPath };
}

/**
 * 登记任务进 registry.json 并同步 bridges.generated.tsx。
 * @param {string} taskName
 * @param {{ kind?: 'native'|'custom-bridge'|'bridge', eval?: 'config-only'|'task-eval', samples?: number|'auto', audio?: boolean, composition?: string }} [opts]
 * @param {string} [root]
 */
export async function registerTask(taskName, opts = {}, root = ROOT) {
  const reg = readRegistry(root);
  const files = await detectTaskFiles(taskName, root);
  const existingIds = new Set(
    Object.entries(reg.tasks)
      .filter(([name]) => name !== taskName)
      .map(([, entry]) => entry.composition),
  );
  const prev = reg.tasks[taskName];
  const composition = opts.composition ?? prev?.composition ?? compositionIdForTask(taskName, existingIds);
  reg.tasks[taskName] = {
    composition,
    kind: opts.kind ?? prev?.kind ?? 'bridge',
    eval: opts.eval ?? prev?.eval ?? 'task-eval',
    audio: opts.audio ?? prev?.audio ?? files.hasAudio,
    samples: opts.samples ?? prev?.samples ?? 'auto',
  };
  writeRegistry(reg, root);
  const synced = await syncBridges(root);
  return { task: taskName, entry: reg.tasks[taskName], ...synced };
}

/**
 * 从 registry.json 移除任务并同步 bridges.generated.tsx。
 * @param {string} taskName
 * @param {string} [root]
 */
export async function unregisterTask(taskName, root = ROOT) {
  const reg = readRegistry(root);
  const existed = Object.prototype.hasOwnProperty.call(reg.tasks, taskName);
  delete reg.tasks[taskName];
  writeRegistry(reg, root);
  const synced = await syncBridges(root);
  return { task: taskName, existed, ...synced };
}

/**
 * CLI 与校验命令共用的任务求值（与 Root.tsx / bridges.generated.tsx 同口径）。
 * @param {string} taskName
 * @param {{ eval: 'config-only'|'task-eval', [k: string]: any }} meta
 * @param {string} [root]
 */
export async function evaluateRegisteredTask(taskName, meta, root = ROOT) {
  const taskDir = path.join(root, 'tasks', taskName);
  const configPath = path.join(taskDir, 'task.config.mjs');
  const mod = await import(pathToFileURL(configPath).href);
  const spec = mod.default ?? mod;
  if (meta.eval === 'config-only') {
    const tl = buildFrameTimeline(spec);
    return { ...tl, audio: normalizeAudio(spec?.audio), narrationData: null, rhythm: null, analysis: null };
  }
  const files = await detectTaskFiles(taskName, root);
  const readJson = (rel) => (rel ? JSON.parse(readFileSync(path.join(taskDir, rel.replace(/^\.\//, '')), 'utf8')) : null);
  const narrRaw = readJson(files.narrationRel);
  const narrationData = narrRaw ? makeNarration(narrRaw, { duration: spec?.duration }) : null;
  const analysis = readJson(files.analysisRel);
  const rhythm = readJson(files.rhythmRel);
  const parsed = evaluateTask(taskName, mod, { narrationData, music: analysis });
  return { ...parsed, narrationData, rhythm, analysis };
}
