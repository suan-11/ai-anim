// @ts-check
/** chorus1 0:58.8-1:14 — STIMULATIONS→SATISFACTION→EXECUTION→trapped SIMULATION
 *  LRC/ASR: stimulations 62.04, satisfaction 65.72, execute 69.42, trapped 70.32/71.26, simulation 72.98。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { keywordBurst, scanlines, makeParticles, drawParticles, glitchTear, TERM } from './_kit.js';

export default makeShot('chorus1', {
  setup() {
    this.cam = makeCinematic();
    this.rain = makeParticles(55, 150, 'rain');
  },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const t = f.t;
    const lt = t - 58.8;
    gl.clear(ctx.out, TERM.bg);
    text.clear();
    lines.begin();
    scanlines(ctx, t, 0.05);

    // stimulation 粒子雨：59.4 "If I can" 起，62.04 关键词
    if (lt < 6) {
      drawParticles(ctx, this.rain, lt, { x: W * 0.5, y: 0 }, 0, 0.6 * (1 - smoothstep(4, 6, lt)));
    }

    // satisfaction 双波形共振：63.86 起
    const resT = t - 63.86;
    if (resT > 0 && resT < 5) {
      const ra = smoothstep(0, 0.6, resT) * (1 - smoothstep(3.5, 5, resT));
      for (let x = 100; x < W - 100; x += 3) {
        const u = (x - 100) / (W - 200);
        const y1 = H * 0.45 + Math.sin(u * 12 + t * 4) * 60 * ra;
        const y2 = H * 0.55 + Math.sin(u * 12 - t * 4 + Math.PI) * 60 * ra;
        lines.circle(x, y1, 1.5, 1, withAlpha(TERM.green, ra * 0.7));
        lines.circle(x, y2, 1.5, 1, withAlpha(TERM.amber, ra * 0.7));
        if (Math.abs(y1 - y2) < 30) lines.seg(x, y1, x, y2, 0.5, withAlpha(TERM.white, ra * 0.3));
      }
    }

    // EXECUTION 故障爆发：唱点 69.42
    const execT = t - 69.42;
    if (execT > 0 && execT < 4) {
      const ep = execT / 4;
      glitchTear(ctx, t, Math.max(0, 1 - execT * 2.8) * 0.9 + (1 - ep) * 0.15, 13);
      const delCount = Math.min(8, 3 + Math.floor(ep * 5));
      for (let i = 0; i < delCount; i++) {
        const dy = H * 0.25 + i * 36;
        lines.seg(W * 0.15, dy, W * 0.85, dy, 2, withAlpha(TERM.red, 0.6 * (1 - ep)));
      }
      const flash = Math.exp(-execT / 0.12);
      if (flash > 0.02) lines.fillRect(0, 0, W, H, withAlpha([1, 1, 1], flash * 0.35));
    }

    // trapped 网格锁死：唱点 70.32 "Though we are trapped"
    const trapT = t - 70.32;
    if (trapT > 0) {
      const ta = smoothstep(0, 0.8, trapT);
      const gridSize = 60;
      for (let x = W * 0.2; x < W * 0.8; x += gridSize) lines.seg(x, H * 0.2, x, H * 0.8, 1.5, withAlpha(TERM.grid, ta * 0.6));
      for (let y = H * 0.2; y < H * 0.8; y += gridSize) lines.seg(W * 0.2, y, W * 0.8, y, 1.5, withAlpha(TERM.grid, ta * 0.6));
      const lockPulse = 0.5 + 0.5 * Math.sin(t * 3);
      lines.rect(W * 0.5 - 30, H * 0.5 - 30, 60, 60, 2, withAlpha(TERM.red, ta * (0.5 + 0.3 * lockPulse)));
      type.write('me', W * 0.5, H * 0.5 + 6, { size: 20, family: 'mono', color: css(TERM.red, ta * 0.8), align: 'center' });
    }

    // 底部代码叙事：与唱词逐句对齐（if → satisfaction → execution → catch trapped）
    const NARR = [
      { t: 59.4, s: 'if (me.canGive(you, ALL_STIMULATIONS)) {', c: TERM.green },
      { t: 63.86, s: '  me.be(yourOnlySatisfaction);', c: TERM.green },
      { t: 66.62, s: '  if (you.happy) me.run(EXECUTION);', c: TERM.amber },
      { t: 70.32, s: '} catch (TrappedException e) {', c: TERM.red },
    ];
    for (let i = 0; i < NARR.length; i++) {
      const el = t - NARR[i].t;
      if (el < 0) break;
      const chars = Math.min(NARR[i].s.length, Math.floor(el * 45));
      type.write(NARR[i].s.slice(0, chars), W * 0.14, H * 0.74 + i * 34, { size: 22, family: 'mono', color: css(NARR[i].c, 0.9), align: 'left' });
      if (chars < NARR[i].s.length && Math.sin(t * 8) > 0) {
        const cw = type.measure(NARR[i].s.slice(0, chars), { size: 22, family: 'mono' });
        lines.fillRect(W * 0.14 + cw + 3, H * 0.74 + i * 34 - 18, 10, 22, withAlpha(NARR[i].c, 0.8));
      }
    }

    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    lines.flush(ctx.out);
    text.clear();
    const kws = [
      { t: 62.04, word: 'STIMULATIONS', col: TERM.green },
      { t: 65.72, word: 'SATISFACTION', col: TERM.amber },
      { t: 69.42, word: 'EXECUTION', col: TERM.red },
      { t: 72.98, word: 'SIMULATION', col: TERM.dim },
    ];
    let kwImpact = 0;
    for (const kw of kws) {
      const isExec = kw.word === 'EXECUTION';
      const dur = isExec ? 1.8 : 1.5;
      const kp = (t - kw.t) / dur;
      if (kp > 0 && kp < 1) {
        keywordBurst(ctx, kw.word, W * 0.5, isExec ? H * 0.5 : H * 0.15, kp,
          { size: isExec ? 128 : 80, color: kw.col, glitch: isExec ? 0.9 : 0.25, dur });
        kwImpact = Math.max(kwImpact, Math.exp(-(t - kw.t) / 0.12) * (isExec ? 1 : 0.5));
      }
    }
    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });

    const impact = Math.max(kwImpact, execT > 0 && execT < 3 ? (1 - execT / 3) * 0.6 : 0);
    return this.cam.post(ctx, { impact, bloomBase: 0.1 });
  },
});
