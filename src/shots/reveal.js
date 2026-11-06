// @ts-check
import { mixColor } from '../core/util.js';
import { phase, recoil } from '../kit/action-motion.js';
import { setupStage, stageFrame, core, label, finishStage, describe } from './action-stage.js';

const DEFAULTS = { id: 'reveal', kicker: 'REVEAL / 揭示', title: '让遮挡退开', label: '看见核心', aperture: .72 };
export function revealShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!Number.isFinite(o.aperture) || o.aperture < .35 || o.aperture > 1) throw new Error('reveal: aperture 必须在 0.35..1 内');
  return {
    id: o.id, focus: 'center',
    setup(ctx) { this.bg = setupStage(ctx); },
    render(ctx) {
      const F = stageFrame(ctx, this.bg), { W, H, cx, cy, r } = F;
      const { lines, P, text, f } = ctx;
      const p = f.p, open = phase(p, .10, .64);
      const seam = cy + recoil((p - .10) * 5, 8, 17) * H * .012;
      const gap = open * H * o.aperture * .30 + H * .38 * phase(p,.52,.94);
      const release = phase(p, .57, .89);
      text.clear();
      lines.begin();
      // Core exists behind the shutters throughout; opening changes visibility, not opacity.
      core(lines, cx, cy, r * (.94 + .06 * release), P, 1 + .10 * recoil((p-.39)*6), 1 - .08 * recoil((p-.39)*6));
      const ring = r * (1.35 + .22 * (1 - release));
      lines.circle(cx, cy, ring, 1.5, mixColor(P.ink, P.bone, .24), 96);
      lines.flush(ctx.out);
      label(ctx, o.label, cx, cy + r * 2.02, phase(p, .50, .75), Math.min(H * .030, W * .034));
      text.upload(); ctx.comp.draw(ctx.gl, text, ctx.out, { premult: false }); text.clear();
      // Draw real opaque panels AFTER both core and text: a physical occlusion, not a wipe overlay.
      lines.begin();
      const cover = mixColor(P.ink, P.bone, .052);
      const top = H * .33, bot = F.bottom;
      if (seam - gap > top) lines.fillRect(F.pad, top, W - F.pad*2, seam-gap-top, cover);
      if (seam + gap < bot) lines.fillRect(F.pad, seam+gap, W - F.pad*2, bot-seam-gap, cover);
      const edge = mixColor(P.ink, P.signal, .35 + .5 * Math.sin(Math.PI * open));
      if (seam-gap > top) lines.seg(F.pad, seam-gap, W-F.pad, seam-gap, 3, edge);
      if (seam+gap < bot) lines.seg(F.pad, seam+gap, W-F.pad, seam+gap, 3, edge);
      // Mechanical registration marks follow the panel edge.
      for (const x of [F.pad, W-F.pad]) {
        if (seam-gap > top) lines.seg(x, seam-gap-14, x, seam-gap+14, 2, P.signal);
        if (seam+gap < bot) lines.seg(x, seam+gap-14, x, seam+gap+14, 2, P.signal);
      }
      lines.flush(ctx.out);
      return finishStage(ctx, o, F, phase(p, .14, .56));
    },
  };
}
describe(revealShot, DEFAULTS, { name: 'reveal', summary: '双遮挡板蓄力退开，核心从缝隙中显露，边缘与文字共用动作进度。', use: '揭晓、打开、从遮挡中发现主体', energy: '中', avoid: '持续长时间静置；长段落文字' }, { aperture: '遮挡开口范围，0.35..1' });
