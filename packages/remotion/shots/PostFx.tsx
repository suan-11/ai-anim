/**
 * ⑧ 后处理层（Remotion 4.0.404 等价实现）。
 *
 * @remotion/effects 包从 4.0.455 才发布，本仓库锁 4.0.404 无法安装。
 * 用 CSS/SVG 等价实现 vignette / noise / glow 三件套，帧驱动、Studio 可编辑：
 *   · vignette：radial-gradient 叠层（与旧引擎 post.vignette 同口径）；
 *   · noise：SVG feTurbulence 静态颗粒（seed 固定 = 确定性，不逐帧闪）；
 *   · glow：drop-shadow filter 作用于信号色元素。
 *
 * 升级 remotion ≥4.0.455 后可换 @remotion/effects 的 vignette()/noise()/glow()
 * 挂 <HtmlInCanvas effects={[...]}>，本组件接口保持不变。
 */
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

export type PostFxProps = {
  /** 暗角强度 0..1 */
  vignette?: number;
  /** 颗粒强度 0..1（静态 seed，确定性） */
  noise?: number;
  /** 颗粒 seed */
  noiseSeed?: number;
};

/** 暗角 + 颗粒叠层（放在 AbsoluteFill 末尾，absolute 定位覆盖全帧）。 */
export const PostFx: React.FC<PostFxProps> = ({ vignette = 0.35, noise = 0.04, noiseSeed = 7 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = interpolate(frame, [0, 0.5 * fps], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <>
      {/* 颗粒：feTurbulence 静态噪声，opacity 随淡入 */}
      {noise > 0 ? (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: noise * fadeIn, pointerEvents: 'none', mixBlendMode: 'overlay' }}>
          <filter id={`postfx-noise-${noiseSeed}`}>
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={noiseSeed} />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter={`url(#postfx-noise-${noiseSeed})`} />
        </svg>
      ) : null}
      {/* 暗角：径向渐变，中心透明边缘压黑 */}
      {vignette > 0 ? (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `radial-gradient(ellipse 75% 70% at 50% 50%, transparent 55%, rgba(0,0,0,${vignette * fadeIn}) 100%)`,
        }} />
      ) : null}
    </>
  );
};

/** 信号色发光：drop-shadow 光晕（替代旧引擎 bloom 对信号色的作用）。 */
export const glowStyle = (color: string, strength = 0.6): React.CSSProperties => ({
  filter: `drop-shadow(0 0 ${8 * strength}px ${color}) drop-shadow(0 0 ${20 * strength}px ${color})`,
});