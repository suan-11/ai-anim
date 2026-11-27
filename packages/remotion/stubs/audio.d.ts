export class MusicData {
  constructor(a: any, extra?: { url?: string });
  static load(url: string, opts?: any): Promise<MusicData>;
  at(t: number): any;
  beatAt(t: number): number;
  bpm: number;
  beats: number[];
  downbeats?: number[];
}
export const SILENT: MusicData;
