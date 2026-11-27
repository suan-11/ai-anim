// @ts-check
/**
 * ⑤ Remotion verify：成片抽帧 vs 同帧重渲逐像素比。
 *
 * 用法：node tools/remotion-verify.mjs <composition> <video> [--frames 0,100,500] [--tol 2]
 * 口径与旧引擎 anim verify 一致：帧数/尺寸先查，再抽 N 帧重渲 still，灰度逐像素差 ≤ tol。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const comp = args[0];
const video = args[1];
if (!comp || !video) {
  console.error('用法: node tools/remotion-verify.mjs <CompositionId> <video.mp4> [--frames 0,100,500] [--tol 2]');
  process.exit(1);
}
const framesIdx = args.indexOf('--frames');
const tolIdx = args.indexOf('--tol');
const meanIdx = args.indexOf('--mean-tol');
const pctIdx = args.indexOf('--pct-tol');
const tol = tolIdx >= 0 ? Number(args[tolIdx + 1]) : 8;
// h264 压缩损失口径：均值差 ≤ meanTol 且 超 tol 像素占比 ≤ pctTol%
// tol=8 对应显示空间 ~3% 亮度差（h264 crf16 在文字边缘的典型振铃），与旧引擎 verify 压缩容差同源
const meanTol = meanIdx >= 0 ? Number(args[meanIdx + 1]) : 2.0;
const pctTol = pctIdx >= 0 ? Number(args[pctIdx + 1]) : 3.0;

// ffprobe 取帧数/fps/尺寸
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=nb_frames,r_frame_rate,width,height', '-of', 'json', video], { encoding: 'utf8' }));
const st = probe.streams[0];
const total = Number(st.nb_frames);
const fps = eval(st.r_frame_rate);
const W = st.width, H = st.height;

// 默认抽 5 帧：首/25%/中/75%/末
const frames = framesIdx >= 0
  ? args[framesIdx + 1].split(',').map(Number)
  : [0, Math.floor(total * 0.25), Math.floor(total * 0.5), Math.floor(total * 0.75), total - 1];

const tmp = path.join(ROOT, 'out', '_remotion-migration', '.tmp', 'verify');
mkdirSync(tmp, { recursive: true });
const entry = path.join(ROOT, 'rm', 'index.ts');
const browser = process.env.ANIM_REMOTION_BROWSER_EXECUTABLE
  ?? [process.env.ProgramW6432, process.env.ProgramFiles].filter(Boolean)
    .map((r) => path.join(r, 'Google/Chrome/Application/chrome.exe')).find(existsSync);

let fail = 0;
console.log(`verify ${comp}: ${total} 帧 @${fps}fps ${W}×${H}, 抽 ${frames.length} 帧, tol=${tol}`);
for (const f of frames) {
  // 1) 从成片抽帧
  const extracted = path.join(tmp, `ext-${f}.png`);
  execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-vf', `select='eq(n,${f})'`, '-frames:v', '1', '-y', extracted]);
  // 2) Remotion 重渲同帧
  const rendered = path.join(tmp, `ren-${f}.png`);
  const cliArgs = [entry, comp, rendered, `--frame=${f}`, '--image-format=png', '--log=error'];
  if (browser) cliArgs.push(`--browser-executable=${browser}`);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', '@remotion', 'cli', 'remotion-cli.js'), 'still', ...cliArgs],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp } });
  if (r.status !== 0) { console.log(`  f${f}: RENDER FAIL\n${r.stderr?.slice(0, 200)}`); fail++; continue; }
  // 3) 灰度逐像素差
  execFileSync('ffmpeg', ['-v', 'error', '-i', extracted, '-vf', 'format=gray', '-f', 'rawvideo', '-y', path.join(tmp, 'a.raw')]);
  execFileSync('ffmpeg', ['-v', 'error', '-i', rendered, '-vf', 'format=gray', '-f', 'rawvideo', '-y', path.join(tmp, 'b.raw')]);
  const a = readFileSync(path.join(tmp, 'a.raw'));
  const b = readFileSync(path.join(tmp, 'b.raw'));
  const n = Math.min(a.length, b.length);
  let sum = 0, max = 0, over = 0;
  for (let i = 0; i < n; i++) { const d = Math.abs(a[i] - b[i]); sum += d; if (d > max) max = d; if (d > tol) over++; }
  const mean = sum / n;
  const pct = over / n * 100;
  const ok = mean <= meanTol && pct <= pctTol;
  console.log(`  f${f}: mean=${mean.toFixed(2)} max=${max} over${tol}=${pct.toFixed(2)}% ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) fail++;
}
rmSync(tmp, { recursive: true, force: true });
console.log(fail === 0 ? '✓ verify 通过' : `✗ verify 失败 ${fail} 帧`);
process.exit(fail === 0 ? 0 : 1);