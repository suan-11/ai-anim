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

/**
 * 校验单条豁免：三字段齐全 + 判据 id 已登记 + reason 够长不样板。返回 {ok, errors}。
 *
 * `segments`（可选）：这条豁免只覆盖哪几段（给 `background.coverage` 用）。
 * 不写 = 覆盖该判据的全部对象；写了就必须是非空的段名字符串数组 ——
 * 空数组/空串会静默变成「什么都没覆盖」，那比不写更糟。
 */
export function validateWaiver(w) {
  const errors = [];
  if (!w?.judge) errors.push('缺 judge（豁免的是哪条判据）');
  else if (!WAIVER_JUDGES[w.judge]) {
    errors.push(`未知判据 id ${JSON.stringify(w.judge)}（可用：${Object.keys(WAIVER_JUDGES).join(' / ')}）`);
  }
  if (!w?.guard) errors.push('缺 guard（豁免成立的证据/条件，不能空口豁免）');
  const reason = String(w?.reason ?? '').trim();
  if (reason.length < WAIVER_MIN_REASON) errors.push(`reason 要 ≥${WAIVER_MIN_REASON} 字、关于这支片子（收到 ${JSON.stringify(w?.reason)}）`);
  if (w?.segments != null) {
    const segs = w.segments;
    if (!Array.isArray(segs) || !segs.length || segs.some((s) => typeof s !== 'string' || !s.trim())) {
      errors.push('segments 要是**非空**的段名字符串数组（不写 = 覆盖该判据的全部对象）');
    }
  }
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
/** 这条豁免是否覆盖某个段（没有 segments 字段 ⇒ 覆盖该判据的全部对象）。 */
export function waiverCovers(waiver, subjectId) {
  const segs = waiver?.segments;
  if (!Array.isArray(segs) || !segs.length) return true;
  return segs.includes(String(subjectId));
}

/**
 * 读一份 waivers.json 之后的**纪律审计**（纯函数）：哪些条目成立、哪些是样板、哪些判据豁太多次。
 *
 * 与 `validateWaiver()` 的分工：那一条管单条的形状，这一条管**整份文件**的纪律。
 * 规则：
 *   · 形状不合格 / 判据 id 没登记 ⇒ `invalid`（check 里是 floor：豁免不成立，后面的豁免也就不算数）；
 *   · reason 与另一条逐字复用 ⇒ `reused`（**不成立**：样板理由不能当证据；check 里是 reflex）；
 *   · 同一判据被豁 ≥3 次 ⇒ `houseStyle`（不是错误，是风格 —— 该写进 design.md 正视它）。
 * @param {any[]} waivers
 * @returns {{ valid: {index:number, waiver:any}[],
 *             invalid: {index:number, judge:string, errors:string[], reused:boolean}[],
 *             reused: string[], houseStyle: {judge:string, count:number}[] }}
 */
export function auditWaiverFile(waivers) {
  const list = Array.isArray(waivers) ? waivers : [];
  const dup = new Set(reusedReasons(list));
  const valid = [];
  const invalid = [];
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    const v = validateWaiver(w);
    const errors = [...v.errors];
    const reason = String(w?.reason ?? '').trim();
    const isReused = !!reason && dup.has(reason);
    if (isReused) errors.push('reason 与另一条逐字复用（样板豁免 —— 理由必须关于这支片子）');
    if (errors.length) invalid.push({ index: i, judge: String(w?.judge ?? ''), errors, reused: isReused });
    else valid.push({ index: i, waiver: w });
  }
  // house style 只数**成立**的条目：不成立的不算「这支片子的风格」
  return { valid, invalid, reused: [...dup], houseStyle: houseStyle(valid.map((x) => x.waiver)) };
}

/**
 * **豁免判定点的审计**（BACKLOG 1-80 的 check 接线，纯函数）：把「声明的豁免」与「留痕」对起来。
 *
 * 两个判定点：
 *   · `layout`：`layout.allowOverlap` 声明 / 采样期**真的**压掉的字压字 —— 要 `layout.overlap` 留痕；
 *   · `background`：`world: false` 的交叠段（背景守门因此**少判了一次**）—— 要 `background.coverage` 留痕。
 *
 * ⚠ 只对**真的豁免掉了判据**的对象要求留痕：不交叠段的 `world: false` 不减少任何判据
 *   （背景守门本来就不查它），不逼作者为它写一条无意义的豁免。
 *
 * @param {{ waivers?: any[], audit?: any, allowOverlap?: string[], appliedOverlaps?: any[],
 *           selfSegments?: {id:string, coveredByGuard?:boolean}[] }} [o]
 * @returns {{ audit: any,
 *   layout: { required:boolean, declared:string[], applied:number, waiver:any|null, waived:boolean, stale:boolean },
 *   background: { required:boolean, segments:string[], covered:string[], uncovered:string[], waived:boolean, stale:boolean } }}
 */
export function auditExemptions(o = {}) {
  const waivers = Array.isArray(o.waivers) ? o.waivers : [];
  const a = o.audit ?? auditWaiverFile(waivers);
  const valid = a.valid.map((x) => x.waiver);
  const layoutWaivers = valid.filter((w) => w.judge === 'layout.overlap');
  const bgWaivers = valid.filter((w) => w.judge === 'background.coverage');

  const declared = (Array.isArray(o.allowOverlap) ? o.allowOverlap : [])
    .filter((s) => typeof s === 'string' && s).map(String);
  const applied = Array.isArray(o.appliedOverlaps) ? o.appliedOverlaps : [];
  const layout = {
    required: declared.length > 0 || applied.length > 0,
    declared,
    applied: applied.length,
    waiver: layoutWaivers[0] ?? null,
    waived: layoutWaivers.length > 0,
    stale: layoutWaivers.length > 0 && declared.length === 0 && applied.length === 0,
  };

  const segments = (Array.isArray(o.selfSegments) ? o.selfSegments : [])
    .filter((s) => s && s.coveredByGuard !== false)
    .map((s) => String(s.id));
  const covered = [];
  const uncovered = [];
  for (const id of segments) {
    const hit = bgWaivers.some((w) => waiverCovers(w, id));
    (hit ? covered : uncovered).push(id);
  }
  const background = {
    required: segments.length > 0,
    segments,
    covered,
    uncovered,
    waived: segments.length > 0 && uncovered.length === 0,
    stale: bgWaivers.length > 0 && segments.length === 0,
  };
  return { audit: a, layout, background };
}
