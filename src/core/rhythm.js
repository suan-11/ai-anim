// @ts-check
/** @typedef {{t_start: number, t_end: number, intensity: number, info_density: number, resistance: number, attention_target: string, motion_grammar?: string, sound_density?: number, beat_role: string}} RhythmBlock */
/** @typedef {{code: string, block: number|null, message: string}} RhythmIssue */

const ROLES = ['pressure', 'hold', 'release', 'residue'];
const TIME_EPSILON = 1e-6;
const HIGH_DENSITY = 4;
const isLevel = (x) => Number.isInteger(x) && x >= 1 && x <= 5;
const isRatio = (x) => Number.isFinite(x) && x >= 0 && x <= 1;

/**
 * 校验数据格式与 R1–R5。可直接传 JSON 文本；编排问题不影响合法块的查找。
 * @param {unknown} input
 * @param {{duration?: number}} [options]
 * @returns {{blocks: readonly Readonly<RhythmBlock>[], issues: RhythmIssue[]}}
 */
export function validateRhythm(input, { duration } = {}) {
  /** @type {RhythmIssue[]} */
  const issues = [];
  const issue = (code, block, message) => issues.push({ code, block, message });
  if (typeof input === 'string') {
    try { input = JSON.parse(input.trimStart()); }
    catch { return { blocks: [], issues: [{ code: 'format', block: null, message: 'rhythm.json 不是有效的 JSON' }] }; }
  }
  if (!Array.isArray(input) || !input.length) {
    return { blocks: [], issues: [{ code: 'format', block: null, message: '节奏表必须是非空块数组' }] };
  }

  Array.from(input).forEach((block, i) => {
    const index = i + 1;
    const invalid = (message) => issue('format', index, message);
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      invalid('块必须是对象');
      return;
    }
    const { t_start: start, t_end: end } = block;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      invalid('t_start / t_end 必须是非负且递增的秒数');
    } else {
      const length = end - start;
      if (length < 3 - TIME_EPSILON || length > 8 + TIME_EPSILON) invalid('块长须为 3–8 秒');
      const previousEnd = i ? input[i - 1]?.t_end : 0;
      if (Number.isFinite(previousEnd) && Math.abs(start - previousEnd) > TIME_EPSILON) {
        invalid(i ? '须与上一块首尾相接' : '第一块须从 0 秒开始');
      }
    }
    if (!isLevel(block.intensity) || !isLevel(block.info_density)) invalid('intensity / info_density 须为 1–5 的整数');
    if (!isRatio(block.resistance)) invalid('resistance 须为 0–1 的数值');
    if (block.sound_density !== undefined && !isRatio(block.sound_density)) invalid('sound_density 须为 0–1 的数值');
    if (block.motion_grammar !== undefined && (typeof block.motion_grammar !== 'string' || !block.motion_grammar.trim())) {
      invalid('motion_grammar 须为非空字符串');
    }
    if (!ROLES.includes(block.beat_role)) invalid(`beat_role 须为 ${ROLES.join(' / ')} 之一`);
  });
  if (issues.length) return { blocks: [], issues };

  const end = input.at(-1).t_end;
  if (Number.isFinite(duration) && Math.abs(end - duration) > TIME_EPSILON) {
    issue('coverage', null, `节奏表结束于 ${end}s，整片时长为 ${duration}s`);
  }

  const roles = new Set();
  input.forEach((block, i) => {
    const index = i + 1;
    const previous = input[i - 1];
    const earlier = input[i - 2];
    const next = input[i + 1];
    if (previous?.intensity === block.intensity && earlier?.intensity === block.intensity) {
      issue('R1', index, '连续三块 intensity 相同');
    }
    if (block.info_density >= HIGH_DENSITY && (!next || next.info_density >= block.info_density)) {
      issue('R2', index, `高信息密度块（≥${HIGH_DENSITY}）之后须接更低密度的块`);
    }
    if (block.beat_role === 'release' && (!previous || previous.resistance <= block.resistance
      || (earlier && earlier.resistance >= previous.resistance))) {
      issue('R3', index, 'release 前的阻力须逐块升向前一块，并在 release 时下降');
    }
    if (block.attention_target !== 'single_anchor') issue('R4', index, 'attention_target 须为 single_anchor');
    // R6：不允许连续两个 release 相邻
    if (block.beat_role === 'release' && previous?.beat_role === 'release') {
      issue('R6', index, '不允许连续两个 release 相邻');
    }
    // R7：每个 release 之前必须有至少一个 pressure 或 hold（蓄势）
    if (block.beat_role === 'release' && (!previous || !['pressure', 'hold'].includes(previous.beat_role))) {
      issue('R7', index, 'release 之前须有 pressure 或 hold 蓄势');
    }
    // R8：release 之后不能直接接 pressure（须先经 residue 余韵，再启下一轮蓄势）
    if (block.beat_role === 'pressure' && previous?.beat_role === 'release') {
      issue('R8', index, 'release 之后须先经 residue，不能直接接 pressure');
    }
    roles.add(block.beat_role);
  });
  if (roles.size < 3) issue('R5', null, '全片须使用至少三类 beat_role');

  const blocks = input.map((block, i) => Object.freeze({ ...block, t_start: i ? input[i - 1].t_end : 0 }));
  return { blocks: Object.freeze(blocks), issues };
}

/**
 * 按整片秒数定位 [t_start, t_end) 内的块。区间外或无表时返回 null。
 * @param {readonly Readonly<RhythmBlock>[]} blocks 已通过格式校验的有序块
 * @param {number} t
 */
export function rhythmAt(blocks, t) {
  if (!Number.isFinite(t)) return null;
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (blocks[mid].t_start <= t) lo = mid + 1;
    else hi = mid;
  }
  const block = blocks[lo - 1];
  return block && t < block.t_end ? block : null;
}

/** @param {readonly Readonly<RhythmBlock>[]} blocks @param {number} t */
export function rhythmFrameAt(blocks, t) {
  const block = rhythmAt(blocks, t);
  if (!block) return null;
  const elapsed = t - block.t_start;
  return { ...block, elapsed, progress: elapsed / (block.t_end - block.t_start) };
}
