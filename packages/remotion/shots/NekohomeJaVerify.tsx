/**
 * Remotion 迁移 · 阶段 2B：nekohome-intro-ja 六段音画验证 Composition。
 *
 * 数据全部来自 rm/task-eval.mjs 对同一份 task.config.mjs 的求值：
 *   · 段长 = audio/ja.timing.mjs 的 slot（经 build() 的秒语义）；
 *   · 配音+配乐 = audio/ja-mix.mp3（整条混音，Remotion <Audio> 从 0 起播）；
 *   · 中文字幕 = audio/ja-sub-zh.narration.json（10 句），布局/换行/保留区用旧引擎同一套
 *     makeCaptionLayer 的口径（paper 风格：46px、顶部带 [40,104]、hold 1.06s、fade 0.16s）。
 *
 * 画面是**简化标定版**：每段标明镜头 ID / 段号 / 切点帧，纸面底色 —— 验的是时间轴与音画对齐，
 * 不是复刻 cards.js 的版面（那属于阶段 3 的复杂镜头迁移）。
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { breakCaption } from '@/engine/cjk';
import { getNekohomeJaMix } from '../audio-assets';
import { ImageLayer, inspectRegion } from './ImageLayer';
import { imageUrl } from '../image-manifest';
import { getWhoosh } from '../media-assets';
import { MusicLayer, CutSfx } from '../audio/MusicLayer';
import { AudioBars } from '../audio/AudioVisual';
import { SegmentTransitions } from './SegmentTransitions';
import { KaraokeCaption, type KaraokeLine } from './KaraokeCaption';
import jaNarration from '../../../tasks/nekohome-intro-ja/audio/ja.narration.json';
import type { NekohomeProps } from '../schemas';

export type JaParsed = {
  name: string; title: string; width: number; height: number; fps: number;
  durationInFrames: number;
  segments: { id: string; startFrame: number; endFrame: number; startSec: number; endSec: number }[];
  narrationRaw: { lines: { id: string; text: string; start: number; dur: number; end: number }[] } | null;
  style: any;
};

const fmt = (s: number) => s.toFixed(3);

/** 字幕层：与 src/core/captions.js active() 逐字同式（at ?? recent(hold)，入/出淡变）。 */
const CaptionLayer: React.FC<{ parsed: JaParsed; karaoke?: boolean; fontSize?: number; dimColor?: string; litColor?: string }> = ({ parsed, karaoke = true, fontSize: fsOverride, dimColor, litColor }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;
  const cs = parsed.style?.captions;
  if (!cs || !parsed.narrationRaw) return null;
  const lines = parsed.narrationRaw.lines;
  const hold = cs.hold ?? 1.06;
  const fade = cs.fade ?? 0.16;
  const sat01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

  type Line = { id: string; text: string; start: number; dur: number; end: number };
  let line: Line | null = lines.find((l) => t >= l.start && t < l.end) ?? null;
  if (!line) {
    let best: Line | null = null;
    for (const l of lines) {
      if (l.end <= t && t - l.end <= hold && (!best || l.end > best.end)) best = l;
    }
    line = best;
  }
  if (!line) return null;
  const inK = sat01((t - line.start) / Math.max(1e-3, fade));
  const outStart = line.end + hold - fade;
  const outK = t > outStart ? 1 - sat01((t - outStart) / Math.max(1e-3, fade)) : 1;
  const alpha = Math.min(inK, outK);
  if (alpha <= 0) return null;

  // 换行交给旧引擎同一份 breakCaption（16 字/行、最多 2 行、行首禁则）
  const { rows } = breakCaption(line.text, { maxChars: cs.maxCharsPerLine ?? 16, maxLines: cs.maxLines ?? 2 });
  const band = parsed.style?.grid?.captionBand ?? [40, 104];
  const size = fsOverride ?? cs.size ?? 44;
  const lh = cs.lineHeight ?? 1.3;
  // paper 风格：宋体栈、墨字（bone=#1b1a17）、无底衬（bg 0）
  const font = parsed.style?.fonts?.sans ?? 'serif';
  const color = parsed.style?.palette?.bone ?? '#1b1a17';

  // 逐词高亮：日文 words 时间戳按字符比例映射到中文（唱到哪亮哪）
  const jaLine = (jaNarration as any).lines?.find((l: any) => l.id === line!.id);
  const karaokeLine: KaraokeLine = {
    id: line.id, text: line.text, start: line.start, end: line.end,
    words: jaLine?.words,
  };

  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, top: band[0],
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      opacity: alpha, pointerEvents: 'none',
    }}>
      {rows.length <= 1 && karaoke ? (
        <KaraokeCaption
          line={karaokeLine}
          dimColor={dimColor ?? parsed.style?.palette?.ash ?? '#9c978f'}
          litColor={litColor ?? color}
          fontSize={size}
          fontFamily={font}
          fontWeight={cs.weight ?? 600}
        />
      ) : rows.map((r: string, i: number) => (
        <div key={i} style={{
          fontFamily: font, fontSize: size, fontWeight: cs.weight ?? 600,
          lineHeight: lh, color, textAlign: 'center', whiteSpace: 'pre',
        }}>{r}</div>
      ))}
    </div>
  );
};

/** 段 → 立绘素材 + 定向理解区域。nuomi/xiaoying 段放真图，其余保持标定卡。 */
const SEGMENT_IMAGE: Record<string, { asset: string; region: 'face' | 'upper' | 'full'; label: string }> = {
  nuomi: { asset: 'nuomi', region: 'upper', label: '小糯米 · 立绘' },
  xiaoying: { asset: 'xiaoying', region: 'upper', label: '萧影 · 立绘' },
};

/** 简化镜头标定画面：纸面底 + 段信息 + 切点读数；有立绘的段左侧放真图（定向理解裁切）。 */
const SegmentCard: React.FC<{ parsed: JaParsed; index: number }> = ({ parsed, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seg = parsed.segments[index];
  const lt = frame / fps;
  const pal = parsed.style?.palette ?? {};
  const paper = pal.ink ?? '#f3f0e7';
  const ink = pal.bone ?? '#1b1a17';
  const signal = pal.signal ?? '#c8381b';
  const ash = pal.ash ?? '#6b665c';
  const font = parsed.style?.fonts?.sans ?? 'serif';
  const mono = parsed.style?.fonts?.mono ?? 'monospace';
  const p = Math.min(1, lt / Math.max(0.5, seg.endSec - seg.startSec));

  const imgSpec = SEGMENT_IMAGE[seg.id];
  const imgSrc = imgSpec ? imageUrl(imgSpec.asset) : null;

  return (
    <AbsoluteFill style={{ background: paper, fontFamily: font }}>
      {/* 有立绘：左侧 620×780 素材位（与旧引擎 cards.js 同框），定向理解裁切 + 标注 */}
      {imgSrc ? (
        <ImageLayer
          src={imgSrc}
          box={{ x: 140, y: 150, w: 620, h: 780 }}
          {...inspectRegion(imgSpec.region)}
          fadeIn={0.5}
          radius={6}
          annotations={[{ rect: { x: 0.02, y: 0.02, w: 0.96, h: 0.96 }, label: imgSpec.label, color: signal }]}
          placeholder={imgSpec.label}
        />
      ) : null}
      {/* 右侧（或无图时居中）：段信息。缩放用 scale 属性（Remotion 可编辑），不用 transform */}
      <AbsoluteFill style={{
        scale: String(1 + 0.02 * p),
        justifyContent: 'center', alignItems: imgSrc ? 'flex-end' : 'center',
        paddingRight: imgSrc ? 120 : 0,
      }}>
        <div style={{ fontSize: 30, letterSpacing: 6, color: ash, fontFamily: mono }}>
          {`SEG ${index + 1} / ${parsed.segments.length} · REMOTION`}
        </div>
        <div style={{ fontSize: imgSrc ? 88 : 120, fontWeight: 800, color: ink, marginTop: 24 }}>{seg.id}</div>
        <div style={{ fontSize: 34, color: ash, marginTop: 20, fontFamily: mono }}>
          {`${fmt(seg.startSec)}s → ${fmt(seg.endSec)}s · f${seg.startFrame}–${seg.endFrame}`}
        </div>
        <div style={{ width: imgSrc ? 600 : 900, height: 4, background: pal.graphite ?? '#b9b2a2', marginTop: 48, borderRadius: 2 }}>
          <div style={{ width: `${p * 100}%`, height: '100%', background: signal, borderRadius: 2 }} />
        </div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 60, bottom: 48, fontSize: 24, color: ash, fontFamily: mono }}>
        {parsed.title}
      </div>
    </AbsoluteFill>
  );
};

export const NekohomeJaVerify: React.FC<{ parsed: JaParsed } & Partial<NekohomeProps>> = ({ parsed, ...opts }) => {
  const mix = getNekohomeJaMix();
  const music = opts.music ?? { duckLevel: 0.55, attack: 0.15, release: 0.4, fadeIn: 0.6, fadeOut: 1.0, volume: 1 };
  const caption = opts.caption ?? { fontSize: 46, dimColor: '#9c978f', litColor: '#1b1a17', karaoke: true };
  const transitionSec = opts.transitionSec ?? 0.25;
  const sfxVolume = opts.sfxVolume ?? 0.35;
  const barsGain = opts.barsGain ?? 12;
  // 旁白窗 → 配乐闪避（运行时曲线，Studio 可见音量关键帧）
  const windows = (parsed.narrationRaw?.lines ?? []).map((l) => ({ start: l.start, end: l.end }));
  // 硬切帧（无交叠的段边界）放 whoosh
  const cuts = parsed.segments.slice(1).map((s) => s.startFrame);
  return (
    <AbsoluteFill>
      {/* 原生转场：段间 wipe/slide/fade 柔化（Studio 可编辑时长/曲线） */}
      <SegmentTransitions
        segments={parsed.segments}
        transitionSec={transitionSec}
        transitions={['wipe', 'slide', 'wipe', 'fade', 'wipe']}
      >
        {parsed.segments.map((seg, i) => (
          <SegmentCard key={seg.id} parsed={parsed} index={i} />
        ))}
      </SegmentTransitions>
      <CaptionLayer parsed={parsed} karaoke={caption.karaoke} fontSize={caption.fontSize} dimColor={caption.dimColor} litColor={caption.litColor} />
      <MusicLayer
        musicSrc={mix}
        windows={windows}
        duckLevel={music.duckLevel}
        attack={music.attack}
        release={music.release}
        fadeIn={music.fadeIn}
        fadeOut={music.fadeOut}
        volume={music.volume}
      />
      <CutSfx cuts={cuts} sfxSrc={getWhoosh()} volume={sfxVolume} />
      <AudioBars src={mix} bars={64} box={{ x: 60, y: 1010, w: 1800, h: 50 }} color="#c8381b" gain={barsGain} />
    </AbsoluteFill>
  );
};
