// @ts-check
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { opt } from "../lib/cli/args.mjs";
import { die, log, warn } from "../lib/cli/log.mjs";
import { ffmpegCmd, probeVideo } from "../lib/cli/media.mjs";
import { ROOT, pickTask, taskOut } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
/* ------------------------------------------------------------------ 命令：verify */

/**
 * 成片验收：把 mp4 里的若干帧抽出来，与**同一时刻重新渲染的那一帧**逐像素比。
 *
 * 为什么这条判据成立且很强：渲染是 t 的纯函数，`still` 与成片走同一条代码路径，
 * 所以「成片第 N 帧」必须等于「t = (N+0.5)/fps 处渲染的那一帧」。一次比对同时抓住：
 *   · 分段拼接错位（某块接错了位置 → 整帧都对不上）
 *   · 帧数不对 / 有丢帧（抽到的帧其实是别的时间）
 *   · 色彩空间不一致（整体偏暗/偏亮 → mean 明显抬手）
 *   · ffmpeg 与浏览器两条路不一致
 *
 * 什么时候抽帧：默认抽**每个段边界前后**（切点最容易被拼错）+ 每段中点。
 * 有音频的成片比画面短一点，所以边界取 ±1 帧、并跳过超出时长的时刻。
 *
 *   node scripts/anim.mjs verify demo
 *   node scripts/anim.mjs verify fidus --times 1,30,59
 *   node scripts/anim.mjs verify demo --file out/demo/shot_0-3.mp4
 */
async function cmdVerify() {
  const task = pickTask();
  const file = path.resolve(ROOT, opt('file', opt('o', taskOut(task, `${task}.mp4`))));
  if (!existsSync(file)) die(`没有找到成片 ${path.relative(ROOT, file)}。先跑 video，或用 --file 指定。`);

  const p = await probeVideo(file, { count: false });
  if (!p.ok) die(`这个成片本身就有问题，先修它：\n${p.reasons.map((r) => '  · ' + r).join('\n')}`);
  const fps = Number(opt('fps', String(p.fps || 0))) || 60;
  const duration = p.duration ?? 0;
  log(`验收 ${path.relative(ROOT, file)}  ${p.width}×${p.height} @${fps}fps  ${duration.toFixed(3)}s  ${p.frames ?? '?'} 帧`);

  const explicit = opt('times', '');
  const verifySamples = opt('samples', '1');
  /**
   * 成片覆盖的是**任务时间轴上的哪一段**。默认 0 = 从片头渲的完整成片；
   * `--from` 配合 `video --from/--to` 出来的片段用（那种片段的第 N 帧对应任务时间
   * `from + N/fps`，不再是 `N/fps`）。
   */
  const clipFrom = Number(opt('from', '0'));
  const clipFrames = p.frames ?? Math.round(duration * fps);
  const clipTo = clipFrom + clipFrames / fps;
  let times;
  if (explicit) {
    times = explicit.split(',').map(Number).filter(Number.isFinite);
  } else {
    await openSession({ task, scale: Number(opt('scale', '0')) || undefined, only: opt('only', undefined) });
    const items = getSession().info.timeline;
    const set = new Set();
    /**
     * 探针时刻要抬到**帧内**（`docs/history/IMPROVEMENTS-1-3.md` P1-3 的第 3 条）。
     *
     * 原来的默认探针里有 `it.start - 1/fps`（切点前一帧）—— 那正好落在**帧边界**上。
     * 而"帧边界"这个时刻本身是有歧义的：引擎算帧号用 `floor(t*fps + 1e-6)`，
     * 浮点误差会让它掉到前一帧去（`t=6.133333` → 367 而不是 368），
     * 于是抽到的帧和重渲的帧差了整整一帧，颗粒图案不同 → 误报 ✗。
     *
     * ⚠ 但"帧内"**不等于**"帧中心"：见下面 `refT` 的注释 ——
     *   成片是在每一帧的**起点** `N/fps` 渲染的，探针必须用同一个时刻，
     *   否则多子帧的运动模糊窗会差半帧（实测 mean 8.4，看着像"跨会话不确定"）。
     *
     * ⚠⚠ 还必须**钳在成片覆盖的区间里**。默认探针里原来有 `duration - 1/fps`，
     *   而 `video --to` 出来的片段往往比任务时长短 —— 那一帧根本不在成片里，
     *   `round(t*fps)` 又正好停在边界上会映射到**最后一帧**，于是拿"不存在的第 N 帧"
     *   去和"成片的第 N-1 帧"比，必然 ✗（demo 的 4 秒片段就这么误报过一次）。
     */
    const snap = (t) => (Math.floor(t * fps) + 0.25) / fps;
    const add = (t) => {
      if (t < clipFrom || t >= clipTo - 0.5 / fps) return;   // 不在成片里的一律跳过
      set.add(Math.round(snap(t) * 1e6) / 1e6);
    };
    for (const it of items) {
      add(it.start + 1 / fps);            // 切点后一帧（这里最容易错）
      add((it.start + it.end) / 2);       // 段中点
    }
    add(clipTo - 1.5 / fps);              // 成片的收尾一帧
    add(clipFrom + 0.5 / fps);            // 成片的开头一帧
    times = [...set].filter((t) => {
      // 二次保险：抽帧的帧号必须落在成片的帧数范围内
      const k = Math.round((t - clipFrom) * fps);
      return k >= 0 && k < clipFrames;
    }).sort((a, b) => a - b);
  }
  if (!times.length) die(`没有可验收的时刻（成片 ${clipFrames} 帧 / ${duration.toFixed(2)}s，时间线是空的？）`);

  // 会话可能已经开过（自动挑点时），也可能还没开
  const ownSession = !getSession();
  if (ownSession) await openSession({ task, scale: Number(opt('scale', 0)) || undefined, only: opt('only', undefined) });
  try {
    log(`比对 ${times.length} 个时刻（成片抽帧 vs 同 t 重新渲染，samples=${verifySamples}）：`);
    let bad = 0;
    for (const t of times) {
      // 成片里的帧号 = (t - from) * fps；抽帧与重渲都必须用这个时刻
      const local = t - clipFrom;
      const idx = Math.max(0, Math.round(local * fps));
      const refT = t;
      const r = await getSession().page.evaluate(
        ([tt, s]) => /** @type {any} */ (window).__anim.framePixels(tt, { samples: s === 'auto' ? 'auto' : Number(s) }),
        [refT, verifySamples],
      );
      const browser = Buffer.from(r.pixels, 'base64');
      const mp4 = await ffmpegFrame(file, local, p.width, p.height, fps);
      if (!mp4) { warn(`  t=${t.toFixed(3)}（成片第 ${idx} 帧） ← ffmpeg 抽帧失败`); bad++; continue; }
      const d = pixelDiff(browser, mp4);
      /**
       * 判据**可调、默认宽松**，并且把量到的数都打出来。
       *
       * 为什么不能写死一个紧阈值（这段是实测出来的，`docs/STATUS.md` §11.7）：
       * h264 是 yuv420p，色度**二次采样**。在"480 根 2px 细竖线"、密集网点这类
       * 高频画面上，编码损失能到 mean 7–8、>16 占 13–17% —— 那不是渲染错，
       * 是编码器的物理极限（实测同一帧的**原始字节**与成片抽帧逐字节相同，
       * 见 `tools/probe-determinism.mjs`）。紧阈值会在这种镜头上误报，
       * 而误报多了这个工具就没人信了。
       *
       * 反过来，真正的问题量级大得多，实测：
       *   · 正确匹配（含高频画面）：mean 1.4–7.0，>64 占 0.000–0.115%
       *   · 拿错成片：            mean 26.5、43.8，>64 成片出现
       *   · 帧号口径错（--from）： mean 7.7
       * 所以默认取 `mean < 18`，中间留着 2.5× 的余量；要更严用 `--tol 6`
       * （或 `--samples 1` —— 那条路上没有子帧近似，与成片逐字节相同）。
       */
      const limit = Number(opt('tol', '18'));
      const ok = d.mean < limit;
      if (!ok) bad++;
      log(`  第 ${String(idx).padStart(5)} 帧  t=${refT.toFixed(4)}  ${ok ? '✓ 一致' : '✗ 不一致'}`
        + `  max ${String(d.max).padStart(3)}  mean ${d.mean.toFixed(2).padStart(6)}`
        + `  >16 ${(d.over16 * 100).toFixed(3)}%  >64 ${(d.over64 * 100).toFixed(3)}%`
        + `  （判据 mean<${limit}）`);
    }
    if (bad) {
      warn(
        `\n✗ ${bad}/${times.length} 个时刻与成片不一致。最可能的原因：\n` +
        `  · 成片是旧版本渲染的（改了场景/引擎但没重渲）\n` +
        `  · 分段拼接错位（某一块接到了错误的位置）—— 删掉 out/${task}/*.parts 重渲\n` +
        `  · 成片不是 --samples 1 渲的（运动模糊的子帧数不同，画面本来就该不一样）：\n` +
        `    用同样的 --samples 重渲，或给 verify 传 --samples auto\n` +
        `  · 色彩空间不一致（整体偏亮/偏暗 → mean 明显变大；见 docs/ENGINE.md §2.3）\n` +
        `  · 跨会话不确定性（同一时刻从不同起点开渲差一点）—— 见 docs/PERF.md 与本文件 §11.9`,
      );
      process.exitCode = 1;
    } else log(`\n✓ ${times.length} 个时刻（按帧号对齐）全部与重新渲染的结果一致（成片可信）`);
  } finally { if (ownSession) await closeSession(); }
}

/**
 * 用 ffmpeg 从成片里取**第 N 帧**（N 由时刻算出来），输出 RGBA（翻成与浏览器 readPixels 一致的方向：自下而上）。
 *
 * 为什么按**帧号**取，而不是按时间（`docs/history/IMPROVEMENTS-1-3.md` P1-3）：
 *   旧实现用 `select='between(t, t±0.5/fps)'` —— 那是个**闭区间**，而且 t 是用
 *   `toFixed(6)` 写进 filter 字符串的。在帧边界上（默认探针里的 `it.start - 1/fps`
 *   正好是帧边界）它会同时框住前后两帧，抽到哪一帧取决于浮点尾数；
 *   加上引擎算帧号是 `idx = floor(t*fps + 1e-6)`，`t=6.133333` 会掉到 367 而不是 368，
 *   于是颗粒图案（`frameSeed(idx)`）不同 → 一堆误报 ✗，而两张图肉眼看一模一样。
 *   实测：24 个探针 9 ✓ / 15 ✗，✗ 的全是移动中的画面。
 *
 * 现在：帧号由 `round(t*fps)` 算出来，`select=eq(n\,N)` 只会命中一帧 ——
 * 没有浮点边界问题，也不需要"帧中心"的近似。
 *
 * 另一个必须踩对的细节：ffmpeg 的 rawvideo **行序是自上而下**，而 `engine.readPixels()`
 * 是自下而上（WebGL 原生顺序）。不翻就会得到 mean≈20、31% 像素超阈值的"全线不一致"，
 * 而两张图肉眼看是同一画面 —— 这条当初把我骗了三轮。
 *
 * @returns {Promise<Buffer|null>}
 */
async function ffmpegFrame(file, t, w, h, fps, opts = {}) {
  const [bin, ...prefix] = ffmpegCmd();
  const idx = Math.max(0, Math.round(t * fps));
  // ⚠ `-copyts` 不是必须的：`select` 的 n 是**解码帧序号**，与时间戳无关，
  //   所以哪怕成片首帧 PTS 不是 0（自己手工 concat 的片子），帧号依然是帧号。
  const args = [
    ...prefix, '-v', 'error',
    '-i', file,
    '-vf', `select=eq(n\\,${idx})`,
    '-frames:v', '1', '-fps_mode', 'passthrough',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
  ];
  const buf = await new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    let n = 0;
    p.stdout.on('data', (d) => { chunks.push(d); n += d.length; });
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const b = Buffer.concat(chunks);
      resolve(n === w * h * 4 ? b : null);
    });
  });
  if (!buf) return null;
  void opts;
  return flipRows(buf, w, h);
}

/** 上下翻转一张 RGBA 图（行序反转）。 */
function flipRows(buf, w, h) {
  const row = w * 4;
  const out = Buffer.allocUnsafe(buf.length);
  for (let y = 0; y < h; y++) buf.copy(out, y * row, (h - 1 - y) * row, (h - y) * row);
  return out;
}

/**
 * 两张 RGBA 的差异统计。
 *
 * 阈值按「同一帧经 h264 往返」来定，不能按"逐像素相等"：
 *   yuv420p 色度二次采样 + BT.709 往返 + x264 压缩，实测差异**全部落在 0–63 这一档**
 *   （正确匹配时：99.5% 的像素差 0–31、0.5% 差 32–63、**>64 的是 0.0%**）。
 *   真正的问题（抽错帧、拼接错位、色彩空间不对）会让画面整体错位，>64 成片出现、
 *   mean 抬到 20–45。所以除了 mean，`over64` 才是最有区分度的那一项 ——
 *   它在"高频细密画面"（细竖线、网点）上也不会被压缩噪声污染。
 */
function pixelDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let max = 0, sum = 0, over16 = 0, over32 = 0, over64 = 0, count = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
    sum += d; count++;
    if (d > 16) over16++;
    if (d > 32) over32++;
    if (d > 64) over64++;
  }
  return {
    max, mean: sum / Math.max(1, count),
    over16: over16 / Math.max(1, count),
    over32: over32 / Math.max(1, count),
    over64: over64 / Math.max(1, count),
  };
}
export { cmdVerify as run };
