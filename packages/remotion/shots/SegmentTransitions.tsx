/**
 * Remotion 原生转场层：TransitionSeries + wipe/slide/fade。
 *
 * 一切以 Remotion 为主：转场时长/曲线在 Studio 可编辑（linearTiming/springTiming），
 * 不再依赖旧引擎 WebGL transitionPass。
 *
 * ⚠ **转场不能推走段起点**：TransitionSeries.Transition 会吃掉相邻两段的接触时间，
 * 第 i 个转场让后续段整体前移 t 帧（5 个 0.25s 缝 = 1.25s 音画错位）。
 * 排程交给 transition-plan.mjs：它给「除最后一段外」的每段补上后面那个转场的帧数，
 * 于是每段仍从自己的 startFrame 起、总时长 = 最后一段 endFrame（与硬切逐帧一致）。
 *
 * 口径：本文件只管「段间视觉」，字幕/音轨层不参与转场，所以它们的帧号永远是绝对唱点。
 */
import React from 'react';
import { TransitionSeries, linearTiming, springTiming } from '@remotion/transitions';
import { wipe } from '@remotion/transitions/wipe';
import { slide } from '@remotion/transitions/slide';
import { fade } from '@remotion/transitions/fade';
import { useVideoConfig } from 'remotion';
import { planTransitions } from '../transition-plan.mjs';

export type TransitionKind = 'wipe' | 'slide' | 'fade' | 'none';

export type SegmentTransitionsProps = {
  segments: { id: string; startFrame: number; endFrame: number }[];
  /** 每段内容（index 对应 segments） */
  children: React.ReactNode[];
  /** 段间转场类型（长度 = segments.length - 1），默认 wipe */
  transitions?: TransitionKind[];
  /** 转场秒数（硬切段间加柔化时用），默认 0.25；0 = 硬切 */
  transitionSec?: number;
  /** 已有交叠的段对（overlapSec > 0）用交叠帧数做转场 */
  overlaps?: { index: number; overlapSec: number }[];
  /** 补时长保证段起点不漂（默认开；关掉 = 旧行为，转场会把后续段推前） */
  compensate?: boolean;
};

const PRESENTATIONS: Record<Exclude<TransitionKind, 'none'>, () => any> = {
  wipe: () => wipe({ direction: 'from-right' }),
  slide: () => slide({ direction: 'from-right' }),
  fade: () => fade(),
};

export const SegmentTransitions: React.FC<SegmentTransitionsProps> = ({
  segments, children, transitions, transitionSec = 0.25, overlaps = [], compensate = true,
}) => {
  const { fps } = useVideoConfig();
  const plan = planTransitions({ segments, transitions, transitionSec, fps, overlaps, compensate });

  return (
    <TransitionSeries>
      {plan.items.map((item: { id: string; durationInFrames: number; transitionBefore: { kind: string; frames: number; linear: boolean } | null }, i: number) => {
        const kind = (item.transitionBefore?.kind ?? 'wipe') as TransitionKind;
        const t = item.transitionBefore?.frames ?? 0;
        return (
          <React.Fragment key={item.id}>
            {i > 0 && t > 0 && kind !== 'none' ? (
              <TransitionSeries.Transition
                presentation={PRESENTATIONS[kind as Exclude<TransitionKind, 'none'>]()}
                timing={item.transitionBefore!.linear
                  ? linearTiming({ durationInFrames: t })
                  : springTiming({ durationInFrames: t, config: { damping: 200 } })}
              />
            ) : null}
            <TransitionSeries.Sequence durationInFrames={item.durationInFrames} name={item.id}>
              {children[i]}
            </TransitionSeries.Sequence>
          </React.Fragment>
        );
      })}
    </TransitionSeries>
  );
};
