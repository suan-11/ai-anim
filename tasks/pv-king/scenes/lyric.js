// @ts-check
/**
 * 歌词 PV 场景：**一句歌词 + 一种字幕效果**，不画人物。
 *
 * 与 `txt.js` 的区别：支持多行歌词（长句自动断成两行）、主句日文 + 副句中文对照、
 * 以及「逐字擦亮」按整块算进度（不再按单行算）。
 * 所有效果只依赖 `f.lt`（可 seek / 可子帧），节拍来自 `f.beat` / `f.a`。
 */

import { css, prog, sat, clamp } from '../../../src/core/util.js';
import { Pass } from '../../../src/core/gl.js';

const INK_DARK_BG = [0.95, 0.94, 0.90];
const INK_LIGHT_BG = [0.07, 0.07, 0.08];
const DIM_DARK_BG = [0.55, 0.54, 0.52];
const DIM_LIGHT_BG = [0.52, 0.52, 0.55];

/** 底色亮就写字、底色暗就写白 —— 换风格（bauhaus 是白底）时不用改场景 */
function inkFor(bg) {
  const lum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
  // 白底时"擦亮"用深色（信号黄在白底上等于看不见）；黑底时才用信号色
  return lum > 0.5
    ? { INK: INK_LIGHT_BG, DIM: DIM_LIGHT_BG, LIT: INK_LIGHT_BG }
    : { INK: INK_DARK_BG, DIM: DIM_DARK_BG, LIT: null };
}

function hash(i, j) {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function rgba(rgb, a = 1) {
  const q = (v) => Math.round(clamp(v, 0, 1) * 255);
  return `rgba(${q(rgb[0])},${q(rgb[1])},${q(rgb[2])},${clamp(a, 0, 1)})`;
}

export default {
  id: 'lyric',

  setup(ctx) {
    const Q = ctx.P;
    this.bg = new Pass(ctx.gl, /* glsl */ `
      uniform vec3 cInk, cSig;
      void main() {
        vec2 p = vUv;
        vec3 col = cInk * 0.92;
        col += vec3(0.015) * step(0.5, fract(p.y * 220.0));
        float glow = exp(-pow(length((p - 0.5) * vec2(1.0, 1.5)) * 3.0, 2.0));
        col += cSig * glow * 0.045;
        col *= 1.0 - 0.5 * smoothstep(0.42, 1.1, length((p - 0.5)) * 1.5);
        fragColor = vec4(col, 1.0);
      }`, { cInk: Q.ink, cSig: Q.signal }, { key: 'lyric_bg', blend: false });
  },

  render(ctx) {
    const { f, gl, P: Q, text, type, comp, lines, W, H } = ctx;
    const o = ctx.params ?? {};
    const mode = o.mode ?? 'karaoke';
    const t = f.lt;
    const sig = Q.signal;
    const pump = Math.pow(f.a?.kick ?? 0, 1.6);
    const { INK, DIM, LIT } = inkFor(Q.ink);
    const litColor = LIT ?? sig;
    this.bg.render(gl, ctx.out, f.t, f.dt);

    // 节拍可视化：每拍一道横扫线（用 kick 事件强度驱动），与歌词换行独立
    {
      const k = pump;
      if (k > 0.02) {
        lines.begin();
        const y = H * (0.5 + 0.42 * (1 - k) * (f.beatPhase > 0.5 ? 1 : -1));
        lines.seg(0, y, W, y, 1 + 2 * k, [sig[0], sig[1], sig[2], 0.16 * k]);
        lines.flush(ctx.out);
      }
    }
    // 包豪斯底纹：一根随拍滑动的竖条 + 一个呼吸的圆环（纯几何，不抢字）
    {
      lines.begin();
      const barX = W * (0.12 + 0.03 * Math.sin(f.t * 0.35)) + 26 * pump;
      lines.fillRect(barX, 0, W * 0.022, H, [sig[0], sig[1], sig[2], 0.10 + 0.10 * pump]);
      const cyc = H * 0.34;
      const rr = Math.min(W, H) * (0.24 + 0.02 * pump);
      lines.circle(W * 0.76, cyc, rr, 3, [sig[0], sig[1], sig[2], 0.5], 96);
      lines.flush(ctx.out);
    }
    const c = text.ctx;
    text.clear();
    const weight = o.weight ?? 900;
    const fam = o.family ?? 'sans';
    const main = String(o.text ?? '');
    const sub = String(o.sub ?? '');
    const cx = W / 2;
    const cy = H / 2 - 24;
    const total = Math.max(0.4, f.end - f.start);
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    // 全局随拍微胀（0.6%）：只给"节拍感"，不影响可读性
    const zoom = 1 + 0.006 * pump;
    if (zoom !== 1) { c.save(); c.translate(W / 2, H / 2); c.scale(zoom, zoom); c.translate(-W / 2, -H / 2); }
    const setFont = (px) => { type.font({ size: px, weight, family: fam }); };
    const widthOf = (s, px) => { setFont(px); let w = 0; for (const ch of [...s]) w += c.measureText(ch).width; return w; };

    /** 每行一个 glyph 数组；统一字号（最宽那行决定），块整体居中 */
    const rowsOf = (str, basePx, frac = 0.84) => {
      const raw = str.split('\n').map((s) => s.trim()).filter(Boolean);
      let px = basePx;
      for (const r of raw) {
        const w = widthOf(r, basePx);
        if (w > W * frac) px = Math.min(px, Math.floor((basePx * W * frac) / w));
      }
      return raw.map((r) => {
        setFont(px);
        const chars = [...r];
        const ws = chars.map((ch) => c.measureText(ch).width);
        const sum = ws.reduce((a, b) => a + b, 0);
        let x = cx - sum / 2;
        return chars.map((ch, i) => { const at = x; x += ws[i]; return { ch, x: at }; });
      });
    };
    const rowPx = (rows, gapK = 1.12) => {
      // 行间距：用当前字号（从第一行的字形宽度反推不了字号，所以单独记）
      void rows; void gapK;
      return 0;
    };
    void rowPx;

    const basePx = o.size ?? Math.round(Math.min(W, H) * 0.155);
    const rows = rowsOf(main, basePx, o.frac ?? 0.86);
    // 实际字号：用第一行重新量（rowsOf 内部已设过 font，这里再设一次同样的）
    const pxOf = o.size ?? Math.round(Math.min(W, H) * 0.155);
    let px = pxOf;
    {
      const raw = main.split('\n').map((s) => s.trim()).filter(Boolean);
      for (const r of raw) {
        const w = widthOf(r, pxOf);
        if (w > W * (o.frac ?? 0.86)) px = Math.min(px, Math.floor((pxOf * W * (o.frac ?? 0.86)) / w));
      }
    }
    const lead = px * 1.26;
    const blockTop = cy - ((rows.length - 1) * lead) / 2;

    const fillRows = (color, alpha = 1, dy = 0) => {
      setFont(px);
      c.fillStyle = rgba(color, alpha);
      rows.forEach((glyphs, ri) => {
        for (const g of glyphs) c.fillText(g.ch, g.x, blockTop + ri * lead + dy);
      });
    };
    const strokeRows = (color, lw = 3, alpha = 1) => {
      setFont(px);
      c.lineWidth = lw;
      c.strokeStyle = rgba(color, alpha);
      rows.forEach((glyphs, ri) => {
        for (const g of glyphs) c.strokeText(g.ch, g.x, blockTop + ri * lead);
      });
    };
    /** 整块字符数（擦亮用） */
    const allChars = rows.reduce((a, r) => a + r.length, 0);

    if (mode === 'karaoke') {
      fillRows(DIM);
      const lit = sat(prog(t, 0.15, Math.max(1.0, total * 0.82))) * allChars;
      let acc = 0;
      setFont(px);
      rows.forEach((glyphs, ri) => {
        glyphs.forEach((g) => {
          const on = sat(lit - acc);
          acc += 1;
          if (on > 0) { c.fillStyle = rgba(litColor, on); c.fillText(g.ch, g.x, blockTop + ri * lead); }
        });
      });
    } else if (mode === 'mask') {
      // 揭示必须快（≤0.42s）：歌词要"到句就看得见"，不能半句都在擦
      const reveal = sat(prog(t, 0.02, Math.min(0.42, total * 0.35)));
      c.save();
      c.beginPath(); c.rect(0, 0, W * reveal, H); c.clip();
      fillRows(INK);
      c.restore();
      if (reveal < 0.999) {
        lines.begin();
        lines.seg(W * reveal, H * 0.18, W * reveal, H * 0.82, 3, [sig[0], sig[1], sig[2], 0.8]);
        lines.flush(ctx.out);
      }
    } else if (mode === 'outline') {
      const fillK = sat(prog(t, 0.7, 1.5));
      strokeRows(INK, 3);
      if (fillK > 0) fillRows(INK, fillK * 0.94);
    } else if (mode === 'split') {
      const off = (1 - sat(prog(t, 0.05, 0.45))) * px * 0.8;
      c.save(); c.beginPath(); c.rect(0, 0, W, cy); c.clip();
      c.translate(-off, 0); fillRows(INK); c.restore();
      c.save(); c.beginPath(); c.rect(0, cy, W, H - cy); c.clip();
      c.translate(off, 0); fillRows(sig); c.restore();
    } else if (mode === 'stack') {
      for (let i = 6; i >= 1; i--) fillRows(INK, 0.09 / i, i * (5 + 9 * (1 - sat(t / total))));
      fillRows(INK);
    } else if (mode === 'glitch') {
      const g = Math.floor(f.t * 12);
      const dx = (hash(g, 1) - 0.5) * 14;
      const dy = (hash(g, 2) - 0.5) * 7;
      c.globalAlpha = 0.8;
      c.save(); c.translate(dx, dy); fillRows(sig); c.restore();
      c.save(); c.translate(-dx * 0.6, -dy); fillRows([0.3, 0.9, 1.0]); c.restore();
      c.globalAlpha = 1;
      fillRows(INK);
      for (let i = 0; i < 2; i++) {
        const y0 = cy - px * 0.6 + i * px * 0.6;
        const off = (hash(g, 10 + i) - 0.5) * 34 * (0.4 + pump);
        c.save(); c.beginPath(); c.rect(0, y0, W, px * 0.6); c.clip();
        c.translate(off, 0); fillRows(sig, 0.85); c.restore();
      }
    } else if (mode === 'vertical') {
      // 竖排：整块按高度贴合（短句专用）
      const chars = [...main.replace(/\n/g, ' ')];
      const px2 = Math.max(26, Math.min(Math.round(pxOf * 0.9), Math.floor((H * 0.78) / (chars.length * 1.1))));
      setFont(px2);
      const top = cy - ((chars.length - 1) * px2 * 1.06) / 2;
      chars.forEach((ch, i) => {
        const p = sat(prog(t, 0.06 + i * 0.06, 0.45 + i * 0.06));
        c.fillStyle = rgba(i % 4 === 3 ? sig : INK, p);
        c.fillText(ch, cx - px2 * 0.5, top + i * px2 * 1.06 - (1 - p) * 40);
      });
    } else if (mode === 'ticker') {
      const b = 1 + 0.04 * pump;
      c.save(); c.translate(cx, cy); c.scale(b, b); c.translate(-cx, -cy - 24);
      fillRows(INK);
      c.restore();
      const px3 = Math.round(px * 0.2);
      type.font({ size: px3, weight: 600, family: 'mono' });
      const strip = o.ticker ?? 'KATTACHI INAI NE · 分かっちゃいないね · ';
      const wS = c.measureText(strip).width;
      const x0 = -((t * 120) % wS);
      c.fillStyle = rgba(sig, 0.7);
      for (let x = x0; x < W; x += wS) c.fillText(strip, x, H - 84);
    } else if (mode === 'interlude') {
      // 空拍段（间奏）：**不是空场** —— 三样跟拍的东西填满画面
      //   ① 中间一条随拍推进的刻度尺（每拍一格）
      //   ② 罗马音标题缓慢横移（慢于字幕，像底噪）
      //   ③ 左下三根能量条（kick / snare / hat）
      const beatIdx = Math.floor(f.beat);
      const phase = f.beatPhase;
      lines.begin();
      const yMid = cy;
      lines.seg(W * 0.08, yMid, W * 0.92, yMid, 1.2, [0.5, 0.49, 0.47, 0.5]);
      for (let i = -14; i <= 14; i++) {
        const x = cx + i * (W * 0.028) + (1 - phase) * (W * 0.028);
        const major = (beatIdx + i) % 4 === 0;
        const h = major ? 22 : 10;
        lines.seg(x, yMid - h, x, yMid + h, major ? 2 : 1, [sig[0], sig[1], sig[2], major ? 0.75 : 0.35]);
      }
      // 能量条
      const bars = [['kick', sig], ['snare', [0.9, 0.85, 0.7]], ['hat', [0.35, 0.8, 1.0]]];
      bars.forEach(([k, col], i) => {
        const v = Math.min(1, (f.a?.[k] ?? 0) * 1.6);
        const bw = W * 0.009;
        const x = W * 0.09 + i * (bw * 1.9);
        const y0 = H * 0.88;
        const hh = Math.max(8, H * 0.2 * v);
        lines.fillRect(x, y0 - hh, bw, hh, [col[0], col[1], col[2], 0.9]);
      });
      lines.flush(ctx.out);
      // 罗马音标题慢移（一条，缓慢横穿）
      const px4 = Math.round(pxOf * 0.26);
      type.font({ size: px4, weight: 700, family: 'mono' });
      const label = o.label ?? 'KATTACHI INAI NE · 分かっちゃいないね';
      const lw = c.measureText(label).width;
      const lx = W + 40 - ((t / total) * (W + lw + 80) + 40);
      c.fillStyle = rgba([0.78, 0.77, 0.74], 0.55);
      c.fillText(label, lx, yMid - pxOf * 0.9);
      // 中间一个「间奏」小标（信号色）
      const px5 = Math.round(pxOf * 0.18);
      type.font({ size: px5, weight: 600, family: 'mono' });
      const tag = 'INTERLUDE';
      c.fillStyle = rgba(sig, 0.75);
      c.fillText(tag, cx - c.measureText(tag).width / 2, yMid + pxOf * 0.62);
    } else {
      fillRows(INK);
    }

    // 中文对照：底部居中（竖排时挪左下）
    if (sub) {
      const subPxBase = Math.round(px * 0.30);
      let subPx = subPxBase;
      const w = widthOf(sub, subPxBase);
      if (w > W * 0.78) subPx = Math.floor((subPxBase * W * 0.78) / w);
      type.font({ size: subPx, weight: 500, family: fam });
      c.fillStyle = rgba([0.62, 0.61, 0.59], sat(prog(t, 0.35, 0.95)));
      const sw = c.measureText(sub).width;
      // 中文对照固定在画面下方（歌词视频的惯例：位置不随句长漂移）
      if (mode === 'vertical') c.fillText(sub, 110, H - 90);
      else c.fillText(sub, cx - sw / 2, H - 138);
    }

    if (zoom !== 1) c.restore();
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    void css;
    // 错误色（色差 ca）：每拍随 kick 抖一下；glitch 段更狠。
    // ⚠ post 的 ca 与 radialBlur 二选一（这里不用径向模糊），见 docs/ENGINE.md §8。
    const caBase = mode === 'glitch' ? 0.85 : mode === 'split' ? 0.45 : 0.22;
    // 片门晃动 + 曝光闪烁 + 呼吸推近：让**每一帧都在变**（事件密度判据要的是帧间差，
    // 白底大字静止 3 秒就成"静帧"）。三者都只吃 t，不破确定性。
    return {
      bloom: 0.26 + 0.22 * pump,
      grain: 0.028,
      vignette: 0.5,
      ca: caBase + 0.45 * pump,
      weave: 1.6,
      flicker: 0.18,
      zoom: 1.028 + 0.012 * Math.sin(f.t * 0.55),
    };
  },
};
