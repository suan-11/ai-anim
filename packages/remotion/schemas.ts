/**
 * Zod 参数化：Composition schema，Studio Props 编辑器可直接改文案/颜色/焦点。
 *
 * 一切以 Remotion 为主：schema 字段 = Studio 可编辑 prop。
 * 每个 key 带 default + description；keyframable 的字段可在时间轴打关键帧。
 */
import { z } from 'zod';

/** ImageLayer 的可编辑参数（焦点/裁切/推近）。 */
export const imageLayerSchema = z.object({
  src: z.string().describe('图片路径（public/ 下）'),
  focusX: z.number().min(0).max(1).default(0.5).describe('焦点 X（0..1）'),
  focusY: z.number().min(0).max(1).default(0.22).describe('焦点 Y（0..1）'),
  zoom: z.number().min(0).max(0.2).default(0.04).describe('Ken Burns 推近量'),
  fadeIn: z.number().min(0).max(3).default(0.5).describe('淡入秒数'),
  radius: z.number().min(0).max(40).default(6).describe('圆角 px'),
});

/** 音乐层可编辑参数。 */
export const musicSchema = z.object({
  duckLevel: z.number().min(0).max(1).default(0.55).describe('说话时配乐电平'),
  attack: z.number().min(0).max(1).default(0.15).describe('闪避 attack 秒'),
  release: z.number().min(0).max(2).default(0.4).describe('闪避 release 秒'),
  fadeIn: z.number().min(0).max(5).default(0.6).describe('全片淡入秒'),
  fadeOut: z.number().min(0).max(5).default(1.0).describe('全片淡出秒'),
  volume: z.number().min(0).max(1).default(1).describe('配乐基础音量'),
});

/** 字幕可编辑参数。 */
export const captionSchema = z.object({
  fontSize: z.number().min(20).max(80).default(46).describe('字幕字号'),
  dimColor: z.string().default('#9c978f').describe('未唱到字色'),
  litColor: z.string().default('#1b1a17').describe('唱到字色'),
  karaoke: z.boolean().default(true).describe('逐词高亮开关'),
});

/** NekohomeJaVerify 顶层 schema（组合子 schema）。 */
export const nekohomeSchema = z.object({
  title: z.string().default('小糯米 · 介绍片（日语配音）').describe('片名'),
  music: musicSchema.default({}),
  caption: captionSchema.default({}),
  transitionSec: z.number().min(0).max(1).default(0.25).describe('段间转场秒数'),
  sfxVolume: z.number().min(0).max(1).default(0.35).describe('切点 whoosh 音量'),
  barsGain: z.number().min(0).max(30).default(12).describe('频谱条灵敏度'),
});

export type NekohomeProps = z.infer<typeof nekohomeSchema>;