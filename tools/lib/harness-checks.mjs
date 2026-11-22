// @ts-check
/**
 * `tools/scene-harness.mjs` 的离线预检纯函数（不依赖 Chrome / WebGL）：
 *   1) `evaluateOfflineLayout` —— 直接复用 `src/layout.js` 的 `layoutVerdict / layoutReport`，
 *      0.5 秒离线抓出一屏超块、主体压字、字压字、出画等问题；
 *   2) `evaluateCutZoomContinuity` —— 在时间线每个切点对比切前最后一帧与切点首帧的有效 `post.zoom`
 *      （镜像 `src/core/engine.js` 后段覆盖前段的合并顺序），抓出未在切点前归零导致的单帧缩放回弹。
 */

import { LAYOUT_LIMITS, layoutReport, layoutVerdict } from '../../src/layout.js';

/**
 * 与 `src/app.js` 的 `layoutLimits()` 同口径：只覆盖 `LAYOUT_LIMITS` 里已有的非负有限数字键。
 * @param {any} [overrides]
 */
export function resolveLayoutLimits(overrides) {
  const out = { ...LAYOUT_LIMITS };
  if (overrides && typeof overrides === 'object') {
    for (const k of Object.keys(out)) {
      const v = Number(overrides[k]);
      if (Number.isFinite(v) && v >= 0) out[k] = v;
    }
  }
  return out;
}

/**
 * 对单个场景的离线采样列表执行 `layoutVerdict()` 并汇总为该段最糟一帧报告。
 * @param {{ t: number, lt?: number, blocks: any[], paint?: any, textLayerDrawn?: boolean }[]} samples
 * @param {{ id: string, focus?: any, W?: number, H?: number, limits?: any, pad?: number, allowOverlap?: string[] }} opts
 */
export function evaluateOfflineLayout(samples, opts) {
  const id = String(opts?.id ?? '');
  const list = Array.isArray(samples) ? samples : [];
  if (!list.length) return null;
  const rows = list.map((s) => ({
    t: Number.isFinite(s.t) ? s.t : 0,
    verdict: layoutVerdict({
      id,
      t: Number.isFinite(s.t) ? s.t : 0,
      blocks: Array.isArray(s.blocks) ? s.blocks : [],
      focus: opts?.focus ?? null,
      W: opts?.W ?? 1920,
      H: opts?.H ?? 1080,
      limits: resolveLayoutLimits(opts?.limits),
      paint: s.paint ?? null,
      textLayerDrawn: !!s.textLayerDrawn,
      pad: opts?.pad ?? 0,
      allowOverlap: opts?.allowOverlap ?? [],
    }),
  }));
  return layoutReport([{ id, samples: rows }])[0] ?? null;
}

/**
 * 镜像 `src/core/engine.js:570,700` 的有效后处理合并逻辑：
 *   `{ zoom: 1, ...basePost, ...stylePost }` 起步，按时间线活跃段顺序每段执行
 *   `post = { ...post, ...(ovObj ?? {}), ...(stylePost ?? {}), ...(itemPost ?? {}) }`。
 * 后段会整包覆盖前段字段；若前段在切点未把 `zoomBoost` 归零，后段接管的一帧会立刻弹回。
 * @param {Record<string, any>|null|undefined} basePost
 * @param {Record<string, any>|null|undefined} stylePost
 * @param {{ ov?: Record<string, any>|null, itemPost?: Record<string, any>|null }[]} activePosts
 */
export function mergeEffectivePost(basePost, stylePost, activePosts) {
  let post = { zoom: 1, ...(basePost ?? {}), ...(stylePost ?? {}) };
  for (const act of Array.isArray(activePosts) ? activePosts : []) {
    const ov = act?.ov && typeof act.ov === 'object' ? act.ov : null;
    const itemPost = act?.itemPost && typeof act.itemPost === 'object' ? act.itemPost : null;
    post = {
      ...post,
      ...(ov ?? {}),
      ...(stylePost ?? {}),
      ...(itemPost ?? {}),
    };
  }
  return post;
}

/**
 * 判别相邻段在切点（或交叠结束点）是否发生有效 `post.zoom` 单帧跳变。
 * @param {{
 *   prevId: string,
 *   nextId: string,
 *   prevStart: number,
 *   cutStart: number,
 *   tBefore: number,
 *   tAt: number,
 *   zoomBefore: number,
 *   zoomAt: number,
 *   kind?: 'cut-start'|'overlap-end',
 * }[]} cutRecords
 * @param {{ W?: number, threshold?: number }} [opts]
 */
export function evaluateCutZoomContinuity(cutRecords, opts = {}) {
  const W = Number.isFinite(opts.W) && opts.W > 0 ? opts.W : 1920;
  const threshold = Number.isFinite(opts.threshold) && opts.threshold >= 0 ? opts.threshold : 0.005;
  const hits = [];
  for (const r of Array.isArray(cutRecords) ? cutRecords : []) {
    if (!r || !Number.isFinite(r.zoomBefore) || !Number.isFinite(r.zoomAt)) continue;
    const delta = r.zoomAt - r.zoomBefore;
    if (Math.abs(delta) <= threshold + 1e-12) continue;
    const pxJump = Math.round(Math.abs(delta) * W * 0.5);
    const prevLt = Math.max(0, Number(r.cutStart ?? 0) - Number(r.prevStart ?? 0));
    const kindTag = r.kind === 'overlap-end' ? '交叠结束点' : '切点';
    hits.push({
      kind: 'cut-zoom-jump',
      cutKind: r.kind ?? 'cut-start',
      prevId: r.prevId,
      nextId: r.nextId,
      cutStart: Number(r.cutStart ?? 0),
      prevLt,
      zoomBefore: r.zoomBefore,
      zoomAt: r.zoomAt,
      delta,
      pxJump,
      message: `${kindTag} t=${Number(r.cutStart ?? 0).toFixed(2)}s（${r.prevId} → ${r.nextId}）有效 post.zoom 发生单帧跳变：`
        + `${r.zoomBefore.toFixed(5)} → ${r.zoomAt.toFixed(5)}（Δ=${delta >= 0 ? '+' : ''}${delta.toFixed(5)}，画面边缘约跳 ~${pxJump}px）`
        + ` —— 上一段（${r.prevId}）应在切点 lt=${prevLt.toFixed(2)}s 前用 zoomRelease 把 zoomBoost 归零`,
    });
  }
  return hits;
}
