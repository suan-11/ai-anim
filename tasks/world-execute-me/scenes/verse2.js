// @ts-check
/** verse2 1:13.4-1:43 — 生物之爱四连 + F/M S/M 镜像 + trance
 *  LRC/ASR: eggplant 74.04, nutrients 77.08, tomato 77.70, antioxidants 81.02,
 *  tabby cat 81.37, enjoyment 84.36, god 85.13, existence 88.14,
 *  gender 88.78, F/M 90.34(90.60/91.54), whatever 92.13, AM/PM 94.09(94.30/95.22),
 *  role 95.78, S/M 97.72(98.08/99.00), trance 101.35(101.66/102.62)。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { keywordBurst, drawVibrations, TERM } from './_kit.js';

export default makeShot('verse2', {
  setup() { this.cam = makeCinematic(); },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const t = f.t;
    text.clear();
    lines.begin();
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
      const purple = [0.42, 0.16, 0.65];
      const neckX = cx + 64 * grow, neckY = cy - 122 * grow;
      lines.seg(cx - 56 * grow, cy + 58 * grow, neckX, neckY, 122 * grow, withAlpha(purple, 0.48 * fade));
      lines.fillCircle(cx - 56 * grow, cy + 58 * grow, 92 * grow, withAlpha(purple, 0.48 * fade));
      lines.fillCircle(neckX, neckY, 48 * grow, withAlpha(TERM.green, 0.34 * fade));
      const n = 6, r = 80 + 148 * grow;
      for (let i = 0; i < n; i++) {
        const spin = -Math.PI / 2 + (t - PH[0].start) * 0.55;
        const a1 = (i / n) * Math.PI * 2 + spin;
        const a2 = ((i + 1) / n) * Math.PI * 2 + spin;
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
      lines.fillCircle(cx, cy, 138 * grow, withAlpha([0.8, 0.12, 0.1], 0.48 * fade));
      for (let i = -1; i <= 1; i++) {
        lines.seg(cx, cy - 120 * grow, cx + i * 54 * grow, cy - (150 - Math.abs(i) * 47) * grow,
          12 * grow, withAlpha(TERM.green, fade * 0.7));
      }
      for (let ring = 0; ring < 3; ring++) {
        const r = 74 + ring * (54 + 38 * grow);
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
      const cs = 54, lh = cs * 1.08;
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
      branch(cx, H * 0.8, -Math.PI / 2, 148, 0);
      lines.fillCircle(cx, H * 0.8, 8, withAlpha(TERM.red, 0.8 * fade));
    }

    // 同一组寄存器依次切换身份、时间、角色，最后把信号送进 trance。
    if (t > 88.78) {
      const a = smoothstep(88.78, 89.3, t) * (1 - smoothstep(101.45, 102.65, t));
      const controls = [
        { label: 'GENDER', values: ['F', 'M'], at: 91.54, from: 88.78 },
        { label: 'CLOCK', values: ['AM', 'PM'], at: 95.22, from: 92.13 },
        { label: 'ROLE', values: ['S', 'M'], at: 99.0, from: 95.78 },
      ];
      const transfer = smoothstep(99.58, 102.6, t);
      const active = t < 92.13 ? 0 : t < 95.78 ? 1 : 2;
      const rail = W * 0.16;
      lines.seg(rail, cy, W - rail, cy, 2, withAlpha(TERM.grid, a * 0.75));
      for (let i = 0; i < controls.length; i++) {
        const { label, values, at, from } = controls[i];
        const x = W * (0.25 + 0.25 * i) + (cx - W * (0.25 + 0.25 * i)) * transfer;
        const w = 290 * (1 - 0.68 * transfer);
        const h = 268 * (1 - 0.55 * transfer);
        const flip = smoothstep(at - 0.30, at + 0.30, t);
        const level = a * (i === active ? 1 : 0.36);
        const color = i === active ? TERM.green : TERM.dim;
        lines.fillRect(x - w / 2, cy - h / 2, w, h, withAlpha(color, level * 0.14));
        lines.rect(x - w / 2, cy - h / 2, w, h, 2, withAlpha(color, level * 0.66));
        for (let j = 0; j < 9; j++) {
          const cellX = x - w * 0.41 + j * w * 0.092;
          lines.fillRect(cellX, cy + h * 0.34, w * 0.07, 9,
            withAlpha(j / 8 <= flip ? TERM.amber : color, level * 0.45));
        }
        const selected = t < at ? values[0] : values[1];
        const glyph = t >= from ? selected : '—';
        type.write(label, x, cy - h * 0.26, { size: 22, family: 'mono', color: css(color, level * (1 - transfer)), align: 'center' });
        type.write(glyph, x, cy + 22, { size: Math.round(62 * (0.55 + 0.45 * Math.abs(1 - 2 * flip))),
          weight: 800, family: 'mono', color: css(TERM.white, level * (1 - transfer)), align: 'center' });
      }
      const packet = (t - 88.78) * 0.55 % 1;
      lines.fillRect(rail + (W - 2 * rail) * packet - 9, cy - 4, 18, 8, withAlpha(TERM.amber, a * 0.85));
    }
    if (t > 101.35) drawVibrations(ctx);

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
      { a: 88.78, b: 92.13, s: t < 91.54 ? '> me.gender = F;' : '> me.gender = M;' },
      { a: 92.13, b: 94.09, s: '> world.doWhatever();  // AM -> PM' },
      { a: 94.09, b: 95.78, s: '> world.schedule(AM, PM);' },
      { a: 95.78, b: 99.58, s: t < 99.0 ? '> me.role = S;' : '> me.role = M;' },
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
