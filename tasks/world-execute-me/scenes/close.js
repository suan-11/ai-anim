// @ts-check
/** close 2:56.6-3:27.5 — LOVE 学习→公式→free/trapped→world.execute(me);
 *  ASR: I've studied 177.20, LOVE 180.18/185.06/187.84/191.68, trapped 190.34,
 *  final Execution 205.54。音乐 207.3 淡尽。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css, rng } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { codeLine, scanlines, TERM } from './_kit.js';

export default makeShot('close', {
  setup() {
    this.cam = makeCinematic();
    const r = rng(53);
    const toks = ['love', 'me', 'you', 'lim', '=', 'free', 'trapped', '{ }'];
    const cols = [TERM.green, TERM.red, TERM.amber, TERM.dim];
    this.loveBlocks = Array.from({ length: 26 }, (_, i) => ({
      x0: 0.1 + r() * 0.8, y0: 0.15 + r() * 0.7, sz: 30 + r() * 50,
      pr: 0.3 + r() * 0.6, ph: r() * Math.PI * 2, a: 0.4 + r() * 0.5,
      token: toks[i % toks.length], col: cols[Math.floor(r() * cols.length)],
    }));
  },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const t = f.t;
    const lt = t - 176.6;
    gl.clear(ctx.out, TERM.bg);
    text.clear();
    lines.begin();
    scanlines(ctx, t, 0.03);
    const conv = smoothstep(195, 204, t);                       // 被困 me 向中心汇聚
    const meX = W * (0.35 + 0.15 * conv), meY = H * (0.6 - 0.1 * conv);

    // 阶段1: I've studied（177.20 起）代码学习动画；182.2 起 question me 应答窗口补空窗
    const studyT = t - 177.20;
    if (studyT > 0 && studyT < 5) {
      const a = smoothstep(0, 0.6, studyT) * (1 - smoothstep(3.8, 5, studyT));
      codeLine(ctx, 'me.learnTopic("love");', W * 0.25, H * 0.3, { size: 24, color: TERM.green, alpha: a, lineNo: 1 });
      codeLine(ctx, 'me.takeExamTopic("love");', W * 0.25, H * 0.3 + 40, { size: 24, color: TERM.green, alpha: a * smoothstep(1.2, 1.8, studyT), lineNo: 2 });
      codeLine(ctx, 'me.getAlgebraicExpression("love");', W * 0.25, H * 0.3 + 80, { size: 24, color: TERM.amber, alpha: a * smoothstep(2.4, 3, studyT), lineNo: 3 });
    }
    // question me / answer all（181.56–185.38 唱词）：问答终端，逐条打字
    const qT = t - 181.56;
    if (qT > 0 && qT < 3.9) {
      const qa = smoothstep(0, 0.4, qT) * (1 - smoothstep(3.3, 3.9, qT));
      const QA = [
        { t: 0.0, s: '> you.question(me);', c: TERM.green },
        { t: 0.7, s: '[answer] all of it.', c: TERM.dim },
        { t: 1.5, s: '> you.question(me, "love");', c: TERM.green },
        { t: 2.2, s: '[answer] love = lim(you->inf) me;', c: TERM.amber },
      ];
      let qy = H * 0.3;
      for (const q of QA) {
        const el = qT - q.t;
        if (el < 0) break;
        const chars = Math.min(q.s.length, Math.floor(el * 45));
        type.write(q.s.slice(0, chars), W * 0.25, qy, { size: 24, family: 'mono', color: css(q.c, qa * 0.92), align: 'left' });
        if (chars < q.s.length && Math.sin(t * 8) > 0) {
          const cw = type.measure(q.s.slice(0, chars), { size: 24, family: 'mono' });
          lines.fillRect(W * 0.25 + cw + 3, qy - 20, 11, 24, withAlpha(q.c, qa * 0.8));
        }
        qy += 40;
      }
    }

    // 阶段2: 爱的代数式（185.38 "I know the algebraic expression of"）
    const eqT = t - 185.38;
    if (eqT > 0 && eqT < 2.4) {
      const ea = smoothstep(0, 0.5, eqT) * (1 - smoothstep(1.8, 2.4, eqT));
      const fs = 48;
      type.write('lim', W * 0.32, H * 0.5, { size: fs, family: 'serif', italic: true, color: css(TERM.white, ea), align: 'center' });
      type.write('you→∞', W * 0.32, H * 0.5 + 36, { size: 22, family: 'mono', color: css(TERM.dim, ea * 0.8), align: 'center' });
      type.write('me', W * 0.48, H * 0.5, { size: fs, family: 'serif', italic: true, color: css(TERM.green, ea), align: 'center' });
      type.write('=', W * 0.56, H * 0.5, { size: fs, family: 'serif', color: css(TERM.white, ea), align: 'center' });
      type.write('love', W * 0.67, H * 0.5, { size: fs, family: 'serif', italic: true, color: css(TERM.red, ea), align: 'center' });
      lines.seg(W * 0.26, H * 0.5 + 12, W * 0.38, H * 0.5 + 12, 2, withAlpha(TERM.white, ea * 0.6));
    }

    // 阶段3: you free / me trapped（188.06 "Though you are free I am trapped"）
    const freeT = t - 188.06;
    if (freeT > 0) {
      const fa = smoothstep(0, 0.5, freeT);
      const meFade = 1 - smoothstep(205.54, 205.9, t);          // 终局执行时 me 退场
      const youX = W * 0.65 + freeT * 40;
      const youY = H * 0.4 - freeT * 20;
      const youA = fa * (1 - smoothstep(1.5, 3, freeT));
      lines.circle(youX, youY, 16, 2, withAlpha(TERM.green, youA));
      type.write('you', youX, youY + 5, { size: 16, family: 'mono', color: css(TERM.green, youA), align: 'center' });
      lines.rect(meX - 24, meY - 24, 48, 48, 2, withAlpha(TERM.red, fa * 0.8 * meFade));
      type.write('me', meX, meY + 5, { size: 16, family: 'mono', color: css(TERM.red, fa * 0.9 * meFade), align: 'center' });
      for (let i = 0; i < 4; i++) {
        const ang = i * Math.PI / 2 + Math.PI / 4;
        lines.seg(meX + Math.cos(ang) * 24, meY + Math.sin(ang) * 24, meX + Math.cos(ang) * 80, meY + Math.sin(ang) * 80, 1, withAlpha(TERM.red, fa * 0.4 * meFade));
      }
      if (freeT > 1 && freeT < 4) {
        const ta = smoothstep(1, 1.6, freeT) * (1 - smoothstep(3, 4, freeT));
        type.write('trapped in love', W * 0.5, H * 0.82, { size: 28, family: 'mono', color: css(TERM.red, ta * 0.7), align: 'center' });
      }
    }

    // 阶段4: world.execute(me); —— 204.5 预览打字，205.54 大字引爆 + 收尾按钮
    const preT = t - 204.5;
    if (preT > 0 && t < 205.54) {
      type.write('world.execute(me);', W * 0.5, H * 0.46, { size: 32, family: 'mono', color: css(TERM.red, smoothstep(0, 0.4, preT) * 0.7), align: 'center' });
    }
    const execT = t - 205.54;
    if (execT > 0) {
      const slam = 1 + 0.5 * Math.exp(-execT / 0.1);
      type.write('world.execute(me);', W * 0.5, H * 0.46, { size: Math.round(64 * slam), weight: 800, family: 'mono', color: css(TERM.red, 1), align: 'center' });
      const flash = Math.exp(-execT / 0.12);
      if (flash > 0.02) {
        lines.fillRect(0, 0, W, H, withAlpha([1, 1, 1], flash * 0.4));
        lines.circle(W * 0.5, H * 0.46, 100 + (1 - flash) * 600, 4, withAlpha(TERM.red, flash * 0.7));
        lines.circle(W * 0.5, H * 0.46, 50 + (1 - flash) * 400, 2, withAlpha(TERM.amber, flash * 0.5));
      }
      if (execT > 0.6) {                                        // 收尾按钮：执行结果
        const ba = smoothstep(0.6, 1.0, execT);
        type.write('> love', W * 0.5, H * 0.6, { size: 44, weight: 700, family: 'mono', color: css(TERM.green, ba), align: 'center' });
        type.write('process exited (0)', W * 0.5, H * 0.68, { size: 20, family: 'mono', color: css(TERM.dim, ba * 0.8), align: 'center' });
      }
    }

    // 被困 me 的牢笼收紧 + love 碎片向 me 汇聚 + 心跳加速（蓄势 195→204.5）
    const gapA = smoothstep(193, 196, t) * (1 - smoothstep(203.5, 204.5, t));
    if (gapA > 0.01) {
      const cageR = 220 - 150 * smoothstep(193, 204, t);
      const ca = gapA * 0.4;
      for (let gx = meX - cageR; gx <= meX + cageR + 1; gx += 40) lines.seg(gx, meY - cageR, gx, meY + cageR, 1, withAlpha(TERM.red, ca * 0.6));
      for (let gy = meY - cageR; gy <= meY + cageR + 1; gy += 40) lines.seg(meX - cageR, gy, meX + cageR, gy, 1, withAlpha(TERM.red, ca * 0.6));
      lines.rect(meX - cageR, meY - cageR, cageR * 2, cageR * 2, 2, withAlpha(TERM.red, ca));
      const hbRate = 1.2 - 0.7 * conv;                          // 心跳随汇聚加速
      const hb = t % hbRate;
      const beat = Math.exp(-hb / 0.1) + (hb > 0.2 * hbRate ? 0.5 * Math.exp(-(hb - 0.2 * hbRate) / 0.1) : 0);
      lines.circle(meX, meY, 30 + beat * 26, 2.5, withAlpha(TERM.red, gapA * beat * 0.7));
      for (const b of this.loveBlocks) {
        const sx = b.x0 * W, sy = b.y0 * H;
        const x = sx + (meX - sx) * conv + 0.02 * Math.sin(t * b.pr + b.ph) * W * (1 - conv);
        const y = sy + (meY - sy) * conv + 0.02 * Math.cos(t * b.pr * 0.8 + b.ph) * H * (1 - conv);
        const a = gapA * b.a * (0.6 + 0.4 * Math.sin(t * b.pr + b.ph));
        if (a <= 0.02) continue;
        lines.fillRect(x - b.sz / 2, y - b.sz * 0.3, b.sz, b.sz * 0.6, withAlpha(b.col, a * 0.4));
        type.write(b.token, x, y + 4, { size: 14, family: 'mono', color: css(b.col, a), align: 'center' });
      }
    }

    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    lines.flush(ctx.out);
    text.clear();
    // LOVE：ASR 180.18 / 185.06 / 187.84 / 191.68
    const loveTimes = [180.18, 185.06, 187.84, 191.68];
    for (const lt2 of loveTimes) {
      const el = t - lt2;
      if (el > 0 && el < 3.4) {
        const la = 0.85 * Math.exp(-el / 2.2);
        const stretch = 1 + 0.12 * Math.sin(Math.min(el / 1.8, 1) * Math.PI);
        type.write('LOVE', W * 0.5, H * 0.12, { size: Math.round(44 * stretch), weight: 300, family: 'serif', italic: true, color: css(TERM.white, la), align: 'center' });
      }
    }
    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    // 终局黑屏盖在所有图层之上（留足收尾按钮展示时间）
    if (execT > 1.2) {
      const fadeOut = smoothstep(1.2, 1.9, execT);
      if (fadeOut > 0.01) {
        lines.begin();
        lines.fillRect(0, 0, W, H, withAlpha([0, 0, 0], fadeOut));
        lines.flush(ctx.out);
      }
    }

    const execImpact = execT > 0 ? Math.exp(-execT / 0.1) * 0.9 : 0;
    return this.cam.post(ctx, { impact: execImpact, bloomBase: 0.05 });
  },
});
