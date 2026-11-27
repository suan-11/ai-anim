// @ts-check
/** verse2 1:13.4-1:43 — 生物之爱四连 + F/M S/M 镜像 + trance
 *  LRC/ASR: eggplant 74.04, nutrients 77.08, tomato 77.70, antioxidants 81.02,
 *  tabby cat 81.37, enjoyment 84.36, god 85.13, existence 88.14,
 *  gender 88.78, F/M 90.34(90.60/91.54), whatever 92.13, AM/PM 94.09(94.30/95.22),
 *  role 95.78, S/M 97.72(98.08/99.00), trance 101.35(101.66/102.62)。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { keywordBurst, scanlines, TERM } from './_kit.js';

export default makeShot('verse2', {
  setup() { this.cam = makeCinematic(); },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const t = f.t;
    gl.clear(ctx.out, TERM.bg);
    text.clear();
    lines.begin();
    scanlines(ctx, t, 0.04);
    const cx = W * 0.5, cy = H * 0.48;
    const PH = [
      { start: 74.04, peak: 77.08, end: 77.70 },   // eggplant → NUTRIENTS
      { start: 77.70, peak: 81.02, end: 81.37 },   // tomato → ANTIOXIDANTS
      { start: 81.37, peak: 84.36, end: 85.13 },   // tabby cat → ENJOYMENT
      { start: 85.13, peak: 88.14, end: 88.78 },   // only god → EXISTENCE
    ];
    const phase = t < PH[1].start ? 0 : t < PH[2].start ? 1 : t < PH[3].start ? 2 : 3;
    const pu = sat((t - PH[phase].start) / (PH[phase].peak - PH[phase].start));
    const exit = sat((t - PH[phase].peak) / (PH[phase].end - PH[phase].peak));
    const fade = 1 - smoothstep(0.4, 1, exit);   // 峰值后及时退场

    if (phase === 0) {
      // 茄子：紫色果实色块 + 分子环（营养）
      const grow = smoothstep(0, 0.6, pu);
      lines.fillCircle(cx, cy + 20, 90 * grow, withAlpha([0.35, 0.15, 0.5], 0.35 * fade));
      lines.fillCircle(cx - 30, cy - 10, 40 * grow, withAlpha([0.45, 0.2, 0.6], 0.3 * fade));
      const n = 6, r = 80;
      for (let i = 0; i < n; i++) {
        const a1 = (i / n) * Math.PI * 2 - Math.PI / 2;
        const a2 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
        const x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
        const x2 = cx + Math.cos(a2) * r, y2 = cy + Math.sin(a2) * r;
        lines.seg(x1, y1, x2, y2, 2, withAlpha(TERM.green, 0.8 * fade));
        lines.fillCircle(x1, y1, 6, withAlpha(TERM.amber, 0.7 * fade));
        if (pu > 0.3) {
          const sl = smoothstep(0.3, 0.7, pu) * 50;
          lines.seg(x1, y1, x1 + Math.cos(a1) * sl, y1 + Math.sin(a1) * sl, 1.5, withAlpha(TERM.green, 0.5 * fade));
        }
      }
    } else if (phase === 1) {
      // 番茄：红色果实色块 + 电子轨道（抗氧化剂）
      const grow = smoothstep(0, 0.5, pu);
      lines.fillCircle(cx, cy, 100 * grow, withAlpha([0.7, 0.12, 0.1], 0.3 * fade));
      lines.fillCircle(cx, cy - 60 * grow, 30 * grow, withAlpha([0.2, 0.5, 0.15], 0.4 * fade));  // 蒂
      for (let ring = 0; ring < 3; ring++) {
        const r = 60 + ring * 50;
        const tilt = ring * 0.4 + t * (0.5 + ring * 0.2);
        for (let i = 0; i <= 60; i++) {
          const a = (i / 60) * Math.PI * 2;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r * Math.cos(tilt) * 0.5;
          if (i > 0) {
            const pa = ((i - 1) / 60) * Math.PI * 2;
            lines.seg(cx + Math.cos(pa) * r, cy + Math.sin(pa) * r * Math.cos(tilt) * 0.5, x, y, 1, withAlpha(TERM.green, 0.4 * fade));
          }
        }
        const ea = t * (1 + ring * 0.5) + ring * 2;
        lines.fillCircle(cx + Math.cos(ea) * r, cy + Math.sin(ea) * r * Math.cos(tilt) * 0.5, 5, withAlpha(TERM.red, 0.8 * fade));
      }
      lines.fillCircle(cx, cy, 10, withAlpha(TERM.amber, 0.9 * fade));
      // 番茄红素：11 段共轭双键多烯链（锯齿骨架），电子沿链离域 = 抗氧化
      const chainY = H * 0.76, cx0 = W * 0.22, cx1 = W * 0.78, NV = 23;
      const growC = smoothstep(0.15, 0.75, pu);
      const nb = Math.floor((NV - 1) * growC);
      for (let i = 0; i < nb; i++) {
        const xa = cx0 + (i / (NV - 1)) * (cx1 - cx0);
        const xb = cx0 + ((i + 1) / (NV - 1)) * (cx1 - cx0);
        const ya = chainY + (i % 2 === 0 ? -16 : 16);
        const yb = chainY + ((i + 1) % 2 === 0 ? -16 : 16);
        lines.seg(xa, ya, xb, yb, 2.5, withAlpha(TERM.red, 0.75 * fade));
        if (i % 2 === 0) {
          const oy = ya < chainY ? 6 : -6;
          lines.seg(xa + (xb - xa) * 0.18, ya + oy, xb - (xb - xa) * 0.18, yb + oy, 1.5, withAlpha(TERM.red, 0.55 * fade));
        }
      }
      if (growC > 0.9) {
        for (let e = 0; e < 3; e++) {
          const u = (t * 0.35 + e / 3) % 1;
          const seg = u * (NV - 1);
          const i0 = Math.min(NV - 2, Math.floor(seg)), fr = seg - i0;
          const ya = chainY + (i0 % 2 === 0 ? -16 : 16);
          const yb = chainY + ((i0 + 1) % 2 === 0 ? -16 : 16);
          lines.fillCircle(cx0 + u * (cx1 - cx0), ya + (yb - ya) * fr, 4, withAlpha(TERM.amber, 0.9 * fade));
        }
      }
    } else if (phase === 2) {
      // 虎斑猫：终端 ASCII 字符拼（mono 绿字），逐行打印入场 + 眨眼；不打呼噜
      const CAT = [
        '   /\\_/\\    ',
        '  ( ^.^ )   ',
        '   > ^ <    ',
        '  /|     |\\ ',
        ' (_|     |_)',
        '   |_|_|_|  ',
      ];
      const cs = 46, lh = cs * 1.08;
      const charW = cs * 0.6;                  // mono 字宽≈0.6em
      const x0 = cx - charW * 13 / 2;
      const topY = cy - CAT.length * lh / 2;
      const blink = (t % 2.6) > 2.48;          // 每 ~2.6s 闭眼一瞬（t 纯函数）
      for (let i = 0; i < CAT.length; i++) {
        const la = smoothstep(0.07 * i, 0.07 * i + 0.12, pu) * fade;   // 自上而下打印
        if (la <= 0.01) continue;
        const line = (i === 1 && blink) ? '  ( -.- )   ' : CAT[i];
        type.write(line, x0, topY + i * lh, { size: cs, weight: 700, family: 'mono', color: css(TERM.green, la), align: 'left' });
      }
      // 打印光标：入场未结束前停在行尾闪烁
      if (pu < 0.6 && Math.sin(t * 18) > 0) {
        const printed = Math.min(CAT.length, Math.floor(pu / 0.07) + 1);
        lines.fillRect(x0 + charW * 13, topY + (printed - 1) * lh - cs * 0.7, charW * 0.6, cs, withAlpha(TERM.green, 0.8 * fade));
      }
      // ENJOYMENT 标注（不打呼噜）
      type.write('me.purr();  // for your enjoyment', cx, H * 0.82, { size: 24, family: 'mono', color: css(TERM.green, 0.8 * fade), align: 'center' });
    } else {
      // 神：证明树（色块叶节点）+ 及时退场
      const depth = Math.floor(pu * 5) + 1;
      function branch(x, y, ang, len, d) {
        if (d > depth || len < 8) return;
        const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
        lines.seg(x, y, x2, y2, Math.max(0.5, 3 - d * 0.5), withAlpha(d === depth ? TERM.amber : TERM.green, 0.7 * fade));
        if (d === depth) lines.fillCircle(x2, y2, 5, withAlpha(TERM.amber, 0.6 * fade));
        branch(x2, y2, ang - 0.5, len * 0.7, d + 1);
        branch(x2, y2, ang + 0.5, len * 0.7, d + 1);
      }
      branch(cx, H * 0.8, -Math.PI / 2, 100, 0);
      lines.fillCircle(cx, H * 0.8, 8, withAlpha(TERM.red, 0.8 * fade));
    }

    // F/M 切换：LRC 90.34 "To F to M"；S/M：97.72 "To S to M"
    if ((t > 90.34 && t < 92.13) || (t > 97.72 && t < 99.58)) {
      const base = t < 92.13 ? 90.34 : 97.72;
      const flipT = t - base;
      const scaleX = Math.cos(sat(flipT / 0.9) * Math.PI);
      ctx.setXform({ scale: 1, anchor: [cx, cy] });
      for (let i = 0; i < 5; i++) {
        const fy = H * 0.2 + i * H * 0.15;
        lines.seg(cx - 200 * Math.abs(scaleX), fy, cx + 200 * Math.abs(scaleX), fy, 1, withAlpha(TERM.dim, 0.3));
      }
      type.write(t < 92.13 ? (flipT < 0.9 ? 'F' : 'M') : (flipT < 0.9 ? 'S' : 'M'), cx, H * 0.15, { size: 48, weight: 800, family: 'mono', color: css(TERM.white, 0.9), align: 'center' });
    }
    // AM/PM：LRC 94.09
    if (t > 94.09 && t < 95.78) {
      const ap = t < 94.9 ? 'AM' : 'PM';
      type.write(ap, cx, H * 0.15, { size: 48, weight: 800, family: 'mono', color: css(TERM.white, 0.9), align: 'center' });
      const ang = (t - 94.09) * 4;
      lines.seg(cx, cy, cx + Math.cos(ang) * 80, cy + Math.sin(ang) * 80, 2, withAlpha(TERM.amber, 0.7));
    }
    // trance：LRC 101.35
    if (t > 101.35) {
      const ta = smoothstep(101.35, 102.3, t);
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      lines.circle(cx, cy, 180 + pulse * 30, 3, withAlpha(TERM.red, ta * 0.4 * pulse));
      lines.circle(cx, cy, 220 + pulse * 20, 2, withAlpha(TERM.amber, ta * 0.3));
    }

    // 番茄红素化学式 C40H56（真下标排版）+ 标注
    if (phase === 1) {
      const fa = smoothstep(0.45, 0.7, pu) * fade;
      if (fa > 0.01) {
        const fy = H * 0.88;
        const parts = [
          { s: 'C', size: 40, dy: 0, c: TERM.white },
          { s: '40', size: 24, dy: 12, c: TERM.white },
          { s: 'H', size: 40, dy: 0, c: TERM.white },
          { s: '56', size: 24, dy: 12, c: TERM.white },
          { s: '  lycopene · 番茄红素', size: 22, dy: 0, c: TERM.dim },
        ];
        let tw = 0;
        for (const p of parts) tw += type.measure(p.s, { size: p.size, family: 'mono' });
        let fx = cx - tw / 2;
        for (const p of parts) {
          type.write(p.s, fx, fy + p.dy, { size: p.size, weight: 700, family: 'mono', color: css(p.c, fa), align: 'left' });
          fx += type.measure(p.s, { size: p.size, family: 'mono' });
        }
      }
    }

    // 切换间隙空窗：贴词代码行（gender/whatever/schedule/role/trance）
    const GAP = [
      { a: 88.78, b: 92.13, s: t < 91.24 ? '> me.gender = F;' : '> me.gender = M;' },
      { a: 92.13, b: 94.09, s: '> world.doWhatever();  // AM -> PM' },
      { a: 94.09, b: 95.78, s: '> world.schedule(AM, PM);' },
      { a: 95.78, b: 99.58, s: t < 98.62 ? '> me.role = S;' : '> me.role = M;' },
      { a: 99.58, b: 101.35, s: '> trance.enter(me, you);' },
    ];
    for (const g of GAP) {
      if (t > g.a && t < g.b) {
        const el = t - g.a;
        const chars = Math.min(g.s.length, Math.floor(el * 40));
        type.write(g.s.slice(0, chars), cx, H * 0.72, { size: 26, family: 'mono', color: css(TERM.green, 0.9), align: 'center' });
        if (chars < g.s.length && Math.sin(t * 8) > 0) {
          const cw = type.measure(g.s.slice(0, chars), { size: 26, family: 'mono' });
          lines.fillRect(cx + cw / 2 + 4, H * 0.72 - 22, 12, 26, withAlpha(TERM.green, 0.8));
        }
      }
    }

    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    lines.flush(ctx.out);
    text.clear();
    const kws = [
      { t: 77.08, word: 'NUTRIENTS' }, { t: 81.02, word: 'ANTIOXIDANTS' },
      { t: 84.36, word: 'ENJOYMENT' }, { t: 88.14, word: 'EXISTENCE' },
    ];
    let kwImpact = 0;
    for (const kw of kws) {
      const kp = (t - kw.t) / 1.5;
      if (kp > 0 && kp < 1) {
        keywordBurst(ctx, kw.word, cx, H * 0.14, kp, { size: 68, color: TERM.amber, glitch: 0.25, dur: 1.5 });
        kwImpact = Math.max(kwImpact, Math.exp(-(t - kw.t) / 0.12));
      }
    }
    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    return this.cam.post(ctx, { impact: kwImpact * 0.5, bloomBase: 0.06 });
  },
});
