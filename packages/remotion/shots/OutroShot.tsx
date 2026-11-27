/**
 * outro 镜头的 React 实现（对照 src/shots/outro.js）。
 * 细线 0.2→1.6s 从两侧收拢成 520px 下划线 + 每 40px 刻度；
 * 标题按字放大落位（stagger .11 / dur .7 / dist .35）；副标 t-1.2 整行淡入；
 * 签名带 2Hz 闪烁光标；最后 0.6s 压黑收尾（fade 是黑掉的量）。
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { P, SANS, MONO, prog, ease, rgba, glyphEnter } from './common';

export type OutroParams = { title?: string; sub?: string; signature?: string };

const W = 1920, H = 1080;

export const OutroShot: React.FC<{ t: number; dur: number; params: OutroParams }> = ({ t, dur, params }) => {
  const title = params.title ?? '代码即素材';
  const sub = params.sub ?? '';
  const signature = params.signature ?? 'anim · deterministic renderer';

  const k = ease.inOutCubic(prog(t, 0.2, 1.6));
  const half = (W * 0.42) * (1 - k) + 260 * k;
  const y = H * 0.5 + 40;
  const subAlpha = prog(t - 1.2, 0, 0.45);
  const blink = Math.floor(t * 2) % 2 === 0 ? '█' : ' ';
  // fade = 黑掉的量；exposure 同步轻压（近似旧 post）
  const fade = Math.max(0, (t - (dur - 0.6)) / 0.6);
  const exposure = 1 - 0.15 * prog(t, dur - 1.2, dur);

  const ticks = [];
  for (let x = W / 2 - 260; x <= W / 2 + 260; x += 40) {
    const on = k > 0.98 && ((x / 40) | 0) % 2 === 0;
    ticks.push(
      <line key={x} x1={x} y1={y - (on ? 7 : 4)} x2={x} y2={y + (on ? 7 : 4)}
        stroke={on ? P.signal : P.graphite} strokeWidth={1.5} />,
    );
  }

  return (
    <AbsoluteFill style={{ background: P.ink }}>
      <AbsoluteFill style={{ filter: `brightness(${exposure})` }}>
        <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
          <line x1={W / 2 - half} y1={y} x2={W / 2 + half} y2={y} stroke={P.graphite} strokeWidth={2} />
          {ticks}
        </svg>

        {/* 标题：按字放大落位 */}
        <div style={{
          position: 'absolute', left: W / 2, top: H * 0.5 - 40, translate: '-50% -100%',
          fontFamily: SANS, fontSize: 96, fontWeight: 800, color: P.bone,
          display: 'flex', whiteSpace: 'pre',
        }}>
          {Array.from(title).map((ch, i) => {
            const g = glyphEnter(t, i, 0.11, 0.7, 0.35, 'scale', 96);
            return (
              <span key={i} style={{
                display: 'inline-block',
                opacity: g ? g.opacity : 0,
                scale: g ? g.scale : '1.0036',
              }}>{ch}</span>
            );
          })}
        </div>

        <div style={{
          position: 'absolute', left: W / 2, top: y + 84, translate: '-50% -100%',
          fontFamily: MONO, fontSize: 26, letterSpacing: 2, color: P.ash,
          opacity: subAlpha, whiteSpace: 'pre',
        }}>{sub}</div>

        <div style={{
          position: 'absolute', left: W / 2, bottom: 90, translate: '-50% 0px',
          fontFamily: MONO, fontSize: 22, color: rgba(P.signal, 0.75), whiteSpace: 'pre',
        }}>{`${signature}${blink}`}</div>
      </AbsoluteFill>

      {/* 收尾压黑 */}
      <AbsoluteFill style={{ background: '#000', opacity: Math.min(1, fade), pointerEvents: 'none' }} />
    </AbsoluteFill>
  );
};