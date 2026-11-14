// @ts-check
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { opt } from "../lib/cli/args.mjs";
import { log } from "../lib/cli/log.mjs";
import { ROOT, pickTask, taskOut } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
/* ------------------------------------------------------------------ 命令：dumpframes */

/**
 * 顺着渲一串帧并把每帧的原始 RGBA 落盘 —— 与 `video --keep-raw` 做逐帧对照用。
 *
 *   node scripts/anim.mjs dumpframes beat --from 0 --to 1 --samples 2 --out out/beat/_frames
 *   node tools/probe-frame-drift.mjs out/beat/_raw.rgba out/beat/_frames
 */
async function cmdDumpFrames() {
  const task = pickTask();
  const from = Number(opt('from', '0'));
  const to = Number(opt('to', '1'));
  const fps = Number(opt('fps', '60'));
  const samples = opt('samples', '1');
  const outDir = path.resolve(ROOT, opt('out', taskOut(task, '_frames')));
  mkdirSync(outDir, { recursive: true });
  const n = Math.max(1, Math.round((to - from) * fps));
  await openSession({ task, only: opt('only', undefined), scale: Number(opt('scale', '0')) || undefined });
  try {
    log(`顺着渲 ${from}→${to}s 共 ${n} 帧，samples=${samples} → ${path.relative(ROOT, outDir)}`);
    /**
     * ⚠ 必须**分批** evaluate：一帧 1080p 的 base64 是 ~11 MB 字符串，
     * 一次把 60 帧（≈660 MB）从页面里送回来会撞上 Node 的字符串上限
     * （`ERR_STRING_TOO_LONG: Cannot create a string longer than 0x1fffffe8 characters`）。
     * 分成每批 4 帧既安全又快 —— 渲染本身在页面里顺序进行，分批不影响渲染历史。
     */
    const BATCH = 4;
    let done = 0;
    for (let i = 0; i < n; i += BATCH) {
      const chunk = await getSession().page.evaluate(async ({ from, fps, samples, shutter, i0, count }) => {
        const api = /** @type {any} */ (window).__anim;
        const e = /** @type {any} */ (window).__animEngine;
        const out = [];
        for (let k = 0; k < count; k++) {
          const t = from + (i0 + k) / fps;
          const r = await api.frame(t, { samples: samples === 'auto' ? 'auto' : Number(samples), shutter });
          const px = e.readPixels();
          let s = '';
          const CH = 0x8000;
          for (let j = 0; j < px.length; j += CH) s += String.fromCharCode.apply(null, px.subarray(j, j + CH));
          out.push({ t, samples: r.samples, b64: btoa(s) });
        }
        return out;
      }, { from, fps, samples, shutter: Number(opt('shutter', '0.5')), i0: i, count: Math.min(BATCH, n - i) });
      for (const row of chunk) {
        writeFileSync(path.join(outDir, `t${row.t.toFixed(6)}.rgba`), Buffer.from(row.b64, 'base64'));
        done++;
      }
      process.stdout.write(`\r  ${done}/${n} 帧`);
    }
    process.stdout.write('\n');
    log(`✓ ${done} 帧 → ${path.relative(ROOT, outDir)}`);
  } finally { await closeSession(); }
}
export { cmdDumpFrames as run };
