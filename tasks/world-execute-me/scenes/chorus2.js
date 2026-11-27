// @ts-check
/** chorus2 1:42.9-2:05 — VIBRATIONS→COMPLETION→you have left×6→ISOLATION→FRAGMENTS
 *  LRC/ASR: vibrations 106.14, completion 110.26, you have left 110.92/112.33/113.25/114.18/115.08/116.03,
 *  isolation ~117.0, fragments 121.52。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css, rng } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { keywordBurst, scanlines, glitchTear, TERM } from './_kit.js';

export default makeShot('chorus2', {
  setup() {
    this.cam = makeCinematic();
    const r = rng(77);
    const LABELS = ['fragment_0x3f', 'pointless[0]', 'null', 'undefined', '// TODO: love', 'me.hope', 'NaN', 'void*', 'fragment_0x7a', '/* us */'];
    this.frags = LABELS.map((s, i) => ({ s, x: 0.15 + r() * 0.68, y: 0.22 + r() * 0.5, del: 119.22 + i * 0.36 }));
  },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const t = f.t;
    const lt = t - 102.88;
    gl.clear(ctx.out, TERM.bg);
    text.clear();
    lines.begin();
    scanlines(ctx, t, 0.04);
    const cx = W * 0.5, cy = H * 0.48;

    // vibration 波纹：103.48 "If I can" 起
    if (lt < 5) {
      const va = smoothstep(0, 0.6, lt) * (1 - smoothstep(3.5, 5, lt));
      for (let r = 30; r < 250; r += 25) {
        const wobble = Math.sin(t * 6 + r * 0.1) * 5 * va;
        lines.circle(cx, cy, r + wobble, 1.5, withAlpha(TERM.green, va * 0.5 * (1 - r / 300)));
      }
    }

    // completion 光环闭合：108.16 起
    const compT = t - 108.16;
    if (compT > 0 && compT < 4) {
      const ca = smoothstep(0, 0.8, compT);
      const closeP = smoothstep(0.5, 2.5, compT);
      const arcEnd = Math.PI * 2 * closeP;
      for (let a = 0; a < arcEnd; a += 0.05) {
        lines.circle(cx + Math.cos(a) * 160, cy + Math.sin(a) * 160, 2, 1, withAlpha(TERM.amber, ca * 0.8));
      }
      if (closeP > 0.95) {
        lines.circle(cx, cy, 160, 3, withAlpha(TERM.amber, ca));
        lines.circle(cx, cy, 8, 2, withAlpha(TERM.white, ca));
      }
    }

    // you have left ×6：LRC 110.92/112.33/113.25/114.18/115.08/116.03
    const LEFT_T = [110.92, 112.33, 113.25, 114.18, 115.08, 116.03];
    const leftT = t - LEFT_T[0];
    if (leftT > 0) {
      const elements = [
        { x: cx - 200, y: cy - 100, label: 'dimension' },
        { x: cx + 200, y: cy - 100, label: 'circumference' },
        { x: cx - 200, y: cy + 100, label: 'tangents' },
        { x: cx + 200, y: cy + 100, label: 'limitations' },
        { x: cx, y: cy - 180, label: 'nutrients' },
        { x: cx, y: cy + 180, label: 'existence' },
      ];
      const deleteCount = LEFT_T.filter((lt2) => t >= lt2).length;
      for (let i = 0; i < 6; i++) {
        const el = elements[i];
        if (i < deleteCount) {
          const fadeOut = 1 - smoothstep(0, 0.8, t - LEFT_T[i]);
          if (fadeOut > 0.01) {
            lines.seg(el.x - 30, el.y, el.x + 30, el.y, 2, withAlpha(TERM.red, fadeOut * 0.8));
            type.write(el.label, el.x, el.y + 20, { size: 14, family: 'mono', color: css(TERM.dim, fadeOut * 0.3), align: 'center' });
          }
        } else {
          const pulse = 0.5 + 0.5 * Math.sin(t * 3 + i);
          lines.circle(el.x, el.y, 12, 1.5, withAlpha(TERM.green, 0.5 + 0.2 * pulse));
          type.write(el.label, el.x, el.y + 22, { size: 14, family: 'mono', color: css(TERM.dim, 0.5), align: 'center' });
        }
      }
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

    // erase fragments：117.6 起漂浮的代码碎片，119.22 唱词起逐条红划线删除
    if (t > 117.6 && t < 124.37) {
      for (const fr of this.frags) {
        const dEl = t - fr.del;
        const fx = fr.x * W, fy = fr.y * H;
        if (dEl < 0) {
          const drift = Math.sin(t * 0.7 + fr.x * 20) * 8;
          type.write(fr.s, fx, fy + drift, { size: 18, family: 'mono', color: css(TERM.dim, 0.55), align: 'left' });
        } else if (dEl < 0.6) {
          const k = 1 - dEl / 0.6;
          const fw = type.measure(fr.s, { size: 18, family: 'mono' });
          type.write(fr.s, fx, fy, { size: 18, family: 'mono', color: css(TERM.dim, 0.55 * k), align: 'left' });
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
