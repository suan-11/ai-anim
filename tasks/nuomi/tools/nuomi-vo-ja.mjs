#!/usr/bin/env node
/**
 * 15 支小糯米短片：**日语台词 + 中文字幕**（Cotton 配音）。
 *
 *   node tools/nuomi-vo-ja.mjs [--only nuomi3]
 *
 * 每支做五步：
 *   ① 按这一支**当前的段序**分配日语句子（表在 out/_ja_table.json，一段一句）；
 *   ② 写 narration.mjs（text=日语、zh=中文字幕）；
 *   ③ anim say --table ja（Cotton 合成，解出 slot）；
 *   ④ 用解出的 slot 回写 config 的 dur，并挂 captions + narration + audio.vo；
 *   ⑤ 生成 ja-sub-zh.narration.json（时间轴取日语，文本取中文）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tablePath = path.join(ROOT, 'out', '_ja_table.json');
if (!existsSync(tablePath)) { console.error('缺 out/_ja_table.json'); process.exit(2); }
const TABLE = JSON.parse(readFileSync(tablePath, 'utf8'));
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const env = {
  ...process.env,
  ANIM_GSV_API: process.env.ANIM_GSV_API || 'http://127.0.0.1:9880',
  ANIM_GSV_REF: process.env.ANIM_GSV_REF || 'D:/gptsov/_models/cotton/reference_audios/日语/ref_cotton.wav',
  ANIM_GSV_REF_TEXT: process.env.ANIM_GSV_REF_TEXT || 'お兄さんはいつまで、私に会いに来てくれますか？',
  ANIM_GSV_REF_LANG: 'ja',
  ANIM_GSV_TEXT_LANG: 'ja',
};

let done = 0;
for (const [name, lines] of Object.entries(TABLE)) {
  if (only && name !== only) continue;
  const dir = path.join(ROOT, 'tasks', name);
  const cfgPath = path.join(dir, 'task.config.mjs');
  if (!existsSync(cfgPath)) { console.log('  skip ' + name + '（没有任务）'); continue; }
  let cfg = readFileSync(cfgPath, 'utf8');
  const segs = (cfg.match(/type:\s*'[^']+'/g) || []).length;
  const use = lines.slice(0, segs);
  const scenes = use.map(([ja, zh], i) =>
    "  { id: 's" + (i + 1) + "', internal: 3.6, lines: [ { cue: 0.2, text: '" + ja + "', zh: '" + zh + "' } ] },");
  writeFileSync(path.join(dir, 'narration.mjs'), [
    '// 自动生成：一段一句（日语台词 + 中文字幕），Cotton 配音。',
    "export const VOICE = 'cotton-ja';",
    'export const TAIL = 0.3;',
    'export const MAX_STRETCH = 1.3;',
    'export const BPM = 80;',
    'export const OVERLAP = 0;',
    '',
    'export const SCENES = [',
    ...scenes,
    '];',
    '',
  ].join('\n'));

  try {
    execFileSync(process.execPath, ['scripts/anim.mjs', 'say', name, '--table', 'ja', '--rate', '+10%', '--tts', 'python tools/tts-gptsovits.py'], { cwd: ROOT, stdio: 'pipe', env });
  } catch { console.log('  ✗ ' + name + ' say 失败'); continue; }

  const timing = JSON.parse(readFileSync(path.join(dir, 'audio', 'ja.timing.json'), 'utf8'));
  let k = 0;
  cfg = cfg.replace(/dur:\s*[\d.]+/g, (m) => (k < timing.scenes.length ? 'dur: ' + timing.scenes[k++].slot.toFixed(2) : m));
  if (!/captions:\s*true/.test(cfg)) cfg = cfg.replace(/(\n\s*style:\s*'[^']+',)/, '$1\n  captions: true,');
  cfg = cfg.replace(/narration:\s*'[^']*',?/g, '');
  cfg = cfg.replace(/(\n\s*style:\s*'[^']+',)/, "$1\n  narration: './audio/ja-sub-zh.narration.json',");
  cfg = cfg.replace(/audio:\s*\{[^}]*\},?/, "audio: { vo: './audio/ja-vo.mp3' },");
  if (!/audio:\s*\{/.test(cfg)) cfg = cfg.replace(/(\n\s*style:\s*'[^']+',)/, "$1\n  audio: { vo: './audio/ja-vo.mp3' },");
  writeFileSync(cfgPath, cfg);

  // 中文字幕表：时间轴取日语，文本取 zh
  const sub = { source: './audio/ja-vo.mp3', lines: timing.scenes.flatMap((sc, i) => sc.lines.map((l, j) => ({
    id: 's' + (i + 1) + '-' + (j + 1), text: use[i] ? use[i][1] : l.text, start: l.start, dur: l.dur,
  }))) };
  writeFileSync(path.join(dir, 'audio', 'ja-sub-zh.narration.json'), JSON.stringify(sub, null, 2) + '\n');
  console.log('  · ' + name.padEnd(8) + segs + ' 段  ' + timing.total.toFixed(1) + 's  日语配音 + 中文字幕');
  done++;
}
console.log('');
console.log('✓ 完成 ' + done + ' 支');
