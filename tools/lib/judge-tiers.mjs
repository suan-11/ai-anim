// @ts-check
/**
 * tools/lib/judge-tiers.mjs —— 判据分层（BACKLOG 1-82，对标 hallmark 的 Floor/Reflex/Finish）。
 *
 * 让「全绿」有明确含义：**0 FAIL 只对 Floor 成立**。把判据分成三层 ——
 *   floor  绝不可过（正确性/诚实，永不豁免）
 *   reflex 模型默认（可豁免、要记录；--strict 才当门）
 *   finish 工艺细节（只报不拦）
 * 本模块只提供**词表 + 归类 + 汇总**，不改任何判据的检测逻辑、也不改退出码（只改报告）。
 */

export const TIERS = {
  floor: '绝不可过（正确性/诚实，永不豁免）',
  reflex: '模型默认（可豁免、要记录；--strict 才当门）',
  finish: '工艺细节（只报不拦）',
};
export const TIER_ORDER = ['floor', 'reflex', 'finish'];

/** 反 PPT 七条判据的分层。C3 是 floor：裸 overlap 会被引擎**静默**退回交叉溶解（正确性问题）。 */
export const ANTI_PPT_TIERS = {
  C1: 'reflex',  // 状态差
  C2: 'reflex',  // 接力物
  C3: 'floor',   // 转场（静默回落 = 正确性）
  C4: 'reflex',  // 节奏
  C5: 'reflex',  // 钩子
  C6: 'finish',  // 声音层（信息项）
  C7: 'reflex',  // 匀速漂移
};

/** 把一组判据代码按 tier 计数。未知代码默认 reflex。 */
export function bucketByTier(codes, tierMap) {
  const counts = { floor: 0, reflex: 0, finish: 0 };
  for (const c of codes) { const t = tierMap[c] ?? 'reflex'; if (counts[t] != null) counts[t]++; }
  return counts;
}

/** 分层汇总一行。`Floor 0 FAIL · Reflex 2 (1 waived) · Finish 3`。 */
export function tierSummary({ floorFail = 0, reflexFail = 0, reflexWaived = 0, finishNotes = 0 } = {}) {
  let s = `Floor ${floorFail} FAIL · Reflex ${reflexFail}`;
  if (reflexWaived) s += ` (${reflexWaived} waived)`;
  s += ` · Finish ${finishNotes}`;
  return s;
}
