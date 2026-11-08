import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tasks = readdirSync(path.join(ROOT, 'tasks')).filter((d) => /^nuomi\d*$/.test(d)).sort();

/** 把 timeline: [ ... ] 里的段切成块（按顶层 { } 匹配），返回 { head, blocks, tail } */
function splitTimeline(src) {
  const i = src.indexOf('timeline: [');
  if (i < 0) return null;
  const start = src.indexOf('[', i);
  let depth = 0, end = -1;
  for (let k = start; k < src.length; k++) {
    const c = src[k];
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0 && c === ']') { end = k; break; } }
  }
  if (end < 0) return null;
  const body = src.slice(start + 1, end);
  const blocks = [];
  let d = 0, cur = '';
  for (const c of body) {
    if (c === '{') { if (d === 0) cur = ''; d++; }
    if (d > 0) cur += c;
    if (c === '}') { d--; if (d === 0) blocks.push(cur); }
  }
  return { head: src.slice(0, start + 1), blocks, tail: src.slice(end) };
}

let n = 0;
for (const [i, name] of tasks.entries()) {
  const p = path.join(ROOT, 'tasks', name, 'task.config.mjs');
  const src = readFileSync(p, 'utf8');
  const t = splitTimeline(src);
  if (!t || t.blocks.length < 4) { console.log('  skip', name); continue; }
  const b = t.blocks;
  const typeOf = (s) => (/'type':\s*'([^']+)'|type:\s*'([^']+)'/.exec(s) || [])[1] || (/'type':\s*'([^']+)'|type:\s*'([^']+)'/.exec(s) || [])[2] || '?';
  // 首段保住（片头），末段若是 lockup/outro 也保住；中间的段按序号循环移位
  const lastLock = /lockup|outro/.test(b[b.length - 1]);
  const midStart = 1, midEnd = lastLock ? b.length - 1 : b.length;
  const mid = b.slice(midStart, midEnd);
  const off = (i * 2 + 1) % Math.max(1, mid.length);
  const rotated = mid.slice(off).concat(mid.slice(0, off));
  const out = [b[0], ...rotated, ...(lastLock ? [b[b.length - 1]] : [])];
  const body = out.map((s) => '    ' + s + ',').join('\n');
  writeFileSync(p, t.head + '\n' + body + '\n  ' + t.tail);
  n++;
  console.log('  · ' + name.padEnd(8) + ' 段序 → ' + out.map(typeOf).join(' → '));
}
console.log('');
console.log('✓ 重排 ' + n + ' 支');