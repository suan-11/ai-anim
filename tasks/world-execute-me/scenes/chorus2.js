// @ts-check
/** chorus2 1:42.9-2:05 — VIBRATIONS→COMPLETION→you have left×6→ISOLATION→FRAGMENTS
 *  LRC/ASR: vibrations 106.14, completion 110.26, you have left 110.92/112.33/113.25/114.18/115.08/116.03,
 *  isolation ~117.0, fragments 121.52。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { keywordBurst, drawVibrations, makeFragments, drawFragmentDebris, glitchTear, TERM } from './_kit.js';

export default makeShot('chorus2', {
  setup() {
    this.cam = makeCinematic();
    this.frags = makeFragments();
  },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const t = f.t;
    text.clear();
    lines.begin();
    const cx = W * 0.5, cy = H * 0.48;

    if (t < 108.55) drawVibrations(ctx);

    // 波纹收束进闭环，闭合后由六个连接点接手。
    const compT = t - 108.16;
    if (compT > 0 && t < 112.16) {
      const ca = smoothstep(0, 0.8, compT) * (1 - smoothstep(110.92, 112.16, t));
      const closeP = 0.10 + 0.9 * smoothstep(0, 2.4, compT);
      const radius = 260 - 75 * smoothstep(0, 2.4, compT);
      const arcEnd = Math.PI * 2 * closeP - Math.PI / 2;
      lines.circle(cx, cy, radius, 2, withAlpha(TERM.grid, ca * 0.58));
      for (let a = -Math.PI / 2; a < arcEnd; a += 0.045) {
        lines.circle(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, 3, 2, withAlpha(TERM.amber, ca * 0.7));
      }
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3 - Math.PI / 2;
        const level = ca * smoothstep(i / 6 - 0.02, i / 6 + 0.12, closeP);
        const x = cx + Math.cos(angle) * radius, y = cy + Math.sin(angle) * radius;
        lines.seg(cx, cy, x, y, 2, withAlpha(TERM.amber, level * 0.25));
        lines.fillCircle(x, y, 8, withAlpha(TERM.amber, level * 0.65));
      }
      lines.fillCircle(cx + Math.cos(arcEnd) * radius, cy + Math.sin(arcEnd) * radius, 8, withAlpha(TERM.white, ca * 0.85));
    }

    // you have left ×6：LRC 110.92/112.33/113.25/114.18/115.08/116.03
    const LEFT_T = [110.92, 112.33, 113.25, 114.18, 115.08, 116.03];
    const leftT = t - LEFT_T[0];
    if (t > 110.26 && t < 117.95) {
      const elements = [
        'dimension', 'circumference', 'tangents', 'limitations', 'nutrients', 'existence',
      ];
      const deleteCount = LEFT_T.filter((lt2) => t >= lt2).length;
      const a = smoothstep(110.26, 110.88, t) * (1 - smoothstep(116.48, 117.95, t));
      for (let i = 0; i < elements.length; i++) {
        const age = t - LEFT_T[i];
        const cut = smoothstep(0, 0.42, age);
        const active = age < 0;
        const sign = i < 3 ? -1 : 1;
        const x = cx + sign * (W * 0.27 + 45 * cut);
        const y = cy + (i % 3 - 1) * H * 0.17;
        const color = active ? TERM.green : TERM.red;
        const level = a * (active ? 0.9 : 0.16 + 0.78 * (1 - cut));
        const edge = x - sign * 150;
        lines.seg(cx, cy, cx, y, 2, withAlpha(color, level * 0.23 * (1 - cut)));
        lines.seg(cx, y, edge, y, 3, withAlpha(color, level * 0.5 * (1 - cut)));
        lines.fillRect(x - 150, y - 48, 300, 96, withAlpha(color, level * 0.14));
        lines.rect(x - 150, y - 48, 300, 96, 2, withAlpha(color, level * 0.7));
        type.write(elements[i], x, y + 7, { size: 24, family: 'mono', color: css(color, level), align: 'center' });
        if (active) {
          const pulseX = cx + (edge - cx) * ((t * 0.8 + i / 6) % 1);
          lines.fillRect(pulseX - 6, y - 3, 12, 6, withAlpha(color, level));
        } else {
          lines.seg(x - 124, y + 1, x - 124 + 248 * cut, y + 1, 3, withAlpha(color, level));
        }
      }
      lines.fillCircle(cx, cy, 14 + (6 - deleteCount) * 5, withAlpha(TERM.amber, a * 0.6));
      const lastDel = LEFT_T[deleteCount - 1];
      if (lastDel != null && t - lastDel < 0.2 && deleteCount < 6) glitchTear(ctx, t, 0.5 * Math.exp(-(t - lastDel) / 0.08), 20 + deleteCount);
    }

    // ISOLATION：唱点 ~117.0
    const isoT = t - 117.0;
    if (isoT > 0 && isoT < 4) {
      const ia = smoothstep(0, 0.6, isoT);
      const cursorOn = Math.sin(t * 4) > 0;
      if (cursorOn) lines.fillRect(cx - 5, cy - 12, 10, 24, withAlpha(TERM.green, ia * 0.8));
      type.write('me', cx, cy + 30, { size: 16, family: 'mono', color: css(TERM.dim, ia * 0.4), align: 'center' });
      for (let x = 200; x < W - 200; x += 120) lines.seg(x, 150, x, H - 150, 0.3, withAlpha(TERM.grid, ia * 0.05));
    }

    if (t > 119.22) drawFragmentDebris(ctx, this.frags);

    // erase fragments：117.6 起漂浮的代码碎片，119.22 唱词起逐条红划线删除
    if (t > 117.6 && t < 124.97) {
      for (const fr of this.frags) {
        const dEl = t - fr.removedAt;
        const fx = fr.x * W, fy = fr.y * H;
        if (dEl < 0) {
          const drift = Math.sin(t * 0.7 + fr.x * 20) * 8;
          type.write(fr.label, fx, fy + drift, { size: 18, family: 'mono', color: css(TERM.dim, 0.55), align: 'left' });
        } else {
          const k = 1 - smoothstep(0.24, 0.75, dEl);
          const fw = type.measure(fr.label, { size: 18, family: 'mono' });
          type.write(fr.label, fx, fy, { size: 18, family: 'mono', color: css(TERM.dim, 0.55 * k), align: 'left' });
          lines.seg(fx - 4, fy - 6, fx + fw * Math.min(1, dEl / 0.25), fy - 6, 2, withAlpha(TERM.red, 0.9 * k));
        }
      }
      const erT = t - 119.22;
      if (erT > 0) {
        const es = '> me.erase(fragments);';
        const ec = Math.min(es.length, Math.floor(erT * 40));
        type.write(es.slice(0, ec), cx, H * 0.8, { size: 26, family: 'mono', color: css(TERM.green, 0.9), align: 'center' });
      }
      if (t > 122.97) {
        const s2 = 'if (fragments.empty) you.stay();  // please';
        const c2 = Math.min(s2.length, Math.floor((t - 122.97) * 40));
        type.write(s2.slice(0, c2), cx, H * 0.8 + 40, { size: 22, family: 'mono', color: css(TERM.amber, 0.85), align: 'center' });
      }
    }

    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    lines.flush(ctx.out);
    text.clear();
    const kws = [
      { t: 106.14, word: 'VIBRATIONS', col: TERM.green },
      { t: 110.26, word: 'COMPLETION', col: TERM.amber },
      { t: 117.0, word: 'ISOLATION', col: TERM.dim },
      { t: 121.52, word: 'FRAGMENTS', col: TERM.dim },
    ];
    let kwImpact = 0;
    for (const kw of kws) {
      const kp = (t - kw.t) / 1.8;
      if (kp > 0 && kp < 1) {
        keywordBurst(ctx, kw.word, cx, H * 0.12, kp, { size: 72, color: kw.col, glitch: kw.word === 'ISOLATION' ? 0 : 0.3, dur: 1.8 });
        kwImpact = Math.max(kwImpact, Math.exp(-(t - kw.t) / 0.12) * 0.5);
      }
    }
    if (leftT > 0) {
      for (const lt2 of LEFT_T) {
        if (t >= lt2) kwImpact = Math.max(kwImpact, Math.exp(-(t - lt2) / 0.08) * 0.35);
      }
    }
    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    return this.cam.post(ctx, { impact: kwImpact, bloomBase: 0.05 });
  },
});
