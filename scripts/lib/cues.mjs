// @ts-check
/**
 * `anim cues <任务>` 的纯函数逻辑（不碰浏览器 / 音频解码）：
 *   从 `audio/timing.{mjs,json}` 或 `audio/narration.json` + `timeline` 抽出每段每句的
 *   关键触发词时刻（全部换算成**段内 `f.lt`**），并标出切点 `cutStart` 与 `railU`/`zoomBoost` 归零线。
 */

const STOP_WORDS = new Set(
  '的了是在和把被也就都而与吗呢啊这那一有个到为以之不会从向将再更只却但让用对它其中上下里'
    .split(''),
);

const OUTER_PUNCT_RE = /^[，。！？、；：“”"'‘’（）()【】\[\],.!?;:\s]+|[，。！？、；：“”"'‘’（）()【】\[\],.!?;:\s]+$/g;
const TECH_WORD_RE = /[0-9A-Za-z%°]/;

/**
 * 从词级时间戳数组中抽出关键触发词，并将绝对秒 `w.start` 扣减为段内 `f.lt`。
 * @param {{ w: string, start: number, end?: number }[]} words
 * @param {number} sceneStart
 * @param {{ maxPerLine?: number, allWords?: boolean }} [opts]
 * @returns {{ w: string, lt: number, endLt: number }[]}
 */
export function extractKeyTriggers(words, sceneStart, opts = {}) {
  const maxPerLine = Number.isFinite(opts.maxPerLine) && opts.maxPerLine > 0 ? Math.floor(opts.maxPerLine) : 8;
  const allWords = !!opts.allWords;
  const baseStart = Number.isFinite(sceneStart) ? sceneStart : 0;

  const cleaned = [];
  for (const item of Array.isArray(words) ? words : []) {
    if (!item) continue;
    const text = String(item.w ?? '').replace(OUTER_PUNCT_RE, '').trim();
    if (!text) continue;
    const wStart = Number(item.start);
    if (!Number.isFinite(wStart)) continue;
    const wEnd = Number.isFinite(Number(item.end)) ? Number(item.end) : wStart;
    const lt = Math.max(0, +(wStart - baseStart).toFixed(2));
    const endLt = Math.max(lt, +(wEnd - baseStart).toFixed(2));
    cleaned.push({ w: text, lt, endLt, tech: TECH_WORD_RE.test(text) });
  }
  if (!cleaned.length) return [];
  if (allWords) return cleaned.map(({ w, lt, endLt }) => ({ w, lt, endLt }));

  const candidates = [];
  for (let i = 0; i < cleaned.length; i++) {
    const it = cleaned[i];
    const isEdge = i === 0 || i === cleaned.length - 1;
    const len = [...it.w].length;
    if (isEdge || it.tech || len >= 2 || !STOP_WORDS.has(it.w)) {
      candidates.push(it);
    }
  }
  if (candidates.length <= maxPerLine) {
    return candidates.map(({ w, lt, endLt }) => ({ w, lt, endLt }));
  }

  // 超出 maxPerLine 时：优先保留首尾 + 含数字/英文技术词，剩余名额在余下候选中均匀抽样
  const picked = new Set();
  picked.add(0);
  if (maxPerLine >= 2) picked.add(candidates.length - 1);

  for (let i = 1; i < candidates.length - 1 && picked.size < maxPerLine; i++) {
    if (candidates[i].tech) picked.add(i);
  }
  const restIdx = [];
  for (let i = 1; i < candidates.length - 1; i++) {
    if (!picked.has(i)) restIdx.push(i);
  }
  const need = maxPerLine - picked.size;
  if (need > 0 && restIdx.length) {
    if (need >= restIdx.length) {
      for (const idx of restIdx) picked.add(idx);
    } else if (need === 1) {
      picked.add(restIdx[Math.floor(restIdx.length / 2)]);
    } else {
      for (let j = 0; j < need; j++) {
        const pos = Math.round((j * (restIdx.length - 1)) / (need - 1));
        picked.add(restIdx[pos]);
      }
    }
  }

  return [...picked]
    .sort((a, b) => a - b)
    .map((idx) => {
      const { w, lt, endLt } = candidates[idx];
      return { w, lt, endLt };
    });
}

/**
 * 归一化单句为 `{ index, text, ltStart, ltEnd, dur, triggers }`。
 */
function normalizeLine(l, idx, sceneStart, opts) {
  const startRaw = Number(l.start);
  const ltStart = Number.isFinite(Number(l.offset))
    ? Math.max(0, +Number(l.offset).toFixed(2))
    : Math.max(0, +((Number.isFinite(startRaw) ? startRaw : sceneStart) - sceneStart).toFixed(2));
  const dur = Number.isFinite(Number(l.dur)) ? Math.max(0, +Number(l.dur).toFixed(2)) : 0;
  const ltEnd = +(ltStart + dur).toFixed(2);
  const triggers = Array.isArray(l.words) && l.words.length
    ? extractKeyTriggers(l.words, sceneStart, opts)
    : [];
  return {
    index: Number.isFinite(Number(l.index)) ? Number(l.index) : idx,
    text: String(l.text ?? '').trim(),
    ltStart,
    ltEnd,
    dur,
    triggers,
  };
}

/**
 * 从 `timing` 或 `narration` + `timeline` 构建整片词点速查数据结构。
 * @param {{ timing?: any, narration?: any, timeline?: any[], task?: string }} input
 * @param {{ maxPerLine?: number, allWords?: boolean }} [opts]
 */
export function buildCuesData({ timing = null, narration = null, timeline = null, task = '' }, opts = {}) {
  const overlap = Number.isFinite(Number(timing?.overlap)) ? +Number(timing.overlap).toFixed(3) : 0;

  // 路径 A：存在 `timing.scenes`
  if (Array.isArray(timing?.scenes) && timing.scenes.length) {
    const scenesRaw = timing.scenes;
    const total = Number.isFinite(Number(timing.total))
      ? +Number(timing.total).toFixed(3)
      : +scenesRaw.reduce((m, s) => Math.max(m, Number(s.start ?? 0) + Number(s.slot ?? 0)), 0).toFixed(3);
    const scenes = scenesRaw.map((sc, i) => {
      const start = +Number(sc.start ?? 0).toFixed(3);
      const slot = +Number(sc.slot ?? 0).toFixed(3);
      const end = +(start + slot).toFixed(3);
      const next = scenesRaw[i + 1];
      const cutStartLt = next ? +Math.max(0, Number(next.start ?? 0) - start).toFixed(3) : null;
      const releaseByLt = cutStartLt != null ? +Math.max(0, cutStartLt - 0.15).toFixed(2) : null;
      const lines = (Array.isArray(sc.lines) ? sc.lines : []).map((l, li) => normalizeLine(l, li, start, opts));
      return {
        id: String(sc.id ?? `seg${i + 1}`),
        start,
        slot,
        end,
        cutStartLt,
        releaseByLt,
        lines,
      };
    });
    return { task, total, overlap, sourceKind: 'timing', scenes };
  }

  // 路径 B：无 `timing`，回退 `narration.lines` + `timeline`
  const nLines = Array.isArray(narration?.lines) ? narration.lines : [];
  const tl = Array.isArray(timeline) && timeline.length
    ? timeline.slice().sort((a, b) => Number(a.start ?? 0) - Number(b.start ?? 0))
    : null;

  if (tl) {
    const total = +tl.reduce((m, s) => Math.max(m, Number(s.end ?? 0)), 0).toFixed(3);
    const scenes = tl.map((seg, i) => {
      const start = +Number(seg.start ?? 0).toFixed(3);
      const end = +Number(seg.end ?? start).toFixed(3);
      const slot = +Math.max(0, end - start).toFixed(3);
      const next = tl[i + 1];
      const cutStartLt = next ? +Math.max(0, Number(next.start ?? 0) - start).toFixed(3) : null;
      const releaseByLt = cutStartLt != null ? +Math.max(0, cutStartLt - 0.15).toFixed(2) : null;
      return {
        id: String(seg.id ?? `seg${i + 1}`),
        start,
        slot,
        end,
        cutStartLt,
        releaseByLt,
        lines: [],
      };
    });
    for (let li = 0; li < nLines.length; li++) {
      const l = nLines[li];
      const tLine = Number(l.start ?? 0);
      let target = scenes.find((s) => tLine >= s.start - 1e-3 && (s.cutStartLt == null ? tLine <= s.end + 1e-3 : tLine < s.start + s.cutStartLt));
      if (!target) target = scenes.find((s) => tLine >= s.start - 1e-3 && tLine <= s.end + 1e-3);
      if (!target) target = tLine < scenes[0].start ? scenes[0] : scenes[scenes.length - 1];
      target.lines.push(normalizeLine(l, li, target.start, opts));
    }
    return { task, total, overlap, sourceKind: 'narration', scenes };
  }

  // 无时间线时打包为单虚拟段 all
  const total = +nLines.reduce((m, l) => Math.max(m, Number(l.start ?? 0) + Number(l.dur ?? 0)), 0).toFixed(3);
  return {
    task,
    total,
    overlap,
    sourceKind: 'narration',
    scenes: [
      {
        id: 'all',
        start: 0,
        slot: total,
        end: total,
        cutStartLt: null,
        releaseByLt: null,
        lines: nLines.map((l, li) => normalizeLine(l, li, 0, opts)),
      },
    ],
  };
}

/**
 * 格式化紧凑单屏词点速查文本。
 * @param {ReturnType<typeof buildCuesData>} data
 * @param {{ sceneFilter?: string[]|null }} [opts]
 */
export function formatCuesText(data, opts = {}) {
  const filter = Array.isArray(opts.sceneFilter) && opts.sceneFilter.length ? new Set(opts.sceneFilter) : null;
  const out = [];
  const ovTxt = data.overlap > 0 ? ` · overlap ${data.overlap.toFixed(3)}s` : '';
  out.push(`词点速查：${data.task || '(未命名)'}（总长 ${Number(data.total ?? 0).toFixed(2)}s${ovTxt} · 全部时刻为段内 f.lt）`);

  const scenes = data.scenes ?? [];
  scenes.forEach((sc, i) => {
    if (filter && !filter.has(sc.id)) return;
    const idxTag = `[${String(i + 1).padStart(2, '0')}]`;
    const cutNote = sc.cutStartLt != null
      ? `切点 cutStart=${sc.cutStartLt.toFixed(2)}s → railU/zoomBoost 归零线 lt<=${sc.releaseByLt.toFixed(2)}s`
      : '末段（无下切点）';
    out.push('');
    out.push(`${idxTag} ${sc.id}  t=${sc.start.toFixed(2)}..${sc.end.toFixed(2)}s  slot=${sc.slot.toFixed(2)}s  ${cutNote}`);
    if (!sc.lines.length) {
      out.push('  （本段无旁白句）');
      return;
    }
    for (let li = 0; li < sc.lines.length; li++) {
      const l = sc.lines[li];
      out.push(`  L${li + 1} lt=${l.ltStart.toFixed(2)}..${l.ltEnd.toFixed(2)}s  ${l.text}`);
      if (l.triggers.length) {
        out.push(`     词点: ${l.triggers.map((w) => `${w.w}@${w.lt.toFixed(2)}`).join(' · ')}`);
      }
    }
  });
  return out.join('\n');
}
