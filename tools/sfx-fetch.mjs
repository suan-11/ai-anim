#!/usr/bin/env node
/**
 * tools/sfx-fetch.mjs —— 从 SoundDino 取音效：**先建索引，再挑着下**。
 *
 *   node tools/sfx-fetch.mjs --index [--categories a,b,c] [--out assets/sfx/catalog.json]
 *   node tools/sfx-fetch.mjs --search whoosh [--limit 20]
 *   node tools/sfx-fetch.mjs --list --category whoosh-transition
 *   node tools/sfx-fetch.mjs --pick 1,3,6 --category whoosh-transition --dir assets/sfx
 *   node tools/sfx-fetch.mjs --get 73722,79283 --category glitch --dir tasks/<任务>/audio/sfx
 *
 * 站点事实（2026-10 实测）：分类页里每条曲目带 data-id / data-duration / data-track；
 * 音频是同域静态文件；首页 FAQ 写明免费、可商用、无需署名。
 * ⚠ 页脚有匿名配额「Downloads left today Sounds 5/5 · Music 5/5」—— 所以默认 --max 5、--gap 800，
 *   宁可多跑几次，也不去顶站点限额（docs/RULES.md S3）。
 *
 * 索引（catalog）只存**元数据**，不含音频，可以放心进仓库；
 * 下下来的 mp3 连同 sfx.manifest.json 一起落在 --dir 目录（出处 + 许可 + sha1 都记着）。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) anim-sfx/1.1';
const SITE = 'https://sounddino.com';
const MAX_PER_RUN = Number(opt('max', '5'));
const GAP_MS = Number(opt('gap', '800'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 做动效最常用的一批分类（索引默认跑这些，而不是全 1341 个） */
export const DEFAULT_CATEGORIES = [
  'whoosh-transition', 'glitch', 'interference', 'short-circuit', 'power-outage',
  'click', 'button-click', 'digital-click', 'toggle-switch', 'clicking',
  'pop', 'impulse', 'collision', 'knock', 'snap', 'crack', 'destruction',
  'sparks', 'energy', 'laser', 'pew-pew', 'electric-effects',
  'typing', 'clock-ticking', 'countdown', 'camera-flash',
  'correct-answer', 'fail', 'ta-da', 'alarm', 'siren', 'danger',
  'robots', 'holograms', 'computer-of-the-future', 'sci-fi',
];

async function getText(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(url + ' → HTTP ' + res.status);
  return res.text();
}

/** 解析分类页 → [{ id, title, group, durationSec, track, category }] */
export function parseCategory(html, category = '') {
  const out = [];
  const re = /<li class="playtrack[^"]*"([^>]*)>([\s\S]*?)(?=<li class="playtrack|<\/ul>)/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1], body = m[2];
    const id = (attrs.match(/data-id="(\d+)"/) || [])[1];
    const track = (attrs.match(/data-track="([^"]+)"/) || [])[1];
    const dur = Number((attrs.match(/data-duration="([\d.]+)"/) || [])[1] || 0);
    const title = ((body.match(/<div class="name">([^<]*)</) || [])[1] || '').trim();
    if (!id || !track) continue;
    out.push({ id, title, durationSec: dur, track, category });
  }
  const heads = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((x) => ({ at: x.index, name: x[1].trim() }));
  for (const it of out) {
    const at = html.indexOf('data-id="' + it.id + '"');
    let g = '';
    for (const h of heads) if (h.at < at) g = h.name;
    it.group = g;
  }
  return out;
}

function sha1(buf) { return createHash('sha1').update(buf).digest('hex').slice(0, 12); }

/** 纯 JS 数 mp3 帧算时长（沙箱里别指望 ffprobe；data-duration 是取整的） */
export function mp3Duration(buf) {
  const BR = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
  const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  let i = 0;
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    i = 10 + size;
  }
  let frames = 0, samples = 0, lastSr = 44100;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const verBits = (buf[i + 1] >> 3) & 0x03, layer = (buf[i + 1] >> 1) & 0x03;
    const brIdx = (buf[i + 2] >> 4) & 0x0f, srIdx = (buf[i + 2] >> 2) & 0x03, pad = (buf[i + 2] >> 1) & 0x01;
    if (layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) { i++; continue; }
    const table = verBits === 3 ? BR[1] : BR[2];
    const bitrate = table[brIdx] * 1000;
    const sr = SR[verBits] ? SR[verBits][srIdx] : 44100;
    const spf = verBits === 3 ? 1152 : 576;
    const len = Math.floor(((spf / 8) * bitrate) / sr) + pad;
    if (!Number.isFinite(len) || len <= 0) { i++; continue; }
    frames++; samples += spf; lastSr = sr; i += len;
  }
  return frames ? samples / lastSr : 0;
}

/** 索引：把一批分类页的元数据并进 catalog */
async function buildIndex(categories, outPath) {
  const cat = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : { site: SITE, updatedAt: '', count: 0, items: [] };
  const have = new Set(cat.items.map((x) => x.id));
  let added = 0;
  for (const c of categories) {
    try {
      const html = await getText(SITE + '/en/effects/' + c + '/');
      const items = parseCategory(html, c);
      let n = 0;
      for (const it of items) {
        if (have.has(it.id)) continue;
        have.add(it.id);
        cat.items.push({ id: it.id, title: it.title, group: it.group ?? '', category: c, durationSec: it.durationSec, path: it.track });
        n++;
      }
      added += n;
      console.log('  ' + c.padEnd(24) + String(items.length).padStart(4) + ' 条（新增 ' + n + '）');
    } catch (e) {
      console.log('  ' + c.padEnd(24) + '✗ ' + String(e.message).slice(0, 60));
    }
    await sleep(GAP_MS);
  }
  cat.count = cat.items.length;
  cat.updatedAt = new Date().toISOString().slice(0, 10);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(cat, null, 1) + '\n');
  console.log('\n索引：' + cat.count + ' 条（本次新增 ' + added + '）→ ' + path.relative(ROOT, outPath));
}

async function download(items, outDir, category) {
  mkdirSync(outDir, { recursive: true });
  const manPath = path.join(outDir, 'sfx.manifest.json');
  const man = existsSync(manPath) ? JSON.parse(readFileSync(manPath, 'utf8')) : { sounds: [] };
  let n = 0;
  for (const it of items) {
    if (n >= MAX_PER_RUN) { console.log('· 到本次上限 --max ' + MAX_PER_RUN + '，剩下的下次再拉'); break; }
    if (man.sounds.some((s) => s.id === it.id)) { console.log('· 已有 ' + it.id + '，跳过'); continue; }
    const url = SITE + (it.track ?? it.path);
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (!res.ok) { console.log('✗ ' + it.id + ' → HTTP ' + res.status); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const safe = (it.title || 'sound').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'sound';
    const file = category + '__' + it.id + '__' + safe + '.mp3';
    writeFileSync(path.join(outDir, file), buf);
    const dur = mp3Duration(buf) || it.durationSec || 0;
    man.sounds.push({
      id: it.id, title: it.title, group: it.group ?? '', category,
      file, bytes: buf.length, sha1: sha1(buf),
      durationSec: Number(dur.toFixed(2)),
      source: SITE + '/en/effects/' + category + '/',
      license: 'SoundDino 免费授权（可商用 / 无需署名；以站点条款为准）',
      fetchedAt: new Date().toISOString().slice(0, 10),
    });
    console.log('✓ ' + it.id + ' ' + (it.title || '') + ' → ' + file + ' (' + (buf.length / 1024).toFixed(0) + ' KB, ' + dur.toFixed(2) + 's)');
    n++;
    await sleep(GAP_MS);
  }
  writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n');
  console.log('· manifest: ' + path.relative(ROOT, manPath) + '（共 ' + man.sounds.length + ' 条）');
}

const catalogPath = path.resolve(ROOT, opt('catalog', 'assets/sfx/catalog.json'));
const category = opt('category', 'whoosh-transition');
const dlDir = opt('dir', '');

try {
  if (flag('index')) {
    const cats = opt('categories', '');
    const list = cats ? cats.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_CATEGORIES;
    console.log('索引 ' + list.length + ' 个分类（间隔 ' + GAP_MS + 'ms）…');
    await buildIndex(list, catalogPath);
  } else if (flag('search')) {
    const kw = String(opt('search', '')).toLowerCase();
    const lim = Number(opt('limit', '20'));
    if (!existsSync(catalogPath)) throw new Error('还没有索引 —— 先跑 --index');
    const cat = JSON.parse(readFileSync(catalogPath, 'utf8'));
    const hits = cat.items.filter((x) => (x.title + ' ' + x.category + ' ' + x.group).toLowerCase().includes(kw));
    console.log('索引 ' + cat.count + ' 条 · 命中 ' + hits.length + ' 条' + (kw ? '（关键词 ' + kw + '）' : ''));
    for (const h of hits.slice(0, lim)) console.log('  ' + String(h.id).padEnd(8) + String(h.durationSec).padStart(4) + 's  ' + h.category.padEnd(22) + h.title);
  }

  if (flag('list') || flag('get') || flag('pick')) {
    const html = await getText(SITE + '/en/effects/' + category + '/');
    const items = parseCategory(html, category);
    console.log('分类页 ' + category + ' · ' + items.length + ' 条');
    const ids = opt('get', ''), pick = opt('pick', '');
    let chosen = [];
    if (ids) {
      const want = ids.split(',').map((s) => s.trim());
      chosen = items.filter((it) => want.includes(it.id));
      const miss = want.filter((w) => !items.some((it) => it.id === w));
      if (miss.length) console.log('· 本页没有这些 id：' + miss.join(','));
    } else if (pick) {
      chosen = pick.split(',').map((s) => items[Number(s.trim()) - 1]).filter(Boolean);
    }
    if (!chosen.length) {
      items.forEach((it, i) => console.log('  ' + String(i + 1).padStart(3) + '  ' + it.id.padEnd(8) + String(it.durationSec).padStart(4) + 's  ' + (it.group || '-').padEnd(22) + (it.title || '')));
      console.log('\n用法：--pick 1,3 --category ' + category + ' --dir assets/sfx');
    } else {
      if (!dlDir) throw new Error('下载要 --dir <目录>（共享库存用 assets/sfx，单片用 tasks/<任务>/audio/sfx）');
      await download(chosen, path.resolve(ROOT, dlDir), category);
    }
  }
} catch (e) {
  console.error('✗ ' + (e && e.message ? e.message : e));
  process.exitCode = 1;
}
