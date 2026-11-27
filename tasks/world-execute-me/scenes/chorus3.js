// @ts-check
/** chorus3 2:42.6-2:57 — 递归 execution → return null → StackOverflowError → trapped
 *  ASR: give them all execution 165.44, only execution 169.02, have you back execution 172.84,
 *  trapped 173.54。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { keywordBurst, scanlines, glitchTear, glitchColor, TERM } from './_kit.js';

export default makeShot('chorus3', {
  setup() { this.cam = makeCinematic(); },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const t = f.t;
    const lt = t - 161.4;
    gl.clear(ctx.out, TERM.bg);
    text.clear();
    lines.begin();
    scanlines(ctx, t, 0.05);
    const cx = W * 0.5, cy = H * 0.48;

    // recursive execution 调用栈：162.08 起，更大更快铺满画面
    if (lt < 6) {
      const depth = Math.min(8, Math.floor(lt / 0.5));
      const fadeOut = 1 - smoothstep(4.5, 6, lt);
      for (let i = 0; i <= depth; i++) {
        const inset = i * 42;
        const a = smoothstep(i * 0.5, i * 0.5 + 0.3, lt) * fadeOut;
        const rw = 1160 - inset * 2, rh = 640 - inset * 2;
        if (rw < 60 || rh < 40) break;
        lines.rect(cx - rw / 2, cy - rh / 2, rw, rh, 2, withAlpha(i === depth ? TERM.red : TERM.green, a * 0.7));
        type.write('execution('.repeat(Math.min(i + 1, 4)) + (i >= 3 ? '…' : '') + ')'.repeat(Math.min(i + 1, 4)), cx - rw / 2 + 16, cy - rh / 2 + 26, { size: 18, family: 'mono', color: css(i === depth ? TERM.red : TERM.green, a * 0.8), align: 'left' });
      }
      type.write('depth: ' + depth, W * 0.88, H * 0.12, { size: 26, family: 'mono', color: css(TERM.amber, 0.85), align: 'right' });
    }

    // have you back → return null：169.66 起
    const retT = t - 169.66;
    if (retT > 0 && retT < 5) {
      const ra = smoothstep(0, 0.4, retT);
      type.write('return you;', cx, cy - 40, { size: 28, family: 'mono', color: css(TERM.green, ra * (1 - smoothstep(2.5, 3.5, retT))), align: 'center' });
      if (retT > 2.5) {
        const na = smoothstep(2.5, 2.8, retT);
        const slam = 1 + 0.35 * Math.exp(-(retT - 2.5) / 0.1);
        const col = glitchColor(retT - 2.5, TERM.white) ?? TERM.white;
        type.write('null', cx, cy + 10, { size: Math.round(56 * slam), weight: 800, family: 'mono', color: css(col, na), align: 'center' });
        lines.rect(cx - 80, cy - 20, 160, 60, 2, withAlpha(TERM.red, na * 0.5));
      }
    }

    // StackOverflowError：EXECUTION 唱点 172.84 引爆 —— 栈迹级联填满画面
    const soT = t - 172.84;
    if (soT > 0) {
      const sa = smoothstep(0, 0.5, soT);
      const stackN = Math.min(30, 6 + Math.floor(soT / 0.12));
      const scroll = (soT * 50) % 30;
      for (let i = 0; i < stackN; i++) {
        const sy = H * 0.08 + i * 30 - scroll;
        if (sy < H * 0.05 || sy > H * 0.95) continue;
        const lx = i % 2 ? W * 0.52 : W * 0.08;
        type.write('at world.runExecution(world.java:' + (142 + i) + ')', lx, sy, { size: 17, family: 'mono', color: css(TERM.red, sa * 0.6), align: 'left' });
      }
      // 满宽故障横幅
      const slam = 1 + 0.4 * Math.exp(-soT / 0.1);
      const col = glitchColor(soT, TERM.white) ?? TERM.white;
      lines.fillRect(0, H * 0.62 - 48, W, 96, withAlpha(TERM.red, sa * 0.25));
      lines.seg(0, H * 0.62 - 48, W, H * 0.62 - 48, 2, withAlpha(TERM.red, sa * 0.7));
      lines.seg(0, H * 0.62 + 48, W, H * 0.62 + 48, 2, withAlpha(TERM.red, sa * 0.7));
      type.write('StackOverflowError', cx, H * 0.62, { size: Math.round(64 * slam), weight: 800, family: 'mono', color: css(col, sa), align: 'center' });
      glitchTear(ctx, t, Math.exp(-soT / 0.2) * 0.8, 60);
      // trapped：173.54，螺旋放大
      if (t > 173.54) {
        const la = smoothstep(173.54, 174.2, t);
        const r = 160;
        for (let a = 0; a < Math.PI * 1.7; a += 0.06) {
          lines.circle(cx + Math.cos(a + t * 0.5) * r, H * 0.82 + Math.sin(a + t * 0.5) * r * 0.4, 2, 1.5, withAlpha(TERM.amber, la * 0.7));
        }
        const ha = t * 0.5 + Math.PI * 1.7;
        const hx = cx + Math.cos(ha) * r, hy = H * 0.82 + Math.sin(ha) * r * 0.4;
        lines.seg(hx, hy, hx - 16, hy - 10, 2.5, withAlpha(TERM.amber, la));
        lines.seg(hx, hy, hx - 16, hy + 10, 2.5, withAlpha(TERM.amber, la));
        type.write('trapped', cx, H * 0.82, { size: 26, family: 'mono', color: css(TERM.amber, la * 0.8), align: 'center' });
      }
    }

    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    lines.flush(ctx.out);
    text.clear();
    const kws = [
      { t: 165.44, word: 'EXECUTION', col: TERM.red },
      { t: 169.02, word: 'EXECUTION', col: TERM.red },
      { t: 172.84, word: 'EXECUTION', col: TERM.red },
    ];
    let kwImpact = 0;
    for (const kw of kws) {
      const kp = (t - kw.t) / 1.5;
      if (kp > 0 && kp < 1) {
        keywordBurst(ctx, kw.word, cx, H * 0.1, kp, { size: 76, color: kw.col, glitch: 0.7, dur: 1.5 });
        kwImpact = Math.max(kwImpact, Math.exp(-(t - kw.t) / 0.12) * 0.8);
      }
    }
    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    const impact = Math.max(kwImpact, soT > 0 && soT < 3 ? Math.exp(-soT / 0.3) * 0.6 : 0);
    return this.cam.post(ctx, { impact, bloomBase: 0.1 });
  },
});
