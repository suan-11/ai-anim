// @ts-check
/**
 * Remotion 迁移 · 阶段 1：把 example-config-only 的时间线换算成**整数帧、左闭右开**。
 *
 * 约定（docs/HANDOVER-remotion.md 阶段 2 的口径提前在这里钉死）：
 *   · 段边界 = round(绝对秒 × fps)，时长 = endFrame - startFrame。
 *   · 60 fps 下共 834 帧，边界为 0、210、474、684、834，最后一个值是排他终点。
 *   · renderMedia 的 frameRange 是**包含结束帧**的，导出时转 [start, end - 1]。
 *
 * 这里不 import src/timeline.js（它拉着整个 WebGL 镜头库进浏览器 bundle）——
 * 这里沿用 src/timeline.js 对秒和无音频拍点的换算，默认 BPM 为 120。
 */

/** @typedef {{ id: string, type: string, startFrame: number, endFrame: number, params: Record<string, unknown>, note?: string }} RmSegment */

const TIMELINE_KEYS = new Set([
  'type', 'id', 'dur', 'at', 'overlap', 'params', 'post', 'maxSamples',
  'handlesTransition', 'note', 'world', 'worldPass', 'focus', 'carry',
  'transition', 'transitionOpts', 'state', 'relayTo',
]);

/**
 * @param {any} v 秒 / { beat } / { bar }
 * @param {number} bpm
 */
export function resolveSeconds(v, bpm = 120) {
  if (v == null) return 4;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`dur 必须是有限数（秒），收到 ${v}`);
    return v;
  }
  if (typeof v === 'object' && v.beat != null) return (v.beat * 60) / bpm;
  if (typeof v === 'object' && v.bar != null) return (v.bar * 4 * 60) / bpm;
  throw new Error(`阶段 1 只支持 秒 / { beat } / { bar } 的 dur，收到 ${JSON.stringify(v)}`);
}

/**
 * 把任务配置展开成帧级时间线。硬切（无 overlap）——example-config-only 四段各自铺满整帧。
 * @param {any} config task.config.mjs 的 default export
 * @returns {{ width: number, height: number, fps: number, durationInFrames: number, segments: RmSegment[] }}
 */
export function buildFrameTimeline(config) {
  const fps = config.fps ?? 60;
  const width = config.width ?? 1920;
  const height = config.height ?? 1080;
  const nodes = Array.isArray(config.timeline) ? config.timeline : config.timeline?.items;
  if (!Array.isArray(nodes)) throw new Error('阶段 1 只接受数组时间线（配置档写法）');

  /** @type {RmSegment[]} */
  const segments = [];
  let endSeconds = 0;
  let endFrame = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node || typeof node.type !== 'string' || node.scene != null) {
      throw new Error(`timeline[${i}] 不是配置档节点（阶段 1 只支持 { type, … }）`);
    }
    if (node.at != null) throw new Error(`timeline[${i}] 指定了 at，阶段 1 只支持顺序排程`);
    if (node.overlap) throw new Error(`timeline[${i}] 带 overlap —— 交叠转场属于阶段 3，阶段 1 只做硬切`);
    const startFrame = endFrame;
    endSeconds += resolveSeconds(node.dur, config.bpm ?? 120);
    endFrame = Math.round(endSeconds * fps);
    if (!Number.isSafeInteger(endFrame) || endFrame <= startFrame) {
      throw new Error(`timeline[${i}] 的 dur 必须在 ${fps} fps 下形成有效的帧区间`);
    }
    /** @type {RmSegment['params']} */
    const params = {};
    for (const [k, v] of Object.entries(node)) {
      if (!TIMELINE_KEYS.has(k)) params[k] = v;
    }
    Object.assign(params, node.params ?? {});
    const id = node.id ?? node.type;
    segments.push({
      id,
      type: node.type,
      startFrame,
      endFrame,
      params,
      note: node.note,
    });
  }
  return { width, height, fps, durationInFrames: endFrame, segments };
}

/**
 * 把全片帧号换成段内秒。
 * @param {{ startFrame: number }} seg
 * @param {number} frame
 * @param {number} fps
 */
export function localSeconds(seg, frame, fps) {
  return (frame - seg.startFrame) / fps;
}
