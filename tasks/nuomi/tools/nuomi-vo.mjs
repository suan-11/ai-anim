#!/usr/bin/env node
/** 给 15 支 nuomi 短片配中文旁白：写 narration.mjs → say → 用解出来的 slot 回写 dur → 挂 audio。 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tasks = readdirSync(path.join(ROOT, 'tasks')).filter((d) => /^nuomi\d*$/.test(d)).sort();
const pick = (src, key) => {
  const m = new RegExp(key + ":\\s*'([^']+)'").exec(src);
  return m ? m[1] : '';
};

let done = 0;
for (const name of tasks) {
  const dir = path.join(ROOT, 'tasks', name);
  const cfgPath = path.join(dir, 'task.config.mjs');
  if (!existsSync(cfgPath)) continue;
  let cfg = readFileSync(cfgPath, 'utf8');
  const segs = (cfg.match(/type:\s*'[^']+'/g) || []).length;
  if (!segs) continue;

  /**
   * 句子从**这一支配置里所有中文短句**按出现顺序取（去重）——
   * 原来只抽 title/line1/line2/text/label/name 六处再循环使用，
   * 结果第 4、5 段在复述第 1、2 段，等于自己制造同质化。
   */
  const all = [...cfg.matchAll(/'([^']*[\u4e00-\u9fa5][^']*)'/g)]
    .map((m) => m[1].replace(/\\n/g, '，').replace(/，+$/, '').trim())
    .filter((s) => s.length >= 4 && s.length <= 26)
    // 眉标不是旁白：`SCAN / 纸箱侦测`、`INNOCENT · 完全无辜` 这类念出来不像人话
    .filter((s) => !s.includes('/') && !s.includes('·') && !/^[A-Z0-9]/.test(s));
  const pool = [];
  for (const s of all) if (!pool.includes(s)) pool.push(s);
  if (!pool.length) { console.log('  · ' + name + ' 没有可用的文案，跳过'); continue; }

  const lines = [];
  for (let i = 0; i < segs; i++) {
    const text = pool[i % pool.length].slice(0, 18);
    lines.push('  { id: \'s' + (i + 1) + '\', internal: 2.4, lines: [ { cue: 0.2, text: \'' + text.replace(/'/g, '') + '\' } ] },');
  }
  const narr = [
    '// 自动生成：一支短片一段一句（中文，edge-tts Xiaoyi）。',
    "export const VOICE = 'zh-CN-XiaoyiNeural';",
    'export const TAIL = 0.3;',
    'export const MAX_STRETCH = 1.25;',
    'export const BPM = 80;',
    'export const OVERLAP = 0;',
    '',
    'export const SCENES = [',
    ...lines,
    '];',
    '',
  ].join('\n');
  writeFileSync(path.join(dir, 'narration.mjs'), narr);

  try {
    // 用**我们自己的 Cotton**（GPT-SoVITS v2Pro）配音，不是 edge-tts。
    // 文本仍是中文（跨语种合成，句尾带一点日语腔 —— 交接单里写明的取舍）。
    const env = {
      ...process.env,
      ANIM_GSV_API: process.env.ANIM_GSV_API || 'http://127.0.0.1:9880',
      ANIM_GSV_REF: process.env.ANIM_GSV_REF || 'D:/gptsov/_models/cotton/reference_audios/日语/ref_cotton.wav',
      ANIM_GSV_REF_TEXT: process.env.ANIM_GSV_REF_TEXT || 'お兄さんはいつまで、私に会いに来てくれますか？',
      ANIM_GSV_REF_LANG: 'ja',
      ANIM_GSV_TEXT_LANG: process.env.ANIM_GSV_TEXT_LANG || 'zh',
    };
    execFileSync(process.execPath, ['scripts/anim.mjs', 'say', name, '--rate', '+6%', '--tts', 'python tools/tts-gptsovits.py'], { cwd: ROOT, stdio: 'pipe', env });
  } catch (e) {
    console.log('  ✗ ' + name + ' say 失败');
    continue;
  }
  const timing = JSON.parse(readFileSync(path.join(dir, 'audio', 'timing.json'), 'utf8'));
  const slots = timing.scenes.map((s) => s.slot);
  let k = 0;
  cfg = cfg.replace(/dur:\s*[\d.]+/g, (m) => (k < slots.length ? 'dur: ' + slots[k++].toFixed(2) : m));
  if (!/audio:\s*\{/.test(cfg)) {
    cfg = cfg.replace(/(\n\s*style:\s*'[^']+',)/, "$1\n  audio: { vo: './audio/" + name + "-vo.mp3' },");
  }
  writeFileSync(cfgPath, cfg);
  const total = timing.total.toFixed(1);
  console.log('  · ' + name.padEnd(8) + ' ' + segs + ' 段  ' + total + 's  vo 已挂');
  done++;
}
console.log('');
console.log('✓ 配音完成 ' + done + ' 支');
