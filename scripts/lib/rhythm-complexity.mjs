// @ts-check
/** 节奏 v0.2：复杂度 / 重复度评分（纯函数，从 attention samples + rhythm blocks 离线算）。
 * 复杂度 complexity：画面显著性分散度 + 热点移动多样性 + 信息密度 → 0-100（高=多锚点/多变）。
 * 重复度 repetition：相邻帧信号相似度 + 节奏序列循环自相关 → 0-100（高=单调重复）。
 * 注意力曲线 attention：复用 attention-rhythm 的加权方差评分（已在 attention.mjs）。
 */
import { sat } from '../../src/core/util.js';

/** 单帧复杂度代理：显著性越分散（concentration 低）越复杂；strength 适中贡献。 */
export function frameComplexity(row) {
  if (row.concentration === null || row.concentration === undefined) return null;
  // concentration 高=单锚点=简单；低=分散=复杂
  const dispersion = 1 - sat(row.concentration);
  const strengthTerm = sat(row.strength / 40); // 有内容才谈复杂
  return sat(0.7 * dispersion + 0.3 * strengthTerm);
}

/** 热点移动多样性：相邻热点位移越大越复杂（视线被多处牵引）。 */
export function hotspotDiversity(samples) {
  let sum = 0, n = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i-1].hotspot, b = samples[i].hotspot;
    if (!a || !b) continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y); // 归一化坐标位移
    sum += sat(d / 0.3); n++;
  }
  return n ? sum / n : 0;
}

/** 整片复杂度评分 0-100：帧复杂度均值 + 热点多样性 + 节奏信息密度。 */
export function complexityScore(samples, blocks = []) {
  const fc = samples.map(frameComplexity).filter(v => v !== null);
  const meanDisp = fc.length ? fc.reduce((a,b)=>a+b,0)/fc.length : 0;
  const diversity = hotspotDiversity(samples);
  const meanDensity = blocks.length ? blocks.reduce((a,b)=>a+(b.info_density??1),0)/blocks.length/5 : 0.4;
  // 加权：分散度 0.5 + 热点多样 0.3 + 信息密度 0.2
  const raw = 0.5*meanDisp + 0.3*diversity + 0.2*meanDensity;
  return { score: Math.round(100*sat(raw)), meanDispersion: meanDisp, hotspotDiversity: diversity, meanInfoDensity: meanDensity*5, samples: fc.length };
}

/** 相邻帧重复度：strength/concentration/hotspot 变化越小越重复。 */
export function frameRepetition(samples) {
  if (samples.length < 2) return 0;
  let sum = 0, n = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i-1], b = samples[i];
    if (a.concentration === null || b.concentration === null) continue;
    const dStrength = Math.abs((b.strength??0)-(a.strength??0))/40;
    const dConc = Math.abs((b.concentration??0)-(a.concentration??0));
    let dHot = 0;
    if (a.hotspot && b.hotspot) dHot = Math.hypot(b.hotspot.x-a.hotspot.x, b.hotspot.y-a.hotspot.y)/0.3;
    const change = sat(0.4*dStrength + 0.3*dConc + 0.3*dHot);
    sum += (1 - change); n++; // 变化小→重复高
  }
  return n ? sum/n : 0;
}

/** 节奏序列循环重复：intensity/info_density/beat_role 序列的自相关峰值（排除 lag0）。 */
export function sequenceRepetition(blocks) {
  if (blocks.length < 4) return 0;
  const raw = blocks.map(b => (b.intensity??1) + (b.info_density??1)*0.5);
  // 去线性趋势：单调递增/递减不算循环重复，只有波动循环才算
  const nn = raw.length;
  const xm = (nn-1)/2, ym = raw.reduce((a,b)=>a+b,0)/nn;
  let sxy=0,sxx=0; for(let i=0;i<nn;i++){sxy+=(i-xm)*(raw[i]-ym);sxx+=(i-xm)**2;}
  const slope = sxx?sxy/sxx:0;
  const seq = raw.map((v,i)=>v-(ym+slope*(i-xm)));
  const mean = seq.reduce((a,b)=>a+b,0)/seq.length;
  const varr = seq.reduce((a,b)=>a+(b-mean)**2,0)/seq.length || 1;
  let best = 0;
  for (let lag = 1; lag <= Math.floor(seq.length/2); lag++) {
    let cov = 0, cnt = 0;
    for (let i = 0; i + lag < seq.length; i++) { cov += (seq[i]-mean)*(seq[i+lag]-mean); cnt++; }
    if (cnt) best = Math.max(best, cov/cnt/varr);
  }
  return sat(Math.max(0, best)); // 自相关峰值高=循环重复
}

/** 整片重复度评分 0-100：帧重复 0.6 + 序列循环 0.4。 */
export function repetitionScore(samples, blocks = []) {
  const fr = frameRepetition(samples);
  const sr = sequenceRepetition(blocks);
  const raw = 0.6*fr + 0.4*sr;
  return { score: Math.round(100*sat(raw)), frameRepetition: fr, sequenceRepetition: sr };
}

/** 综合报告。 */
export function evaluateComplexityRepetition(report) {
  const samples = report.samples ?? [];
  const blocks = report.events ?? [];
  return { complexity: complexityScore(samples, blocks), repetition: repetitionScore(samples, blocks) };
}
