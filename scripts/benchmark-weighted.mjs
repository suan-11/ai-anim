// @ts-check
/** 播放量加权标杆统计：读 out/_benchmark/*-attn.json + batch*-meta.json，
 * 按 view_count 加权算基准曲线统计（均值/钩子/波幅/高位占比/锯齿周期/深谷）。
 * node scripts/benchmark-weighted.mjs [--group bit|aigen|math|all]
 * 产物 out/_benchmark/weighted-summary.json */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'out', '_benchmark');
const group = (process.argv.find(a => a.startsWith('--group'))?.split('=')[1]) ?? 'all';

// slug → {play, group, title}
const entries = [];
function addMeta(file, grp) {
  if (!existsSync(path.join(DIR, file))) return;
  const m = JSON.parse(readFileSync(path.join(DIR, file), 'utf8'));
  for (const [slug, v] of Object.entries(m)) entries.push({ slug, play: v.view_count, group: grp(v), title: v.title });
}
addMeta('batch2-meta.json', () => 'aigen');           // AI生成科普（实拍感AI画面）
addMeta('batch3-meta.json', (v) => v.uploader === '比特新语' ? 'bit' : 'math');
// 第一批手工补
entries.push({ slug: 'xingkong', play: 6120000, group: 'aigen', title: '星球最大' });
entries.push({ slug: 'yangqi', play: 5320000, group: 'aigen', title: '氧气消失5秒' });
entries.push({ slug: 'user', play: 2735309, group: 'bit', title: '剃刀（用户指定第一批）' });
entries.push({ slug: 'masike-qian', play: 3307771, group: 'aigen', title: '花光马斯克的钱' });

function stats(slug) {
  const f = path.join(DIR, `${slug}-attn.json`);
  if (!existsSync(f)) return null;
  const j = JSON.parse(readFileSync(f, 'utf8'));
  const s = j.samples.filter(x => x.A != null);
  if (s.length < 10) return null;
  const mean = s.reduce((a, x) => a + x.A, 0) / s.length;
  const hook = Math.max(...s.filter(x => x.t < 3).map(x => x.A));
  const max = Math.max(...s.map(x => x.A)), min = Math.min(...s.map(x => x.A));
  const hi65 = s.filter(x => x.A >= 0.65).length / s.length;
  const lo50 = s.filter(x => x.A < 0.5).length / s.length;
  // 平滑找峰谷
  const sm = s.map((x, i) => { const w = s.slice(Math.max(0, i - 2), i + 3); return { t: x.t, A: w.reduce((a, b) => a + b.A, 0) / w.length }; });
  const peaks = [], troughs = [];
  for (let i = 2; i < sm.length - 2; i++) { const v = sm[i].A;
    if (v > sm[i-1].A && v > sm[i+1].A && v > sm[i-2].A && v > sm[i+2].A) peaks.push(sm[i]);
    if (v < sm[i-1].A && v < sm[i+1].A && v < sm[i-2].A && v < sm[i+2].A) troughs.push(sm[i]); }
  const gaps = peaks.slice(1).map((p, i) => p.t - peaks[i].t).filter(g => g >= 2).sort((a, b) => a - b);
  const medGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  const amps = peaks.map(p => { const b = troughs.filter(t => t.t < p.t).pop(), a = troughs.find(t => t.t > p.t);
    const lows = [b?.A, a?.A].filter(x => x != null);
    return lows.length ? p.A - lows.reduce((x, y) => x + y, 0) / lows.length : null; }).filter(x => x != null);
  const meanAmp = amps.length ? amps.reduce((a, b) => a + b, 0) / amps.length : null;
  let run = 0, best = 0;
  for (const x of s) { if (x.A < 0.55) { run += j.step; best = Math.max(best, run); } else run = 0; }
  return { dur: j.duration, mean, hook, max, min, drop: max - min, hi65, lo50, medGap, meanAmp, lowRun: best, nPeaks: peaks.length };
}

const rows = [];
for (const e of entries) {
  if (group !== 'all' && e.group !== group) continue;
  const st = stats(e.slug);
  if (!st) { console.log(`[skip] ${e.slug} 无数据`); continue; }
  rows.push({ ...e, ...st });
}
rows.sort((a, b) => b.play - a.play);

function weighted(rs, key) {
  const valid = rs.filter(r => r[key] != null);
  const W = valid.reduce((a, r) => a + r.play, 0);
  return valid.reduce((a, r) => a + r[key] * r.play, 0) / W;
}
function report(name, rs) {
  if (!rs.length) return null;
  const totalPlay = rs.reduce((a, r) => a + r.play, 0);
  const out = { group: name, n: rs.length, totalPlay,
    mean: weighted(rs, 'mean'), hook: weighted(rs, 'hook'), drop: weighted(rs, 'drop'),
    hi65: weighted(rs, 'hi65'), lo50: weighted(rs, 'lo50'), medGap: weighted(rs, 'medGap'),
    meanAmp: weighted(rs, 'meanAmp'), lowRun: weighted(rs, 'lowRun') };
  console.log(`\n== ${name}（${rs.length}支，总播放${(totalPlay/1e4).toFixed(0)}万，播放量加权）==`);
  console.log(`A均值 ${out.mean.toFixed(3)} | 前3s峰 ${out.hook.toFixed(3)} | 落差 ${out.drop.toFixed(3)} | ≥0.65占比 ${(out.hi65*100).toFixed(1)}% | <0.5占比 ${(out.lo50*100).toFixed(1)}%`);
  console.log(`锯齿中位间隔 ${out.medGap.toFixed(1)}s | 平均波幅 ${out.meanAmp.toFixed(3)} | 最长<0.55段 ${out.lowRun.toFixed(1)}s`);
  return out;
}

console.log('slug                组     播放万  时长  A均值  钩子  落差  hi65  lo50  间隔  波幅  低段s');
for (const r of rows) console.log(
  r.slug.padEnd(19), r.group.padEnd(6), String(Math.round(r.play/1e4)).padStart(5),
  String(Math.round(r.dur)).padStart(5), r.mean.toFixed(2).padStart(6), r.hook.toFixed(2).padStart(5),
  r.drop.toFixed(2).padStart(5), (r.hi65*100).toFixed(0).padStart(4)+'%', (r.lo50*100).toFixed(0).padStart(4)+'%',
  (r.medGap??0).toFixed(1).padStart(5), (r.meanAmp??0).toFixed(3).padStart(6), r.lowRun.toFixed(1).padStart(5));

const summary = { all: report('全部', rows),
  bit: report('比特新语系（代码动画概念科普）', rows.filter(r => r.group === 'bit')),
  aigen: report('AI生成科普', rows.filter(r => r.group === 'aigen')),
  math: report('数学/概率讲解', rows.filter(r => r.group === 'math')) };
writeFileSync(path.join(DIR, 'weighted-summary.json'), JSON.stringify({ rows, summary }, null, 2));
console.log('\n→ out/_benchmark/weighted-summary.json');