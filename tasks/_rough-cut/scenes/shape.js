import { Pass } from '../../../src/core/gl.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smooth = (value) => {
  const p = clamp01(value);
  return p * p * (3 - 2 * p);
};

export function roughShapeScene() {
  return {
    id: 'rough-shape',
    setup(ctx) {
      this.shape = new Pass(ctx.gl, /* glsl */ `
        uniform float seconds;
        void main() {
          vec2 p = (FRAG_PX - 0.5 * RES_LOGICAL) / RES_LOGICAL.y;
          vec3 ink = vec3(0.025);
          vec3 paper = vec3(0.80);
          // Follow the same mass across the frame. Hold the silhouette between
          // the end of the turn (8.45s) and the beginning of the landing (10s).
          float launch = smoothstep(0.0, 3.4, seconds);
          float turn = smoothstep(4.6, 8.45, seconds);
          float landing = smoothstep(10.0, 12.4, seconds);
          p -= mix(vec2(-0.22, -0.08), vec2(0.12, 0.04), launch)
               + vec2(0.08, 0.03) * turn + vec2(0.09, 0.03) * landing;
          float angle = 0.42 * turn * (1.0 - landing);
          p = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * p;
          const float halfTile = 0.047;
          float distanceToShape = 1.0;

          for (int i = 0; i < 9; i++) {
            vec2 cell = vec2(mod(float(i), 3.0), floor(float(i) / 3.0)) - 1.0;
            float delay = (cell.x + cell.y + 2.0) * 0.10;
            float split = smoothstep(1.6 + delay, 4.2 + delay, seconds);
            float close = smoothstep(10.0 + delay, 11.95 + delay, seconds);
            float spread = split * (1.0 - close);
            vec2 offset = vec2(0.19 * cell.x + 0.065 * cell.y, 0.12 * cell.y);
            vec2 center = 2.0 * halfTile * cell + spread * offset;
            vec2 d = abs(p - center) - halfTile;
            float box = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
            distanceToShape = min(distanceToShape, box);
          }

          // When closed, draw the exterior contour so shared tile edges vanish.
          vec2 hull = abs(p) - 3.0 * halfTile;
          float exterior = length(max(hull, 0.0)) + min(max(hull.x, hull.y), 0.0);
          float gap = smoothstep(1.6, 1.8, seconds) * (1.0 - smoothstep(12.15, 12.35, seconds));
          float edge = 1.0 / RES_LOGICAL.y;
          float alpha = 1.0 - smoothstep(-edge, edge, mix(exterior, distanceToShape, gap));
          fragColor = vec4(mix(ink, paper, alpha), 1.0);
        }`, { seconds: 0 }, { key: 'rough_cut_shape', blend: false });
    },
    render(ctx) {
      const phase = clamp01(ctx.f.t / 12.4);
      this.shape.set({ seconds: ctx.f.t }).render(ctx.gl, ctx.out, ctx.f.t, ctx.f.dt);

      // A single slow camera breath is the only whole-frame motion. The second,
      // shorter cycle keeps the suspended middle from becoming a frozen plate.
      const breath = 1
        + 0.040 * Math.sin(ctx.f.t * 0.34)
        + 0.012 * Math.sin(ctx.f.t * 0.86 + 0.7)
        + 0.016 * smooth(phase);
      ctx.setXform({
        x: 22 * Math.sin(ctx.f.t * 0.21) + 5 * Math.sin(ctx.f.t * 0.52 + 0.8),
        y: 13 * Math.cos(ctx.f.t * 0.17) + 4 * Math.sin(ctx.f.t * 0.43),
        rot: 0.006 * Math.sin(ctx.f.t * 0.16 + 0.4),
        scale: breath,
        anchor: [ctx.W / 2, ctx.H / 2],
      });
      return { grain: 0, vignette: 0.12, bloom: 0 };
    },
    dispose() {
      this.shape?.dispose();
    },
  };
}
