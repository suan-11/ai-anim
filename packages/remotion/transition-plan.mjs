/**
 * 转场排程（纯函数，无 React）：把「段列表 + 每缝转场」算成 TransitionSeries 能吃的
 * durationInFrames 序列，并保证**每段的起始帧号不被转场推走**。
 *
 * 为什么需要它：TransitionSeries.Transition 会吃掉相邻两段的接触时间 —— 第 i 个转场
 * 让后续所有段整体前移 t 帧。5 个 0.25s 转场在 60fps 下就是 75 帧（1.25s）漂移，
 * 音画同步的镜头会整体错位。这里给「除最后一段外」的每段补上它后面那个转场的帧数：
 *
 *   start_{i+1} = start_i + (dur_i + pad_i) - t_{i+1}  ⟹  pad_i = start_{i+1} - start_i - dur_i + t_{i+1}
 *
 * 当段是紧邻的（start_{i+1} = start_i + dur_i）时 pad_i 正好 = t_{i+1}，
 * 总时长 = 最后一段的 endFrame，**与不加转场时逐帧一致**。
 */

/**
 * @param {object} opts
 * @param {{id: string, startFrame: number, endFrame: number}[]} opts.segments
 * @param {(string|undefined)[]} [opts.transitions]  长度 = segments.length - 1；'none' = 该缝不加转场
 * @param {number} [opts.transitionSec]              硬切缝的柔化秒数（默认 0.25）
 * @param {number} [opts.fps]
 * @param {{index: number, overlapSec: number}[]} [opts.overlaps]  有交叠的缝用交叠秒数
 * @param {boolean} [opts.compensate]                默认 true：补时长，保证起始帧不变
 */
export function planTransitions({
  segments, transitions, transitionSec = 0.25, fps = 24, overlaps = [], compensate = true,
}) {
  const overlapByIndex = new Map(overlaps.map((o) => [o.index, o.overlapSec]));
  const n = segments.length;

  // 第 i 段之前的转场（i >= 1）
  const before = segments.map((seg, i) => {
    if (i === 0) return null;
    const kind = transitions?.[i - 1] ?? 'wipe';
    if (kind === 'none') return { index: i, kind, frames: 0, linear: false };
    const sec = overlapByIndex.get(i) ?? transitionSec;
    return { index: i, kind, frames: Math.max(0, Math.round(sec * fps)), linear: overlapByIndex.has(i) };
  });

  let cursor = segments[0].startFrame;
  const items = segments.map((seg, i) => {
    const dur = seg.endFrame - seg.startFrame;
    const t = before[i]?.frames ?? 0;
    // 补时长：让下一段（扣掉转场）仍落在它自己的 startFrame 上
    const nextStart = i + 1 < n ? segments[i + 1].startFrame : null;
    const nextT = i + 1 < n ? (before[i + 1]?.frames ?? 0) : 0;
    const pad = compensate && nextStart !== null
      ? Math.max(0, nextStart - seg.startFrame - dur + nextT)
      : 0;

    const startFrame = cursor;
    if (compensate) cursor = startFrame + dur + pad - nextT;
    else cursor = startFrame + dur + pad - nextT;

    return {
      id: seg.id,
      startFrame,                       // 不含转场时的目标起始帧（断言用）
      durationInFrames: dur + pad,
      pad,
      transitionBefore: before[i],
    };
  });

  const totalFrames = compensate
    ? segments[n - 1].endFrame - segments[0].startFrame
    : items.reduce((s, it) => s + it.durationInFrames, 0)
      - items.reduce((s, it) => s + (it.transitionBefore?.frames ?? 0), 0);

  return { items, totalFrames };
}
