#!/usr/bin/env node
// @ts-check
/**
 * tools/lint-craft.mjs —— 「偷懒检测」量具（docs/CRAFT.md §6）。
 *
 *   node tools/lint-craft.mjs <任务> [--stills dir] [--only a,b] [--json] [--strict]
 *
 * 只读源码（task.config.mjs + scenes/**.js）+ 可选 PNG stills（用 ffprobe + ffmpeg rawvideo，
 * 绝不解码 mp4）。默认退出码 0（只报读数），--strict 时有任意发现即退出码 1。不进 check。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from '../src/timeline.js';
import { SHOTS } from '../src/shots/index.js';
import { blankJsComments } from '../scripts/lib/js-source.mjs';
import { scanSource, taskSignals, pixelSignals, computeCraftScore } from './lib/craft-signals.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, d = '') => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

/** 收集任务下的 task.config.mjs 与 scenes/**.js */
function collectTaskFiles(taskDir, onlySet = null, segSceneFiles = null) {
  /** @type {{ file: string, text: string }[]} */
  const out = [];
  const cfgPath = path.join(taskDir, 'task.config.mjs');
  if (existsSync(cfgPath)) {
    out.push({ file: path.relative(ROOT, cfgPath).replace(/\\/g, '/'), text: readFileSync(cfgPath, 'utf8') });
  }
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.js')) {
        const rel = path.relative(ROOT, p).replace(/\\/g, '/');
        if (onlySet && segSceneFiles && !e.name.startsWith('_') && !segSceneFiles.has(e.name.replace(/\.js$/, ''))) {
          continue;
        }
        out.push({ file: rel, text: readFileSync(p, 'utf8') });
      }
    }
  };
  walk(path.join(taskDir, 'scenes'));
  return out;
}

/** 扫描静态模板引用（排除 placeholder 占位符）。 */
function scanTemplateNames(files, knownNames) {
  const names = new Set(knownNames);
  const found = [];
  for (const f of files) {
    const code = blankJsComments(f.text);
    for (const m of code.matchAll(/(?:\bshot\s*\(\s*|(?:^|[,{[\s])type\s*:\s*)['"]([\w-]+)['"]/g)) {
      if (names.has(m[1]) && m[1] !== 'placeholder') found.push(m[1]);
    }
  }
  return found;
}

/** 用 ffprobe + ffmpeg 解码单张 PNG 为裸 RGBA（沿用 tools/png-rows.mjs 口径）。 */
function decodePngRgba(file) {
  const ffprobe = process.env.ANIM_FFPROBE || 'ffprobe';
  const ffmpeg = process.env.ANIM_FFMPEG || 'ffmpeg';
  const dim = execFileSync(ffprobe,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
    { encoding: 'utf8', windowsHide: true })
    .trim().split(/[\r\n,]+/).filter(Boolean).map(Number);
  const w = dim[0];
  const h = dim[1];
  const rgba = execFileSync(ffmpeg,
    ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { maxBuffer: 1 << 28, windowsHide: true });
  return { w, h, rgba };
}

/** 自动寻找最新一轮 review 帧或指定 stills 目录里的 PNG。 */
function findStillsDir(task, explicitDir) {
  if (explicitDir) {
    const abs = path.resolve(ROOT, explicitDir);
    return existsSync(abs) ? abs : null;
  }
  const revBase = path.join(ROOT, 'out', task, 'review');
  if (existsSync(revBase)) {
    const rounds = readdirSync(revBase, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^round-(\d+)$/.test(d.name))
      .sort((a, b) => Number(b.name.slice(6)) - Number(a.name.slice(6)));
    for (const r of rounds) {
      const fdir = path.join(revBase, r.name, 'frames');
      if (existsSync(fdir)) return fdir;
      const rdir = path.join(revBase, r.name);
      if (readdirSync(rdir).some((f) => f.endsWith('.png'))) return rdir;
    }
  }
  return null;
}

async function main() {
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--stills' || argv[i] === '--only') { i++; continue; }
    if (!argv[i].startsWith('-')) positional.push(argv[i]);
  }
  const task = positional[0];
  if (!task) {
    console.error('用法：node tools/lint-craft.mjs <任务> [--stills dir] [--only a,b] [--json] [--strict]');
    process.exit(2);
  }

  const taskDir = path.join(ROOT, 'tasks', task);
  const cfgPath = path.join(taskDir, 'task.config.mjs');
  if (!existsSync(cfgPath)) {
    console.error(`找不到 ${path.relative(ROOT, cfgPath)}`);
    process.exit(2);
  }

  const onlyArg = opt('only', '');
  const onlySet = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim()).filter(Boolean)) : null;

  const mod = await import(pathToFileURL(cfgPath).href);
  const cfg = mod.default ?? mod.config;
  let segs = build(cfg.timeline, { bpm: 120, duration: cfg.duration ?? 0 });
  if (onlySet) segs = segs.filter((s) => onlySet.has(s.id));

  const segIds = new Set(segs.map((s) => s.id));
  const files = collectTaskFiles(taskDir, onlySet, segIds);

  /** @type {any[]} */
  const findings = [];
  for (const f of files) {
    for (const hit of scanSource(f.text, f.file)) findings.push(hit);
  }

  const cfgText = readFileSync(cfgPath, 'utf8');
  const hasWorld = typeof mod.world === 'function'
    || segs.some((s) => s.world === 'auto' || s.worldPass || (s.world && s.world !== false));
  const templateTypes = scanTemplateNames(files, Object.keys(SHOTS));
  const durations = segs.map((s) => Math.max(0, Number(s.end ?? 0) - Number(s.start ?? 0)));

  const tFindings = taskSignals({
    segments: segs,
    durations,
    templateTypes,
    hasWorld,
    sourceTexts: files.map((f) => f.text),
  });
  for (const hit of tFindings) findings.push(hit);

  // 可选：像素信号（仅 PNG）
  const stillsDir = findStillsDir(task, opt('stills', ''));
  const pixelFrames = [];
  let pixelSkipped = null;
  if (stillsDir) {
    const pngs = readdirSync(stillsDir)
      .filter((f) => f.endsWith('.png') && !/^board\.png$|^cut_/.test(f))
      .sort();
    if (!pngs.length) {
      pixelSkipped = `${path.relative(ROOT, stillsDir)} 里没有单帧 PNG`;
    } else {
      for (const name of pngs) {
        const fp = path.join(stillsDir, name);
        try {
          const { w, h, rgba } = decodePngRgba(fp);
          const px = pixelSignals(rgba, w, h);
          pixelFrames.push({ file: path.relative(ROOT, fp).replace(/\\/g, '/'), ...px.stats, signals: px.signals });
          for (const sig of px.signals) {
            findings.push({
              code: sig.code,
              file: path.relative(ROOT, fp).replace(/\\/g, '/'),
              line: null,
              count: 1,
              msg: `${name}: ${sig.msg}`,
            });
          }
        } catch (err) {
          pixelSkipped = `PNG 解码失败（缺 ffprobe/ffmpeg？）：${err && err.message ? err.message.split('\n')[0] : String(err)}`;
          break;
        }
      }
    }
  } else {
    pixelSkipped = '未传 --stills 且暂无 out/<任务>/review/ 帧（仅做源码检查）';
  }

  const score = computeCraftScore(findings);
  const asJson = flag('json');
  const strict = flag('strict');

  const payload = {
    task,
    only: onlySet ? [...onlySet] : null,
    segments: segs.length,
    duration: +durations.reduce((a, b) => a + b, 0).toFixed(2),
    score,
    findings,
    pixelFrames,
    pixelSkipped,
    note: 'CRAFT-TEXTONLY 暂未接线；此命令只报手艺信号，不进 check',
  };

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`手艺体检（lint-craft）：${task}${onlySet ? ` [--only ${[...onlySet].join(',')}]` : ''}（${segs.length} 段 / ${payload.duration}s）`);
    console.log(`  · 源码扫描：${files.length} 个文件 · 模板命中 ${templateTypes.length} 处 · 共享世界=${hasWorld ? '是' : '否'}`);
    if (pixelFrames.length) {
      console.log(`  · 像素扫描：${pixelFrames.length} 帧（来自 ${path.relative(ROOT, stillsDir)}）`);
    } else if (pixelSkipped) {
      console.log(`  · 像素扫描：跳过（${pixelSkipped}）`);
    }
    if (!findings.length) {
      console.log(`\n✓ 未发现明显偷懒信号（参考分 ${score}/100）`);
    } else {
      console.log('');
      for (const f of findings) console.log(`  ⚠ [${f.code}] ${f.msg}`);
      console.log(`\n发现 ${findings.length} 条偷懒信号（参考分 ${score}/100）${strict ? ' —— --strict 模式退出码 1' : '（默认仅报读数，--strict 才当门）'}`);
    }
  }

  if (strict && findings.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('lint-craft 错误：' + (err && err.message ? err.message : String(err)));
  process.exit(2);
});
