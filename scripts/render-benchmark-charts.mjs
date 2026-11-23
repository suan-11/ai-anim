// @ts-check
/** 第二批B站标杆注意力折线图：每支一张 PNG（纯 Node 无依赖，SVG→ffmpeg 不可靠，直接画 PPM→ffmpeg）。
 * node scripts/render-benchmark-charts.mjs [slug...]   缺省=全部 batch2
 * 产物 out/_benchmark/charts/<slug>-curve.png */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'out', '_benchmark');
const OUT = path.join(DIR, 'charts');
mkdirSync(OUT, { recursive: true });

const slugs = process.argv.slice(2).length ? process.argv.slice(2)
  : readdirSync(DIR).filter(f => f.endsWith('-attn.json')).map(f => f.replace('-attn.json', ''));

const W = 1280, H = 480, PADL = 60, PADR = 20, PADT = 40, PADB = 50;
const PW = W - PADL - PADR, PH = H - PADT - PADB;

function drawChart(slug, samples, duration, title) {
  const px = Buffer.alloc(W * H * 3);
  const set = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = b; };
  const rect = (x0, y0, w, h, r, g, b) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, r, g, b); };
  const line = (x0, y0, x1, y1, r, g, b, th = 1) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) { const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n);
      for (let dy = -th; dy <= th; dy++) for (let dx = -th; dx <= th; dx++) set(x + dx, y + dy, r, g, b); }
  };
  // 底
  rect(0, 0, W, H, 24, 24, 28);
  rect(PADL, PADT, PW, PH, 32, 32, 38);
  const X = t => PADL + t / duration * PW;
  const Y = a => PADT + (1 - a) * PH;
  // 网格 0.1 步进 + 0.55/0.65 参考线
  for (let a = 0; a <= 1.001; a += 0.1) { const y = Math.round(Y(a)); line(PADL, y, W - PADR, y, 48, 48, 56); }
  line(PADL, Math.round(Y(0.65)), W - PADR, Math.round(Y(0.65)), 90, 130, 90, 0); // 高位线（绿）
  line(PADL, Math.round(Y(0.55)), W - PADR, Math.round(Y(0.55)), 130, 110, 60, 0); // 浅蹲线（黄）
  // 前3s钩子区
  rect(PADL, PADT, Math.round(X(3) - PADL), PH, 44, 40, 34);
  // 曲线（红）+ 3点平滑（亮红粗线）
  const s = samples.filter(r => r.A != null);
  for (let i = 1; i < s.length; i++) line(X(s[i - 1].t), Y(s[i - 1].A), X(s[i].t), Y(s[i].A), 160, 60, 60);
  const sm = s.map((r, i) => { const w = s.slice(Math.max(0, i - 2), i + 3); return { t: r.t, A: w.reduce((a, b) => a + b.A, 0) / w.length }; });
  for (let i = 1; i < sm.length; i++) line(X(sm[i - 1].t), Y(sm[i - 1].A), X(sm[i].t), Y(sm[i].A), 255, 90, 90, 1);
  // 轴刻度文字用 ffmpeg drawtext 叠（PPM 无字体）——先存 PPM
  const tmp = path.join(os.tmpdir(), `bench_${slug}_${Date.now()}.ppm`);
  writeFileSync(tmp, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), px]));
  const valid = s;
  const mean = valid.reduce((a, r) => a + r.A, 0) / valid.length;
  const hook = Math.max(...valid.filter(r => r.t < 3).map(r => r.A));
  const hi = valid.filter(r => r.A >= 0.65).length / valid.length;
  const label = `${slug}  mean=${mean.toFixed(2)} hook=${hook.toFixed(2)} hi65=${(hi * 100).toFixed(0)}pct  dur=${duration.toFixed(0)}s`;
  // drawtext 的 fontfile 冒号/反斜杠转义在 Windows 极易碎——改用 textfile + 默认字体；% 是展开符要避开
  const txt = path.join(os.tmpdir(), `bench_${slug}_${Date.now()}.txt`);
  writeFileSync(txt, label);
  const escPath = p => p.replace(/\\/g, '/').replace(/:/g, '\\:');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp,
    '-vf', `drawtext=textfile='${escPath(txt)}':x=60:y=8:fontsize=22:fontcolor=white`,
    path.join(OUT, `${slug}-curve.png`)]);
  try { require('node:fs').unlinkSync(tmp); require('node:fs').unlinkSync(txt); } catch {}
  return { mean, hook, hi };
}

const summary = [];
for (const slug of slugs) {
  const file = path.join(DIR, `${slug}-attn.json`);
  let j; try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { console.log(`[skip] ${slug}: 无 attn.json`); continue; }
  const r = drawChart(slug, j.samples, j.duration, slug);
  summary.push({ slug, ...r });
  console.log(`[chart] ${slug}-curve.png  mean=${r.mean.toFixed(2)} hook=${r.hook.toFixed(2)} hi65=${(r.hi * 100).toFixed(0)}%`);
}
writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('done →', OUT);