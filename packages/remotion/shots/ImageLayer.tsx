/**
 * Remotion 原生图片层：读取 + 定向理解。
 *
 * 布局以 Remotion 为准（remotion-interactivity 契约）：
 *   · 动画用内联 interpolate()，输入范围用 frame / fps 表达式；
 *   · 变换用 scale / translate CSS 属性（不用 transform），Studio 可编辑；
 *   · 本仓库 remotion 4.0.404 无 Interactive 导出，用普通 div + 内联样式等价实现。
 *
 * 读取：<Img>（内置 delayRender）+ staticFile()。
 * 定向理解：focus 焦点 / crop 裁切窗 / annotations 标注框，全部归一化、帧驱动。
 */
import React from 'react';
import { Img, staticFile, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { resolveMedia } from '../media-assets';

export type Focus = { x: number; y: number };
export type Crop = { x: number; y: number; w: number; h: number };
export type Annotation = { rect: Crop; label?: string; color?: string };

export type ImageLayerProps = {
  src: string;
  box: { x: number; y: number; w: number; h: number };
  focus?: Focus;
  crop?: Crop;
  annotations?: Annotation[];
  fadeIn?: number;
  zoom?: number;
  radius?: number;
  placeholder?: string;
};

export const ImageLayer: React.FC<ImageLayerProps> = ({
  src, box, focus = { x: 0.5, y: 0.5 }, crop, annotations = [],
  fadeIn = 0.4, zoom = 0, radius = 0, placeholder = '素材位',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const resolved = resolveMedia(src, staticFile);

  return (
    <div
      style={{
        position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h,
        overflow: 'hidden', borderRadius: radius, background: '#1a1a1c',
        opacity: interpolate(frame, [0, fadeIn * fps], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
      }}
    >
      {/* 占位底层：缺图时露出 */}
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center',
        fontFamily: "'IBM Plex Mono', monospace", fontSize: 20, color: '#6b665c',
        border: '2px dashed #5e5b57', borderRadius: radius,
      }}>{placeholder}</div>

      {/* 图片容器：crop 窗用百分比尺寸/偏移；Ken Burns 用 scale 属性（可编辑） */}
      <div style={{
        position: 'absolute',
        width: crop ? `${100 / crop.w}%` : '100%',
        height: crop ? `${100 / crop.h}%` : '100%',
        left: crop ? `${-crop.x * 100 / crop.w}%` : 0,
        top: crop ? `${-crop.y * 100 / crop.h}%` : 0,
        scale: interpolate(frame, [0, 8 * fps], [1, 1 + zoom], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        }),
      }}>
        <Img
          src={resolved}
          style={{
            width: '100%', height: '100%',
            objectFit: crop ? 'fill' : 'cover',
            objectPosition: `${focus.x * 100}% ${focus.y * 100}%`,
          }}
        />
      </div>

      {/* 标注框：归一化 → 像素，错峰淡入（内联 interpolate） */}
      {annotations.map((a, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: a.rect.x * box.w, top: a.rect.y * box.h,
          width: a.rect.w * box.w, height: a.rect.h * box.h,
          border: `2px solid ${a.color ?? '#ff4d12'}`, borderRadius: 4,
          pointerEvents: 'none',
          opacity: interpolate(frame, [(fadeIn + i * 0.15) * fps, (fadeIn + 0.3 + i * 0.15) * fps], [0, 1], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          }),
        }}>
          {a.label ? (
            <span style={{
              position: 'absolute', top: -24, left: 0,
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 16,
              color: a.color ?? '#ff4d12', background: 'rgba(0,0,0,0.7)',
              padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap',
            }}>{a.label}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
};

/** 定向理解预设：face / eyes / upper / full。 */
export function inspectRegion(region: 'face' | 'eyes' | 'full' | 'upper'): Partial<ImageLayerProps> {
  switch (region) {
    case 'face':
      return { crop: { x: 0.2, y: 0.02, w: 0.6, h: 0.5 }, focus: { x: 0.5, y: 0.25 }, zoom: 0.05 };
    case 'eyes':
      return { crop: { x: 0.25, y: 0.1, w: 0.5, h: 0.22 }, focus: { x: 0.5, y: 0.2 }, zoom: 0.06 };
    case 'upper':
      return { focus: { x: 0.5, y: 0.22 }, zoom: 0.04 };
    default:
      return { focus: { x: 0.5, y: 0.4 }, zoom: 0.03 };
  }
}