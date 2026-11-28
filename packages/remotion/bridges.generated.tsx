// @ts-nocheck
/**
 * 自动生成文件 — 请勿手工编辑。
 * 来源：packages/remotion/registry.json（运行 node tools/gen-remotion-registry.mjs 更新）。
 */
import React from 'react';
import { EngineBridge } from './shots/EngineBridge';
import { evaluateTask } from '@/rm/task-eval';
import { makeNarration } from '@/engine/narration';

import * as mod_0 from "../../tasks/_three-lab/task.config.mjs";
import * as mod_1 from "../../tasks/nekohome-intro-ja/task.config.mjs";
import narr_1 from "../../tasks/nekohome-intro-ja/audio/ja-sub-zh.narration.json";
import analysis_1 from "../../tasks/nekohome-intro-ja/audio/bed.analysis.json";

const spec_0 = (mod_0 as any).default ?? mod_0;
const eval_0 = evaluateTask("_three-lab", mod_0, {  });
const Bridge_0: React.FC<{ samples?: number | 'auto'; shutter?: number }> = ({ samples = "auto", shutter }) => (
  <EngineBridge
    taskId="_three-lab"
    taskMod={mod_0}
    samples={samples}
    shutter={shutter ?? (samples === 1 ? undefined : 0.5)}
  />
);

const spec_1 = (mod_1 as any).default ?? mod_1;
const narrData_1 = makeNarration(narr_1, { duration: spec_1.duration });
const eval_1 = evaluateTask("nekohome-intro-ja", mod_1, { narrationData: narrData_1, music: analysis_1 });
const Bridge_1: React.FC<{ samples?: number | 'auto'; shutter?: number }> = ({ samples = "auto", shutter }) => (
  <EngineBridge
    taskId="nekohome-intro-ja"
    taskMod={mod_1}
    narrationData={narrData_1}
    analysis={analysis_1}
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
    task: "_three-lab",
    id: "Task-three-lab",
    width: eval_0.width,
    height: eval_0.height,
    fps: eval_0.fps,
    durationInFrames: eval_0.durationInFrames,
    component: Bridge_0,
  },
  {
    task: "nekohome-intro-ja",
    id: "Task-nekohome-intro-ja",
    width: eval_1.width,
    height: eval_1.height,
    fps: eval_1.fps,
    durationInFrames: eval_1.durationInFrames,
    component: Bridge_1,
  },
];
