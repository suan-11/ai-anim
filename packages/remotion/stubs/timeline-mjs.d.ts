export function resolveSeconds(v: any, bpm?: number): number;
export function buildFrameTimeline(config: any): {
  width: number; height: number; fps: number; durationInFrames: number;
  segments: { id: string; type: string; startFrame: number; endFrame: number; params: Record<string, unknown>; note?: string }[];
};
export function localSeconds(seg: { startFrame: number }, frame: number, fps: number): number;
