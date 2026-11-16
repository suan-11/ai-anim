import { TAU } from '../../../src/core/util.js';
// 无缝循环夹具：一切运动周期 = 时长，render(0) === render(时长)。无淡入淡出。
const DUR = 6;
export default {
  id: 'loop-lab',
  render(ctx) {
    const t = ctx.f.t, { W, H, text } = ctx;
    const ph = (t % DUR) / DUR;
    const c = text.ctx;
    text.clear();
    c.fillStyle = '#0a0e14'; c.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    const breathe = 150 + 40 * Math.sin(TAU * ph);
    c.strokeStyle = 'rgba(79,208,255,0.8)'; c.lineWidth = 4;
    c.beginPath(); c.arc(cx, cy, breathe, 0, TAU); c.stroke();
    const a = TAU * ph;
    const dx = cx + breathe * Math.cos(a), dy = cy + breathe * Math.sin(a);
    c.fillStyle = '#4fd0ff'; c.beginPath(); c.arc(dx, dy, 18, 0, TAU); c.fill();
    text.upload();
    ctx.comp.draw(ctx.gl, text, ctx.out, { premult: false });
    return { grain: 0, bloom: 0.1, vignette: 0.2, fade: 0 };
  },
};
