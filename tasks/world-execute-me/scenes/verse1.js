// @ts-check
/** verse1 0:14.8-0:59 — 器奏→数学之爱四连 + AC/DC示波 + dizzy + AD/BC时间轴 + unite
 *  时间来自真实 LRC + ASR。视觉：色块填充 + 几何，不只线条。
 *  DIMENSION 退场右拉成线 → 线变示波器中轴 → AC/DC 波形。 */
import { makeShot, withAlpha } from '../../../src/kit/index.js';
import { sat, smoothstep, css } from '../../../src/core/util.js';
import { makeCinematic } from '../../_shared/cinematic.js';
import { keywordBurst, drawUnionSignal, makeParticles, drawParticles, TERM } from './_kit.js';

export default makeShot('verse1', {
  setup() {
    this.cam = makeCinematic();
    this.genesis = makeParticles(42, 200, 'burst');
  },
  draw(ctx) {
    const { f, lines, text, type, comp, gl, W, H, P } = ctx;
    const t = f.t;
    text.clear();
    lines.begin();
    const cx = W * 0.5, cy = H * 0.48;

    // ── 器奏段 14.8-29.44：模拟运行日志（焦点代码块），色块星云退为背景 ──
    if (t < 29.44) {
      drawParticles(ctx, this.genesis, t - 14.02, { x: cx, y: H * 0.5 }, 600, 0.9);
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.2);
      for (let i = 0; i < 24; i++) {
        const ang = (i / 24) * Math.PI * 2 + t * 0.08;
        const r = 280 + Math.sin(i * 2.3 + t * 0.4) * 90;
        const sz = 14 + Math.sin(i * 1.7) * 8;
        const col = i % 3 === 0 ? TERM.green : i % 3 === 1 ? TERM.amber : TERM.grid;
        lines.fillRect(cx + Math.cos(ang) * r - sz / 2, cy + Math.sin(ang) * r * 0.6 - sz / 2, sz, sz, withAlpha(col, 0.05 + 0.05 * pulse));
      }
      const SIM = [
        { t: 15.2, s: '> world.startSimulation();', c: TERM.green },
        { t: 16.4, s: '[ok] 5 things loaded into world', c: TERM.dim },
        { t: 17.6, s: '> me.observe(you);', c: TERM.green },
        { t: 18.8, s: '[ok] you observed at (0, 0)', c: TERM.dim },
        { t: 20.0, s: '> you.observe(me);', c: TERM.green },
        { t: 21.2, s: '[ok] me observed at (0, 0)', c: TERM.dim },
        { t: 22.4, s: '> me.attract(you);', c: TERM.green },
        { t: 23.6, s: '[force] gravity = love', c: TERM.amber },
        { t: 24.8, s: '> world.tick(dt);', c: TERM.green },
        { t: 26.0, s: '[sim] running  t -> inf', c: TERM.dim },
        { t: 27.2, s: '> me.love(you);  // unconditional', c: TERM.amber },
      ];
      const sx = W * 0.18, sy0 = H * 0.22, lh = 38;
      const cursorOn = Math.sin(t * 6) > 0;
      for (let i = 0; i < SIM.length; i++) {
        const el = t - SIM[i].t;
        if (el < 0) break;
        const chars = Math.min(SIM[i].s.length, Math.floor(el * 45));
        type.write(SIM[i].s.slice(0, chars), sx, sy0 + i * lh, { size: 25, family: 'mono', color: css(SIM[i].c, 0.92), align: 'left' });
        if (chars < SIM[i].s.length && cursorOn) {
          lines.fillRect(sx + chars * 25 * 0.6 + 2, sy0 + i * lh - 20, 11, 24, withAlpha(TERM.green, 0.85));
        }
      }
      // 右侧 INSPECTOR：me/you 对象实况（attract 后靠近，gravity=love 画吸引线）
      const ipA = smoothstep(14.65, 15.45, t) * (1 - smoothstep(28.9, 29.44, t));
      if (ipA > 0) {
        const px = W * 0.60, py = H * 0.20, pw = W * 0.32, ph = H * (0.36 + 0.16 * smoothstep(15.2, 18.8, t));
        lines.fillRect(px, py, pw, ph, withAlpha([0.02, 0.05, 0.04], ipA * 0.5));
        lines.rect(px, py, pw, ph, 1.5, withAlpha(TERM.grid, ipA * 0.9));
        lines.fillRect(px, py, pw, 30, withAlpha(TERM.grid, ipA * 0.35));
        type.write('INSPECTOR · live', px + 14, py + 21, { size: 16, family: 'mono', color: css(TERM.dim, ipA * 0.9), align: 'left' });
        const appr = smoothstep(22.4, 28.5, t);
        const mx = Math.round(-120 + 102 * appr), yx = Math.round(120 - 102 * appr);
        const pcx = px + pw / 2, pcy = py + 110;
        const mX = pcx + mx * 1.6, yX = pcx + yx * 1.6;
        if (t > 22.4) {
          const fa = smoothstep(22.4, 23.2, t) * ipA;
          const fp = 0.5 + 0.5 * Math.sin(t * 4);
          lines.seg(mX, pcy, yX, pcy, 2, withAlpha(TERM.amber, fa * (0.4 + 0.4 * fp)));
          for (let i = 1; i <= 3; i++) {
            const ax = mX + (yX - mX) * (i / 4);
            lines.fillRect(ax - 3, pcy - 8, 6, 16, withAlpha(TERM.amber, fa * 0.3 * fp));
          }
        }
        lines.fillCircle(mX, pcy, 10, withAlpha(TERM.green, ipA * 0.85));
        lines.fillCircle(yX, pcy, 10, withAlpha(TERM.amber, ipA * 0.85));
        type.write('me', mX, pcy - 22, { size: 16, family: 'mono', color: css(TERM.green, ipA * 0.8), align: 'center' });
        type.write('you', yX, pcy - 22, { size: 16, family: 'mono', color: css(TERM.amber, ipA * 0.8), align: 'center' });
        const IROWS = [
          { t: 15.2, s: `me.pos  = (${mx}, 0)`, c: TERM.green },
          { t: 15.2, s: `you.pos = (${yx}, 0)`, c: TERM.amber },
          { t: 23.6, s: 'F = G*love / r^2', c: TERM.amber },
          { t: 24.8, s: `tick  : ${String(Math.max(0, Math.floor((t - 24.8) * 24))).padStart(6, '0')}`, c: TERM.dim },
          { t: 27.2, s: 'me.love(you) -> inf', c: TERM.amber },
        ];
        let iy = py + 210;
        for (const r of IROWS) {
          const el = t - r.t;
          if (el < 0) break;
          const chars = Math.min(r.s.length, Math.floor(el * 45));
          type.write(r.s.slice(0, chars), px + 14, iy, { size: 20, family: 'mono', color: css(r.c, ipA * 0.92), align: 'left' });
          iy += 36;
        }
      }
    } else if (t < 44.48) {
      // ── 数学之爱四连 ──
      const PH = [
        { start: 29.74, peak: 32.74, end: 33.42 },   // DIMENSION
        { start: 33.42, peak: 36.40, end: 37.15 },   // CIRCUMFERENCE
        { start: 37.15, peak: 40.26, end: 40.78 },   // TANGENTS
        { start: 40.78, peak: 43.58, end: 44.48 },   // LIMITATIONS
      ];
      const phase = t < PH[1].start ? 0 : t < PH[2].start ? 1 : t < PH[3].start ? 2 : 3;
      const pu = sat((t - PH[phase].start) / (PH[phase].peak - PH[phase].start));
      // 退场进度：峰值后到下一段起点
      const exit = sat((t - PH[phase].peak) / (PH[phase].end - PH[phase].peak));

      if (phase === 0) {
        // DIMENSION：点集→维度轴→右拉成线（线留下变成示波器中轴）
        const n = 60;
        const collapse = smoothstep(0, 1, exit);
        const pullRight = smoothstep(0, 1, exit);
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2;
          const r0 = 200 + Math.sin(i * 3.7) * 80;
          const spread = (1 - smoothstep(0.2, 0.7, pu)) * (1 - collapse);
          const lineX = (i / n - 0.5) * 600;
          const x = cx + Math.cos(ang) * r0 * spread + (1 - spread) * lineX + pullRight * W * 0.9;
          const y = cy + Math.sin(ang) * r0 * spread * 0.6 * (1 - collapse);
          lines.circle(x, y, 2.5 * (1 - collapse * 0.6), 1, withAlpha(TERM.green, 0.7 * (1 - collapse * 0.5)));
        }
        const aa = smoothstep(0.5, 0.8, pu);
        if (aa > 0 || collapse > 0) {
          const halfW = 300 * aa + collapse * W;
          const shiftX = pullRight * W * 0.9;
          const yAmp = 150 * aa * (1 - collapse);
          lines.seg(cx - halfW + shiftX, cy, cx + halfW + shiftX, cy, 2 + collapse * 1.5, withAlpha(TERM.amber, Math.max(aa, collapse)));
          if (yAmp > 1) lines.seg(cx + shiftX, cy - yAmp, cx + shiftX, cy + yAmp, 2, withAlpha(TERM.amber, aa * 0.6 * (1 - collapse)));
        }
      } else if (phase === 1) {
        // CIRCUMFERENCE：圆→椭圆拉伸，色块填充环
        const r = 150;
        const stretch = smoothstep(0.3, 0.8, pu);
        const fadeOut = 1 - smoothstep(0.6, 1, exit);
        // 填充椭圆（色块）
        const rx = r * (1 + stretch * 1.5), ry = r * (1 - stretch * 0.7);
        lines.fillCircle(cx, cy, Math.min(rx, ry) * 0.85, withAlpha(TERM.green, 0.1 * fadeOut));
        for (let i = 0; i <= 80; i++) {
          const ang = (i / 80) * Math.PI * 2;
          const x = cx + Math.cos(ang) * rx;
          const y = cy + Math.sin(ang) * ry;
          if (i > 0) {
            const pa = ((i - 1) / 80) * Math.PI * 2;
            lines.seg(cx + Math.cos(pa) * rx, cy + Math.sin(pa) * ry, x, y, 2, withAlpha(TERM.green, 0.8 * fadeOut));
          }
        }
        // 圆周标尺刻度（色块小矩形）
        if (stretch > 0.3) {
          for (let i = 0; i < 12; i++) {
            const sx = cx - 350 + i * 63;
            lines.fillRect(sx - 2, cy + 80, 4, 15, withAlpha(TERM.amber, stretch * 0.6 * fadeOut));
          }
        }
      } else if (phase === 2) {
        // TANGENTS：正弦波 + 切线滑动，波下色块填充
        const fadeOut = 1 - smoothstep(0.5, 1, exit);
        for (let x = 100; x < W - 100; x += 3) {
          const u = (x - 100) / (W - 200);
          const y = cy + Math.sin(u * 8 + t * 2) * 100;
          lines.circle(x, y, 1.5, 1, withAlpha(TERM.green, 0.7 * fadeOut));
          // 波到中线之间的色块填充
          if (x % 12 === 0) {
            const h = Math.abs(y - cy);
            lines.fillRect(x - 3, Math.min(y, cy), 6, h, withAlpha(TERM.green, 0.06 * fadeOut));
          }
        }
        const tanU = (pu * 2) % 1;
        const tanX = 100 + tanU * (W - 200);
        const tanY = cy + Math.sin(tanU * 8 + t * 2) * 100;
        const slope = Math.cos(tanU * 8 + t * 2) * 100 * 8 / (W - 200);
        lines.seg(tanX - 120, tanY - slope * 120, tanX + 120, tanY + slope * 120, 2.5, withAlpha(TERM.amber, 0.9 * fadeOut));
        lines.fillCircle(tanX, tanY, 6, withAlpha(TERM.red, 0.8 * fadeOut));
      } else {
        // LIMITATIONS：曲线逼近渐近线，极限框色块
        const fadeOut = 1 - smoothstep(0.5, 1, exit);
        const asymY = cy - 120;
        lines.seg(100, asymY, W - 100, asymY, 1.5, withAlpha(TERM.dim, 0.5 * fadeOut));
        type.write('limit', W - 160, asymY - 10, { size: 16, family: 'mono', color: css(TERM.dim, 0.5 * fadeOut), align: 'right' });
        for (let x = 100; x < W - 100; x += 3) {
          const u = (x - 100) / (W - 200);
          const approach = 1 - Math.exp(-u * 4 * (1 + pu));
          const y = cy + 150 - approach * 270;
          lines.circle(x, y, 1.5, 1, withAlpha(TERM.green, 0.7 * fadeOut));
        }
        if (pu > 0.5) {
          const ba = smoothstep(0.5, 0.8, pu) * fadeOut;
          lines.fillRect(W * 0.6, asymY - 20, W * 0.3, 40, withAlpha(TERM.red, ba * 0.12));
          lines.rect(W * 0.6, asymY - 20, W * 0.3, 40, 1.5, withAlpha(TERM.red, ba * 0.6));
        }
      }
      // 左下公式/代码标注：每相位贴唱词，打字机入场，随退场淡出
      const ANN = [
        { a: 'me.dimension -> you;', b: '// 60 points -> axis' },
        { a: 'C = 2πr', b: 'me.circumference -> you;' },
        { a: 'tangent(x) = dy/dx', b: 'you.sit(me.tangents);' },
        { a: 'lim x->∞  me = you', b: 'you = me.limit;' },
      ];
      const annA = 1 - smoothstep(0.5, 1, exit);
      const annEl = t - PH[phase].start;
      const ann = ANN[phase];
      const ca = Math.min(ann.a.length, Math.max(0, Math.floor(annEl * 30)));
      type.write(ann.a.slice(0, ca), W * 0.12, H * 0.76, { size: 32, family: 'mono', color: css(TERM.green, annA * 0.9), align: 'left' });
      if (annEl > 0.8) {
        const cb = Math.min(ann.b.length, Math.floor((annEl - 0.8) * 30));
        type.write(ann.b.slice(0, cb), W * 0.12, H * 0.76 + 42, { size: 20, family: 'mono', color: css(TERM.dim, annA * 0.8), align: 'left' });
      }
    }

    // ── AC/DC 示波器：44.48 起，DIMENSION 留下的线变成中轴 ──
    if (t > 44.48 && t < 49.78) {
      const scopeX = W * 0.12, scopeY = H * 0.3, scopeW = W * 0.76, scopeH = H * 0.45;
      const scopeA = smoothstep(44.48, 45.2, t) * (1 - smoothstep(48.8, 49.78, t));
      const midY = scopeY + scopeH / 2;
      // 示波器面板底色（色块）
      lines.fillRect(scopeX, scopeY, scopeW, scopeH, withAlpha([0.02, 0.06, 0.04], scopeA * 0.6));
      lines.rect(scopeX, scopeY, scopeW, scopeH, 2, withAlpha(TERM.grid, scopeA * 0.9));
      // 刻度网格
      for (let i = 1; i < 10; i++) {
        const gx = scopeX + (scopeW / 10) * i;
        lines.seg(gx, scopeY, gx, scopeY + scopeH, 0.5, withAlpha(TERM.grid, scopeA * 0.3));
      }
      for (let i = 1; i < 4; i++) {
        const gy = scopeY + (scopeH / 4) * i;
        lines.seg(scopeX, gy, scopeX + scopeW, gy, 0.5, withAlpha(TERM.grid, scopeA * 0.3));
      }
      // 中轴 = DIMENSION 留下的那根线（琥珀→绿过渡）
      const axisCol = t < 45.5 ? TERM.amber : TERM.green;
      lines.seg(scopeX, midY, scopeX + scopeW, midY, 2, withAlpha(axisCol, scopeA * 0.7));
      // AC↔DC 每拍翻转
      const isAC = t < 46.13 ? true : (Math.floor((t - 46.13) / 0.46) % 2 === 0);
      const amp = scopeH * 0.38;
      const cycles = 4;
      for (let x = 0; x <= scopeW; x += 2) {
        const u = x / scopeW;
        let y;
        if (isAC) {
          y = midY - Math.sin(u * cycles * Math.PI * 2 + t * 6) * amp;
        } else {
          const ph = (u * cycles + t * 1.5) % 1;
          const sq = ph < 0.5 ? 1 : -1;
          const edge = Math.min(1, Math.min(ph, 1 - ph) * 40);
          y = midY - sq * amp * edge;
        }
        if (x > 0) {
          const pu2 = (x - 2) / scopeW;
          let py;
          if (isAC) py = midY - Math.sin(pu2 * cycles * Math.PI * 2 + t * 6) * amp;
          else {
            const ph = (pu2 * cycles + t * 1.5) % 1;
            const sq = ph < 0.5 ? 1 : -1;
            const edge = Math.min(1, Math.min(ph, 1 - ph) * 40);
            py = midY - sq * amp * edge;
          }
          lines.seg(scopeX + x - 2, py, scopeX + x, y, 2.5, withAlpha(TERM.green, scopeA * 0.95));
        }
      }
      // 触发标记 + 读数
      lines.seg(scopeX + scopeW * 0.5, scopeY - 8, scopeX + scopeW * 0.5, scopeY + 8, 2, withAlpha(TERM.amber, scopeA));
      type.write(isAC ? 'AC' : 'DC', scopeX + scopeW - 12, scopeY + 28, { size: 36, weight: 800, family: 'mono', color: css(TERM.white, scopeA), align: 'right' });
      type.write(isAC ? '~ 50Hz' : '— 0Hz', scopeX + 12, scopeY + 26, { size: 18, family: 'mono', color: css(TERM.dim, scopeA * 0.8), align: 'left' });
    }

    // ── dizzy：49.78-51.38 旋转色块漩涡 + 画面倾斜 ──
    if (t > 49.78 && t < 51.38) {
      const dz = (t - 49.78) / 1.6;
      const spin = dz * Math.PI * 3;
      ctx.setXform({ scale: 1 + 0.04 * Math.sin(dz * Math.PI * 4), rot: Math.sin(dz * Math.PI * 2) * 0.06, anchor: [cx, cy] });
      // 漩涡色块：两圈反向旋转的方块
      for (let ring = 0; ring < 2; ring++) {
        const n = 10 + ring * 6;
        const r = 120 + ring * 100;
        const dir = ring === 0 ? 1 : -1;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2 + spin * dir;
          const sz = 22 - ring * 6;
          const col = i % 2 === 0 ? TERM.amber : TERM.green;
          const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r * 0.7;
          lines.fillRect(x - sz / 2, y - sz / 2, sz, sz, withAlpha(col, 0.35 * (1 - dz * 0.5)));
        }
      }
      type.write('dizzy', cx, cy, { size: 48, weight: 800, family: 'mono', color: css(TERM.white, 0.7 * (1 - dz)), align: 'center' });
    }

    // ── AD/BC 时间轴：51.38 "Oh we can travel" → 53.48 "To A.D to B.C" ──
    if (t > 51.38 && t < 55.17) {
      const ta = smoothstep(51.38, 52.2, t) * (1 - smoothstep(54.6, 55.17, t));
      const tlY = H * 0.5;
      // 时间轴主线
      lines.seg(W * 0.1, tlY, W * 0.9, tlY, 2, withAlpha(TERM.dim, ta * 0.7));
      // 年份刻度色块
      const years = [-500, -200, 0, 200, 500, 1000, 1500, 2000];
      for (let i = 0; i < years.length; i++) {
        const x = W * 0.1 + (i / (years.length - 1)) * W * 0.8;
        lines.fillRect(x - 2, tlY - 10, 4, 20, withAlpha(TERM.grid, ta * 0.8));
        type.write(String(Math.abs(years[i])), x, tlY + 30, { size: 13, family: 'mono', color: css(TERM.dim, ta * 0.6), align: 'center' });
      }
      // 游标：AD 向右 / BC 向左
      const ad = t < 54.3;
      const travel = sat((t - 53.48) / 0.8);
      const cursorX = ad ? W * 0.5 + travel * W * 0.35 : W * 0.5 - travel * W * 0.35;
      lines.fillCircle(cursorX, tlY, 8, withAlpha(ad ? TERM.green : TERM.amber, ta));
      lines.seg(cursorX, tlY - 40, cursorX, tlY + 40, 2, withAlpha(ad ? TERM.green : TERM.amber, ta * 0.6));
      // 方向箭头色块
      const dir = ad ? 1 : -1;
      for (let i = 0; i < 5; i++) {
        const ax = cursorX + dir * (20 + i * 25);
        lines.fillRect(ax, tlY - 3, 15, 6, withAlpha(ad ? TERM.green : TERM.amber, ta * (0.6 - i * 0.1)));
      }
      type.write(ad ? 'A.D' : 'B.C', cx, H * 0.25, { size: 64, weight: 800, family: 'mono', color: css(TERM.white, ta), align: 'center' });
      type.write(ad ? '→ future' : '← past', cx, H * 0.25 + 50, { size: 20, family: 'mono', color: css(TERM.dim, ta * 0.7), align: 'center' });
      const ts = ad ? 'world.travel(+2000);  // A.D' : 'world.travel(-500);  // B.C';
      const tc = Math.min(ts.length, Math.floor((t - 51.38) * 35));
      type.write(ts.slice(0, tc), cx, H * 0.74, { size: 26, family: 'mono', color: css(TERM.green, ta * 0.9), align: 'center' });
    }

    // 合并后的两颗对象跨镜头展开成双波形。
    if (t > 55.17) drawUnionSignal(ctx);
    if (t > 55.17 && t < 58.8) {
      const fade = 1 - smoothstep(57.8, 58.8, t);
      const us = 'me.unite(you);  // deeply, deeply';
      const uc = Math.min(us.length, Math.floor((t - 55.17) * 35));
      type.write(us.slice(0, uc), cx, H * 0.74, { size: 26, family: 'mono', color: css(TERM.green, fade * 0.9), align: 'center' });
    }

    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    lines.flush(ctx.out);
    text.clear();
    const kws = [
      { t: 32.74, word: 'DIMENSION' }, { t: 36.40, word: 'CIRCUMFERENCE' },
      { t: 40.26, word: 'TANGENTS' }, { t: 43.58, word: 'LIMITATIONS' },
    ];
    let kwImpact = 0;
    for (const kw of kws) {
      const kp = (t - kw.t) / 1.5;
      if (kp > 0 && kp < 1) {
        keywordBurst(ctx, kw.word, cx, H * 0.1, kp, { size: 72, color: TERM.amber, glitch: 0.3, dur: 1.5 });
        kwImpact = Math.max(kwImpact, Math.exp(-(t - kw.t) / 0.12));
      }
    }
    text.upload(); comp.draw(gl, text, ctx.out, { premult: false });
    return this.cam.post(ctx, { impact: kwImpact * 0.5, bloomBase: 0.06 });
  },
});
