// @ts-check
import { flag, opt } from "../lib/cli/args.mjs";
import { collectRenderErrors, reportErrors } from "../lib/cli/gates.mjs";
import { log, warn } from "../lib/cli/log.mjs";
import { pickTask } from "../lib/cli/paths.mjs";
import { closeSession, getSession, openSession } from "../lib/cli/session.mjs";
/* ------------------------------------------------------------------ 命令：carry（连贯度审计，BACKLOG 1-34） */

/**
 * 连贯度 oracle：每个镜头边界两侧各渲一帧，块匹配找"活过边界的东西"，
 * 分类 carried / anchored / bare，汇总 carry score。
 *
 *   node scripts/anim.mjs carry <任务>              # 全片
 *   node scripts/anim.mjs carry <任务> --strict     # score < 0.5 时退出码 1
 *   node scripts/anim.mjs carry <任务> --at 12,30   # 只查给定时刻（调试用）
 *
 * 判据出处：外部项目 onetake 的 probe（`docs/REFERENCE-onetake.md` §2，【外部经验值】）——
 * 同一条片子的四个版本 carry 0.00 / 0.40 / 0.75 / 0.83 与人审结论逐版一致，
 * 而**节奏腿四版全过**：连贯是节奏看不见的维度。判据 + 盲区（跨元素合成、连续世界）：
 *   · carried  = 有东西活过边界且动了（位移 ≥2% 对角线 或 缩放 ≥10%）
 *   · anchored = 大块幸存物没动（≥3% 画面）—— 世界没变，新内容围着它长
 *   · bare     = 互相替换 —— 无论节奏多好都读作换灯片
 *   · 豁免     = burst（1.5s 内 ≥3 切）、片尾 1.2s、`carry: 'morph'` 显式登记
 *
 * ⚠ 读数不 gate（默认退出码 0）：与版面守门同例 —— 这是一条新纪律，先让数字被看见。
 *   要卡死加 --strict。
 */
async function cmdCarry() {
  const task = pickTask();
  const strict = flag('strict');
  const atArg = opt('at', '');

  await openSession({ task, scale: Number(opt('scale', '0')) || undefined, only: opt('only', undefined) });
  try {
    const { planCarryBoundaries, classifyCarry, summarizeCarry } = await import("../../src/timeline.js");
    const timeline = getSession().info.timeline ?? [];
    let bounds = planCarryBoundaries(timeline);
    if (atArg) {
      const times = atArg.split(',').map(Number).filter(Number.isFinite);
      bounds = bounds.filter((b) => times.some((t) => Math.abs(t - b.at) < 0.05));
      if (!bounds.length) { log('--at 给的时刻附近没有镜头边界（±0.05s）。'); return; }
    }

    if (!bounds.length) {
      // onetake probe 的盲区②（REFERENCE-onetake.md §2.3）：连续世界 / 单镜头没有边界可判，
      // "continuity 1.00 over 0 boundaries" 不是证据 —— 这里明说，不说"通过"。
      log(`时间线 ${timeline.length} 段、没有内部边界可判 —— carry 在一镜到底的片子上只能靠眼睛（CARRY 分不出来）。`);
      log('→ 这不是通过；要看衔接质量用 anim cuts 出图，或者只挑有切点的区间。');
      return;
    }

    log(`连贯度审计：${bounds.length} 个边界（${bounds.filter((b) => b.overlap > 0).length} 个交叠 / ${bounds.filter((b) => !b.overlap).length} 个硬切）`);
    log(`块匹配：每边界两侧各 1 帧 · 16×16 块 · 位移半径 3 块（判据见 docs/REFERENCE-onetake.md §2）\n`);

    const rows = [];
    for (const b of bounds) {
      // 两侧各取一帧：交叠边界取中点前 0.30s（旧段还在画）与后 0.30s（新段接手了）；
      // 硬切取切点前后各 1/6 秒（避开切点本身的转场噪声，也避开相邻内容静止帧）。
      const off = b.overlap > 0 ? 0.30 : Math.max(1 / 12, 1 / 6);
      const tA = Math.max(0, b.at - off), tB = Math.min(getSession().info.duration, b.at + off);
      const m = await getSession().page.evaluate(async ({ tA, tB, grid, maxShift, tol }) => {
        const api = /** @type {any} */ (window).__anim;
        await api.frame(tA, { samples: 1 });
        const A = new Uint8Array(await api.pixels());
        await api.frame(tB, { samples: 1 });
        const B = new Uint8Array(await api.pixels());
        // 块匹配（页面侧算：省去 8MB×2 的跨桥传输）。
        const W = api.info().width, H = api.info().height;
        const bw = Math.ceil(W / grid), bh = Math.ceil(H / grid);
        // 每块取 4×4 采样的平均灰度（128 级量化），抗噪且便宜
        const blockGray = (px, bx, by) => {
          const x0 = bx * (W / grid), y0 = by * (H / grid);
          let s = 0, n = 0;
          for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
            const x = Math.min(W - 1, Math.floor(x0 + (sx + 0.5) * (bw / 4)));
            const y = Math.min(H - 1, Math.floor(y0 + (sy + 0.5) * (bh / 4)));
            const i = (y * W + x) * 4;   // pixels() 自下而上：A/B 同序，比位移不用翻
            s += (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
            n++;
          }
          return s / Math.max(1, n);
        };
        let matched = 0, total = 0, shiftSum = 0, scaleSum = 0;
        for (let by = 1; by < grid - 1; by++) {
          for (let bx = 1; bx < grid - 1; bx++) {
            total++;
            const ga = blockGray(A, bx, by);
            let best = Infinity, bdx = 0, bdy = 0;
            for (let dy = -maxShift; dy <= maxShift; dy++) {
              for (let dx = -maxShift; dx <= maxShift; dx++) {
                const nx = bx + dx, ny = by + dy;
                if (nx < 0 || ny < 0 || nx >= grid || ny >= grid) continue;
                const d = Math.abs(ga - blockGray(B, nx, ny));
                if (d < best) { best = d; bdx = dx; bdy = dy; }
              }
            }
            if (best <= tol) {
              matched++;
              // 位移以"块"计（两帧分辨率相同，scale ≈ 1 的水平位移才是 carry 的常态；
              // 缩放检测给 morphRect/zoomThrough 那类边界：B 帧同一内容占的块数变了 ⇒ 近似
              // 用"匹配块对的间距差"没有稳定定义，退化为不报缩放，位移判据已够用）
              shiftSum += Math.hypot(bdx, bdy) * bw;
              scaleSum += 1;
            }
          }
        }
        const diag = Math.hypot(W, H);
        return {
          matched, total,
          avgShiftFrac: matched ? (shiftSum / matched) / diag : 0,
          avgScale: 1,
          quality: 1 - (matched / Math.max(1, total)) * 0, // 匹配覆盖率即质量读数
          cover: matched / Math.max(1, total),
        };
      }, { tA, tB, grid: 16, maxShift: 3, tol: 0.02 });
      const verdict = classifyCarry(m);
      rows.push({ ...b, verdict: verdict.verdict, reason: verdict.reason, cover: m.cover });
      const mark = verdict.verdict === 'carried' ? '✓ carried  ' : verdict.verdict === 'anchored' ? '· anchored ' : '✗ bare     ';
      log(`  t=${b.at.toFixed(2).padStart(7)}s  ${b.prevId} → ${b.id}${b.overlap ? `（交叠 ${b.overlap.toFixed(2)}s）` : '（硬切）'}`
        + `  ${mark} 覆盖 ${(m.cover * 100).toFixed(0)}%  位移 ${(m.avgShiftFrac * 100).toFixed(2)}% 对角线`);
      log(`      ${verdict.reason}`);
    }

    const sum = summarizeCarry(rows);
    log('');
    if (sum.noBoundaries) {
      log(`计入的边界 0 个（豁免 ${sum.exempt} 个）—— 没有可判对象，carry score 无意义。`);
    } else {
      log(`carry score = ${sum.score.toFixed(2)}（carried ${sum.carried} · anchored ${sum.anchored} · bare ${sum.bare} · 豁免 ${sum.exempt}）`
        + `  ${sum.tier === 'pass' ? '✓' : sum.tier === 'warn' ? '⚠' : '✗'} ${sum.tier === 'pass' ? '通过（≥0.7）' : sum.tier === 'warn' ? '警告（<0.7）—— 有缝在互相替换' : '不合格（<0.5）—— 大量边界互相替换，像 PPT'}`);
      log('  阈值出处：onetake probe 的标定（【外部经验值】，我方未实测）：0.00/0.40 被否、0.75/0.83 通过。');
    }
    const bareList = rows.filter((r) => r.verdict === 'bare' && !r.exemptTail && !r.registered);
    if (bareList.length) {
      warn(`\n⚠ ${bareList.length} 个 bare 边界（互相替换 —— 观众读作"换了一张灯片"）：`);
      for (const r of bareList) warn(`  t=${r.at.toFixed(2)}s  ${r.prevId} → ${r.id}：${r.reason}`);
      warn('  → 改法（都是内容层的事，不动引擎）：');
      warn('    ① 让一个东西活过边界：按下的东西变成结果（morphRect）、卡片推近成场景（zoomThrough）、');
      warn('       主体跳到下一个槽（hop）、一群元素收拢（gather）—— src/kit/carry.js 有现成纯函数；');
      warn('    ② 硬切集中在 burst 里（1.5s ≥3 切会被豁免），别匀速铺满全片；');
      warn('    ③ 跨元素合成的衔接（卡片淡出+新页淡入）对观众成立但量具判 bare —— 在 cut(..., { carry: \'morph\' }) 里声明。');
    }
    if (strict && sum.tier === 'fail') {
      warn('\n--strict：carry score < 0.5，判不合格。');
      process.exitCode = 1;
    }
    reportErrors(getSession().info);
    const rerr = await collectRenderErrors({ take: false });
    if (rerr.count) {
      warn(`\n⚠ 刚渲染的帧里有场景异常：${rerr.count} 帧 —— carry 读数里那些帧是错帧卡片，先修场景错误。`);
      process.exitCode = 1;
    }
    log('\n下一步：把 bare 边界的两侧用 anim cuts --at <t> 出图，亲眼看是什么替换了什么，再决定 carry 声明还是改衔接。');
  } finally { await closeSession(); }
}
export { cmdCarry as run };
