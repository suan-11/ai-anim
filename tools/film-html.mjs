#!/usr/bin/env node
/**
 * tools/film-html.mjs —— 把一支片子打成**一个 HTML 文件**（`anim film-html <任务>`）。
 *
 * 来源：OpenFilm「一个 HTML 文件就是一支片子」。我们这边是：
 *   · 引擎 + 场景 + 时间线**打成 IIFE**（esbuild）；
 *   · 音轨（可选）内联成 data URI；
 *   · 输出 `out/<任务>/film.html`，双击即可播放（无需 Node / Vite / 联网）。
 *
 * 播放器和成片走**同一条渲染路径**（`engine.render(t, { preview:true, toScreen:true })`），
 * 而 `render(t)` 是 t 的纯函数 —— 所以拖进度条、暂停、逐帧都不会和预览不一致。
 *
 * ⚠ 大音轨会小心：超过 --max-audio MB（默认 20）就不内联，改成同目录的 `<audio>` 相对路径，
 *   并在 stdout 说明（HTML 会变成「必须和音频文件放在一起」）。
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const task = argv.find((a) => !a.startsWith('--'));
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
if (!task) { console.error('用法：node tools/film-html.mjs <任务> [--out 路径] [--max-audio 20] [--no-audio]'); process.exit(2); }

const dir = path.join(ROOT, 'tasks', task);
if (!existsSync(dir)) { console.error('✗ 没有任务 ' + task); process.exit(2); }
const outPath = path.resolve(ROOT, opt('out', path.join('out', task, 'film.html')));
const maxAudioMB = Number(opt('max-audio', '20'));
const noAudio = argv.includes('--no-audio');

const cfgPath = path.join(dir, 'task.config.mjs');
if (!existsSync(cfgPath)) { console.error('✗ 这个任务没有 task.config.mjs（单文件播放器只支持配置档）'); process.exit(2); }
const mod = await import(new URL('../tasks/' + task + '/task.config.mjs', import.meta.url).href);
const cfg = mod.default ?? mod.config;
if (!cfg?.timeline) { console.error('✗ 任务没有导出 timeline'); process.exit(2); }

// 音轨：内联 or 同目录
let audioExpr = "''";
let audioNote = '无音轨';
const audioRel = typeof cfg.audio === 'string' ? cfg.audio : cfg.audio?.music;
if (audioRel && !noAudio) {
  const audioAbs = path.resolve(dir, audioRel);
  if (existsSync(audioAbs)) {
    const mb = statSync(audioAbs).size / 1048576;
    if (mb <= maxAudioMB) {
      const b64 = readFileSync(audioAbs).toString('base64');
      const mime = audioRel.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
      audioExpr = "'data:" + mime + ";base64," + b64 + "'";
      audioNote = `内联音轨 ${mb.toFixed(1)} MB`;
    } else {
      const copies = path.join(path.dirname(outPath), path.basename(audioRel));
      mkdirSync(path.dirname(outPath), { recursive: true });
      writeFileSync(copies, readFileSync(audioAbs));
      audioExpr = JSON.stringify(path.basename(audioRel));
      audioNote = `音轨 ${mb.toFixed(1)} MB 太大，已复制到同目录（HTML 需与它放在一起）`;
    }
  }
}

// 音频分析（可选）：给 f.beat / f.a.* 用
let musicExpr = 'null';
const adir = path.join(dir, 'audio');
if (existsSync(adir)) {
  const an = readdirSync(adir).filter((f) => f.endsWith('.analysis.json'));
  if (an.length) {
    const rel = path.relative(path.join(ROOT, 'src'), path.join(adir, an[0])).replace(/\\/g, '/');
    musicExpr = 'new MusicData(' + JSON.stringify('./' + '') + 'x)';
    musicExpr = 'music' + 'Json';
    // 真正的导入在下面的临时入口里（这里只留占位）
    musicExpr = '__ANALYSIS__';
  }
}

const tmp = path.join(ROOT, 'out', '_film', task);
mkdirSync(tmp, { recursive: true });
const entry = path.join(tmp, 'entry.js');
const rel = (p) => path.relative(tmp, p).replace(/\\/g, '/');

const analysisFile = (() => {
  if (!existsSync(adir)) return null;
  const an = readdirSync(adir).filter((f) => f.endsWith('.analysis.json'));
  return an.length ? path.join(adir, an[0]) : null;
})();

const lines = [
  "import { mountFilm } from '" + rel(path.join(ROOT, 'src', 'player.js')) + "';",
  "import { resolveStyle } from '" + rel(path.join(ROOT, 'src', 'style', 'index.js')) + "';",
  "import { MusicData } from '" + rel(path.join(ROOT, 'src', 'core', 'audio.js')) + "';",
  "import cfg from '" + rel(cfgPath) + "';",
];
if (analysisFile) lines.push("import analysis from '" + rel(analysisFile) + "';");
lines.push('');
lines.push('const styleResolved = resolveStyle(cfg);');
lines.push('const music = ' + (analysisFile ? 'new MusicData(analysis, { url: ' + JSON.stringify(path.basename(audioRel ?? '')) + ' })' : 'null') + ';');
lines.push('mountFilm({ cfg, styleResolved, music, audioUrl: ' + audioExpr + ', title: ' + JSON.stringify(cfg.title ?? task) + ' });');
writeFileSync(entry, lines.join('\n') + '\n');

const res = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: ['chrome110'],
  loader: { '.json': 'json' },
  logLevel: 'silent',
});
const js = res.outputFiles[0].text;

const html = [
  '<!doctype html>',
  '<html lang="zh">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>' + String(cfg.title ?? task).replace(/</g, '&lt;') + '</title>',
  '</head>',
  '<body>',
  '<div id="film"></div>',
  '<script>' + js + '</script>',
  '</body>',
  '</html>',
].join('\n');

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
const sizeMB = (statSync(outPath).size / 1048576).toFixed(1);
console.log('✓ ' + path.relative(ROOT, outPath) + '  ' + sizeMB + ' MB  ·  ' + audioNote);
console.log('  双击就能播（空格 播放/暂停 · ←→ 逐帧 · 拖进度条）');
