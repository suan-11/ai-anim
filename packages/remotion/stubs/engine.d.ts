export class Engine {
  constructor(canvas: HTMLCanvasElement, opts?: any);
  load(spec: any): Promise<void>;
  render(t: number, opts?: any): any;
  readPixels(opts?: any): Uint8Array;
  dispose(): void;
  gl: any;
  hud2d: any;
  timeline: any[];
  errors: string[];
  renderErrors: { id: string; t: number; message: string }[];
  hud: boolean;
  _ctxFor(item: any, t: number, idx: number, extras?: any): any;
}
