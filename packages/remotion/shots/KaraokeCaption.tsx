/**
 * 逐词字幕高亮（Remotion 原生 karaoke）。
 *
 * 一切以 Remotion 为主：读 ja.narration.json 的 words 时间戳（日文逐字），
 * 按字符比例映射到中文译文 —— 唱到哪亮哪。
 * 高亮用内联 interpolate 驱动 color/opacity，Studio 可编辑。
 *
 * 与旧引擎 type.karaoke 的关系：旧引擎在 Canvas2D 里逐词填色；
 * Remotion 侧用 DOM span + 帧驱动样式，确定性相同，可编辑性更强。
 */
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

export type Word = { w: string; start: number; end: number };
export type KaraokeLine = {
  id: string;
  /** 中文译文 */
  text: string;
  start: number;
  end: number;
  /** 日文逐字时间戳（来自 ja.narration.json） */
  words?: Word[];
};

/**
 * 把日文 word 时间戳按字符序号比例映射到中文字符。
 * 返回每个中文字符的 [start, end] 秒。无 words 时整句均匀分配。
 */
export function mapCharTimings(line: KaraokeLine): { start: number; end: number }[] {
  const chars = Array.from(line.text);
  const n = chars.length;
  if (!line.words?.length) {
    return chars.map((_, i) => ({
      start: line.start + (i / n) * (line.end - line.start),
      end: line.start + ((i + 1) / n) * (line.end - line.start),
    }));
  }
  const totalJa = line.words.reduce((s, w) => s + Array.from(w.w).length, 0);
  const jaStart = line.words[0].start;
  const jaEnd = line.words[line.words.length - 1].end;
  // 中文字符 i 对应日文进度 i/n → 在 [jaStart, jaEnd] 上线性插值
  return chars.map((_, i) => ({
    start: jaStart + (i / n) * (jaEnd - jaStart),
    end: jaStart + ((i + 1) / n) * (jaEnd - jaStart),
  }));
}

export type KaraokeCaptionProps = {
  line: KaraokeLine;
  /** 未唱到的字色 */
  dimColor?: string;
  /** 唱到的字色 */
  litColor?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
};

/** 单句逐词高亮字幕。useCurrentFrame 只在本组件订阅。 */
export const KaraokeCaption: React.FC<KaraokeCaptionProps> = ({
  line, dimColor = '#9c978f', litColor = '#1b1a17',
  fontSize = 46, fontFamily = "'Songti SC', 'SimSun', serif", fontWeight = 600,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const timings = mapCharTimings(line);
  const chars = Array.from(line.text);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', fontFamily, fontSize, fontWeight }}>
      {chars.map((ch, i) => {
        const ct = timings[i];
        // 唱到 = lit，未唱到 = dim；过渡 0.08s
        const lit = interpolate(t, [ct.start, ct.start + 0.08], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        return (
          <span key={i} style={{
            color: lit > 0.5 ? litColor : dimColor,
            opacity: interpolate(lit, [0, 1], [0.55, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            whiteSpace: 'pre',
          }}>{ch}</span>
        );
      })}
    </div>
  );
};