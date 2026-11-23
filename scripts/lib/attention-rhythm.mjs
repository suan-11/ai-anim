const HOOK_END = 3;
const WINDOW = 0.5;
const VARIANCE_SCALE = 0.25;
const EPSILON = 1e-8;

/** 双形态目标曲线（docs/BENCHMARK-WEIGHTED.md，33支B站标杆播放量加权）：
 * bit   = 深谷叙事型（比特新语系代码动画，与我们引擎同构；缺省）：
 *         均值≈0.48、落差≈0.45、波幅≈0.07、下蹲4-8s、59%时间<0.5。
 * aigen = 高位保持型（AI生成科普）：均值≈0.65、hi65≈59%、几乎无深谷、浅蹲1-2s。
 * 两档的 hook/角色包络/验收线都不同——不能混用一条曲线。 */
export const ATTENTION_PROFILES = {
  bit: {
    hook: (t) => t < 1 ? 0.45 + t * 0.15 : 0.60 - (t - 1) * 0.025,   // 1s峰0.60 → 3s 0.55
    pressure: (u) => 0.52 - 0.22 * u,                                 // 深蹲 0.52→0.30
    hold: (u) => 0.38 + 0.05 * Math.sin(u * Math.PI),                 // 低位期待 0.38±0.05
    release: (u) => 0.35 + 0.35 * Math.min(1, u * 1.6),               // 冲峰 0.35→0.70
    residue: (u, isFinal) => isFinal ? 0.48 - 0.08 * u + 0.04 * Math.sin(u * Math.PI) : 0.55 - 0.15 * u,
    hookPeakMin: 0.50, hookChangeMin: 0.08, waveChangeMin: 0.08,
  },
  aigen: {
    hook: (t) => t < 1 ? 0.40 + t * 0.30 : 0.70 - (t - 1) * 0.025,   // 1s峰0.70 → 3s 0.65
    pressure: (u) => 0.58 - 0.06 * u,                                 // 浅蹲 0.58→0.52
    hold: (u) => 0.55 + 0.04 * Math.sin(u * Math.PI),                 // 中高位微起伏
    release: (u) => 0.55 + 0.17 * Math.min(1, u * 1.6),               // 0.55→0.72
    residue: (u, isFinal) => isFinal ? 0.62 - 0.06 * u + 0.03 * Math.sin(u * Math.PI) : 0.65 - 0.07 * u,
    hookPeakMin: 0.60, hookChangeMin: 0.10, waveChangeMin: 0.06,
  },
};

function visualAttention(row) {
  if (!Number.isFinite(row.strength) || row.strength < 0) return null;
  const energy = row.strength / (row.strength + 8);
  const concentration = row.concentration ?? 0;
  if (!Number.isFinite(concentration) || concentration < 0 || concentration > 1) return null;
  return 0.75 * energy + 0.25 * concentration;
}

function expectedAttention(t, { start, end, role }, ctx = {}) {
  const profile = ATTENTION_PROFILES[ctx.profile] ?? ATTENTION_PROFILES.bit;
  // 前3秒陡升段：快速拉到中高位（让观众知道值得看），峰在~1s 后缓落建立
  if (t < HOOK_END) return profile.hook(t);
  const u = (t - start) / (end - start);
  const isFinal = ctx.isFinalBlock; // 结尾块：余韵缓降不归零
  switch (role) {
    case 'pressure': return profile.pressure(u);
    case 'hold': return profile.hold(u);
    case 'release': return profile.release(u);
    case 'residue': return profile.residue(u, isFinal);
  }
  return null;
}

function overlap(start, end, a, b) {
  return Math.max(0, Math.min(end, b) - Math.max(start, a));
}

function meanInWindow(rows, start, end) {
  let value = 0, duration = 0;
  for (const row of rows) {
    if (row.observed === null) continue;
    const seconds = overlap(start, end, row.t, row.end);
    value += seconds * row.observed;
    duration += seconds;
  }
  return end > start && duration + EPSILON >= (end - start) * 0.75 ? value / duration : null;
}

function windowReadings(rows, start, end) {
  const windows = [];
  for (let from = start; from + WINDOW <= end + EPSILON; from += WINDOW) {
    const value = meanInWindow(rows, from, from + WINDOW);
    if (value !== null) windows.push({ time: from + WINDOW / 2, value });
  }
  return windows;
}

function highest(windows) {
  return windows.reduce((peak, row) => !peak || row.value > peak.value ? row : peak, null);
}

function readHook(rows, profile) {
  const windows = windowReadings(rows, 0, HOOK_END);
  if (windows.length < 4) return { status: 'unmeasured' };
  const peak = highest(windows);
  const change = peak.value - Math.min(...windows.map((row) => row.value));
  return { status: peak.value >= profile.hookPeakMin && change >= profile.hookChangeMin ? 'observed' : 'review',
    peakTime: peak.time, peak: peak.value, change };
}

function readWaves(events, buckets, profile) {
  const waves = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.role !== 'release' || event.start < HOOK_END) continue;
    const before = events[i - 1], after = events[i + 1];
    const peak = highest(windowReadings(buckets[i], event.start, event.end));
    const build = before && ['pressure', 'hold'].includes(before.role);
    const recovery = after?.role === 'residue';
    const lead = build ? meanInWindow(buckets[i - 1], Math.max(before.start, before.end - 1), before.end) : null;
    const tail = recovery ? meanInWindow(buckets[i + 1], Math.max(after.start, after.end - 1), after.end) : null;
    const rise = peak && lead !== null ? peak.value - lead : null;
    const fall = peak && tail !== null ? peak.value - tail : null;
    const issues = [];
    if (!build) issues.push('missing_build');
    if (!recovery) issues.push('missing_recovery');
    if (!peak || (build && lead === null) || (recovery && tail === null)) issues.push('missing_signal');
    if (rise !== null && rise < profile.waveChangeMin) issues.push('weak_rise');
    if (fall !== null && fall < profile.waveChangeMin) issues.push('weak_fall');
    waves.push({ start: event.start, end: event.end, peakTime: peak?.time ?? null, rise, fall, issues });
  }
  return waves;
}

/** Score the shape of a full-film attention curve by the time-weighted variance of its residuals.
 * profile: 'bit'（缺省，深谷叙事）| 'aigen'（高位保持），见 ATTENTION_PROFILES。 */
export function evaluateAttentionRhythm({ duration, events, samples, sourceOffset = 0, only = null, profile = 'bit' }) {
  const prof = ATTENTION_PROFILES[profile] ?? ATTENTION_PROFILES.bit;
  if (sourceOffset || only?.length) return { status: 'unmeasured', reason: 'partial' };
  if (!Number.isFinite(duration) || duration < HOOK_END || !events?.length || !samples?.length) {
    return { status: 'unmeasured', reason: 'missing_timeline' };
  }
  const complete = events.every((event, i) => event.end > event.start
    && Math.abs(event.start - (events[i - 1]?.end ?? 0)) < EPSILON);
  if (!complete || Math.abs(events.at(-1).end - duration) >= EPSILON) {
    return { status: 'unmeasured', reason: 'incomplete_events' };
  }

  let eventIndex = 0, weight = 0, mean = 0, sumSquares = 0;
  const buckets = events.map(() => []);
  const series = samples.map((sample, i) => {
    const { t } = sample;
    while (eventIndex < events.length - 1 && t + EPSILON >= events[eventIndex].end) eventIndex++;
    const end = Math.min(samples[i + 1]?.t ?? duration, duration);
    const observed = visualAttention(sample);
    const target = expectedAttention(t, events[eventIndex], { isFinalBlock: eventIndex === events.length - 1, profile });
    const row = { t, end, observed, target };
    if (end <= t) return { t, observed, target };
    // The opening seconds count twice. Boundary samples retain only their actual time span.
    if (observed !== null && target !== null) {
      const w = end - t + overlap(t, end, 0, HOOK_END);
      const residual = observed - target;
      const delta = residual - mean;
      weight += w;
      mean += w * delta / weight;
      sumSquares += w * delta * (residual - mean);
    }
    buckets[eventIndex].push(row);
    return { t, observed, target };
  });
  if (weight + EPSILON < (duration + HOOK_END) * 0.8) return { status: 'unmeasured', reason: 'missing_signal' };

  const variance = Math.max(0, sumSquares / weight);
  const score = Math.round(100 * Math.max(0, 1 - Math.sqrt(variance) / VARIANCE_SCALE));
  const hook = readHook(buckets.flat().filter((row) => row.t < HOOK_END), prof);
  const waves = readWaves(events, buckets, prof);
  const body = waves.length && waves.every((wave) => !wave.issues.length) ? 'observed' : 'review';
  return { status: hook.status === 'observed' && body === 'observed' && Math.abs(mean) <= 0.12 ? 'observed' : 'review',
    profile: ATTENTION_PROFILES[profile] ? profile : 'bit',
    score, variance, bias: mean, hook, body, waves, series };
}

export const ATTENTION_ISSUE_LABELS = {
  missing_build: '释放前缺蓄势或持压',
  missing_recovery: '释放后缺回落',
  missing_signal: '可测样本不足',
  weak_rise: '波峰升幅不足',
  weak_fall: '峰后回落不足',
  missing_timeline: '全片节奏表或样本缺失',
  incomplete_events: '节奏表覆盖不完整',
  partial: '选段报告仅显示原始读数',
};
