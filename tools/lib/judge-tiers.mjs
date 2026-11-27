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

/**
 * **check 的判据分层**（BACKLOG 1-82 第二步，2026-11-20）。
 *
 * 归类口径与 ANTI_PPT_TIERS 相同：**按当前的门**归类，不按「它有多严重」归类 ——
 *   · floor  = 现在就会进 errs（退出码 1），**不可豁免**；
 *   · reflex = 现在默认只报、--strict 才进 errs；**可豁免，但必须在 waivers.json 留痕**；
 *   · finish = 只报读数、永不进 errs（连 --strict 也不）。
 *
 * ⚠ 这张表**只改报告**：加/改一行分类不会改变任何检测逻辑或退出码。
 *   新增一条 check 判据时**必须**在这里登记（否则默认 reflex，会让「Floor 0 FAIL」失去意义）。
 *   代码是稳定锚点 —— 退役的代码**不要复用**，改语义就换一个新代码。
 */
const CHECK_JUDGE_TABLE = [
  // ── floor：现在就会红，不可豁免 ──────────────────────────────────────────
  ['scene.nonfinite', 'floor', '场景输出非有限值（NaN/±Inf）'],
  ['scene.black', 'floor', '采样点几乎全黑（mean < 0.004）'],
  ['scene.overexposed', 'floor', '过曝 / 死白'],
  ['scene.blur-path', 'floor', '单子帧与多子帧亮度不一致（运动模糊路径）'],
  ['scene.brightness-uneven', 'floor', '段内亮度很不均'],
  ['scene.render-error', 'floor', '渲染期场景抛异常（错帧卡片）'],
  ['background.missing', 'floor', '背景守门：交叠段没有铺满整帧的背景'],
  ['under.missing', 'floor', '依赖 under：声明要读 ctx.under 却没有交叠'],
  ['timeline.error', 'floor', '时间线装载期错误'],
  ['shot.missing-audio', 'floor', '镜头模板需要 audio，任务没配'],
  ['motion-spec.invalid', 'floor', 'motion.json 解析失败'],
  ['waiver.invalid', 'floor', '豁免记录不成立（判据 id / guard / reason 不合格）'],
  ['remotion.render-error', 'floor', 'Remotion 渲染期报错'],
  ['remotion.black', 'floor', 'Remotion 采样帧几乎全黑（mean < 0.004）'],
  ['remotion.mismatch', 'floor', 'Remotion 桥接帧与旧引擎同帧不一致'],
  // ── reflex：默认只报，--strict 当门；可豁免（要留痕） ─────────────────────
  ['narration.config', 'reflex', '旁白表配了但加载不了'],
  ['narration.dup', 'reflex', '画面文字逐字复述旁白'],
  ['beat.align', 'reflex', '切点没落在拍上'],
  ['beat.confidence', 'reflex', '拍网格置信度偏低'],
  ['lyric.sync', 'reflex', '歌词句首与人对不上'],
  ['motion.persona', 'reflex', '运动人格越界'],
  ['easing.direction', 'reflex', '缓动方向反了'],
  ['motion.concurrency', 'reflex', '一帧里同时运动的面太大'],
  ['color.family', 'reflex', '色系散了'],
  ['event.density', 'reflex', '事件密度太低（有超过 3.5s 的静止）'],
  ['motion.rhythm', 'reflex', '成片像匀速漂移（C7 口径）'],
  ['shot.placeholder', 'reflex', '时间线里还有 placeholder 占位卡'],
  ['motion.caps', 'reflex', '运动上限越线（错峰跨度 / 辉光峰值）'],
  ['layout.guard', 'reflex', '版面超限（块数 / 主体外的东西）'],
  ['rhythm.cov', 'reflex', '镜头长度 CoV 太低（节拍器）'],
  ['rhythm.events', 'reflex', '节奏表校验发现问题'],
  ['rhythm.structure', 'reflex', 'C4 镜头时长或呼吸窗口不足'],
  ['rhythm.hooks', 'reflex', 'C5 缺过程钩子'],
  ['motion.assert', 'reflex', '画面语义断言命中'],
  ['waiver.reused', 'reflex', '豁免理由逐字复用（样板豁免）'],
  ['waiver.unrecorded.layout', 'reflex', '无痕豁免：layout.allowOverlap 没有留痕'],
  ['waiver.unrecorded.background', 'reflex', '无痕豁免：world: false 没有留痕'],
  ['remotion.flat', 'reflex', 'Remotion 采样帧几乎纯平（无视觉层次）'],
  // ── finish：只报读数，永不拦 ────────────────────────────────────────────
  ['under.no-handles', 'finish', '读了 ctx.under 却没声明 handlesTransition（只报）'],
  ['timeline.gap', 'finish', '时间线有空档（会渲染成黑，但当前只报）'],
  ['scene.determinism', 'finish', '静态扫描：非确定性写法（只报不拦）'],
  ['scene.warning', 'finish', '渲染期 ctx.warnings（字幕保留带冲突等）'],
  ['audio.loudness', 'finish', '响度偏离平台靶子（只报数字）'],
  ['caption.missing', 'finish', '有旁白但没开字幕层'],
  ['caption.cross-scene', 'finish', '字幕跨越场景切换'],
  ['narration.anchors', 'finish', '词锚点降级成手写秒数'],
  ['background.dark-tail', 'finish', 'world:false 段窗后中点近黑（读数）'],
  ['waiver.house-style', 'finish', '同一判据被豁免 ≥3 次（house style）'],
  ['waiver.stale', 'finish', '豁免记录没有对应的判定点（可能已不需要）'],
];

export const CHECK_TIERS = Object.fromEntries(CHECK_JUDGE_TABLE.map(([code, tier]) => [code, tier]));
export const CHECK_LABELS = Object.fromEntries(CHECK_JUDGE_TABLE.map(([code, , label]) => [code, label]));
/** 分层的读法（报告里那一行脚注用它，测试钉住措辞）。 */
export const TIER_LEGEND = 'floor = 现在就会红（正确性，不可豁免）· reflex = 默认只报、--strict 才当门（可豁免，须在 waivers.json 留痕）· finish = 只报不拦';

/** 手艺与偷懒检测判据的分层（全部归 finish：只报读数、不进 check，--strict 才当门）。 */
export const CRAFT_TIERS = {
  'CRAFT-FONT': 'finish',
  'CRAFT-COLOR': 'finish',
  'CRAFT-RAWTEXT': 'finish',
  'CRAFT-MONO': 'finish',
  'CRAFT-TEMPLATE': 'finish',
  'CRAFT-STATIC-CAM': 'finish',
  'CRAFT-NOWORLD': 'finish',
  'CRAFT-EMPTY': 'finish',
  'CRAFT-FLAT': 'finish',
};

/**
 * 把 check 这一次**触发过的**判据按 tier 汇总（纯函数，离线单测）。
 *
 * 计数单位是**判据代码**，不是实例：同一段三个采样点都非有限值 = 一条 scene.nonfinite（×3）。
 * 这样「Floor 1 FAIL」读作「有一个 floor 级判据红了」，与 anti-ppt 的 C 码口径一致。
 *
 * @param {{ code: string, detail?: string, waived?: boolean, tier?: string }[]} findings
 * @param {Record<string,string>} [tierMap]
 * @returns {{ counts: { floor:number, reflex:number, finish:number, waived:number },
 *             codes: { code:string, tier:string, count:number, waived:boolean, detail:string }[],
 *             line: string }}
 */
export function summarizeCheckFindings(findings, tierMap = CHECK_TIERS) {
  /** @type {Map<string, { code:string, tier:string, count:number, waivedCount:number, detail:string }>} */
  const byCode = new Map();
  for (const f of Array.isArray(findings) ? findings : []) {
    const code = String(f?.code ?? '?');
    const tier = f?.tier ?? tierMap[code] ?? 'reflex';
    const row = byCode.get(code) ?? { code, tier, count: 0, waivedCount: 0, detail: '' };
    row.count++;
    if (f?.waived) row.waivedCount++;
    if (!row.detail && f?.detail) row.detail = String(f.detail);
    byCode.set(code, row);
  }
  const codes = [...byCode.values()]
    .map((r) => ({
      code: r.code,
      tier: r.tier,
      count: r.count,
      // 同一判据有**任何一条**没豁免 ⇒ 整条算没豁免（别用「部分豁免」粉饰）
      waived: r.count > 0 && r.waivedCount === r.count,
      detail: r.detail,
    }))
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.code.localeCompare(b.code));
  const counts = { floor: 0, reflex: 0, finish: 0, waived: 0 };
  for (const c of codes) {
    if (counts[c.tier] != null) counts[c.tier]++;
    if (c.tier === 'reflex' && c.waived) counts.waived++;
  }
  const line = tierSummary({
    floorFail: counts.floor,
    reflexFail: counts.reflex,
    reflexWaived: counts.waived,
    finishNotes: counts.finish,
  });
  return { counts, codes, line };
}

/** 触发清单的一行（flags: scene.nonfinite×3 · beat.align；空时给一句「没有判据触发」）。 */
export function formatTriggered(codes) {
  const list = Array.isArray(codes) ? codes : [];
  if (!list.length) return '没有判据触发（0 ≠ 没接线 —— 跳过的项看 skipped 段）';
  return list.map((c) => c.code + (c.count > 1 ? '×' + c.count : '') + (c.waived ? '(waived)' : '')).join(' · ');
}

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
