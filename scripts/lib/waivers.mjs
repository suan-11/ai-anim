// @ts-check
/**
 * scripts/lib/waivers.mjs —— 豁免纪律（BACKLOG 1-80，对标 hallmark 的 waiver 三字段）。
 *
 * 现在 allowOverlap / world:false / --accept 这些豁免**无痕** —— 骗过 check 很容易。
 * 这里把豁免统一成可记录块：**judge（哪条判据）+ guard（豁免成立的证据）+ reason（关于这支片子的理由）**。
 * 同一判据被反复豁免（≥3 次）⇒ 那不是例外，是 **house style**，要写进 design.md 正视它。
 * 纯函数，离线可测。记录存 tasks/<任务>/waivers.json。
 */

/** 已知的豁免点 → 判据 id。新增豁免点往这里登记。 */
export const WAIVER_JUDGES = {
  'layout.overlap': '版面允许字压字（style.layout.allowOverlap）',
  'background.coverage': '这一段刻意不铺底（world:false）',
  'hashes.baseline': '画面基线变更被接受（hashes --accept）',
  'anti-ppt': '反 PPT 某条判据豁免',
};

export const WAIVER_MIN_REASON = 12;
export const HOUSE_STYLE_THRESHOLD = 3;

/** 校验单条豁免：三字段齐全 + reason 够长不样板。返回 {ok, errors}。 */
export function validateWaiver(w) {
  const errors = [];
  if (!w?.judge) errors.push('缺 judge（豁免的是哪条判据）');
  if (!w?.guard) errors.push('缺 guard（豁免成立的证据/条件，不能空口豁免）');
  const reason = String(w?.reason ?? '').trim();
  if (reason.length < WAIVER_MIN_REASON) errors.push(`reason 要 ≥${WAIVER_MIN_REASON} 字、关于这支片子（收到 ${JSON.stringify(w?.reason)}）`);
  return { ok: errors.length === 0, errors };
}

/** 同一 reason 逐字复用 ⇒ 样板豁免，拒。返回复用的 reason 列表。 */
export function reusedReasons(waivers) {
  const seen = new Map(); const dup = [];
  for (const w of waivers) {
    const r = String(w?.reason ?? '').trim();
    if (!r) continue;
    if (seen.has(r)) dup.push(r); else seen.set(r, true);
  }
  return [...new Set(dup)];
}

/** 同一判据被豁免 ≥threshold 次 ⇒ house style（不是例外，是风格，要正视）。 */
export function houseStyle(waivers, threshold = HOUSE_STYLE_THRESHOLD) {
  const counts = {};
  for (const w of waivers) { if (w?.judge) counts[w.judge] = (counts[w.judge] || 0) + 1; }
  return Object.entries(counts).filter(([, n]) => n >= threshold).map(([judge, count]) => ({ judge, count }));
}
