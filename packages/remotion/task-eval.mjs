// @ts-check
/**
 * Remotion 迁移 · 阶段 2A：任务解析（发现与求值分离）。
 *
 * 旧引擎的 src/tasks.js 顶层是 Vite 专属的 import.meta.glob，Node/Remotion bundle 都不能直接 import。
 * 这里把**可共享的求值**抽出来，全部复用旧引擎的同一份实现（不是第二套规则）：
 *   · 变体深合并  → src/core/util.js deepMergeInto（对象递归、数组/原始值整体替换）
 *   · 音轨归一    → normalizeAudio（与 src/tasks.js 逐字同式；那边不能 import，这份是镜像，改动要同步）
 *   · 旁白表      → src/core/narration.js makeNarration / makeNarrationReader
 *   · 时间语义    → src/timeline.js build()（秒 / {beat} / {bar} / {vo} / at / overlap 全支持）
 *   · 风格包      → src/style/index.js resolveStyle
 *
 * **发现**这一半留给调用方：Remotion 入口用显式 import（rm/Root.tsx），
 * CLI/测试用 Node 动态 import。本模块不做任何文件系统扫描。
 *
 * 输出契约（Composition 与诊断共同读取）：
 *   { name, title, width, height, fps, durationInFrames,
 *     segments: [{ id, type|null, startFrame, endFrame, startSec, endSec, params, sceneId }],
 *     audio: { music, vo, mix, analysis, packaging, split },
 *     narration: { lines, ... } | null, style: resolvedStyle | null,
 *     overlaps: [{ id, prevId, overlapSec }] }
 *
 * 帧口径：内部一律整数帧、左闭右开；边界 = round(绝对秒 × fps)（累计秒取整，不是逐段取整再累加）。
 * renderMedia 导出时转 [startFrame, endFrame - 1]。
 */

import { build, isConfigNode } from '../../src/timeline.js';
import { makeNarration, makeNarrationReader } from '../../src/core/narration.js';
import { deepMergeInto } from '../../src/core/util.js';
import { resolveStyle } from '../../src/style/index.js';

/**
 * 音轨归一 —— 与 src/tasks.js normalizeAudio 逐字同式（镜像实现，改那边记得同步这里）。
 * @param {any} audio
 */
export function normalizeAudio(audio) {
  /** @param {any} v */
  const s = (v) => (typeof v === 'string' && v ? v : null);
  if (!audio) return { music: null, vo: null, mix: null, analysis: null, packaging: null, split: false };
  if (typeof audio === 'string') {
    return { music: null, vo: null, mix: audio, analysis: audio, packaging: audio, split: false };
  }
  const music = s(audio.music), vo = s(audio.vo), mix = s(audio.mix);
  const analysis = music ?? mix ?? vo;
  const packaging = mix ?? music ?? vo;
  return { music, vo, mix, analysis, packaging, split: true };
}

/**
 * 纯数据深拷贝（变体合并前的隔离层）。
 * 只递归普通对象与数组；函数 / 类实例 / 其他引用原样保留 ——
 * timeline 里的场景对象带 render() 函数，不能 structuredClone，也不能被变体合并改写。
 * @param {any} v
 * @returns {any}
 */
function cloneData(v) {
  if (Array.isArray(v)) return v.map(cloneData);
  if (v && typeof v === 'object' && (v.constructor === Object || v.constructor == null)) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = cloneData(val);
    return out;
  }
  return v;
}

/**
 * 求值一份任务模块（{ default, variants?, world? }）。
 * @param {string} name 任务名（报错用）
 * @param {any} mod task.config.mjs 的模块命名空间
 * @param {{ variant?: string|null, narrationData?: any, music?: { beats?: number[], downbeats?: number[], bpm?: number }|null }} [opts]
 */
export function evaluateTask(name, mod, opts = {}) {
  // 深拷贝纯数据部分：变体深合并会递归改写嵌套对象（palette/style/grid…），
  // 浅拷贝顶层挡不住 —— 同一进程里多次求值不同变体会互相污染（实测：dark 改 signal 后 base 也变）。
  // 场景对象/函数原样保留（cloneData 不碰它们）。
  const spec = cloneData(mod.default ?? mod);
  if (!spec) throw new Error(`tasks/${name}/task.config.mjs 没有 export default`);

  // 变体：与 src/tasks.js 同一条深合并规则；未知变体名抛错并列出可用的
  const variants = (mod.variants && typeof mod.variants === 'object') ? mod.variants : null;
  const variantName = opts.variant == null ? null : (String(opts.variant).trim() || null);
  if (variantName) {
    const patch = variants && variants[variantName];
    if (!patch) {
      const known = Object.keys(variants ?? {}).join(' / ') || '（这个任务没有 export const variants）';
      throw new Error(`任务 "${name}" 没有变体 "${variantName}"。可用：${known}`);
    }
    deepMergeInto(spec, patch);
    spec.variantName = variantName;
  }

  const fps = spec.fps ?? 60;
  const width = spec.width ?? 1920;
  const height = spec.height ?? 1080;

  // 音轨
  const audioTracks = normalizeAudio(spec.audio);

  // 旁白表：对象内联直接 makeNarration；字符串路径由调用方读文件后从 narrationData 注入
  let narrationData = null;
  if (spec.narration && typeof spec.narration !== 'string') {
    narrationData = makeNarration(spec.narration, { duration: spec.duration });
  } else if (typeof spec.narration === 'string') {
    narrationData = opts.narrationData ?? null;
  }

  // 风格（报错带任务名，与 src/tasks.js 同口径）。
  // ⚠ resolveStyle 读 spec.style + spec.layout，**不读 spec.palette** ——
  //   任务级/变体级的 palette 覆盖要并进 style 请求对象（与引擎 ctx.P 的合并顺序一致：风格包 → 任务覆盖）。
  let styleResolved = null;
  try {
    const styleReq = spec.palette
      ? { ...(typeof spec.style === 'object' && spec.style ? spec.style : { name: spec.style ?? 'print' }), palette: { ...(typeof spec.style === 'object' ? spec.style?.palette : null), ...spec.palette } }
      : spec.style;
    styleResolved = resolveStyle({ ...spec, style: styleReq });
  } catch (err) {
    throw new Error(`tasks/${name}/task.config.mjs 的 style 不合法：\n  ${err instanceof Error ? err.message : String(err)}`);
  }

  // 时间线：与 src/tasks.js 同一条选路 ——
  //   · 数组且**不含配置档节点**：旧引擎视为「已经展开好的段」原样用（不 build）；
  //   · 其余（seq/par 方案、含 {type} 节点的数组）走 build()。
  // ⚠ 但 [cut(scene,{dur})] 这种**未展开的 cut 数组**在旧引擎里也是原样传给引擎、
  //   由引擎自己排时间的；求值器这里必须替它补排（否则 start/end 缺失 → 0–0 帧区间）。
  //   判据：数组项带 kind:'cut' 且没有 start/end → 也走 build()。
  let items;
  /** @type {WeakMap<object, { type: string, params: Record<string, unknown> }>} */
  const templates = new WeakMap();
  const tl = spec.timeline;
  const isUnexpandedCutArray = Array.isArray(tl) && tl.length > 0
    && tl.every((n) => n && n.kind === 'cut' && n.start == null && n.end == null);
  const laidOut = Array.isArray(tl) && !tl.some(isConfigNode) && !isUnexpandedCutArray;
  if (!laidOut) {
    try {
      items = build(tl, {
        ...(opts.music ? { beats: opts.music.beats, downbeats: opts.music.downbeats, bpm: opts.music.bpm } : {}),
        narration: narrationData,
      }, {
        onConfigSegment: (segment, template) => { templates.set(segment, template); },
      });
    } catch (err) {
      throw new Error(`tasks/${name}/task.config.mjs 的时间线不合法：\n${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    items = tl;
  }
  if (!Array.isArray(items) || !items.length) {
    throw new Error(`tasks/${name} 的 timeline 是空的`);
  }

  // 秒 → 帧：累计绝对秒取整（与阶段 1 收尾口径一致），左闭右开
  const segments = [];
  const overlaps = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const startSec = Number(it.start ?? 0);
    const endSec = Number(it.end ?? startSec);
    const startFrame = Math.round(startSec * fps);
    const endFrame = Math.round(endSec * fps);
    if (!(endFrame > startFrame)) {
      throw new Error(`tasks/${name} 段 ${it.id} 在 ${fps}fps 下帧区间无效（${startSec}–${endSec}s）`);
    }
    const scene = it.scene ?? null;
    const template = templates.get(it);
    segments.push({
      id: String(it.id ?? `scene_${i}`),
      type: template?.type ?? null,
      sceneId: scene?.id != null ? String(scene.id) : null,
      startFrame, endFrame, startSec, endSec,
      params: template?.params ?? it.params ?? {},
      note: it.note ?? null,
      focus: it.focus ?? null,
      state: it.state ?? null,
      transition: it.transition ?? null,
      overlap: it.overlap ?? 0,
      handlesTransition: !!it.handlesTransition,
    });
    if (i > 0) {
      // 交叠 = 本段 start 早于**此前所有段**的最晚 end（par 组里多段同起点，
      // 只比前一段会漏掉与更早段的交叠）。
      const prevMaxEnd = Math.max(...items.slice(0, i).map((x) => Number(x.end ?? 0)));
      if (startSec < prevMaxEnd) {
        overlaps.push({ id: segments[i].id, prevId: segments[i - 1].id, overlapSec: prevMaxEnd - startSec });
      }
    }
  }
  // 总帧数 = max(所有段 endFrame, spec.duration × fps)。
  // build() 按 start 排序，乱序 at / par 组里最后一段未必最长 —— 取 last.endFrame 会截短片子；
  // spec.duration 显式声明时与旧引擎 engine.load 同口径（spec.duration ?? max(end)），
  // 片尾留白 / 音轨比时间线长的任务（如 world-execute-me 212.33s vs 末段 207.5s）靠它保尾。
  const durationInFrames = Math.max(
    ...segments.map((s) => s.endFrame),
    Number.isFinite(spec.duration) ? Math.round(spec.duration * fps) : 0,
  );

  return {
    name,
    variantName: variantName,
    title: spec.title ?? name,
    width, height, fps,
    durationInFrames,
    durationSec: durationInFrames / fps,
    segments,
    overlaps,
    audio: audioTracks,
    narration: narrationData ? makeNarrationReader(narrationData) : null,
    narrationRaw: narrationData,
    style: styleResolved,
    captionsEnabled: spec.captions === true,
    // 素材引用（相对任务目录的原样路径，存在性检查由调用方做）
    assetRefs: {
      audio: [audioTracks.music, audioTracks.vo, audioTracks.mix].filter(Boolean),
      narrationFile: typeof spec.narration === 'string' ? spec.narration : null,
      fonts: spec.fonts ?? null,
    },
  };
}

/**
 * 缺失素材检查：返回 [{ task, file }]。指定音轨缺失时报告任务和文件（2C 验收口径）。
 * @param {ReturnType<typeof evaluateTask>} parsed
 * @param {(relPath: string) => boolean} exists 相对任务目录的存在性判断
 */
export function missingAssets(parsed, exists) {
  /** @type {{ task: string, file: string }[]} */
  const out = [];
  for (const rel of parsed.assetRefs.audio) {
    if (rel && !exists(rel)) out.push({ task: parsed.name, file: rel });
  }
  if (parsed.assetRefs.narrationFile && !exists(parsed.assetRefs.narrationFile)) {
    out.push({ task: parsed.name, file: parsed.assetRefs.narrationFile });
  }
  return out;
}
