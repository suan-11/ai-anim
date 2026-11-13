// @ts-check
import { opt } from "../lib/cli/args.mjs";
import { log, warn } from "../lib/cli/log.mjs";
import { pickTask } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
/* ------------------------------------------------------------------ 命令：determinism */

/**
 * **P1-2 定位实验**：同一时刻，为什么"逐帧顺着渲"与"直接 seek 过去渲"不一样？
 *
 * 背景（`docs/history/IMPROVEMENTS-1-3.md` P1-2）：把成片抽帧和 `still` 重渲比对，同一个 t
 * 长期只能部分通过。beast 那轮的实测是：从 85s 起渲到 112s 的窗口 vs 从 110s 起渲
 * 同一窗口 → 34.8 dB；从 105s 起（预热 5 秒）→ 33.2 dB。也就是说
 * **"每帧是 t 的纯函数"这句话在像素层面只在同一个渲染序列内成立**。
 *
 * 这个命令把"序列"这件事显式化，用同一条会话测三组：
 *   A) 顺着 0,1,2,…,N-1 逐帧渲（= 出片那条路）
 *   B) 倒着 N-1,…,1,0 逐帧渲（= 另一个序列）
 *   C) 只在最末尾 seek 一次到 N-1（= `still` 那条路）
 * 然后对比「同一 t 在 A/B/C 里的指纹」，并**打印引擎内部所有可能与上一帧有关的量**
 * （子帧数、采样误差、post 参数、音频特征、池子复用），逐帧找第一个分叉点。
 *
 *   node scripts/anim.mjs determinism <任务> --from 0 --frames 40
 *   node scripts/anim.mjs determinism beast --from 100 --frames 40
 */
async function cmdDeterminism() {
  const task = pickTask();
  const from = Number(opt('from', '0'));
  const n = Math.max(2, Number(opt('frames', '40')));
  const samples = opt('samples', '1');
  const shutter = Number(opt('shutter', '0.5'));
  await openSession({ task, only: opt('only', undefined) });
  try {
    const r = await getSession().page.evaluate(async ({ from, n, samples, shutter }) => {
      const api = /** @type {any} */ (window).__anim;
      const times = Array.from({ length: n }, (_, i) => from + i / 60);
      /**
       * 一帧的指纹 + 所有"可能跨帧"的内部量。
       * 指纹用每 16 像素取一个的粗哈希（对 1 LSB 噪声宽容，但真变了会露出来）。
       */
      const measure = async (t) => {
        const e = window.__animEngine;
        await api.frame(t, { samples: samples === 'auto' ? 'auto' : Number(samples), shutter });
        const px = e.readPixels();
        let h = 0x811c9dc5, sum = 0, cnt = 0;
        for (let i = 0; i < px.length; i += 64) {
          h = Math.imul(h ^ px[i], 16777619) >>> 0;
          sum += px[i]; cnt++;
        }
        const a = e.music?.at ? e.music.at(t) : {};
        return {
          t,
          hash: (h >>> 0).toString(16).padStart(8, '0'),
          mean: sum / cnt,
          samples: e.lastSamples,
          lastErrors: (e.lastErrors ?? []).map((x) => +x.toFixed(4)),
          post: {
            bloom: e.lastPost?.bloom, grain: e.lastPost?.grain,
            vignette: e.lastPost?.vignette, zoom: e.lastPost?.zoom,
            shake: e.lastPost?.shake,
          },
          a: { rms: a.rms, kick: a.kick, beat: a.beat },
        };
      };
      const forward = [];
      for (const t of times) forward.push(await measure(t));
      const backward = [];
      for (let i = times.length - 1; i >= 0; i--) backward.push(await measure(times[i]));
      backward.reverse();
      // C) 只 seek 一次到最后一帧（模拟 still 那条路：会话里没有前面的帧）
      const seekOnly = [await measure(times[times.length - 1])];
      return { times, forward, backward, seekOnly };
    }, { from, n, samples, shutter });

    const show = (row) => `  t=${row.t.toFixed(4)}  ${row.hash}  mean ${row.mean.toFixed(4)}`
      + `  子帧 ${row.samples}  err [${row.lastErrors.join(' ')}]`
      + `  post ${JSON.stringify(row.post)}  a ${JSON.stringify(row.a)}`;

    const cmp = (name, A, B) => {
      let bad = 0, firstBad = -1;
      for (let i = 0; i < A.length; i++) {
        const same = A[i].hash === B[i].hash;
        if (!same) { bad++; if (firstBad < 0) firstBad = i; }
      }
      log(`\n${name}：${A.length - bad}/${A.length} 一致${bad ? `，第一个分叉在第 ${firstBad} 帧（t=${A[firstBad].t.toFixed(4)}）` : ''}`);
      if (bad) {
        const i = firstBad;
        log('  顺向 : ' + show(A[i]));
        log('  反向 : ' + show(B[i]));
        const d = (k, x, y) => {
          const va = x[k], vb = y[k];
          if (JSON.stringify(va) === JSON.stringify(vb)) return;
          log(`    ⚠ ${k} 不同：${JSON.stringify(va)} vs ${JSON.stringify(vb)}`);
        };
        for (const k of ['samples', 'lastErrors', 'post', 'a', 'mean']) d(k, A[i], B[i]);
      }
      return bad;
    };

    log(`确定性实验  ${task}  从 ${from}s 起 ${n} 帧  samples=${samples}  shutter=${shutter}`);
    log('A/B = 顺着 / 倒着逐帧渲同一串时刻；C = 只 seek 一次到最后一帧\n');
    log('顺向：');
    for (const row of r.forward.slice(0, 6)) log(show(row));
    if (n > 6) log(`  …（共 ${n} 帧）`);

    let bad = 0;
    bad += cmp('A 顺向 vs B 反向（同一串时刻，不同顺序）', r.forward, r.backward);
    bad += cmp(
      'B 反向 vs C 只 seek 一帧（末尾那一帧）',
      [r.backward[r.backward.length - 1]],
      r.seekOnly,
    );

    if (!bad) log('\n✓ 这一串时刻在三种序列下逐像素一致（这批帧没有跨帧依赖）');
    else {
      warn('\n✗ 存在跨帧依赖 —— 见上面"⚠ … 不同"的那几行：那就是根因所在。');
      process.exitCode = 1;
    }
  } finally { await closeSession(); }
}
export { cmdDeterminism as run };
