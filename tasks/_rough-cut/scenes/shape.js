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
        uniform float phase;
        void main() {
          vec2 p = (FRAG_PX - 0.5 * RES_LOGICAL) / RES_LOGICAL.y;
          vec3 ink = vec3(0.025);
          vec3 paper = vec3(0.80);
          float split = smoothstep(0.20, 0.48, phase);
          float returnHome = smoothstep(0.74, 0.98, phase);
          float spread = split * (1.0 - returnHome);
          float grow = smoothstep(0.0, 0.16, phase);
          float alpha = 0.0;

          for (int i = 0; i < 9; i++) {
            float fi = float(i);
            float col = mod(fi, 3.0) - 1.0;
            float row = floor(fi / 3.0) - 1.0;
            vec2 home = vec2(col, row) * 0.24 * split;
            vec2 force = normalize(vec2(col * 0.78 + 0.14, row * 0.66 - 0.08));
            vec2 drift = force * (0.40 + 0.12 * sin(fi * 2.7)) * spread;
            vec2 pos = home + drift;
            float size = mix(0.0, 0.090, grow);
            size *= mix(1.0, 0.82, spread);
            vec2 d = abs(p - pos) - vec2(size);
            float box = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
            float edge = 0.008 + 0.006 * (1.0 - spread);
            alpha = max(alpha, 1.0 - smoothstep(-edge, edge, box));
          }

          // One continuous crease gives the shape a readable axis while the modules separate.
          float crease = 1.0 - smoothstep(0.006, 0.014, abs(p.x + p.y * 0.16));
          alpha = max(alpha, crease * spread * 0.55);
          fragColor = vec4(mix(ink, paper, alpha), 1.0);
        }`, { phase: 0 }, { key: 'rough_cut_shape', blend: false });
    },
    render(ctx) {
      const phase = clamp01(ctx.f.t / 12.4);
      this.shape.set({ phase }).render(ctx.gl, ctx.out, ctx.f.t, ctx.f.dt);

      // A single slow camera breath is the only whole-frame motion.
      const breath = 1 + 0.040 * Math.sin(ctx.f.t * 0.34) + 0.016 * smooth(phase);
      ctx.setXform({
        x: 18 * Math.sin(ctx.f.t * 0.21),
        y: 11 * Math.cos(ctx.f.t * 0.17),
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
