// @ts-check
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flag, opt } from "../lib/cli/args.mjs";
import { log } from "../lib/cli/log.mjs";
import { ROOT, pickTask, taskOut } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
/* ------------------------------------------------------------------ 命令：dumpframe */

/**
 * 把某一帧的原始 RGBA 落盘（浏览器那条路），给"两条渲染路径到底哪里不同"做对照。
 *
 *   node scripts/anim.mjs dumpframe beat -t 0.508333 --samples 2
 *   node scripts/anim.mjs dumpframe beat -t 0.508333 --samples 2 --run-up   # 先顺着渲 0..N
 *
 * `--run-up` 是关键对照：`stream()` 是顺着 0,1,2,… 渲的，而 `still`/`framePixels`
 * 是**直接 seek** 到那一帧渲的。如果只有"顺着渲"才和成片对得上，那根因就是渲染历史。
 */
async function cmdDumpFrame() {
  const task = pickTask();
  const times = (opt('t', opt('times', '0')) ?? '0').split(',').map(Number).filter(Number.isFinite);
  const samples = opt('samples', '1');
  const runUp = flag('run-up');
  const outDir = path.resolve(ROOT, opt('out', taskOut(task, '_dumpframe')));
  mkdirSync(outDir, { recursive: true });
  await openSession({ task, only: opt('only', undefined), scale: Number(opt('scale', '0')) || undefined });
  try {
    const meta = await getSession().page.evaluate(async ({ times, samples, shutter, runUp, via }) => {
      const api = /** @type {any} */ (window).__anim;
      const e = /** @type {any} */ (window).__animEngine;
      const rows = [];
      for (const t of times) {
        if (runUp) {
          // 顺着渲到这一帧（与 stream() 的渲染历史一致）
          for (let k = 0; k * (1 / 60) < t - 1e-9; k++) {
            await api.frame(k / 60, { samples: samples === 'auto' ? 'auto' : Number(samples), shutter });
          }
        }
        let used;
        if (via === 'render') {
          // 完全照 stream() 的方式调引擎（同一个会话里就能和 api.frame 逐像素对比）
          const r = e.render(t, {
            samples: samples === 'auto' ? 'auto' : Number(samples),
            shutter, toScreen: false, seeked: true,
          });
          used = r.samples;
        } else {
          const r = await api.frame(t, { samples: samples === 'auto' ? 'auto' : Number(samples), shutter });
          used = r.samples;
        }
        const px = e.readPixels();
        let s = '';
        const CH = 0x8000;
        for (let i = 0; i < px.length; i += CH) s += String.fromCharCode.apply(null, px.subarray(i, i + CH));
        rows.push({
          t, samples: used, b64: btoa(s),
          engine: {
            hud: e.hud, fps: e.fps, scale: e.gl.scale, w: e.gl.w, h: e.gl.h, pw: e.gl.pw, ph: e.gl.ph,
            lastSamples: e.lastSamples, lastPost: e.lastPost,
            lastT: e.lastT, duration: e.duration,
            renderer: e.gl.renderer,
            idAt: e.timeline.filter((i) => t >= i.start && t < i.end).map((i) => i.id),
          },
        });
      }
      return rows;
    }, { times, samples, shutter: Number(opt('shutter', '0.5')), runUp, via: opt('via', 'frame') });
    for (const row of meta) {
      const f = path.join(outDir, `t${row.t.toFixed(6)}.rgba`);
      writeFileSync(f, Buffer.from(row.b64, 'base64'));
      log(`t=${row.t}  子帧 ${row.samples}  ${path.relative(ROOT, f)}`);
      log(`  ${JSON.stringify(row.engine)}`);
    }
  } finally { await closeSession(); }
}
export { cmdDumpFrame as run };
