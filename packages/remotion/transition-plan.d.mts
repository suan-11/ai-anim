/** transition-plan.mjs 的类型声明（tsc 严格检查用；运行时是 .mjs）。 */
export type TransitionKind = 'wipe' | 'slide' | 'fade' | 'none' | string;

export type PlanSegment = { id: string; startFrame: number; endFrame: number };
export type PlanTransition = { index: number; kind: TransitionKind; frames: number; linear: boolean };
export type PlanItem = {
  id: string;
  /** 不含转场时的目标起始帧（断言用；TransitionSeries 里由补时长保证成立） */
  startFrame: number;
  durationInFrames: number;
  pad: number;
  transitionBefore: PlanTransition | null;
};

export declare function planTransitions(opts: {
  segments: PlanSegment[];
  transitions?: TransitionKind[];
  transitionSec?: number;
  fps?: number;
  overlaps?: { index: number; overlapSec: number }[];
  compensate?: boolean;
}): { items: PlanItem[]; totalFrames: number };
