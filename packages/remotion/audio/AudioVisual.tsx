/**
 * 音频可视化（Remotion 原生）：useAudioData + visualizeAudio 驱动频谱条/脉动。
 *
 * 一切以 Remotion 为主：替代旧引擎 f.a.rms / f.beat 的离线分析，
 * 运行时 FFT 取频谱，帧号直接求值，Studio 可编辑条数/颜色/灵敏度。
 */
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, staticFile } from 'remotion';
import { useAudioData, visualizeAudio } from '@remotion/media-utils';

export type AudioBarsProps = {
  /** public/ 下的音频路径或 URL */
  src: string;
  /** 频谱条数（必须 2 的幂：32/64/128） */
  bars?: number;
  /** 显示区域 */
  box?: { x: number; y: number; w: number; h: number };
  color?: string;
  /** 灵敏度（振幅倍率） */
  gain?: number;
  /** 圆角 */
  radius?: number;
};

/** 底部频谱条：每帧 FFT → 条高。useCurrentFrame 只在本组件订阅。 */
export const AudioBars: React.FC<AudioBarsProps> = ({
  src, bars = 32, box = { x: 0, y: 980, w: 1920, h: 100 },
  color = '#ff4d12', gain = 1.6, radius = 3,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const audioData = useAudioData(src.startsWith('http') ? src : staticFile(src));
  if (!audioData) return null;

  const samples = visualizeAudio({
    audioData, frame, fps, numberOfSamples: bars, optimizeFor: 'speed', smoothing: true,
  });
  const bw = box.w / bars;

  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
      {samples.map((v, i) => {
        const h = Math.max(2, Math.min(box.h, v * gain * box.h));
        return (
          <div key={i} style={{
            width: bw - 2, height: h, background: color, borderRadius: radius,
            opacity: interpolate(v, [0, 0.5], [0.35, 0.95], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          }} />
        );
      })}
    </div>
  );
};

export type AudioPulseProps = {
  src: string;
  /** 脉动作用的对象尺寸基准 */
  baseScale?: number;
  /** 脉动幅度 */
  amount?: number;
  children: React.ReactNode;
};

/** 低频脉动包裹器：取前 4 个频段均值驱动 scale（背景呼吸感）。 */
export const AudioPulse: React.FC<AudioPulseProps> = ({ src, baseScale = 1, amount = 0.03, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const audioData = useAudioData(src.startsWith('http') ? src : staticFile(src));
  if (!audioData) return <>{children}</>;

  const samples = visualizeAudio({
    audioData, frame, fps, numberOfSamples: 8, optimizeFor: 'speed', smoothing: true,
  });
  const bass = samples.slice(0, 4).reduce((s, v) => s + v, 0) / 4;
  const scale = baseScale + bass * amount;

  return (
    <div style={{ scale: String(scale), width: '100%', height: '100%' }}>
      {children}
    </div>
  );
};