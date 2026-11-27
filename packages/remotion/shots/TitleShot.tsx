/**
 * title 镜头的 React 实现（对照 src/shots/title.js）。
 * 内容/节奏参数全部来自任务配置；动画时刻与旧模板逐字一致：
 *   眉标 0.15→1.4s 逐字打出；主标 t-0.5 起逐字上浮（stagger .075 / dur .7 / dist 70）；
 *   横线 0.35→1.9s outExpo 生长 + 24 根刻度；副标 t-1.6 整行淡入（.45s）；
 *   右下读数 0.4→3.4s 走到 100%。
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { P, SANS, MONO, prog, ease, pulse, rgba, glyphEnter } from './common';
import { PostFx } from './PostFx';

export type TitleParams = {
  eyebrow?: string; title?: string; sub?: string; readout?: boolean;
};

const W = 1920, H = 1080;

export const TitleShot: React.FC<{ t: number; params: TitleParams }> = ({ t, params }) => {
  const eyebrow = params.eyebrow ?? 'ANIM / CODE-RENDERED MOTION';
  const title = params.title ?? '写代码，就是做动画';
  const sub = params.sub ?? '';
  const readout = params.readout !== false;

  const y = H * 0.62;
  const x0 = W * 0.12, x1 = W * 0.88;
  const grow = ease.outExpo(prog(t, 0.35, 1.9));
  const breath = 1 + 0.004 * Math.sin(t * 2.4);
  const typed = Math.floor(prog(t, 0.15, 1.4) * eyebrow.length);
  const pct = Math.round(prog(t, 0.4, 3.4) * 100);
  const subAlpha = prog(t - 1.6, 0, 0.45);
  // 旧模板 post.flash = pulse(t,4,.05)*.06：一层极轻的全屏暖闪
  const flash = pulse(t, 4, 0.05) * 0.06;

  const ticks = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const k = i / N;
    const x = x0 + (x1 - x0) * k;
    const lit = Math.min(1, Math.max(0, (grow - k) * 30));
    const hh = (i % 4 === 0 ? 22 : 11) * lit;
    ticks.push(
      <line key={i} x1={x} y1={y - hh} x2={x} y2={y + hh}
        stroke={rgba(P.bone, lit)} strokeWidth={i % 4 === 0 ? 2.4 : 1.4} />,
    );
  }

  return (
    <AbsoluteFill style={{ background: P.ink }}>
      {/* 背景：径向渐变 + 60px 细网格 + 中心一点信号色暖光（近似 demo_title_bg shader） */}
      <AbsoluteFill style={{
        background: `radial-gradient(ellipse 120% 100% at 50% 52%, ${P.ink2} 0%, ${P.ink} 78%)`,
      }} />
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <pattern id="title-grid" width={60} height={60} patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke={rgba(P.graphite, 0.5)} strokeWidth={1} />
          </pattern>
          <radialGradient id="title-grid-fade" cx="50%" cy="52%" r="75%">
            <stop offset="0%" stopColor="white" stopOpacity={0.9} />
            <stop offset="100%" stopColor="white" stopOpacity={0.12} />
          </radialGradient>
          <mask id="title-grid-mask"><rect width={W} height={H} fill="url(#title-grid-fade)" /></mask>
        </defs>
        <rect width={W} height={H} fill="url(#title-grid)" mask="url(#title-grid-mask)" />
        <rect width={W} height={H} fill={rgba(P.signal, 0.05)}
          style={{ mixBlendMode: 'screen' }} mask="url(#title-grid-mask)" opacity={0.6} />
      </svg>

      {/* 生长的横线 + 刻度 */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        <line x1={x0} y1={y} x2={x0 + (x1 - x0) * grow} y2={y} stroke={P.signal} strokeWidth={3.5} />
        {ticks}
      </svg>

      {/* 眉标：等宽逐字打出 */}
      <div style={{
        position: 'absolute', left: x0, top: H * 0.30, translate: '0px -100%',
        fontFamily: MONO, fontSize: 26, letterSpacing: 6, color: rgba(P.signal, 0.95),
        whiteSpace: 'pre',
      }}>{eyebrow.slice(0, typed)}</div>

      {/* 主标题：逐字上浮 */}
      <div style={{
        position: 'absolute', left: x0, top: H * 0.46 * breath, translate: '0px -100%',
        fontFamily: SANS, fontSize: 128, fontWeight: 800, color: P.bone,
        display: 'flex', whiteSpace: 'pre',
      }}>
        {Array.from(title).map((ch, i) => {
          const g = glyphEnter(t - 0.5, i, 0.075, 0.7, 70, 'up', 128);
          return (
            <span key={i} style={{
              display: 'inline-block',
              opacity: g ? g.opacity : 0,
              translate: g ? g.translate : '0px 70px',
            }}>{ch}</span>
          );
        })}
      </div>

      {/* 副标：整行淡入 */}
      <div style={{
        position: 'absolute', left: x0, top: y + 96, translate: '0px -100%',
        fontFamily: MONO, fontSize: 30, letterSpacing: 1, color: P.ash,
        opacity: subAlpha, whiteSpace: 'pre',
      }}>{sub}</div>

      {/* 右下读数 */}
      {readout ? (
        <div style={{
          position: 'absolute', right: 90, bottom: 90,
          fontFamily: MONO, fontSize: 34, color: rgba(P.signal, 0.8), whiteSpace: 'pre',
        }}>{`${String(pct).padStart(3, ' ')}%`}</div>
      ) : null}

      {/* 极轻暖闪（对应 post.flash） */}
      <AbsoluteFill style={{ background: rgba(P.ember, flash), pointerEvents: 'none' }} />
      {/* 后处理：暗角 + 颗粒（旧引擎 post.vignette/grain 的 Remotion 等价） */}
      <PostFx vignette={0.4} noise={0.032} noiseSeed={7} />
    </AbsoluteFill>
  );
};