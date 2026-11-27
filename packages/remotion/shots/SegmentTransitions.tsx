/**
 * Remotion 原生转场层：TransitionSeries + wipe/slide/fade。
 *
 * 一切以 Remotion 为主：转场时长/曲线在 Studio 可编辑（linearTiming/springTiming），
 * 不再依赖旧引擎 WebGL transitionPass。
 *
 * 用法：把段列表交给 <SegmentTransitions>，它用 TransitionSeries 编排：
 *   · 硬切段（无交叠）→ 直接 Sequence 拼接；
 *   · 有交叠的段 → TransitionSeries.Transition 插入 wipe/slide，
 *     转场帧数 = overlapSec × fps，presentation 按段序轮换。
 *
 * 与旧引擎口径：paperfold 的 overlap=0.6s 甩镜 → Remotion slide(from-right) 近似；
 * neko 全硬切 → 可选加 0.25s wipe 柔化（默认开，Studio 可调）。
 */
import React from 'react';
import { TransitionSeries, linearTiming, springTiming } from '@remotion/transitions';
import { wipe } from '@remotion/transitions/wipe';
import { slide } from '@remotion/transitions/slide';
import { fade } from '@remotion/transitions/fade';
import { useVideoConfig } from 'remotion';

export type TransitionKind = 'wipe' | 'slide' | 'fade' | 'none';

export type SegmentTransitionsProps = {
  segments: { id: string; startFrame: number; endFrame: number }[];
  /** 每段内容（index 对应 segments） */
  children: React.ReactNode[];
  /** 段间转场类型（长度 = segments.length - 1），默认 wipe */
  transitions?: TransitionKind[];
  /** 转场秒数（硬切段间加柔化时用），默认 0.25 */
  transitionSec?: number;
  /** 已有交叠的段对（overlapSec > 0）用交叠帧数做转场，不额外加 */
  overlaps?: { index: number; overlapSec: number }[];
};

const PRESENTATIONS: Record<Exclude<TransitionKind, 'none'>, () => any> = {
  wipe: () => wipe({ direction: 'from-right' }),
  slide: () => slide({ direction: 'from-right' }),
  fade: () => fade(),
};

export const SegmentTransitions: React.FC<SegmentTransitionsProps> = ({
  segments, children, transitions, transitionSec = 0.25, overlaps = [],
}) => {
  const { fps } = useVideoConfig();
  const overlapByIndex = new Map(overlaps.map((o) => [o.index, o.overlapSec]));

  return (
    <TransitionSeries>
      {segments.map((seg, i) => {
        const dur = seg.endFrame - seg.startFrame;
        const kind = transitions?.[i - 1] ?? 'wipe';
        const ov = overlapByIndex.get(i);
        // 转场帧数：有交叠用交叠帧，否则用 transitionSec（硬切柔化）
        const tFrames = i > 0 && kind !== 'none'
          ? Math.round((ov ?? transitionSec) * fps)
          : 0;
        return (
          <React.Fragment key={seg.id}>
            {i > 0 && tFrames > 0 ? (
              <TransitionSeries.Transition
                presentation={PRESENTATIONS[kind === 'none' ? 'wipe' : kind]()}
                timing={ov ? linearTiming({ durationInFrames: tFrames }) : springTiming({ durationInFrames: tFrames, config: { damping: 200 } })}
              />
            ) : null}
            <TransitionSeries.Sequence durationInFrames={dur} name={seg.id}>
              {children[i]}
            </TransitionSeries.Sequence>
          </React.Fragment>
        );
      })}
    </TransitionSeries>
  );
};