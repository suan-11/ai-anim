/**
 * `tier-estimate.mjs` —— C-1：`anim video --dry-run` 按档预估的纯函数部分。
 *
 * 为什么有它：老 dry-run 只测"你手上这次参数"，而用户真正要回答的问题是两档
 * 各自的代价 —— **草稿档**（`--draft`：绝对 scale 0.5 + samples 1）和
 * **成片档**（任务 scale + samples auto）。两档价格差 8–24×（docs/PERF.md A1），
 * 只看一档做的决定几乎总是错的（要么被成片的分钟数吓住，要么被草稿的速度骗了）。
 *
 * 这里只放能离线测的纯逻辑（档位归类 / 档位计划 / 分钟数换算）；
 * 真正的测速（起浏览器渲 10 帧）在 scripts/anim.mjs 的 printEstimate 里。
 */

/** 草稿档的绝对 scale。`--draft` 用的就是 0.5（不是成片 scale 的一半，见 cmdVideo）。 */
export const DRAFT_SCALE = 0.5;

/** 编码开销（ms/帧）：成片档沿用 CLI 的 --encode 默认 4（x264 veryfast @1080p），草稿档减半。 */
export const DRAFT_ENCODE_MS = 2;

/**
 * 判断"这次跑的参数"落在哪个档。
 * @param {{ scale: number, samples: string|number }} cur  这次解析后的参数（samples 可能是 'auto'/'8'/'1'）
 * @param {number} configScale  任务自己声明的 scale（成片档的分辨率）
 * @returns {'draft'|'final'|'custom'}
 */
export function classifyTier(cur, configScale) {
  if (Math.abs(cur.scale - DRAFT_SCALE) < 1e-9 && String(cur.samples) === '1') return 'draft';
  if (Math.abs(cur.scale - configScale) < 1e-9 && String(cur.samples) === 'auto') return 'final';
  return 'custom';
}

/**
 * 出档清单：永远都是「草稿档 / 成片档」两档；本次参数两档都不属于时补一行「本次参数」。
 * `current` 标出哪一行不用另起会话测（本次会话就是它）。
 * @returns {{ id: string, label: string, scale: number, samples: number|'auto', current: boolean }[]}
 */
export function planTiers({ configScale, scale, samples }) {
  const cur = classifyTier({ scale, samples }, configScale);
  const tiers = [
    { id: 'draft', label: '草稿档', scale: DRAFT_SCALE, samples: 1, current: cur === 'draft' },
    { id: 'final', label: '成片档', scale: configScale, samples: 'auto', current: cur === 'final' },
  ];
  if (cur === 'custom') {
    tiers.push({ id: 'custom', label: '本次参数', scale, samples, current: true });
  }
  return tiers;
}

/**
 * 档位成本换算：帧数 = 秒数 × fps（至少 1 帧），分钟数含编码开销。
 * perFrameMs 是 measureSpeed 量出来的纯渲染毫秒。
 */
export function estimateTier({ seconds, fps, perFrameMs, encodeMs }) {
  const frames = Math.max(1, Math.round(seconds * fps));
  const perFrameTotal = perFrameMs + encodeMs;
  return { frames, perFrameMs: perFrameTotal, minutes: (frames * perFrameTotal) / 60000 };
}
