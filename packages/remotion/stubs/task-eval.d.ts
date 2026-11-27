export function normalizeAudio(audio: any): {
  music: string | null; vo: string | null; mix: string | null;
  analysis: string | null; packaging: string | null; split: boolean;
};
export function evaluateTask(name: string, mod: any, opts?: {
  variant?: string | null; narrationData?: any;
  music?: { beats?: number[]; downbeats?: number[]; bpm?: number } | null;
}): any;
export function missingAssets(parsed: any, exists: (relPath: string) => boolean): { task: string; file: string }[];
