// @ts-check
import { flag, opt } from "../lib/cli/args.mjs";
import { log, warn } from "../lib/cli/log.mjs";
import { pickTask } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
import { analyzeShake, shakeSummary } from "../lib/shake.mjs";
/* ------------------------------------------------------------------ 抖动体检 / 音频分轨 */

/**
 * `anim shake <任务>` —— 把整片的 `post.shake` 拉出来量一遍（docs/history/IMPROVEMENTS-1-3.md 建议 E）。
 *
 * 为什么需要这条命令：那次事故（用户说"最后像地震"）是**成片出来之后**才靠
 * "相邻帧互相关"反查出来的 —— 眼睛先发现、工具后确认。shake 是场景里的**设计值**，
 * 本来就拿得到，所以这条命令把它变成"工具先发现"：
 *
 *   · 逐帧变化量 ≈ 幅度  ⇒ 逐帧白噪声（`hash2(f.idx)`），60fps 下是**振动**，不是手持
 *   · 收尾段幅度 ≫ 中段   ⇒ 镜头停住了画面还在晃（"越到后面越像地震"的就是这个）
 *
 * 只跑 `samples: 1` 且**不读像素**。跑多快取决于场景本身：promo 的走廊段约 8ms/帧，
 * 而 raymarch 段（大厅/隧道）要 170ms/帧 —— 所以**慢是正常的**，命令会分批打进度；
 * 想快就用 `--from/--to` 只体检有疑虑的那一段。
 * 判据与 `video` 收尾的守门共用 `scripts/lib/shake.mjs`，两处口径一致。
 */
async function cmdShake() {
  const task = pickTask();
  const from = Number(opt('from', '0'));
  await openSession({ task, only: opt('only', undefined) });
  try {
    const info = getSession().info;
    const dur = info.onlyDuration || info.duration;
    const to = Number(opt('to', String(dur)));
    const fps = info.fps;
    log(`抖动体检 ${task}  ${from}–${to}s  ${fps}fps${info.only ? `  --only ${info.only}` : ''}`);
    const totalFrames = Math.max(1, Math.round((to - from) * fps));
    /**
     * ⚠ **分批** evaluate，不是一次跑完。
     *   · 一次跑整片（2880 帧）时 CLI 长时间收不到任何输出 —— 看上去就是卡死；
     *     而且 promo 的 raymarch 段要 170ms/帧，整片要几分钟。
     *   · 分批还能打进度 + ETA，出问题也知道停在哪一段。
     */
    const batch = Math.max(30, Number(opt('batch', '240')));
    /** @type {[number, number][]} */
    const seq = [];
    const errs = [];
    const tAll = Date.now();
    for (let i0 = 0; i0 < totalFrames; i0 += batch) {
      const n = Math.min(batch, totalFrames - i0);
      const part = await getSession().page.evaluate(async ({ from, fps, i0, n }) => {
        const e = /** @type {any} */ (window).__animEngine;
        const out = [];
        const errs = [];
        for (let i = 0; i < n; i++) {
          const t = from + (i0 + i) / fps;
          try {
            e.render(t, { samples: 1, toScreen: false });
            const s = e.lastPost && e.lastPost.shake;
            out.push(Array.isArray(s)
              ? [Number(s[0]) || 0, Number(s[1]) || 0]
              : [0, 0]);
          } catch (err) {
            if (errs.length < 2) errs.push(`t=${t.toFixed(2)}s ${String(err && err.message).split('\n')[0]}`);
            out.push([0, 0]);
          }
        }
        return { out, errs };
      }, { from, fps, i0, n });
      seq.push(...part.out);
      errs.push(...part.errs);
      const done = i0 + n;
      const sec = (Date.now() - tAll) / 1000;
      const worst = errs.length ? `  ⚠ ${errs.length} 帧抛异常` : '';
      process.stdout.write(`\r  渲染中 ${done}/${totalFrames} 帧  ${(done / sec).toFixed(1)} fps  ETA ${((totalFrames - done) / (done / sec)).toFixed(0)}s${worst}   `);
    }
    process.stdout.write('\n');
    const r = { seq, errs };

    const st = analyzeShake(r.seq, { fps, from, checkTail: to >= dur - 1 / fps - 1e-6 });
    if (flag('json')) { log(JSON.stringify(st, null, 2)); return st; }

    log(`  ${shakeSummary(st)}`);
    log(`\n  分段（每段 ${(st.n / st.segments.length / fps).toFixed(1)}s）：`);
    for (const s of st.segments) {
      log(`    ${s.from.toFixed(2).padStart(6)}–${s.to.toFixed(2).padStart(6)}s   峰值 ${s.amp.toFixed(2).padStart(6)}px   逐帧变化 ${s.stepRms.toFixed(3).padStart(6)}px`);
    }
    log(`\n  收尾段 / 中段幅度 = ${st.tailRatio.toFixed(2)}`);
    if (r.errs.length) {
      warn(`\n  ⚠ ${r.errs.length >= 3 ? '至少 3' : r.errs.length} 个时刻 render 抛异常（这些帧的抖动按 0 计）：`);
      for (const e of r.errs) warn(`    · ${e}`);
    }
    if (st.notices.length) {
      warn('');
      for (const n of st.notices) warn(`  ⚠ ${n}`);
      log(`\n  参考：post.shake 单位是**物理像素**（4K 下要乘 scale）、影响整帧（含文字/HUD）。`);
      log(`        平滑抖动用 shakeSmooth(f.t, amp)（src/core/cam.js），幅度 ≤2px 是呼吸、3–5px 是手持、≥5px 是冲击。`);
      warn(`        见 docs/history/IMPROVEMENTS-1-3.md 第三轮（"像不像手持取决于频率，不取决于幅度"）。`);
      process.exitCode = 1;
    } else {
      log(`\n  ✓ 没有发现问题（抖动平滑、且没有"停住了还在晃"）`);
    }
    return st;
  } finally { await closeSession(); }
}
export { cmdShake as run };
