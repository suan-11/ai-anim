const HOOK_END = 3;
const WINDOW = 0.5;
const VARIANCE_SCALE = 0.25;
const MIN_WAVE_CHANGE = 0.08;
const EPSILON = 1e-8;

function visualAttention(row) {
  if (!Number.isFinite(row.strength) || row.strength < 0) return null;
  const energy = row.strength / (row.strength + 8);
  const concentration = row.concentration ?? 0;
  if (!Number.isFinite(concentration) || concentration < 0 || concentration > 1) return null;
  return 0.75 * energy + 0.25 * concentration;
}

function expectedAttention(t, { start, end, role }, ctx = {}) {
  // 前3秒陡升段：快速拉到中高位（让观众知道值得看），峰在~1s 后缓落建立
  if (t < HOOK_END) return t < 1 ? 0.40 + t * 0.42 : 0.82 - (t - 1) * 0.10;
  const u = (t - start) / (end - start);
  const isFinal = ctx.isFinalBlock; // 结尾块：余韵缓降不归零
  switch (role) {
    // pressure：主动下蹲（压弹簧），从中位降到中低位，阻力最高
    case 'pressure': return 0.58 - 0.26 * u;
    // hold：停低/中位制造期待，轻微起伏
    case 'hold': return 0.40 + 0.04 * Math.sin(u * Math.PI);
    // release：冲峰值（全片高点），起于蓄势末的低点猛升
    case 'release': return 0.42 + 0.46 * Math.min(1, u * 1.6);
    // residue：峰值后回落中位再缓降，不归零；结尾块留小回扣
    case 'residue': return isFinal ? 0.52 - 0.10 * u + 0.05 * Math.sin(u * Math.PI) : 0.62 - 0.20 * u;
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

function readHook(rows) {
  const windows = windowReadings(rows, 0, HOOK_END);
  if (windows.length < 4) return { status: 'unmeasured' };
  const peak = highest(windows);
  const change = peak.value - Math.min(...windows.map((row) => row.value));
  return { status: peak.value >= 0.55 && change >= 0.12 ? 'observed' : 'review',
    peakTime: peak.time, peak: peak.value, change };
}

function readWaves(events, buckets) {
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
    if (rise !== null && rise < MIN_WAVE_CHANGE) issues.push('weak_rise');
    if (fall !== null && fall < MIN_WAVE_CHANGE) issues.push('weak_fall');
    waves.push({ start: event.start, end: event.end, peakTime: peak?.time ?? null, rise, fall, issues });
  }
  return waves;
}

/** Score the shape of a full-film attention curve by the time-weighted variance of its residuals. */
export function evaluateAttentionRhythm({ duration, events, samples, sourceOffset = 0, only = null }) {
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
    const target = expectedAttention(t, events[eventIndex], { isFinalBlock: eventIndex === events.length - 1 });
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
  const hook = readHook(buckets.flat().filter((row) => row.t < HOOK_END));
  const waves = readWaves(events, buckets);
  const body = waves.length && waves.every((wave) => !wave.issues.length) ? 'observed' : 'review';
  return { status: hook.status === 'observed' && body === 'observed' && Math.abs(mean) <= 0.12 ? 'observed' : 'review',
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
