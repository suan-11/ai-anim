// @ts-check
/** 焦点动态分析：焦点不是钉死的，它应该跟着叙事走。
 *
 * 静态判据（focus-quality.mjs）回答「此刻焦点在不在主体上」；
 * 动态判据回答「焦点的运动有没有叙事意图」——
 *
 * 四个维度：
 *
 * 1. **轨迹连贯性 trajectoryCoherence**：相邻 hotspot 位移的方向一致性。
 *    好的焦点运动是「有方向的移动」（从左柱扫到右柱、从数轴推到框），
 *    坏的是「随机抖动」（每帧跳一个无关联的位置）。
 *    量法：连续三步的方向向量夹角余弦均值。≥0.6 = 连贯定向移动。
 *
 * 2. **转移合理性 transitionQuality**：跨节奏块边界时焦点的跳变是否有叙事理由。
 *    pressure→hold：焦点应从蓄势位移到揭示位（大跳合理）；
 *    hold→release：焦点应冲向峰值主体（大跳合理）；
 *    release→residue：焦点应从峰值缓回（小移合理）；
 *    同角色内：焦点应稳定或定向扫描（不该乱跳）。
 *    量法：块边界位移 vs 块内中位位移的比值 + 角色转移矩阵校验。
 *
 * 3. **叙事锚定 narrativeAnchoring**：焦点是否在该段「该看的东西」上停留足够久。
 *    release 期焦点应在峰值主体（1号柱/高亮框）停留 ≥60% 采样；
 *    hold 期焦点可在多个数据锚点间扫描但每个停留 ≥2 采样；
 *    residue 期焦点应缓回全景中心。
 *    量法：把 focus 框分成子区域（左/中/右 或 上/下），统计各区域停留占比，
 *    与该角色的期望分布做余弦相似度。
 *
 * 4. **运动节奏 motionRhythm**：焦点运动的快慢是否与节奏角色匹配。
 *    pressure：慢移或静止（蓄力）；hold：中速扫描；
 *    release：快冲+锁定；residue：慢回。
 *    量法：各角色内 hotspot 速度中位数 vs 期望速度带的偏差。
 *
 * 综合 dynamicFocusScore ∈ [0,1]：
 *   dfs = 0.3*coherence + 0.25*transitionQ + 0.25*anchoring + 0.2*rhythmMatch
 */

import { sat } from '../../src/core/util.js';

/** 方向连贯性：连续三步方向余弦均值。samples 需含 hotspot + role。
 * release/residue 期严格要求定向移动（冲峰/缓回）；
 * hold/pressure 期允许扫描式移动（数据集切换、蓄势微移），只罚大幅往返抖动。 */
export function trajectoryCoherence(samples) {
  const pts = samples.filter(s => s.hotspot).map(s => ({ t: s.t, x: s.hotspot.x, y: s.hotspot.y, role: s.role }));
  if (pts.length < 4) return { score: null, n: pts.length };
  let sum = 0, n = 0;
  for (let i = 2; i < pts.length; i++) {
    const ax = pts[i-1].x - pts[i-2].x, ay = pts[i-1].y - pts[i-2].y;
    const bx = pts[i].x - pts[i-1].x, by = pts[i].y - pts[i-1].y;
    const ma = Math.hypot(ax, ay), mb = Math.hypot(bx, by);
    if (ma < 0.005 || mb < 0.005) continue;
    const cos = (ax*bx + ay*by) / (ma*mb);
    const role = pts[i].role;
    // hold/pressure 期：只罚大幅往返（位移>0.05 且 cos<-0.3），小抖和扫描不罚
    if (role === 'hold' || role === 'pressure') {
      if (ma > 0.05 && mb > 0.05 && cos < -0.3) { sum += 0.2; n++; }
      else { sum += 0.8; n++; }                      // 扫描/微移给 0.8 基础分
      continue;
    }
    const weight = (ma < 0.02 && mb < 0.02) ? 0.3 : 1;
    sum += weight * (cos + 1) / 2;
    n += weight;
  }
  return { score: n ? sum / n : null, n };
}

/** 块边界转移质量。events + samples → 每个边界的位移比 + 合理性。
 * 跨场景边界（timeline cut 点）的大跳豁免：不同场景主体位置天然不同。
 * 同场景内角色切换：pressure→hold 允许小移（看同一个东西蓄势→期待），
 * hold→release 期望大跳（冲向峰值），release→residue 期望小移（缓回）。 */
export function transitionQuality(events, samples, timeline = []) {
  const pts = samples.filter(s => s.hotspot);
  // 场景切点集合（±0.3s 容差）
  const cutPoints = timeline.map(t => t.start).filter(s => s > 0);
  const isCutBoundary = (b) => cutPoints.some(c => Math.abs(b - c) < 0.8);
  const transitions = [];
  for (let i = 1; i < events.length; i++) {
    const boundary = events[i].start;
    const before = pts.filter(p => p.t < boundary && p.t >= boundary - 1.5);
    const after = pts.filter(p => p.t >= boundary && p.t < boundary + 1.5);
    if (!before.length || !after.length) continue;
    const bLast = before[before.length - 1], aFirst = after[0];
    const jump = Math.hypot(aFirst.hotspot.x - bLast.hotspot.x, aFirst.hotspot.y - bLast.hotspot.y);
    const innerDisps = [];
    for (let j = 1; j < before.length; j++) innerDisps.push(Math.hypot(before[j].hotspot.x - before[j-1].hotspot.x, before[j].hotspot.y - before[j-1].hotspot.y));
    innerDisps.sort((a, b) => a - b);
    const medianInner = innerDisps.length ? innerDisps[Math.floor(innerDisps.length / 2)] : 0.01;
    const ratio = jump / Math.max(0.005, medianInner);
    const from = events[i-1].role, to = events[i].role;
    let ok;
    if (isCutBoundary(boundary)) ok = true;          // 跨场景大跳天然合理
    else if (from === to) ok = ratio < 4;
    else if (to === 'release') {
      // 冲峰：看 boundary+1s 窗口（spring 生长有 ~0.3s 物理延迟，0.5s 采样可能错过）
      const after1s = pts.filter(p => p.t >= boundary && p.t < boundary + 1.2);
      const jump1s = after1s.length ? Math.hypot(after1s[after1s.length-1].hotspot.x - bLast.hotspot.x, after1s[after1s.length-1].hotspot.y - bLast.hotspot.y) : jump;
      ok = ratio > 1.2 || jump > 0.15 || jump1s > 0.15;
    }
    else if (from === 'release') ok = ratio < 5;
    else ok = true;
    transitions.push({ boundary, from, to, jump, ratio, ok, isCut: isCutBoundary(boundary) });
  }
  const passRate = transitions.length ? transitions.filter(t => t.ok).length / transitions.length : null;
  return { score: passRate, transitions };
}

/** 叙事锚定：各角色内焦点在子区域的停留分布 vs 期望。
 * 把画面横向三分（左/中/右），统计 hotspot.x 落在哪。
 * 期望分布按场景主体位置动态调整：如果该段 focus 框中心偏左，
 * release 的期望也偏左（mechanism 数轴框在左侧），不是固定偏右。 */
export function narrativeAnchoring(events, samples) {
  const BASE_EXPECT = {
    pressure: [0.4, 0.4, 0.2],
    hold: [0.33, 0.34, 0.33],
    release: [0.2, 0.3, 0.5],
    residue: [0.25, 0.5, 0.25],
  };
  const results = [];
  let cursor = 0;
  for (const ev of events) {
    const blockPts = [];
    while (cursor < samples.length && samples[cursor].t < ev.end) {
      if (samples[cursor].t >= ev.start && samples[cursor].hotspot) blockPts.push(samples[cursor]);
      cursor++;
    }
    if (blockPts.length < 3) { results.push({ start: ev.start, role: ev.role, score: null }); continue; }
    const dist = [0, 0, 0];
    for (const p of blockPts) {
      const zone = p.hotspot.x < 0.33 ? 0 : p.hotspot.x < 0.66 ? 1 : 2;
      dist[zone]++;
    }
    const total = blockPts.length;
    const actual = dist.map(d => d / total);
    // 动态期望：用该块 focus 框中心 x 偏移调整 release 期望
    const focus = blockPts.find(p => p.focus)?.focus;
    let expect = [...(BASE_EXPECT[ev.role] ?? BASE_EXPECT.hold)];
    if (ev.role === 'release' && focus) {
      const fcx = focus.x + focus.w / 2;             // 归一化主体中心
      if (fcx < 0.4) expect = [0.5, 0.3, 0.2];      // 主体偏左（mechanism）
      else if (fcx > 0.6) expect = [0.2, 0.3, 0.5]; // 主体偏右（data）
      else expect = [0.25, 0.5, 0.25];               // 居中
    }
    // 动态期望：release 期焦点应集中在主体所在区域（不管左中右），
    // 用实际分布的集中度（1-归一化熵）评，而不是和固定三分期望比。
    // hold/pressure/residue 仍用期望分布余弦相似度。
    let sim;
    if (ev.role === 'release') {
      // 集中度 = 1 - H/Hmax，H = -Σp·log(p)，Hmax = log(3)
      const H = -actual.reduce((a, p) => a + (p > 0 ? p * Math.log(p) : 0), 0);
      const concentration = 1 - H / Math.log(3);
      sim = 0.5 + 0.5 * concentration;               // 完全集中=1, 均匀=0.5
    } else {
      const dot = actual.reduce((a, v, i) => a + v * expect[i], 0);
      const ma = Math.sqrt(actual.reduce((a, v) => a + v * v, 0));
      const me = Math.sqrt(expect.reduce((a, v) => a + v * v, 0));
      sim = ma && me ? dot / (ma * me) : 0;
    }
    results.push({ start: ev.start, end: ev.end, role: ev.role, actual, expect, score: sim, n: total });
  }
  const measured = results.filter(r => r.score != null);
  const mean = measured.length ? measured.reduce((a, r) => a + r.score, 0) / measured.length : null;
  return { score: mean, blocks: results };
}

/** 运动节奏匹配：各角色内 hotspot 速度中位数 vs 期望带。 */
export function motionRhythm(events, samples) {
  // 期望速度带（归一化/秒，采样间隔0.5s → 位移/0.5）：
  // pressure: 0-0.03（慢/静）; hold: 0.02-0.10（中速扫描）;
  // release: 0.03-0.15（快冲+锁定交替）; residue: 0.01-0.06（慢回）
  const BANDS = {
    pressure: [0, 0.03], hold: [0.02, 0.10],
    release: [0.03, 0.15], residue: [0.01, 0.06],
  };
  const results = [];
  let cursor = 0;
  for (const ev of events) {
    const blockPts = [];
    while (cursor < samples.length && samples[cursor].t < ev.end) {
      if (samples[cursor].t >= ev.start && samples[cursor].hotspot) blockPts.push(samples[cursor]);
      cursor++;
    }
    if (blockPts.length < 3) { results.push({ start: ev.start, role: ev.role, score: null }); continue; }
    const speeds = [];
    for (let i = 1; i < blockPts.length; i++) {
      const dt = blockPts[i].t - blockPts[i-1].t || 0.5;
      speeds.push(Math.hypot(blockPts[i].hotspot.x - blockPts[i-1].hotspot.x, blockPts[i].hotspot.y - blockPts[i-1].hotspot.y) / dt);
    }
    speeds.sort((a, b) => a - b);
    const median = speeds[Math.floor(speeds.length / 2)];
    const [lo, hi] = BANDS[ev.role] ?? BANDS.hold;
    // 在带内=1，偏离越远越低
    const score = median >= lo && median <= hi ? 1 : sat(1 - Math.min(Math.abs(median - lo), Math.abs(median - hi)) / 0.1);
    results.push({ start: ev.start, end: ev.end, role: ev.role, medianSpeed: median, band: [lo, hi], score });
  }
  const measured = results.filter(r => r.score != null);
  const mean = measured.length ? measured.reduce((a, r) => a + r.score, 0) / measured.length : null;
  return { score: mean, blocks: results };
}

/** 综合动态焦点评分。 */
export function evaluateFocusDynamics(report) {
  const events = report.events ?? [];
  const samples = report.samples ?? [];
  const coh = trajectoryCoherence(samples);
  const trans = transitionQuality(events, samples, report.timeline ?? []);
  const anch = narrativeAnchoring(events, samples);
  const rhythm = motionRhythm(events, samples);
  const c = coh.score ?? 0.5, t = trans.score ?? 0.5, a = anch.score ?? 0.5, r = rhythm.score ?? 0.5;
  const dfs = 0.3 * c + 0.25 * t + 0.25 * a + 0.2 * r;
  // 问题清单
  const issues = [];
  if (c < 0.5) issues.push(`轨迹连贯性 ${c.toFixed(2)} < 0.5（焦点乱跳）`);
  if (t < 0.6) issues.push(`转移合理性 ${(t * 100).toFixed(0)}% < 60%`);
  if (a < 0.7) issues.push(`叙事锚定 ${a.toFixed(2)} < 0.7（焦点没在该看的地方）`);
  if (r < 0.6) issues.push(`运动节奏 ${r.toFixed(2)} < 0.6（快慢不匹配角色）`);
  for (const tr of trans.transitions.filter(x => !x.ok)) issues.push(`边界 ${tr.boundary}s ${tr.from}→${tr.to} 跳变比 ${tr.ratio.toFixed(1)} 不合理`);
  for (const b of anch.blocks.filter(x => x.score != null && x.score < 0.6)) issues.push(`${b.start}-${b.end}s ${b.role} 锚定 ${b.score.toFixed(2)} 分布 [${b.actual.map(v => (v * 100).toFixed(0) + '%').join(',')}]`);
  for (const b of rhythm.blocks.filter(x => x.score != null && x.score < 0.5)) issues.push(`${b.start}-${b.end}s ${b.role} 速度 ${b.medianSpeed.toFixed(3)} 超出带 [${b.band}]`);
  return {
    status: issues.length ? 'review' : 'observed',
    dfs, coherence: c, transitionQ: t, anchoring: a, rhythmMatch: r,
    details: { coherence: coh, transitions: trans, anchoring: anch, rhythm },
    issues,
    summary: `动态焦点 ${dfs.toFixed(2)} · 连贯${c.toFixed(2)} 转移${(t * 100).toFixed(0)}% 锚定${a.toFixed(2)} 节奏${r.toFixed(2)} · ${issues.length} 个问题`,
  };
}