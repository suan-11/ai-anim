/**
 * kinetic 镜头的 React 实现（对照 src/shots/kinetic.js）。
 * 两行大字逐字上浮 + 字距收紧；副标 1.6→3.2s 逐字擦出；
 * 左下 8×5 计数器阵列（rng(31) 确定性相位）；四角取景框 0.9→2.0s 张开。
 * 背景 fbm 等高线用 SVG feTurbulence 近似（有意差异，记录在交接页）。
 */
import React, { useMemo } from 'react';
import { AbsoluteFill } from 'remotion';
import { P, SANS, MONO, prog, ease, rng, rgba, glyphEnter } from './common';

export type KineticParams = {
  headline?: [string, string] | string[]; sub?: string;
  cellCols?: number; cellRows?: number; cellSeed?: number;
};

const W = 1920, H = 1080;

export const KineticShot: React.FC<{ t: number; params: KineticParams }> = ({ t, params }) => {
  const headline = params.headline ?? ['每一帧', '都是时间的函数'];
  const sub = params.sub ?? '';
  const cols = params.cellCols ?? 8;
  const rows = params.cellRows ?? 5;
  const seed = params.cellSeed ?? 31;

  // 确定性相位：与旧模板 setup 里 rng(cellSeed) 同流（useMemo 只算一次，值不随帧变）
  const cells = useMemo(() => {
    const r = rng(seed);
    return Array.from({ length: cols * rows }, () => r());
  }, [cols, rows, seed]);

  const tight = -6 + 10 * (1 - ease.outCubic(prog(t, 0.2, 2.2)));
  const size1 = 170;
  const x = W * 0.5;
  const y1 = H * 0.42;
  const y2 = y1 + size1 * 1.06;
  const typed = Math.floor(ease.outCubic(prog(t, 1.6, 3.2)) * sub.length);
  const k = ease.outExpo(prog(t, 0.9, 2.0));
  const m = 70 + (1 - k) * 120;
  const arm = 90 * k;

  const line = (text: string, y: number, tOff: number) => (
    <div style={{
      position: 'absolute', left: x, top: y, translate: '-50% -100%',
      fontFamily: SANS, fontSize: size1, fontWeight: 900, color: P.bone,
      letterSpacing: tight, display: 'flex', whiteSpace: 'pre',
    }}>
      {Array.from(text).map((ch, i) => {
        const g = glyphEnter(t - tOff, i, 0.12, 0.8, 90, 'up', size1);
        return (
          <span key={i} style={{
            display: 'inline-block',
            opacity: g ? g.opacity : 0,
            translate: g ? g.translate : '0px 90px',
          }}>{ch}</span>
        );
      })}
    </div>
  );

  return (
    <AbsoluteFill style={{ background: P.ink }}>
      {/* 背景：暗底 + 信号色等高线（feTurbulence → 离散色阶提取细线）+ 中心暖光 */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="kin-contours" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.004 0.006" numOctaves={4} seed={11} result="n" />
            {/* R 通道灰度（alpha 恒 1）→ table 三角波折叠出多条等高线带 */}
            <feColorMatrix in="n" type="matrix"
              values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1" result="g" />
            <feComponentTransfer in="g" result="bands">
              <feFuncR type="table" tableValues="0 0 0.9 0 0 0 0.9 0 0" />
              <feFuncG type="table" tableValues="0 0 0.9 0 0 0 0.9 0 0" />
              <feFuncB type="table" tableValues="0 0 0.9 0 0 0 0.9 0 0" />
            </feComponentTransfer>
            {/* 染成信号色：RGB 常量、alpha 取自带的亮度（压低到细线感） */}
            <feColorMatrix in="bands" type="matrix"
              values="0 0 0 0 1  0 0 0 0 0.30  0 0 0 0 0.07  0.4 0 0 0 0" />
          </filter>
          <radialGradient id="kin-glow" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor={P.signal} stopOpacity={0.10} />
            <stop offset="100%" stopColor={P.signal} stopOpacity={0} />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill={P.ink} />
        <rect width={W} height={H} filter="url(#kin-contours)" opacity={0.6} />
        <rect width={W} height={H} fill="url(#kin-glow)" />
      </svg>

      {/* 计数器阵列 */}
      {cells.map((phase, i) => {
        const cx = 60 + (i % cols) * 26;
        const cy = 60 + Math.floor(i / cols) * 26;
        const v = Math.floor((t * 37 * (0.4 + phase) + i * 13) % 1000);
        const a = 0.06 + 0.1 * phase * (0.5 + 0.5 * Math.sin(t * 1.3 + i));
        return (
          <div key={i} style={{
            position: 'absolute', left: cx, top: cy, translate: '0px -100%',
            fontFamily: MONO, fontSize: 22, color: rgba(P.signal, a), whiteSpace: 'pre',
          }}>{String(v).padStart(3, '0')}</div>
        );
      })}

      {line(headline[0] ?? '', y1, 0)}
      {line(headline[1] ?? '', y2, 0.35)}

      {/* 副标：逐字擦出 */}
      <div style={{
        position: 'absolute', left: x, top: y2 + 96, translate: '-50% -100%',
        fontFamily: MONO, fontSize: 26, letterSpacing: 8, color: rgba(P.signal, 0.9), whiteSpace: 'pre',
      }}>{sub.slice(0, typed)}</div>

      {/* 四角取景框 */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        {([[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const).map(([cx, cy, sx, sy], i) => (
          <g key={i} stroke={P.signal} strokeWidth={2.5}>
            <line x1={cx} y1={cy} x2={cx + arm * sx} y2={cy} />
            <line x1={cx} y1={cy} x2={cx} y2={cy + arm * sy} />
          </g>
        ))}
      </svg>
    </AbsoluteFill>
  );
};