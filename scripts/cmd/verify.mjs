// @ts-check
import { existsSync } from "node:fs";
import path from "node:path";
import { opt } from "../lib/cli/args.mjs";
import { decodePngRgba, ffmpegFrame, pixelDiff } from "../lib/cli/frame-diff.mjs";
import { die, log, warn } from "../lib/cli/log.mjs";
import { probeVideo } from "../lib/cli/media.mjs";
import { ROOT, pickTask, taskOut } from "../lib/cli/paths.mjs";
import { getRegisteredTask } from "../lib/cli/remotion.mjs";
import { openRemotionSession } from "../lib/cli/remotion-api.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
import { evaluateRegisteredTask } from "../lib/remotion-registry.mjs";
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
function pickProbeTimes(items, { fps, clipFrom, clipTo, clipFrames }) {
  const set = new Set();
  for (const it of items) {
    const start = Number(it.start ?? it.startSec ?? 0);
    const end = Number(it.end ?? it.endSec ?? start);
    const dur = end - start;
    if (start > 0.05) {
      set.add(start - 1 / fps + 0.5 / fps);
      set.add(start + 0.5 / fps);
    }
    set.add(start + dur * 0.5);
    if (dur > 0.2) set.add(end - 1 / fps - 0.5 / fps);
  }
  return [...set].filter((t) => {
    if (t < clipFrom - 1e-6 || t >= clipTo - 0.5 / fps) return false;
    const k = Math.round((t - clipFrom) * fps);
    return k >= 0 && k < clipFrames;
  }).sort((a, b) => a - b);
}

async function cmdVerify(opts = {}) {
  const renderer = opts.renderer ?? 'legacy';
  const task = pickTask();
  const defaultFile = renderer === 'remotion'
    ? taskOut(task, `${task}.remotion.mp4`)
    : taskOut(task, `${task}.mp4`);
  const file = path.resolve(ROOT, opt('file', opt('o', defaultFile)));
  if (!existsSync(file)) die(`没有找到成片 ${path.relative(ROOT, file)}。先跑 video，或用 --file 指定。`);

  const p = await probeVideo(file, { count: false });
  if (!p.ok) die(`这个成片本身就有问题，先修它：\n${p.reasons.map((r) => '  · ' + r).join('\n')}`);
  const fps = Number(opt('fps', String(p.fps || 0))) || 60;
  const duration = p.duration ?? 0;
  log(`验收 ${path.relative(ROOT, file)}  ${p.width}×${p.height} @${fps}fps  ${duration.toFixed(3)}s  ${p.frames ?? '?'} 帧`);

  const explicit = opt('times', '');
  const clipFrom = Number(opt('from', '0'));
  const clipFrames = p.frames ?? Math.round(duration * fps);
  const clipTo = clipFrom + clipFrames / fps;
  const limit = Number(opt('tol', '18'));

  if (renderer === 'remotion') {
    if (opt('only', null) || opt('variant', null) || opt('style', null)) {
      die('Remotion 的 verify 暂不支持 --only / --variant / --style。请改用 --renderer legacy。');
    }
    const { meta } = getRegisteredTask(task);
    const evalRes = await evaluateRegisteredTask(task, meta);
    const scale = opt('scale', null) ? Number(opt('scale', '1')) : (p.width / evalRes.width);
    if (!Number.isFinite(scale) || scale <= 0 || Math.abs(Math.round(evalRes.height * scale) - p.height) > 1) {
      die(`成片尺寸 ${p.width}×${p.height} 与任务 ${evalRes.width}×${evalRes.height} 不成比例`);
    }
    const defaultSamples = meta.samples ?? (meta.eval === 'config-only' ? 1 : 'auto');
    const verifySamplesRaw = opt('samples', String(defaultSamples));
    const verifySamples = verifySamplesRaw === 'auto' ? 'auto' : Number(verifySamplesRaw);
    if (meta.eval === 'config-only' && verifySamples !== 1) {
      die('该 Remotion 任务只支持 --samples 1');
    }
    const times = explicit
      ? explicit.split(',').map(Number).filter(Number.isFinite)
      : pickProbeTimes(evalRes.segments, { fps, clipFrom, clipTo, clipFrames });
    if (!times.length) die(`没有可验收的时刻（成片 ${clipFrames} 帧 / ${duration.toFixed(2)}s，时间线是空的？）`);

    const inputProps = meta.eval === 'config-only' ? {} : { samples: verifySamples };
    const remSession = await openRemotionSession({
      compositionId: meta.composition,
      inputProps,
    });
    try {
      log(`比对 ${times.length} 个时刻（Remotion 成片抽帧 vs 同帧重渲，samples=${verifySamples}）：`);
      let bad = 0;
      for (const t of times) {
        const local = t - clipFrom;
        const idx = Math.max(0, Math.round(local * fps));
        const taskFrame = Math.min(evalRes.durationInFrames - 1, Math.round(t * evalRes.fps));
        const { buffer } = await remSession.renderFrame({ frame: taskFrame, scale, output: null });
        if (!buffer || !buffer.length) { warn(`  t=${t.toFixed(3)}（成片第 ${idx} 帧） ← Remotion 重渲失败`); bad++; continue; }
        const rem = await decodePngRgba(buffer, p.width, p.height);
        const mp4 = await ffmpegFrame(file, idx, p.width, p.height, { flip: false });
        if (!mp4) { warn(`  t=${t.toFixed(3)}（成片第 ${idx} 帧） ← ffmpeg 抽帧失败`); bad++; continue; }
        const d = pixelDiff(rem, mp4);
        const ok = d.mean < limit;
        if (!ok) bad++;
        log(`  第 ${String(idx).padStart(5)} 帧  t=${t.toFixed(4)}  ${ok ? '✓ 一致' : '✗ 不一致'}`
          + `  max ${String(d.max).padStart(3)}  mean ${d.mean.toFixed(2).padStart(6)}`
          + `  >16 ${(d.over16 * 100).toFixed(3)}%  >64 ${(d.over64 * 100).toFixed(3)}%`
          + `  （判据 mean<${limit}）`);
      }
      if (bad) {
        warn(
          `\n✗ ${bad}/${times.length} 个时刻与成片不一致。最可能的原因：\n` +
          `  · 成片是旧版本渲染的（改了源码但没重渲）\n` +
          `  · 分段拼接错位 —— 删掉 out/${task}/*.remotion.parts 重渲\n` +
          `  · 成片采样数不一致 —— 传同样的 --samples（如 --samples 1 或 --samples auto）`,
        );
        process.exitCode = 1;
      } else {
        log(`\n✓ ${times.length} 个时刻（按帧号对齐）全部与 Remotion 重新渲染的结果一致（成片可信）`);
      }
    } finally {
      await remSession.close();
    }
    return;
  }

  const verifySamples = opt('samples', '1');
  let times;
  if (explicit) {
    times = explicit.split(',').map(Number).filter(Number.isFinite);
  } else {
    await openSession({ task, scale: Number(opt('scale', '0')) || undefined, only: opt('only', undefined) });
    const items = getSession().info.timeline;
    times = pickProbeTimes(items, { fps, clipFrom, clipTo, clipFrames });
  }
  if (!times.length) die(`没有可验收的时刻（成片 ${clipFrames} 帧 / ${duration.toFixed(2)}s，时间线是空的？）`);

  // 会话可能已经开过（自动挑点时），也可能还没开
  const ownSession = !getSession();
  if (ownSession) await openSession({ task, scale: Number(opt('scale', '0')) || undefined, only: opt('only', undefined) });
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
      const mp4 = await ffmpegFrame(file, idx, p.width, p.height, { flip: true });
      if (!mp4) { warn(`  t=${t.toFixed(3)}（成片第 ${idx} 帧） ← ffmpeg 抽帧失败`); bad++; continue; }
      const d = pixelDiff(browser, mp4);
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
export { cmdVerify as run };
