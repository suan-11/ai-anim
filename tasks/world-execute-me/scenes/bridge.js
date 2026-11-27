// @ts-check
/** bridge 2:04.4-2:25.6 — DISHEARTENED→Challenging God→ILLEGAL ARGUMENTS→碎裂
 *  LRC/ASR: disheartened 124.76, Challenging God 125.56, you have made 128.92, ILLEGAL 130.78。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { keywordBurst, scanlines, makeParticles, drawParticles, glitchTear, glitchColor, TERM } from './_kit.js';

export default makeShot('bridge', {
  setup() {
    this.cam = makeCinematic();
    this.frags = makeParticles(77, 80, 'fall');
  },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const t = f.t;
    const lt = t - 124.37;
    gl.clear(ctx.out, TERM.bg);
    text.clear();
    lines.begin();
    scanlines(ctx, t, 0.05);

    // fragments 碎片飘落（承接 chorus2 的 FRAGMENTS 121.52）
    if (lt < 6) {
      drawParticles(ctx, this.frags, lt + 2, { x: 0, y: 0 }, 0, 0.6 * (1 - smoothstep(4, 6, lt)));
    }

    // disheartened 褪色：唱点 124.76
    const desat = smoothstep(124.76, 128.92, t);
    if (desat > 0.01 && t < 140) {
      lines.fillRect(0, 0, W, H, withAlpha([0.1, 0.1, 0.12], desat * 0.4));
    }

    // try/catch：125.56 "Challenging your God"；密集滚动栈迹 128.92 起填满框
    const errT = t - 125.56;
    if (errT > 0) {
      const ea = smoothstep(0, 0.6, errT);
      const boxX = W * 0.16, boxY = H * 0.18, boxW = W * 0.68, boxH = H * 0.64;
      const shatter = smoothstep(6, 9, errT);
      const live = ea * (1 - shatter);
      if (shatter < 0.99) {
        lines.rect(boxX, boxY, boxW, boxH, 2, withAlpha(TERM.green, live));
        lines.fillRect(boxX, boxY, boxW, 36, withAlpha(TERM.green, live * 0.12));
        type.write('try {', boxX + 24, boxY + 44, { size: 26, family: 'mono', color: css(TERM.green, live), align: 'left' });
        type.write('  me.setOpinion("you are here", false);', boxX + 24, boxY + 84, { size: 24, family: 'mono', color: css(TERM.white, live * 0.8), align: 'left' });
        type.write('} catch (IllegalArgumentException e) {', boxX + 24, boxY + 124, { size: 24, family: 'mono', color: css(TERM.amber, live), align: 'left' });
      }
      if (errT > 3.36) {
        const stackN = Math.min(13, Math.floor((errT - 3.36) / 0.16) + 1);
        for (let i = 0; i < stackN; i++) {
          const sy = boxY + 170 + i * 34;
          if (sy > boxY + boxH - 20) break;
          const sa = smoothstep(3.36 + i * 0.16, 3.5 + i * 0.16, errT) * (1 - shatter);
          type.write(`  at world.announce("God is always true.");  // ${i}`, boxX + 36, sy, { size: 19, family: 'mono', color: css(TERM.red, sa * 0.85), align: 'left' });
        }
        // ILLEGAL ARGUMENTS：满宽故障横幅（唱点 130.78）
        if (t >= 130.78) {
          const slam = 1 + 0.4 * Math.exp(-(t - 130.78) / 0.1);
          const ia = (t < 138 ? 1 : 1 - smoothstep(138, 140, t)) * (1 - shatter);
          const col = glitchColor(t - 130.78, TERM.white) ?? TERM.white;
          lines.fillRect(0, H * 0.8 - 52, W, 104, withAlpha(TERM.red, ia * 0.22));
          lines.seg(0, H * 0.8 - 52, W, H * 0.8 - 52, 2, withAlpha(TERM.red, ia * 0.7));
          lines.seg(0, H * 0.8 + 52, W, H * 0.8 + 52, 2, withAlpha(TERM.red, ia * 0.7));
          type.write('ILLEGAL ARGUMENTS', W * 0.5, H * 0.8, { size: Math.round(72 * slam), weight: 800, family: 'mono', color: css(col, ia), align: 'center' });
        }
      }
      if (shatter > 0.01) {
        const n = 16;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2;
          const dist = shatter * 380;
          const fx = W * 0.5 + Math.cos(ang) * dist;
          const fy = H * 0.5 + Math.sin(ang) * dist;
          lines.seg(fx - 20, fy, fx + 20, fy, 2.5, withAlpha(TERM.red, (1 - shatter) * 0.8));
        }
        glitchTear(ctx, t, shatter * 0.8 * (1 - smoothstep(134.5, 137, t)), 33);
      }
    }

    // crash-dump 滚动错误日志 + RETRY 计数爬升（承接 shatter → breakdown EXECUTION×12，填 134→145.6）
    const crashT = t - 134.0;
    if (crashT > 0 && t < 145.6) {
      const ca = smoothstep(0, 0.5, crashT) * (1 - smoothstep(10.6, 11.6, crashT));
      const scroll = (crashT * 70) % 38;
      for (let i = 0; i < 18; i++) {
        const ly = H * 0.12 + i * 38 - scroll;
        if (ly < H * 0.08 || ly > H * 0.92) continue;
        type.write(`  at world.execute(me.java:${142 + i})`, W * 0.1, ly, { size: 16, family: 'mono', color: css(i % 3 ? TERM.red : TERM.amber, ca * 0.45), align: 'left' });
        type.write('FATAL: "God is always true" violated', W * 0.56, ly, { size: 16, family: 'mono', color: css(TERM.red, ca * 0.35), align: 'left' });
      }
      const retry = Math.min(12, Math.floor(crashT / 0.8) + 1);
      const rp = (crashT % 0.8) / 0.8;
      const rslam = 1 + 0.3 * Math.exp(-rp * 0.8 / 0.1);
      type.write(`RETRY ${retry} / 12`, W * 0.5, H * 0.48, { size: Math.round(76 * rslam), weight: 800, family: 'mono', color: css(TERM.white, ca), align: 'center' });
      lines.fillRect(W * 0.3, H * 0.58, W * 0.4 * (retry / 12), 10, withAlpha(TERM.red, ca * 0.85));
      lines.rect(W * 0.3, H * 0.58, W * 0.4, 10, 1.5, withAlpha(TERM.dim, ca * 0.6));
      glitchTear(ctx, t, ca * (0.3 + 0.5 * (retry / 12)), 33);
    }

    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    lines.flush(ctx.out);
    text.clear();
    const kws = [
      { t: 124.76, word: 'DISHEARTENED', col: TERM.dim },
    ];
    let kwImpact = 0;
    for (const kw of kws) {
      const kp = (t - kw.t) / 1.8;
      if (kp > 0 && kp < 1) {
        keywordBurst(ctx, kw.word, W * 0.5, H * 0.1, kp, { size: 64, color: kw.col, glitch: 0.2, dur: 1.8 });
        kwImpact = Math.max(kwImpact, Math.exp(-(t - kw.t) / 0.12) * 0.4);
      }
    }
    if (t >= 130.78) kwImpact = Math.max(kwImpact, Math.exp(-(t - 130.78) / 0.12));
    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    const crashImpact = crashT > 0 && crashT < 11 ? Math.exp(-(crashT % 0.8) / 0.1) * 0.4 : 0;
    const impact = Math.max(kwImpact, errT > 6 ? smoothstep(6, 8, errT) * 0.6 : 0, crashImpact);
    return this.cam.post(ctx, { impact, bloomBase: 0.08 });
  },
});
