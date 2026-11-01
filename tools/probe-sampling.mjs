// @ts-check
/**
 * 自适应子帧采样的量具：**每一帧到底用了几个子帧、误差是多少、cap 起了多大作用**。
 *
 * 为什么需要它：`docs/history/HANDOFF-spectrum-friction.md` §1 记过一件事 —— 一支"画面主体
 * 是静止图表"的片子，出片实测 0.9 fps（4550 帧要 85 分钟），作者只能在段上写
 * `maxSamples: 8` 压到 2.5 fps。而引擎**从头到尾没有告诉过任何人**它为什么一路加子帧：
 * `lastErrors` 只在 `anim determinism` 的调试输出里露过一次，`perf` 又只量
 * `samples: 1` 或固定档，量不到 `auto` 的真实分布。
 *
 * 这个量具把三件事变成数字：
 *   ① 每个时刻的**子帧数**与**每一级误差**（`engine.lastErrors`，已换算成 0..255 显示空间）；
 *   ② 同一时刻**去掉段上的 maxSamples 之后**会变成多少（区分"场景在动"与"封顶在起作用"）；
 *   ③ GL 读回有没有报错 —— `_sampleError()` 读的是 `errRT`，若读错了格式，
 *      误差会**恒为 0**，看起来"永远收敛"，实际是判据死了。
 *
 *   node tools/probe-sampling.mjs spectrum                       # 整片均匀取 8 个时刻
 *   node tools/probe-sampling.mjs spectrum --times 12,20.5,30
 *   node tools/probe-sampling.mjs spectrum --json
 *
 * 退出码：0 = 量到了（不管读数好坏）；1 = 页面/渲染出错。
 */

import { openProbePage } from './lib/probe-page.mjs';

const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const task = argOf('--task') ?? process.argv[2] ?? 'spectrum';
const nTimes = Math.max(2, Number(argOf('--n') ?? '8'));
const timesArg = argOf('--times');

let probe = null;
let failed = 0;
try {
  probe = await openProbePage({
    task, port: 5403, timeout: 240000,
    onPageError: (e) => { console.log('PAGEERROR', e.message); failed++; },
  });
  const page = probe.page;
  const info = await page.evaluate(() => /** @type {any} */ (window).__anim.info());
  const times = timesArg
    ? timesArg.split(',').map(Number).filter(Number.isFinite)
    : Array.from({ length: nTimes }, (_, i) => Math.round((info.duration * (i + 0.5) / nTimes) * 1000) / 1000);
  console.log('· ' + task + '  ' + info.width + '×' + info.height + '  ' + info.duration.toFixed(2) + 's  ' + info.timeline.length + ' 段');
  console.log('· 量 ' + times.length + ' 个时刻：' + times.join(', '));

  const rows = await page.evaluate(async ({ times }) => {
    const e = /** @type {any} */ (window).__animEngine;
    const gl = e.gl.ctx;
    const out = [];
    const measure = async (t) => {
      const active = e.timeline.filter((i) => t >= i.start && t < i.end)
        .map((i) => i.id + (i.maxSamples ? '(cap ' + i.maxSamples + ')' : ''));
      // 先清一次错误：上一次渲染可能留下一个 INVALID_OPERATION，会污染下面的读数
      while (gl.getError() !== gl.NO_ERROR) { /* drain */ }
      const t0 = performance.now();
      let err = null;
      try {
        e.render(t, { samples: 'auto', toScreen: false });
      } catch (e2) {
        err = String(e2 && e2.message ? e2.message : e2);
      }
      const ms = performance.now() - t0;
      const glErr = gl.getError();
      return {
        t, ms, active, err,
        samples: e.lastSamples,
        errors: (e.lastErrors ?? []).map((x) => +(x * 255).toFixed(2)),
        glErr,
      };
    };
    const caps = new Map(e.timeline.map((i) => [i, i.maxSamples]));
    for (const t of times) {
      const withCap = await measure(t);
      for (const i of e.timeline) delete i.maxSamples;
      const noCap = await measure(t);
      for (const [it, v] of caps) { if (v) it.maxSamples = v; }
      out.push({ t, withCap, noCap });
    }
    return out;
  }, { times });

  for (const r of rows) {
    console.log('');
    console.log(' t=' + r.t.toFixed(3) + 's  ' + (r.withCap.active.join(' + ') || '(没有段在播)'));
    for (const k of ['withCap', 'noCap']) {
      const m = r[k];
      const bad = m.glErr ? '   ⚠ GL 错误 0x' + m.glErr.toString(16) : '';
      const e = m.err ? '   ✗ ' + m.err : '';
      console.log('   ' + (k === 'withCap' ? '含 cap' : '去 cap') + '：'
        + String(m.samples).padStart(3) + ' 子帧  '
        + m.ms.toFixed(0) + ' ms  各级误差(0..255) [' + m.errors.join(' ') + ']' + bad + e);
    }
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
} catch (err) {
  console.error('✗ ' + (err && err.message ? err.message : err));
  failed++;
} finally {
  if (probe) await probe.close();
  process.exitCode = failed ? 1 : 0;
}
