// Shared stage for reveal / cascade / transform. No per-shot drifting background or camera reset.
import { Pass } from '../core/gl.js';
import { css, mixColor } from '../core/util.js';
import { contentOk } from './pick.js';

export function setupStage(ctx) {
  const P = ctx.P;
  return new Pass(ctx.gl, /* glsl */ `
    uniform vec3 bg, ink2, bone, signal;
    void main() {
      vec2 p = vUv;
      float glow = exp(-dot((p - vec2(.5,.44))*vec2(2.7,3.4), (p - vec2(.5,.44))*vec2(2.7,3.4)));
      vec3 col = mix(bg, ink2, .22 + glow*.20);
      col += signal * glow * .022;
      float y = abs((p.y - .32) * RES_LOGICAL.y);
      col = mix(col, bone, (1.0-smoothstep(.0,1.2,y))*.075);
      fragColor = vec4(col,1.0);
    }`, { bg: P.ink, ink2: P.ink2, bone: P.bone, signal: P.signal }, { key: 'action_stage', blend: false });
}

export function stageFrame(ctx, bg) {
  bg.render(ctx.gl, ctx.out, ctx.f.t, ctx.f.dt);
  const { W, H, grid } = ctx;
  const pad = grid?.pad ?? W * .065;
  const bottom = Math.min(grid?.contentBottom ?? H * .83, H * .84);
  return { W, H, pad, cx: W / 2, cy: H * .55, r: Math.min(W * .12, H * .13), bottom };
}

export function core(lines, x, y, r, P, sx = 1, sy = 1) {
  const pts = Array.from({ length: 80 }, (_, i) => {
    const a = i / 80 * Math.PI * 2;
    return [x + Math.cos(a) * r * sx, y + Math.sin(a) * r * sy];
  });
  lines.fillPoly(pts, P.signal, 2);
  // A fixed highlight gives the moving disc a face, so its squash is readable.
  lines.seg(x - r * sx * .34, y - r * sy * .35, x + r * sx * .24, y - r * sy * .35, Math.max(2, r * .035), mixColor(P.signal, P.bone, .55));
}

/** Labels are spatial reveals; the exact same progress can move a physical occluder. */
export function label(ctx, text, x, y, progress, size, opts = {}) {
  ctx.type.reveal(String(text), x, y, { size, weight: 700, color: css(ctx.P.bone), align: 'center', progress, ...opts });
}

export function finishStage(ctx, o, frame, trigger) {
  const { type, text, comp, gl, P } = ctx;
  const { W, H, pad } = frame;
  type.write(String(o.kicker), pad, H * .15, { size: Math.min(W * .019, H * .026), family: 'mono', tracking: 3, color: css(P.signal) });
  const title = String(o.title);
  const maxSize = Math.min(H * .074, W * .065);
  const size = Math.min(maxSize, maxSize * (W - pad * 2) / Math.max(1, type.measure(title, { size: maxSize, weight: 700 })));
  label(ctx, title, W / 2, H * .28, trigger, size);
  text.upload();
  comp.draw(gl, text, ctx.out, { premult: false });
  return { bloom: .18, bloomThreshold: 1.1, grain: 0, vignette: .20, halation: .04 };
}

/** Keep all CLI metadata in the same factory contract as the other templates. */
export function describe(factory, defaults, meta, extras = {}) {
  factory.defaults = defaults;
  const descriptions = { id: '段名', title: '动作触发的主标题', kicker: '页眉标注', label: '主体旁的短标注', ...extras };
  const params = Object.keys(defaults).map((name) => ({ name, type: typeof defaults[name], desc: descriptions[name] ?? name }));
  factory.meta = { ...meta, notes: '动作按段内进度缩放；共享舞台和核心物可硬切接力。文字随动作裁切揭示，不靠透明度入场。', params };
  factory.spec = { params: Object.fromEntries(params.map((p) => [p.name, p.type])), requires: [], outputs: { visual: 'full-frame', handlesTransition: false } };
  factory.tags = ['graphic', 'process', 'flow'];
  factory.w = .9;
  factory.fits = contentOk;
  factory.fitsNote = '正文与开场；不用于片尾或独立转场';
}
