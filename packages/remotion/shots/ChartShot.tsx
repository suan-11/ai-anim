/**
 * chart 镜头的 React 实现（对照 src/shots/chart.js）。
 * 纸面底 + 坐标轴 + 逐条生长的排线柱体 + 扫描线与跟随读数。
 * 动画时刻与旧模板逐字一致：柱 i 从 0.35+i*0.13 起 0.9s outCubic；
 * 扫描线 1.6→4.4s；底部结论 t-3.2 整行淡入（.45s）；标题 t-0.1 逐字（stagger .03, from none）。
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { P, SANS, MONO, prog, ease, sat, rgba } from './common';

export type ChartParams = {
  values?: number[]; title?: string; sub?: string; footer?: string; peak?: number;
};

const W = 1920, H = 1080;

export const ChartShot: React.FC<{ t: number; params: ChartParams }> = ({ t, params }) => {
  const values = params.values ?? [0.18, 0.34, 0.27, 0.52, 0.44, 0.71, 0.63, 0.88, 0.79, 0.95, 0.86, 1.0];
  const title = params.title ?? '';
  const sub = params.sub ?? '';
  const footer = params.footer ?? '';
  const peak = params.peak ?? 0.95;

  // print 风格：暗底 → 纸面用 bone、墨字用 ink（chart.js lightBg 判定同式）
  const paperCol = P.bone;
  const inkCol = P.ink;

  const L = W * 0.12, R = W * 0.92, B = H * 0.80, T = H * 0.24;
  const n = values.length;
  const slot = (R - L) / n;
  const bw = slot * 0.55;
  const scan = prog(t, 1.6, 4.4);
  const sx = L + (R - L) * scan;
  const idx = Math.min(n - 1, Math.max(0, Math.floor(scan * n)));
  const footerAlpha = prog(t - 3.2, 0, 0.45);

  const bars = values.map((v, i) => {
    const x = L + slot * (i + 0.5) - bw / 2;
    const start = 0.35 + i * 0.13;
    const k = ease.outCubic(prog(t, start, start + 0.9));
    const hh = (B - T) * v * k;
    const y = B - hh;
    const isMax = v >= peak;
    const col = isMax ? P.signal : inkCol;
    const nl = Math.max(1, Math.round(v * 7));
    const hatch = [];
    for (let j = 1; j <= nl; j++) {
      const yy = y + (hh * j) / (nl + 1);
      hatch.push(<line key={j} x1={x + 3} y1={yy} x2={x + bw - 3} y2={yy} stroke={rgba(col, 0.5)} strokeWidth={1} />);
    }
    const pop = 1 + 0.5 * Math.exp(-Math.max(0, t - (start + 0.9)) * 6);
    return (
      <g key={i}>
        <rect x={x} y={y} width={bw} height={hh} fill="none" stroke={col} strokeWidth={isMax ? 3 : 2} />
        {hatch}
        {k > 0.98 ? (
          <line x1={x - 6 * pop} y1={y} x2={x + bw + 6 * pop} y2={y}
            stroke={isMax ? P.signal : paperCol} strokeWidth={3} />
        ) : null}
        <line x1={L + slot * (i + 0.5)} y1={B} x2={L + slot * (i + 0.5)} y2={B + 8} stroke={inkCol} strokeWidth={1} />
      </g>
    );
  });

  const gridLines = [];
  const yLabels = [];
  for (let i = 0; i <= 4; i++) {
    const k = i / 4;
    const y = B - (B - T) * k;
    gridLines.push(<line key={i} x1={L - 14} y1={y} x2={R} y2={y} stroke={inkCol} strokeWidth={1} />);
    yLabels.push(
      <div key={i} style={{
        position: 'absolute', left: L - 26, top: y + 6, translate: '-100% -100%',
        fontFamily: MONO, fontSize: 19, color: rgba(inkCol, 0.5),
      }}>{Math.round(k * 100)}</div>,
    );
  }

  return (
    <AbsoluteFill style={{ background: paperCol }}>
      {/* 纸面：轻噪声 + 28 条横格线 + 四角压暗（近似 demo_chart_paper shader） */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="chart-paper-noise">
            <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves={2} seed={7} result="n" />
            <feColorMatrix in="n" type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.06 0" />
            <feComposite operator="over" in2="SourceGraphic" />
          </filter>
          <radialGradient id="chart-vignette" cx="50%" cy="50%" r="80%">
            <stop offset="55%" stopColor="black" stopOpacity={0} />
            <stop offset="100%" stopColor="black" stopOpacity={0.35} />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill={paperCol} filter="url(#chart-paper-noise)" />
        {Array.from({ length: 28 }, (_, i) => {
          const y = ((i + 0.5) / 28) * H;
          return <line key={i} x1={0} y1={y} x2={W} y2={y} stroke={rgba(P.ash, 0.25)} strokeWidth={1} />;
        })}
        <rect width={W} height={H} fill="url(#chart-vignette)" />
      </svg>

      {/* 坐标轴 / 刻度 / 柱体 / 扫描线 */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        <line x1={L} y1={T} x2={L} y2={B} stroke={inkCol} strokeWidth={2} />
        <line x1={L} y1={B} x2={R} y2={B} stroke={inkCol} strokeWidth={2} />
        {gridLines}
        {bars}
        <line x1={sx} y1={T - 10} x2={sx} y2={B + 14} stroke={P.signal} strokeWidth={2} />
      </svg>

      {/* 标题：逐字入场（from none = 只淡入） */}
      <div style={{
        position: 'absolute', left: L, top: T - 46, translate: '0px -100%',
        fontFamily: SANS, fontSize: 44, fontWeight: 700, color: inkCol,
        display: 'flex', whiteSpace: 'pre',
      }}>
        {Array.from(title).map((ch, i) => {
          const k = sat((t - 0.1 - i * 0.03) / 0.45);
          return <span key={i} style={{ opacity: ease.outCubic(k) }}>{ch}</span>;
        })}
      </div>
      <div style={{
        position: 'absolute', left: L, top: T - 14, translate: '0px -100%',
        fontFamily: MONO, fontSize: 20, letterSpacing: 4, color: rgba(inkCol, 0.55), whiteSpace: 'pre',
      }}>{sub}</div>

      {/* 跟随扫描线的读数 */}
      <div style={{
        position: 'absolute', left: R, top: T - 46, translate: '-100% -100%',
        fontFamily: MONO, fontSize: 58, fontWeight: 800, color: P.signal, whiteSpace: 'pre',
      }}>{`${(values[idx] * 100).toFixed(1)}%`}</div>

      {yLabels}

      {/* 底部结论 */}
      <div style={{
        position: 'absolute', left: W / 2, top: H * 0.92, translate: '-50% -100%',
        fontFamily: SANS, fontSize: 30, fontWeight: 500, color: rgba(inkCol, 0.8),
        opacity: footerAlpha, whiteSpace: 'pre',
      }}>{footer}</div>
    </AbsoluteFill>
  );
};