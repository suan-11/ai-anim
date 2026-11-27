// @ts-nocheck
/**
 * 自动生成文件 — 请勿手工编辑。
 * 来源：packages/remotion/registry.json（运行 node tools/gen-remotion-registry.mjs 更新）。
 */
import React from 'react';
import { EngineBridge } from './shots/EngineBridge';
import { evaluateTask } from '@/rm/task-eval';
import { makeNarration } from '@/engine/narration';

import * as mod_0 from "../../tasks/nekohome-intro-ja/task.config.mjs";
import narr_0 from "../../tasks/nekohome-intro-ja/audio/ja-sub-zh.narration.json";
import analysis_0 from "../../tasks/nekohome-intro-ja/audio/bed.analysis.json";

const spec_0 = (mod_0 as any).default ?? mod_0;
const narrData_0 = makeNarration(narr_0, { duration: spec_0.duration });
const eval_0 = evaluateTask("nekohome-intro-ja", mod_0, { narrationData: narrData_0, music: analysis_0 });
const Bridge_0: React.FC<{ samples?: number | 'auto'; shutter?: number }> = ({ samples = "auto", shutter }) => (
  <EngineBridge
    taskId="nekohome-intro-ja"
    taskMod={mod_0}
    narrationData={narrData_0}
    analysis={analysis_0}
    samples={samples}
    shutter={shutter ?? (samples === 1 ? undefined : 0.5)}
  />
);

export type GeneratedBridgeEntry = {
  task: string;
  id: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  component: React.FC<{ samples?: number | 'auto'; shutter?: number }>;
};

export const BRIDGES: GeneratedBridgeEntry[] = [
  {
    task: "nekohome-intro-ja",
    id: "Task-nekohome-intro-ja",
    width: eval_0.width,
    height: eval_0.height,
    fps: eval_0.fps,
    durationInFrames: eval_0.durationInFrames,
    component: Bridge_0,
  },
];
