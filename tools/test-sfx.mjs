#!/usr/bin/env node
/**
 * tools/test-sfx.mjs —— 音效这一层的离线回归（纯 JS，不需要 GPU、不联网）。
 *
 * 断言的是**判据**而不是「跑得通」：
 *   ① 库里找得到、找不到要抛（静默放过 = 加的音效没响而没人知道）；
 *   ② 自动摆位：第一条段不摆、每个切点一条、时间严格等于段首；
 *   ③ 混音：能量确实加上去了、位置对、越界 / 缺文件被跳过并记账；
 *   ④ 峰归一：不同来源的素材混进来量级一致（不归一会出现「有的听不见」）；
 *   ⑤ 侧链：音效出现的那一小段音乐被压下去（否则 whoosh 会被埋）。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findSfx, autoSfx, mixSfx } from '../scripts/lib/mix.mjs';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; console.log('  ✓ ' + msg); };

console.log('音效库');
const whoosh = findSfx('whoosh');
ok(existsSync(whoosh), '找得到 whoosh：' + path.basename(whoosh));
let threw = false;
try { findSfx('绝不存在的类别'); } catch { threw = true; }
ok(threw, '找不到的类别必须抛（不是返回 null）');

console.log('自动摆位');
const segs = [{ start: 0 }, { start: 4.2 }, { start: 9.6 }, { start: 15.2 }];
const items = autoSfx(segs);
eq(items.length, 3, '第一条段不摆，其余 3 个切点各一条');
eq(items.map((x) => x.at), [4.2, 9.6, 15.2], '时间严格等于段首');
ok(items.every((x) => x.gain > 1), '默认增益 >1（相对峰归一的倍数，要压过音乐床）');

console.log('混音');
const sr = 8000;
const n = sr * 2;
const L = new Float32Array(n), R = new Float32Array(n);
const dir = mkdtempSync(path.join(os.tmpdir(), 'sfx-test-'));
const tone = path.join(dir, 'tone.wav');
{
  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sr, 24); data.writeUInt32LE(sr * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = i < sr * 0.1 ? Math.sin((2 * Math.PI * 440 * i) / sr) * 0.2 : 0;
    data.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(tone, data);
}
const energy = (from, to, arr) => { let s = 0; for (let i = from; i < to; i++) s += Math.abs(arr[i]); return s; };
const rep = mixSfx(L, R, [{ file: tone, at: 1.0, gain: 1, fadeIn: 0, fadeOut: 0 }], { sr });
eq(rep.placed, 1, '一条音效被摆上');
eq(rep.skipped.length, 0, '没有被跳过的');
eq(energy(0, sr * 0.9, L), 0, '声源之前整段是静音');
ok(energy(sr, sr * 1.1, L) > 50, '声源窗口里有能量（位置对）');
eq(energy(sr * 1.2, sr * 2, L), 0, '窗口之外仍然静音（没有整轨糊上去）');
const rep2 = mixSfx(L, R, [{ file: path.join(os.tmpdir(), '不存在.mp3'), at: 0.5 }, { file: tone, at: 999 }], { sr });
eq(rep2.placed, 0, '摆不上的都不算');
eq(rep2.skipped.length, 2, '缺文件 / 越界都记账（写进 skipped，不静默）');

console.log('侧链');
const L2 = new Float32Array(n).fill(0.5), R2 = new Float32Array(n).fill(0.5);
mixSfx(L2, R2, [{ file: tone, at: 1.0, gain: 1, duck: 1, duckLen: 0.2 }], { sr });
const atStart = Math.abs(L2[Math.round(sr * 1.002)]);
ok(atStart < 0.4, '音效出现时床被压下去（' + atStart.toFixed(3) + ' < 0.5）');
const later = Math.abs(L2[Math.round(sr * 1.5)]);
ok(Math.abs(later - 0.5) < 1e-6, '侧链只作用在一小段，之后恢复');

console.log('索引（assets/sfx/catalog.json）');
const catPath = path.join(process.cwd(), 'assets', 'sfx', 'catalog.json');
if (existsSync(catPath)) {
  const cat = JSON.parse(readFileSync(catPath, 'utf8'));
  ok(cat.count > 500, '索引条数 > 500（现在 ' + cat.count + '）');
  ok(cat.items.every((x) => x.id && x.category && x.path), '每条都有 id / category / path');
  const ids = new Set(cat.items.map((x) => x.id));
  ok(ids.size === cat.items.length, 'id 不重复');
} else {
  console.log('  · 没有索引（跳过）');
}


console.log('语义规则（designSfx）');
const { designSfx, summarize } = await import('../scripts/lib/sfx-rules.mjs');
const rolesAt = (items, t) => items.filter((x) => Math.abs(x.at - t) < 0.02).map((x) => x.role);
{
  const segs2 = [
    { id: 'title', start: 0 },
    { id: 'chart', start: 4 },
    { id: 'kinetic', start: 9 },
    { id: 'outro', start: 13 },
  ];
  const { items: d, missing } = designSfx(segs2);
  eq(missing.length, 0, '库里各类角色都齐');
  ok(rolesAt(d, 0).includes('destruction'), '标题段：有撞击（destruction）');
  ok(rolesAt(d, 0).includes('camera-flash'), '标题段：有闪（camera-flash）');
  ok(!rolesAt(d, 0).includes('whoosh'), '第一条段不放切点风');
  ok(rolesAt(d, 4).includes('digital-click'), '图表段：UI 声而不是风');
  ok(rolesAt(d, 9).includes('destruction'), '动态大字段：也是撞击');
  eq(rolesAt(d, 13), ['power-outage'], '片尾：断电，且不给别的声');
  ok(d.some((x) => x.role === 'riser' || x.role === 'riser-in'), '大字之前先吸气');
}
{
  const lyric = [
    { id: 'k01', start: 0, params: { mode: 'mask' } },
    { id: 'k02', start: 3, params: { mode: 'karaoke' } },
    { id: 'k03', start: 6, params: { mode: 'karaoke' } },
    { id: 'k04', start: 9, params: { mode: 'glitch' } },
    { id: 'k05', start: 12, params: { mode: 'karaoke' } },
    { id: 'k06', start: 15, params: { mode: 'mask' } },
  ];
  const { items: l } = designSfx(lyric);
  ok(rolesAt(l, 3).includes('whoosh'), '换族（display → sing）给一声风');
  eq(rolesAt(l, 6), [], '同族延续（karaoke → karaoke）不给切点声');
  ok(rolesAt(l, 9).includes('glitch'), 'glitch 段给故障声');
  eq(rolesAt(l, 15), ['power-outage'], '最后一段断电');
  ok(summarize(l).length > 0, '摘要能念出用量（' + summarize(l) + '）');
}
console.log('\n✓ 音效回归：' + passed + ' 项通过');
