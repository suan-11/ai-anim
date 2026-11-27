/**
 * Remotion 音乐层：帧驱动音量曲线 + 旁白闪避 + 切点 SFX。
 *
 * 一切以 Remotion 为主（remotion-markup/audio.md 契约）：
 *   · <Audio> 来自 @remotion/media，volume 用内联 interpolate（Studio 显示音量曲线可编辑）；
 *   · 闪避 = 读旁白时间戳，说话窗口配乐压到 duckLevel，说完 attack/release 恢复；
 *   · 切点 whoosh = <Sequence from={cutFrame}> 定位 + 短包络；
 *   · 音量组件独立（useCurrentFrame 只在最小订阅者里），不拖累整棵合成树。
 *
 * 与旧引擎 mix.mjs 的关系：旧引擎离线把闪避烘进 ja-mix.mp3；
 * Remotion 侧改为**运行时曲线**——同一条 bed + vo 分轨进来，闪避由帧号实时算，
 * Studio 里能直接看到/调音量关键帧。已烘好的 mix 仍可用（bypassDuck）。
 */
import React from 'react';
import { Audio } from '@remotion/media';
import { Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { resolveMedia } from '../media-assets';

export type NarrationWindow = { start: number; end: number };

export type MusicLayerProps = {
  /** 配乐 src（staticFile 路径或 URL） */
  musicSrc: string;
  /** 旁白 src（可选；有它才做闪避） */
  voSrc?: string;
  /** 旁白时间窗（秒），用于闪避配乐 */
  windows?: NarrationWindow[];
  /** 说话时配乐压到的电平（0..1），默认 0.22 ≈ -13dB */
  duckLevel?: number;
  /** 闪避 attack / release 秒数 */
  attack?: number;
  release?: number;
  /** 全片淡入 / 淡出秒数 */
  fadeIn?: number;
  fadeOut?: number;
  /** 配乐循环（bed 比片子短时） */
  loop?: boolean;
  /** 配乐基础音量 */
  volume?: number;
};

/**
 * 配乐轨：基础音量 × 淡入淡出 × 旁白闪避，全部内联 interpolate。
 * 闪避曲线：对每个旁白窗 [start-attack, end+release] 做梯形包络，取所有窗的最小增益。
 */
const MusicTrack: React.FC<MusicLayerProps> = ({
  musicSrc, windows = [], duckLevel = 0.22, attack = 0.18, release = 0.45,
  fadeIn = 0.8, fadeOut = 1.2, loop = false, volume = 0.9,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // 闪避增益：逐窗梯形，取 min。interpolate 输入范围用秒×fps 表达式。
  let duck = 1;
  for (const w of windows) {
    const g = interpolate(
      frame,
      [(w.start - attack) * fps, w.start * fps, w.end * fps, (w.end + release) * fps],
      [1, duckLevel, duckLevel, 1],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.4, 0, 0.2, 1) },
    );
    if (g < duck) duck = g;
  }

  return (
    <Audio
      src={resolveMedia(musicSrc, staticFile)}
      loop={loop}
      volume={volume * duck * interpolate(
        frame,
        [0, fadeIn * fps, durationInFrames - fadeOut * fps, durationInFrames],
        [0, 1, 1, 0],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
      )}
    />
  );
};

/** 旁白轨：全量播放，轻微淡入防爆音。 */
const VoTrack: React.FC<{ src: string }> = ({ src }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Audio
      src={resolveMedia(src, staticFile)}
      volume={interpolate(frame, [0, 0.05 * fps], [0, 1], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      })}
    />
  );
};

export const MusicLayer: React.FC<MusicLayerProps> = (props) => {
  return (
    <>
      <MusicTrack {...props} />
      {props.voSrc ? <VoTrack src={props.voSrc} /> : null}
    </>
  );
};

/**
 * 切点 SFX：在每个硬切帧放一记 whoosh，短包络（快攻慢释）。
 * cuts 是帧号数组；sfxSrc 指向 public/sfx/whoosh.mp3。
 */
export const CutSfx: React.FC<{ cuts: number[]; sfxSrc: string; volume?: number }> = ({
  cuts, sfxSrc, volume = 0.5,
}) => {
  const { fps } = useVideoConfig();
  return (
    <>
      {cuts.map((cut, i) => (
        <Sequence key={i} from={cut} durationInFrames={Math.ceil(0.4 * fps)} name={`whoosh-${i}`}>
          <WhooshHit src={sfxSrc} volume={volume} />
        </Sequence>
      ))}
    </>
  );
};

const WhooshHit: React.FC<{ src: string; volume: number }> = ({ src, volume }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Audio
      src={resolveMedia(src, staticFile)}
      volume={volume * interpolate(frame, [0, 0.02 * fps, 0.25 * fps], [0, 1, 0], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      })}
    />
  );
};