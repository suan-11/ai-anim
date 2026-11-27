/**
 * Remotion 素材索引：图片 id → **打包后的 URL**（require.context，不再复制到 public/）。
 *
 * 原文件仍在原位置并被 git 跟踪：
 *   · 立绘   tasks/nekohome-intro-ja/assets/avatars/<name>.jpg
 *   · 字标   assets/logos/nekohome-logo.png
 * 定向理解预设（inspectRegion）在 ImageLayer.tsx，这里只管「有什么图」。
 *
 * 新增素材：文件放回上面两类目录，这里加一行 id → getAvatar/getLogo。
 */
import { getAvatar, getLogo } from './media-assets';

export type ImageAsset = {
  id: string;
  kind: 'avatar' | 'logo' | 'screenshot' | 'texture';
  source: string;
  /** 惰性取 URL（打包期解析；缺文件时抛带路径的错） */
  url: () => string;
};

export const IMAGE_ASSETS: ImageAsset[] = [
  { id: 'nuomi', kind: 'avatar', source: '小糯米立绘（tasks/nekohome-intro-ja/assets/avatars）', url: () => getAvatar('nuomi') },
  { id: 'xiaoying', kind: 'avatar', source: '萧影立绘（tasks/nekohome-intro-ja/assets/avatars）', url: () => getAvatar('xiaoying') },
  { id: 'nekohome-logo', kind: 'logo', source: 'NekoHome 字标（assets/logos）', url: () => getLogo('nekohome-logo') },
];

const BY_ID = new Map(IMAGE_ASSETS.map((a) => [a.id, a]));

/** 按 id 取素材；不存在返回 null（调用方画占位）。 */
export function getImageAsset(id: string): ImageAsset | null {
  return BY_ID.get(id) ?? null;
}

/** 按 id 取图片 URL；不存在返回 null。 */
export function imageUrl(id: string): string | null {
  const a = BY_ID.get(id);
  return a ? a.url() : null;
}