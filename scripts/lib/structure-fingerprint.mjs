// @ts-check
/**
 * scripts/lib/structure-fingerprint.mjs —— 结构反收敛（BACKLOG 1-81，对标 hallmark 的 Variety 轴）。
 *
 * 风格反疲劳只管「配色换没换」；这里量的是**结构**是否跟最近几支撞：
 * 段数 / 总时长 / 段长 CoV / 转场类型分布 / 段长离散度。五个维度里 ≥4 个同构 ⇒ 「结构收敛」。
 * 纯函数，吃段表（build 后的 timeline），不起 GPU / 不渲帧 —— 离线可测。
 */

export const FINGERPRINT_DIMS = ['segCount', 'totalDur', 'durCov', 'transDist', 'durSpread'];

/** 从段表算结构指纹。segs 需有 dur（或 start/end）与可选 transition。 */
export function fingerprint(segs) {
  const durs = segs.map((s) => Number(s.dur ?? (s.end != null && s.start != null ? s.end - s.start : 4))).filter((d) => d > 0);
  const n = durs.length;
  if (!n) return { segCount: 0, totalDur: 0, durCov: 0, transDist: {}, durSpread: 1 };
  const total = durs.reduce((a, b) => a + b, 0);
  const mean = total / n;
  const variance = durs.reduce((a, d) => a + (d - mean) ** 2, 0) / n;
  const cov = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const trans = {};
  for (const s of segs) { const t = String(s.transition ?? 'push'); trans[t] = (trans[t] || 0) + 1; }
  const transDist = {}; for (const k of Object.keys(trans)) transDist[k] = trans[k] / n;
  const spread = Math.max(...durs) / Math.min(...durs);
  return { segCount: n, totalDur: total, durCov: cov, transDist, durSpread: spread };
}

const l1 = (x, y) => {
  const keys = new Set([...Object.keys(x || {}), ...Object.keys(y || {})]);
  let s = 0; for (const k of keys) s += Math.abs((x?.[k] || 0) - (y?.[k] || 0)); return s;
};

/** 逐维判「同构」。阈值刻意宽一点 —— 反收敛抓的是「明显撞结构」，不是斤斤计较。 */
export function dimSimilarity(a, b) {
  return {
    segCount: Math.abs(a.segCount - b.segCount) <= 1,
    totalDur: Math.abs(a.totalDur - b.totalDur) / Math.max(a.totalDur, b.totalDur, 1e-9) < 0.20,
    durCov: Math.abs(a.durCov - b.durCov) < 0.10,
    transDist: l1(a.transDist, b.transDist) < 0.35,
    durSpread: Math.abs(a.durSpread - b.durSpread) / Math.max(a.durSpread, b.durSpread, 1e-9) < 0.30,
  };
}

/**
 * 当前指纹 vs 历史指纹列表。任一历史片 ≥minDims 维同构 ⇒ 结构收敛。
 * @param {object} current @param {{name:string,fingerprint:object}[]} history
 */
export function convergence(current, history, opts = {}) {
  const minDims = opts.minDims ?? 4;
  // 单段连续片的段结构指纹退化（CoV 恒 0 / 离散恒 1 / 无切点）：两支单段片必然「4 维同构」，是假阳性。
  // 反收敛对单段片不适用（要比就比段内运动/节拍）—— 明说不适用，别假装判了。
  if (current.segCount < 2) {
    return { converged: false, matches: [], minDims, applicable: false, reason: '单段连续片：段结构指纹退化，反收敛暂不适用（要比段内运动/节拍）' };
  }
  const matches = [];
  for (const h of history) {
    if (!h?.fingerprint || h.fingerprint.segCount < 2) continue;
    const sims = dimSimilarity(current, h.fingerprint);
    const dims = FINGERPRINT_DIMS.filter((d) => sims[d]);
    if (dims.length >= minDims) matches.push({ name: h.name, similarDims: dims.length, dims });
  }
  matches.sort((a, b) => b.similarDims - a.similarDims);
  return { converged: matches.length > 0, matches, minDims, applicable: true };
}
