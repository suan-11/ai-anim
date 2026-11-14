// @ts-check
import { opt } from "../lib/cli/args.mjs";
import { reportErrors } from "../lib/cli/gates.mjs";
import { die, log } from "../lib/cli/log.mjs";
import { pickTask } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
/* ------------------------------------------------------------------ 命令：diff / hashes */

/**
 * 逐像素差分：判「同一时刻两次渲染到底差多少」。
 *
 *   node scripts/anim.mjs diff demo --times 12            # 12 秒这一帧渲染两次
 *   node scripts/anim.mjs diff demo --times 12 --warm 9.5 # 先渲 9.5 再渲 12（查历史上文的影响）
 *
 * 用途：定标「确定性」到底有多确定。哈希是 0 容差，但 GPU 的导数/滤波在若干 tile 上有
 * 最后一位的噪声，这类差异不影响观感，却会让哈希比对失败——所以两者都要有。
 */
async function cmdDiff() {
  const task = pickTask();
  const times = (opt('times', opt('t', '1')) ?? '1').split(',').map(Number).filter(Number.isFinite);
  if (!times.length) die('--times 需要给时间');
  const warm = opt('warm', '');
  const samples = opt('samples', '1');
  await openSession({ task, scale: Number(opt('scale', '0')) || undefined, only: opt('only', undefined) });
  try {
    log(`差分（samples=${samples}）  阈值：>8 与 >32 的像素占比`);
    for (const t of times) {
      const warmPx = warm ? warm.split(',').map(Number).filter(Number.isFinite) : [];
      const r = await getSession().page.evaluate(async ({ t, warmPx, samples }) => {
        const api = /** @type {any} */ (window).__anim;
        for (const w of warmPx) await api.frame(w, { samples: Number(samples) });
        return api.diff(t, t, { samples: Number(samples) });
      }, { t, warmPx, samples });
      const tag = warmPx.length ? `（先渲 ${warmPx.join(',')}）` : '';
      log(`  t=${t.toFixed(3)}${tag}  max ${r.max}  mean ${r.mean.toFixed(4)}  >8 ${(r.over8 * 100).toFixed(3)}%  >32 ${(r.over32 * 100).toFixed(3)}%`);
    }
    reportErrors(getSession().info);
  } finally { await closeSession(); }
}
export { cmdDiff as run };
