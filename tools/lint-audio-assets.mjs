#!/usr/bin/env node
// 音频资产盘点：**干净克隆里，哪些任务会静音出片**。
//
// 为什么存在（2026-11-28 实测）：`tasks/*/audio/*-vo.mp3`、`*-mix.mp3`、`*.wav` 按
// `.gitignore` 第 25–36 行**不入库**（它们是 `anim say` / `anim mix` / `make-*-audio.mjs`
// 的派生产物）。于是 `resolveAudioTracks()` 遇到缺文件只会返回 `null`（`scripts/lib/cli/audio.mjs`
// 的 `abs()`）—— 渲染照常成功、成片没有声音，**不报错**。
// 2026-11-28 盘点：**22 个任务**的 `audio:` 字段指向不存在的文件；R2 验收只碰到其中 2 个。
//
// 本工具只**报告**，不改任何文件、不进 `check`、默认退出码 0。分类口径：
//   · 可重建      —— 缺的是 vo/mix，且有 `narration.mjs` + **标准 edge 音色**（`xx-XX-XxxNeural`）
//                    ⇒ `anim say <任务> --pin-timing` + `anim mix <任务>` 能重建
//   · 阻塞(音色)  —— 缺 vo/mix，但音色不是标准 edge 音色（如克隆音色 `cotton-ja`），
//                    需要本机 TTS 服务与参考音频，换音色等于换交付物
//   · 阻塞(配乐)  —— 缺的是 music 床，仓库里没有对应生成脚本
//   · 阻塞(无脚本) —— 缺 vo/mix 且没有 `narration.mjs`，无从重建
//
//   node tools/lint-audio-assets.mjs            # 报告（退出码 0）
//   node tools/lint-audio-assets.mjs --strict   # 有缺文件就退出码 1（当门用）
//   node tools/lint-audio-assets.mjs --json     # 机器可读
//   node tools/lint-audio-assets.mjs --selftest # 分类逻辑自检（临时夹具，不碰仓库）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTaskAudioSpec } from '../scripts/lib/media.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|flac)$/i;
/** 标准 edge 音色形如 `zh-CN-YunxiNeural` / `ja-JP-NanamiNeural`；克隆音色（`cotton-ja`）不匹配。 */
const EDGE_VOICE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural$/;

/** 读 `narration.mjs`（含历史位置 `tools/narration.mjs`）里的 VOICE / TTS。 */
export function readNarrationVoice(taskDir) {
  for (const rel of ['narration.mjs', path.join('tools', 'narration.mjs')]) {
    const f = path.join(taskDir, rel);
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    const voice = (/VOICE\s*=\s*['"]([^'"]+)['"]/.exec(src) ?? [])[1] ?? null;
    const tts = (/TTS\s*=\s*['"]([^'"]+)['"]/.exec(src) ?? [])[1] ?? null;
    return { file: rel, voice, tts };
  }
  return null;
}

/**
 * 给"缺文件"分类。**纯函数**，方便自检。
 * @param {{key:string, file:string}} miss
 * @param {{narration:{voice:string|null}|null, musicMaker:string|null, intentional:boolean}} ctx
 */
export function classifyMissing(miss, ctx) {
  if (ctx.intentional) {
    return { kind: 'external-asset', label: '外部素材(有意不入库)', hint: '按任务 README / .gitignore 注释在本地自备' };
  }
  if (miss.key === 'music') {
    return ctx.musicMaker
      ? { kind: 'rebuildable-music', label: '可重建(配乐脚本)', hint: `node scripts/${ctx.musicMaker}` }
      : { kind: 'blocked-music', label: '阻塞(配乐床不在库)', hint: '仓库里没有生成这条 music 的脚本' };
  }
  if (!ctx.narration) {
    return { kind: 'blocked-no-script', label: '阻塞(无 narration.mjs)', hint: '没有旁白脚本，无从重建' };
  }
  if (ctx.narration.voice && EDGE_VOICE.test(ctx.narration.voice)) {
    return {
      kind: 'rebuildable-vo',
      label: '可重建(标准音色)',
      hint: `anim say <任务> --pin-timing + anim mix（VOICE=${ctx.narration.voice}）`,
    };
  }
  return {
    kind: 'blocked-voice',
    label: '阻塞(非标准音色)',
    hint: `VOICE=${ctx.narration.voice ?? '(未声明)'} 需要本机 TTS 服务/参考音频`,
  };
}

/** `.gitignore` 里被**逐条点名**的路径 = 有意不入库（不是"忘了生成"）。 */
export function readIntentionalIgnores(root = ROOT) {
  const set = new Set();
  try {
    for (const line of fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.includes('*')) continue;
      set.add(t.replace(/\\/g, '/'));
    }
  } catch { /* 没有 .gitignore 就当空集 */ }
  return set;
}

/** 配乐床的生成脚本：先找同名脚本，再退回 `task.config.mjs` 注释里点名的那一个。 */
export function findMusicMaker(taskDir, taskName, rawConfig = '') {
  const same = `make-${taskName}-audio.mjs`;
  if (fs.existsSync(path.join(ROOT, 'scripts', same))) return same;
  const m = /scripts\/(make-[\w.-]+\.mjs)/.exec(rawConfig);
  return m && fs.existsSync(path.join(ROOT, 'scripts', m[1])) ? m[1] : null;
}

/** 扫一个任务目录，返回它声明了但不存在的音频文件。 */
export function inspectTask(taskDir, taskName = path.basename(taskDir)) {
  const spec = readTaskAudioSpec(taskDir);
  if (!spec) return { task: taskName, declared: false, missing: [], narration: null };
  let rawConfig = '';
  try { rawConfig = fs.readFileSync(path.join(taskDir, 'task.config.mjs'), 'utf8'); } catch { /* 没配置 */ }
  const entries = typeof spec === 'string'
    ? [['mix', spec]]
    : Object.entries(spec).filter(([, v]) => typeof v === 'string' && AUDIO_EXT.test(v));
  const narration = readNarrationVoice(taskDir);
  const musicMaker = findMusicMaker(taskDir, taskName, rawConfig);
  const intentionalSet = readIntentionalIgnores();
  const missing = [];
  for (const [key, rel] of entries) {
    const clean = String(rel).replace(/^\.\//, '');
    const abs = path.join(taskDir, clean);
    if (fs.existsSync(abs)) continue;
    const miss = { key, file: String(rel) };
    const intentional = intentionalSet.has(`tasks/${taskName}/${clean}`);
    missing.push({ ...miss, ...classifyMissing(miss, { narration, musicMaker, intentional }) });
  }
  return { task: taskName, declared: true, missing, narration, spec };
}

/** 扫全部任务。 */
export function scanAll(root = ROOT) {
  const tasksDir = path.join(root, 'tasks');
  const rows = [];
  for (const d of fs.readdirSync(tasksDir).sort()) {
    const dir = path.join(tasksDir, d);
    if (!fs.existsSync(path.join(dir, 'task.config.mjs'))) continue;
    const r = inspectTask(dir, d);
    if (r.declared) rows.push(r);
  }
  return rows;
}

function summarize(rows) {
  const withAudio = rows.filter((r) => r.declared);
  const broken = withAudio.filter((r) => r.missing.length);
  const byKind = {};
  for (const r of broken) for (const m of r.missing) byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
  return { withAudio: withAudio.length, ok: withAudio.length - broken.length, broken: broken.length, byKind };
}

function selftest() {
  const cases = [
    [{ key: 'vo', file: 'a.mp3' }, { narration: { voice: 'zh-CN-YunxiNeural' }, musicMaker: null, intentional: false }, 'rebuildable-vo'],
    [{ key: 'mix', file: 'a.mp3' }, { narration: { voice: 'cotton-ja' }, musicMaker: null, intentional: false }, 'blocked-voice'],
    [{ key: 'vo', file: 'a.mp3' }, { narration: null, musicMaker: null, intentional: false }, 'blocked-no-script'],
    [{ key: 'music', file: 'b.mp3' }, { narration: { voice: 'zh-CN-YunxiNeural' }, musicMaker: null, intentional: false }, 'blocked-music'],
    [{ key: 'music', file: 'b.mp3' }, { narration: { voice: 'zh-CN-YunxiNeural' }, musicMaker: 'make-demo-audio.mjs', intentional: false }, 'rebuildable-music'],
    [{ key: 'mix', file: 'track.mp3' }, { narration: null, musicMaker: null, intentional: true }, 'external-asset'],
  ];
  let pass = 0;
  for (const [miss, ctx, want] of cases) {
    const got = classifyMissing(miss, ctx).kind;
    if (got !== want) throw new Error(`selftest: ${miss.key} ${JSON.stringify(ctx)} 期望 ${want}，得到 ${got}`);
    pass++;
  }
  // 真实仓库里 paperfold 现在应当"文件齐"（本机跑过 say/mix 之后）；干净克隆下则归入可重建。
  const pf = inspectTask(path.join(ROOT, 'tasks', 'paperfold'), 'paperfold');
  if (!pf.declared) throw new Error('selftest: paperfold 应当声明了 audio');
  for (const m of pf.missing) {
    if (m.kind !== 'rebuildable-vo') throw new Error(`selftest: paperfold 缺 ${m.file} 应判可重建，得到 ${m.kind}`);
  }
  // 有意不入库的那条版权音轨必须被识别成外部素材，而不是"阻塞"
  const wem = inspectTask(path.join(ROOT, 'tasks', 'world-execute-me'), 'world-execute-me');
  for (const m of wem.missing) {
    if (m.kind !== 'external-asset') throw new Error(`selftest: world-execute-me 的 ${m.file} 应判外部素材，得到 ${m.kind}`);
  }
  console.log(`lint-audio-assets: selftest PASS（${pass} 项分类 + paperfold/world-execute-me 实测）`);
}

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const rows = scanAll();
  const s = summarize(rows);
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ summary: s, tasks: rows }, null, 2));
  } else {
    console.log(`音频资产盘点：${s.withAudio} 个任务声明了 audio，${s.ok} 个文件齐，${s.broken} 个缺文件`);
    const broken = rows.filter((r) => r.missing.length);
    for (const r of broken) {
      console.log(`\n  ${r.task}`);
      for (const m of r.missing) console.log(`    ${m.label.padEnd(18)} ${m.key.padEnd(6)} ${m.file}   ← ${m.hint}`);
    }
    if (s.broken) {
      const parts = Object.entries(s.byKind).map(([k, n]) => `${k}=${n}`).join('  ');
      console.log(`\n  分类：${parts}`);
      console.log('  ⚠ 缺 vo/mix 不影响画面渲染，但成片会**没有声音且不报错**（`resolveAudioTracks()` 把缺文件判成 null）。');
      console.log('    重建前先确认 `--pin-timing` 能钉住既有 timing（否则段长会变，整片要重出）。');
    }
  }
  return s.broken && argv.includes('--strict') ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
