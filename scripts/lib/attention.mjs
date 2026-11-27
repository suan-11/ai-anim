import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rhythmAt } from '../../src/core/rhythm.js';
import { renderAttentionReport } from './attention-report.mjs';
import { evaluateAttentionRhythm } from './attention-rhythm.mjs';

export const DEFAULT_ATTENTION_STEP = 0.25;
const MOTION_LAG = 0.15;

export function attentionStep(value = DEFAULT_ATTENTION_STEP) {
  const step = Number(value);
  if (!Number.isFinite(step) || step < 0.1) throw new Error('注意力曲线的采样步长须为至少 0.1 秒的有限数值');
  return step;
}

export function planAttention(info, step) {
  const duration = Number(info.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('注意力曲线需要正数的时间线时长');
  const sourceOffset = info.rhythmOffset ?? 0;
  const blocks = info.rhythm?.blocks ?? [];
  const timeAt = new Map();
  const add = (t) => { if (t >= 0 && t < duration) timeAt.set(t.toFixed(9), t); };
  for (let i = 0; i * step < duration; i++) add(i * step);
  if (!sourceOffset && !info.only?.length) add(3);
  for (const shot of info.timeline ?? []) { add(shot.start); add(shot.end); }
  const events = [];
  for (const block of blocks) {
    const start = Math.max(0, block.t_start - sourceOffset);
    const end = Math.min(duration, block.t_end - sourceOffset);
    if (end <= start) continue;
    events.push({ start, end, role: block.beat_role, intensity: block.intensity, info_density: block.info_density, resistance: block.resistance });
    add(start);
  }
  return { times: [...timeAt.values()].sort((a, b) => a - b), duration, sourceOffset, blocks, events };
}

export async function collectAttention(session, { task, step }) {
  const { times, duration, sourceOffset, blocks, events } = planAttention(session.info, step);
  const samples = [];
  // Each sampled frame is independent. Limit the size of individual browser replies.
  for (let i = 0; i < times.length; i += 16) {
    const batch = await session.page.evaluate(async ({ times, lag }) => {
      const rows = [];
      for (const t of times) rows.push(await window.__anim.attentionFrame(t, lag));
      return rows;
    }, { times: times.slice(i, i + 16), lag: MOTION_LAG });
    for (const row of batch) {
      const sourceTime = row.t + sourceOffset;
      const event = rhythmAt(blocks, sourceTime + 1e-9);
      samples.push({ ...row, sourceTime, role: event?.beat_role ?? null });
    }
  }
  const report = { schema: 'anim.attention/1', task, duration, step, motionLag: MOTION_LAG,
    sourceOffset, only: session.info.only ?? null, profile: session.info.attentionProfile ?? 'bit', events, samples };
  return { ...report, rhythmScore: evaluateAttentionRhythm(report) };
}

export function attentionSummary({ samples, rhythmScore }) {
  const measured = samples.filter((row) => row.concentration !== null).length;
  const focused = samples.filter((row) => row.focusShare !== null);
  const meanFocus = focused.length ? focused.reduce((sum, row) => sum + row.focusShare, 0) / focused.length : null;
  const rhythm = rhythmScore && Number.isFinite(rhythmScore.score)
    ? ` · 注意力节奏 ${rhythmScore.score}/100（${rhythmScore.status === 'observed' ? '波形通过' : '待复看'}）` : '';
  return `${measured}/${samples.length} 个采样点有显著性信号`
    + (meanFocus === null ? ' · 无可测的单主体框' : ` · 主体内显著性平均 ${Math.round(meanFocus * 100)}%（${focused.length} 个采样点）`)
    + rhythm;
}

export function summarizeAttentionBlocks(events, samples) {
  let cursor = 0;
  return events.map((event) => {
    while (cursor < samples.length && samples[cursor].t < event.start) cursor++;
    const first = cursor;
    let concentration = 0, measured = 0, focusShare = 0, focused = 0, inside = 0, lowest = null;
    while (cursor < samples.length && samples[cursor].t < event.end) {
      const row = samples[cursor++];
      if (row.concentration !== null) { concentration += row.concentration; measured++; }
      if (row.focusShare === null) continue;
      focusShare += row.focusShare;
      focused++;
      const { x, y, w, h } = row.focus;
      const point = row.hotspot;
      if (point && point.x >= x && point.x < x + w && point.y >= y && point.y < y + h) inside++;
      if (!lowest || row.focusShare < lowest.focusShare) lowest = row;
    }
    return { ...event, samples: cursor - first, measured, focused, inside,
      meanConcentration: measured ? concentration / measured : null,
      meanFocusShare: focused ? focusShare / focused : null,
      lowestFocusTime: lowest?.t ?? null };
  });
}

export function attentionVideoPath(root, explicit, candidate) {
  if (!explicit && !candidate) return null;
  const file = path.resolve(root, explicit || candidate);
  if (statSync(file, { throwIfNoEntry: false })?.isFile()) return file;
  if (explicit) throw new Error(`找不到注意力预览视频：${file}`);
  return null;
}

export function writeAttentionReport(dir, report, { videoPath = null } = {}) {
  mkdirSync(dir, { recursive: true });
  const samples = report.samples.map(({ preview, ...sample }) => sample);
  const blocks = summarizeAttentionBlocks(report.events, samples);
  writeFileSync(path.join(dir, 'attention.json'), JSON.stringify({ ...report, samples, blocks }, null, 2) + '\n');
  const relative = videoPath ? path.relative(dir, videoPath) : '';
  const video = relative && (path.isAbsolute(relative) ? pathToFileURL(videoPath).href
    : relative.split(path.sep).map(encodeURIComponent).join('/'));
  writeFileSync(path.join(dir, 'attention.html'), renderAttentionReport({ ...report, blocks, video }));
}
