// @ts-check
import { spawnSync } from "node:child_process";
import path from "node:path";
import { flag, opt } from "../lib/cli/args.mjs";
import { log } from "../lib/cli/log.mjs";
import { ROOT, pickTask } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
async function cmdPerf() {
  const task = pickTask();
  const from = Number(opt('from', '0'));
  // --breakdown：走**真实出片管线**（video 推流 + ffmpeg）分段计时，而不是 api.frame() 空转。
  // 只测量不改出片路径；子进程跑 video --breakdown --draft，表由它打印。
  if (flag('breakdown')) {
    const to = opt('to', String(from + 5));
    const args = [path.join(ROOT, 'scripts', 'anim.mjs'), 'video', task,
      '--from', String(from), '--to', String(to), '--samples', opt('samples', 'auto'),
      '--breakdown', '--draft'];
    if (opt('only', undefined)) args.push('--only', opt('only'));
    log(`perf --breakdown → 真实管线分段计时（video --draft --breakdown）`);
    const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    process.exitCode = r.status ?? 1;
    return;
  }
  await openSession({ task, only: opt('only', undefined) });
  try {
    const info = getSession().info;
    const to = Number(opt('to', String(Math.min(info.duration, from + 5))));
    const samples = opt('samples', '1');
    log(`性能测量 ${from}→${to}s  samples=${samples}  (${info.width}×${info.height}${info.scale > 1 ? ' ×' + info.scale : ''})`);
    const r = await getSession().page.evaluate(async ({ from, to, samples, shutter }) => {
      const api = /** @type {any} */ (window).__anim;
      const ms = [];
      const used = {};
      for (let t = from; t < to; t += 1 / 60) {
        const a = performance.now();
        const res = await api.frame(t, { samples: samples === 'auto' ? 'auto' : Number(samples), shutter });
        await api.stats();
        ms.push(performance.now() - a);
        used[res.samples] = (used[res.samples] ?? 0) + 1;
      }
      ms.sort((x, y) => x - y);
      return {
        n: ms.length,
        avg: ms.reduce((a, b) => a + b, 0) / ms.length,
        p50: ms[ms.length >> 1], p95: ms[Math.floor(ms.length * 0.95)], max: ms[ms.length - 1],
        used,
      };
    }, { from, to, samples, shutter: Number(opt('shutter', '0.5')) });
    log(`  帧数 ${r.n}  平均 ${r.avg.toFixed(1)}ms  p50 ${r.p50.toFixed(1)}ms  p95 ${r.p95.toFixed(1)}ms  最慢 ${r.max.toFixed(1)}ms`);
    log(`  子帧分布 ${Object.entries(r.used).map(([k, v]) => `${k}:${v}`).join('  ')}`);
    const perFrame = r.avg + Number(opt('encode', '8'));
    const totalFrames = info.duration * 60;
    const minutes = (totalFrames * perFrame) / 60000;
    log(`  按 ${totalFrames.toFixed(0)} 帧算，整片约 ${minutes.toFixed(1)} 分钟（含编码开销）`);
  } finally { await closeSession(); }
}
export { cmdPerf as run };
