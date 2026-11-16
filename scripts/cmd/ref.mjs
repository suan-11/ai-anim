// @ts-check
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flag, opt, positional } from "../lib/cli/args.mjs";
import { ffmpegArgv, probeDuration, run } from "../lib/media.mjs";
import { log, warn, die } from "../lib/cli/log.mjs";
import { ROOT } from "../lib/cli/paths.mjs";
import { detectCuts, bpmCandidates, segmentMotion, motionHeat, aggregateCellHeat, REF_STATIC_DIFF } from "../lib/ref-analysis.mjs";
/* 命令：ref —— 参考片拆解器（BACKLOG 1-76）。吃**别人的成片**，量出可比较的数，不渲自己的任务。 */

const HEAT_CHARS = " .:-=+*#%@";
const heatChar = (level) => HEAT_CHARS[Math.min(HEAT_CHARS.length - 1, Math.floor(level * HEAT_CHARS.length))];

/**
 * 解码外片 → 灰度帧 → 全局帧间差 + 网格单元差（一次 ffmpeg，两种粒度）。
 * 帧差口径与 tools/lib/diff-series.mjs 一致（每 5 像素取 1）；单元差供空间热图。
 */
function decodeRef(file, fps, W, H, grid) {
  const r = run([...ffmpegArgv(), "-v", "error", "-i", file, "-vf", `fps=${fps},scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1 << 30 });
  if (r.status !== 0) return null;
  const raw = r.stdoutBuf, FS = W * H, n = Math.floor(raw.length / FS);
  if (n < 8) return null;
  const diff = new Array(n).fill(0);
  const cellDiffs = new Array(n).fill(null);
  const cw = W / grid.cols, ch = H / grid.rows, ncell = grid.cols * grid.rows;
  for (let i = 1; i < n; i++) {
    const a = (i - 1) * FS, b = i * FS;
    let s = 0, c = 0;
    for (let k = 0; k < FS; k += 5) { s += Math.abs(raw[b + k] - raw[a + k]); c++; }
    diff[i] = s / c;
    const cells = new Array(ncell).fill(0);
    const cc = new Array(ncell).fill(0);
    for (let y = 0; y < H; y += 3) {
      const gy = Math.min(grid.rows - 1, Math.floor(y / ch));
      for (let x = 0; x < W; x += 3) {
        const gx = Math.min(grid.cols - 1, Math.floor(x / cw));
        const gi = gy * grid.cols + gx;
        const p = y * W + x;
        cells[gi] += Math.abs(raw[b + p] - raw[a + p]); cc[gi]++;
      }
    }
    cellDiffs[i] = cells.map((v, j) => (cc[j] ? v / cc[j] : 0));
  }
  return { diff, cellDiffs, frames: n, fps };
}

async function cmdRef() {
  const file = positional(0);
  if (!file) { console.error("用法：node scripts/anim.mjs ref <外片.mp4> [--fps 8] [--cells 30] [--json] [--no-sheet]"); process.exit(2); }
  const abs = path.resolve(file);
  if (!existsSync(abs)) die(`文件不存在：${abs}`);
  const fps = Math.max(2, Number(opt("fps", "8")));
  const W = 480, H = 270, grid = { cols: 16, rows: 9 };
  let duration;
  try { duration = probeDuration(abs); } catch (e) { die(String(e.message)); }
  log(`参考片拆解：${path.basename(abs)}  ${duration.toFixed(2)}s  采样 ${fps}fps / ${W}×${H} / 热图网格 ${grid.cols}×${grid.rows}`);
  const dec = decodeRef(abs, fps, W, H, grid);
  if (!dec) die("ffmpeg 解码失败或帧数太少（<8）—— 确认是有效视频、ffmpeg 在 PATH（或设 ANIM_FFMPEG）");
  const { diff, cellDiffs, frames } = dec;

  const cuts = detectCuts(diff, fps);
  const cutFrames = cuts.map((c) => c.frame);
  const cutTimes = cuts.map((c) => c.t);
  const bpm = bpmCandidates(cutTimes, duration);
  const segs = segmentMotion(diff, cutFrames, fps);
  const heat = motionHeat(diff, fps, 48);
  const cellHeat = aggregateCellHeat(cellDiffs, cutFrames, grid);

  const name = path.basename(abs).replace(/\.[^.]+$/, "");
  const outDir = path.resolve(ROOT, opt("out", path.join("out", "_ref", name)));
  mkdirSync(outDir, { recursive: true });

  // ① 切点表
  log(`\n① 场景切点：${cuts.length} 个（阈值=帧差尖峰，判据见 ref-analysis.detectCuts）`);
  if (!cuts.length) log("   （没检到硬切 —— 可能是一镜到底 / 全溶解转场）");
  for (const c of cuts) log(`   ${c.t.toFixed(2)}s  强度 ${c.strength.toFixed(1)}`);

  // ② BPM 候选
  log(`\n② BPM 候选（切点网格拟合；随机基线 ≈ ${(bpm.randomBaseline * 100).toFixed(0)}%，高于它才有节奏意义）`);
  for (const c of bpm.candidates) log(`   ${c.bpm} BPM  切点贴网格 ${c.onGrid}/${c.total}（${(c.score * 100).toFixed(0)}%）`);
  if (bpm.histogram.length) log("   切点间隔直方图（60/间隔）：" + bpm.histogram.map(([b, n]) => `${b}×${n}`).join("  "));

  // ③ 每段运动量
  log(`\n③ 每段运动量（${segs.length} 段；静帧阈值 ${REF_STATIC_DIFF}）`);
  log("   段  起止(s)      时长   平均运动  峰值   静帧占比");
  for (const s of segs) {
    log(`   ${String(s.index).padStart(2)}  ${s.start.toFixed(2)}–${s.end.toFixed(2)}  ${s.dur.toFixed(2)}s  ${s.meanMotion.toFixed(2).padStart(7)}  ${s.peak.toFixed(1).padStart(5)}  ${(s.stillRatio * 100).toFixed(0).padStart(4)}%`);
  }

  // ④a 时间热图
  log(`\n④ 运动热图（时间轴，${heat.length} 桶；越亮越动）`);
  log("   " + heat.map((h) => heatChar(h.level)).join(""));
  log(`   0s${" ".repeat(Math.max(1, heat.length - 8))}${duration.toFixed(0)}s`);
  // ④b 空间热图（每段哪里在动）
  log("   空间热图（每段一块，" + grid.cols + "×" + grid.rows + "）：");
  for (const ch of cellHeat) {
    const mx = Math.max(...ch.cells, 1e-6);
    log(`   段${ch.index} [${(ch.start / fps).toFixed(1)}–${(ch.end / fps).toFixed(1)}s]`);
    for (let ry = 0; ry < grid.rows; ry++) {
      let row = "     ";
      for (let rx = 0; rx < grid.cols; rx++) row += heatChar(ch.cells[ry * grid.cols + rx] / mx);
      log(row);
    }
  }

  // 接触表（整片全貌，ffmpeg tile，一次调用）
  let sheetPath = null;
  if (!flag("no-sheet")) {
    const cells = Math.max(4, Number(opt("cells", "30")));
    const cols = Math.min(6, cells), rows = Math.ceil(cells / cols);
    sheetPath = path.join(outDir, "sheet.png");
    const sr = run([...ffmpegArgv(), "-v", "error", "-i", abs, "-vf", `fps=${(cells / duration).toFixed(4)},scale=240:-1,tile=${cols}x${rows}`, "-frames:v", "1", sheetPath]);
    if (sr.status !== 0 || !existsSync(sheetPath)) { warn("接触表生成失败（不影响读数）"); sheetPath = null; }
  }

  const report = { file: abs, duration, fps, frames, grid, cuts, bpm, segments: segs, heat, cellHeat, sheet: sheetPath };
  const jsonPath = path.join(outDir, "ref.json");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  log(`\n✓ 读数已写 ${path.relative(ROOT, jsonPath)}${sheetPath ? "  接触表 " + path.relative(ROOT, sheetPath) : ""}`);
  if (flag("json")) console.log(JSON.stringify(report));
}
export { cmdRef as run };
