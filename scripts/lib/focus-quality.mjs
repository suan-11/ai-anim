// @ts-check
/** 视觉焦点判据：观众在看你想让他看的东西吗？
 *
 * 三个可测量维度（全部来自 measureAttention 已有输出，不需要新渲染）：
 *
 * 1. **focusShare**（主体内显著性占比）：画面总显著性质量中，落在声明的 focus 框内的比例。
 *    高 = 观众的注意力被主体吸引；低 = 显著性散在背景/装饰/字幕上，主体没存在感。
 *    这是「有没有焦点」的量。
 *
 * 2. **hotspotInside**（最强吸引点在不在主体框内）：measureAttention 找到的全局最强
 *    10% 窗口的加权中心是否落在 focus 框里。focusShare 高但 hotspot 在外 = 主体虽然
 *    占了不少显著性，但最亮的那个点不是主体（比如一个装饰闪光比柱阵更抢眼）。
 *    这是「焦点对不对」的二值判定。
 *
 * 3. **focusStability**（焦点时间稳定性）：相邻采样间 hotspot 位移的中位数。
 *    太高 = 视线被到处牵引没有锚定（复杂度刷分的副作用）；
 *    太低 = 画面静止无变化（PPT）。合理区间 0.02-0.15 归一化/采样。
 *    这是「焦点稳不稳」的量。
 *
 * 综合判据 focusQuality ∈ [0,1]：
 *   fq = 0.5 * focusShare + 0.3 * insideRate + 0.2 * stabilityScore
 *   stabilityScore = 1 - |medianDisp - 0.06| / 0.12  （0.06 是甜区中心）
 *
 * 分角色阈值（bit 深谷档）：
 *   release:  fq ≥ 0.55, focusShare ≥ 0.45, insideRate ≥ 0.75
 *   hold:     fq ≥ 0.35, focusShare ≥ 0.25, insideRate ≥ 0.40
 *   pressure: fq ≥ 0.30, focusShare ≥ 0.25, insideRate ≥ 0.40
 *   residue:  fq ≥ 0.35, focusShare ≥ 0.30, insideRate ≥ 0.50
 *
 * 用法：
 *   node scripts/anim.mjs rhythm <task> --focus          # 采集+报告
 *   或离线：evaluateFocusQuality(attentionJson) → 逐块诊断
 */

/** 单块焦点质量评估。samples 是该块内的 attention 采样行。 */
export function blockFocusQuality(samples, focus) {
  const valid = samples.filter(s => s.focusShare != null && s.hotspot);
  if (!valid.length) return { status: 'unmeasured', fq: null, focusShare: null, insideRate: null, stability: null };
  const meanShare = valid.reduce((a, s) => a + s.focusShare, 0) / valid.length;
  let inside = 0;
  if (focus) {
    for (const s of valid) {
      const p = s.hotspot;
      if (p.x >= focus.x && p.x < focus.x + focus.w && p.y >= focus.y && p.y < focus.y + focus.h) inside++;
    }
  }
  const insideRate = focus ? inside / valid.length : null;
  // hotspot 位移中位数
  const disps = [];
  for (let i = 1; i < valid.length; i++) {
    const a = valid[i - 1].hotspot, b = valid[i].hotspot;
    disps.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  disps.sort((a, b) => a - b);
  const medianDisp = disps.length ? disps[Math.floor(disps.length / 2)] : 0;
  const stabilityScore = Math.max(0, 1 - Math.abs(medianDisp - 0.06) / 0.12);
  const fq = 0.5 * meanShare + 0.3 * (insideRate ?? 0.5) + 0.2 * stabilityScore;
  return { status: 'measured', fq, focusShare: meanShare, insideRate, medianDisp, stabilityScore, n: valid.length };
}

/** 角色阈值表（bit 深谷档）。 */
export const FOCUS_THRESHOLDS = {
  release:  { fq: 0.55, share: 0.45, inside: 0.75 },
  hold:     { fq: 0.35, share: 0.25, inside: 0.40 },
  pressure: { fq: 0.30, share: 0.25, inside: 0.40 },
  residue:  { fq: 0.35, share: 0.30, inside: 0.50 },
};

/** 整片焦点诊断：读 attention.json 的 events + samples + timeline focus 框。
 * 返回逐块结果 + 全片汇总 + 问题清单。 */
export function evaluateFocusQuality(report) {
  const events = report.events ?? [];
  const samples = report.samples ?? [];
  // focus 框从 timeline 取（attention.json 里 samples 自带 focus 字段）
  const blocks = [];
  const issues = [];
  let cursor = 0;
  for (const ev of events) {
    const blockSamples = [];
    while (cursor < samples.length && samples[cursor].t < ev.end) {
      if (samples[cursor].t >= ev.start) blockSamples.push(samples[cursor]);
      cursor++;
    }
    // focus 框取该块第一个有 focus 的采样
    const focus = blockSamples.find(s => s.focus)?.focus ?? null;
    const q = blockFocusQuality(blockSamples, focus);
    const th = FOCUS_THRESHOLDS[ev.role] ?? FOCUS_THRESHOLDS.hold;
    const problems = [];
    if (q.status === 'measured') {
      if (q.fq < th.fq) problems.push(`fq ${q.fq.toFixed(2)} < ${th.fq}`);
      if (q.focusShare < th.share) problems.push(`share ${(q.focusShare * 100).toFixed(0)}% < ${(th.share * 100).toFixed(0)}%`);
      if (q.insideRate != null && q.insideRate < th.inside) problems.push(`inside ${(q.insideRate * 100).toFixed(0)}% < ${(th.inside * 100).toFixed(0)}%`);
    }
    const entry = { start: ev.start, end: ev.end, role: ev.role, ...q, threshold: th, problems };
    blocks.push(entry);
    if (problems.length) issues.push({ start: ev.start, end: ev.end, role: ev.role, problems });
  }
  const measured = blocks.filter(b => b.status === 'measured');
  const meanFq = measured.length ? measured.reduce((a, b) => a + b.fq, 0) / measured.length : null;
  const passRate = measured.length ? measured.filter(b => !b.problems.length).length / measured.length : null;
  return {
    status: issues.length ? 'review' : 'observed',
    meanFq, passRate, blocks, issues,
    summary: `${measured.length}/${blocks.length} 块可测 · 平均焦点质量 ${meanFq?.toFixed(2) ?? '—'} · 通过率 ${passRate != null ? (passRate * 100).toFixed(0) + '%' : '—'} · ${issues.length} 块有问题`,
  };
}