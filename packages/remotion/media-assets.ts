/**
 * Remotion 素材统一入口：**不复制到 public/**，直接从原位置打包。
 *
 * 为什么：仓库里的音频/立绘本来就在 `tasks/<任务>/audio`、`tasks/<任务>/assets`、
 * `assets/` 下并被 git 跟踪。之前为了 `staticFile()` 又在 `public/` 复制了一份，
 * 结果同一首歌/同一张图进库两次（wem 的 track.mp3 6.3MB 就是纯重复、且 Composition 根本没用它）。
 *
 * 现在统一用 webpack `require.context`（与 `rm/audio-assets.ts` 同一范式）：
 *   · 只在构建期把**用到的**文件收进 bundle，返回可直接喂给 <Audio>/<Img> 的 URL；
 *   · 缺文件时 `keys()` 里没有 → 抛带任务名的错，而不是静默 404；
 *   · `public/` 只留真正需要静态路径的东西（fonts 走 staticFile，因为 CSS 里要相对路径）。
 */
type AssetContext = {
  keys(): string[];
  (path: string): string;
};
declare const require: {
  context(directory: string, recursive: boolean, filter: RegExp): AssetContext;
};

function pick(ctx: AssetContext, file: string, where: string): string {
  if (!ctx.keys().includes(file)) {
    throw new Error(`缺少素材 ${where}${file.slice(1)}（该文件不在仓库里，或名字写错）`);
  }
  return ctx(file);
}

/* ---------------------------------------------------------------- 音频 */

const paperfoldAudio = require.context('../../tasks/paperfold/audio', false, /^\.\/bed\.mp3$/);
const wemAudio = require.context('../../tasks/world-execute-me/audio', false, /^\.\/track\.mp3$/);
const sfxAudio = require.context('../../assets/sfx', false, /whoosh-transition__73722__Sound16\.mp3$/);

/** paperfold 配乐床（tasks/paperfold/audio/bed.mp3，仓库已跟踪） */
export const getPaperfoldBed = () => pick(paperfoldAudio, './bed.mp3', 'tasks/paperfold/audio');

/** world.execute(me); 原曲（tasks/world-execute-me/audio/track.mp3）。
 *  ⚠ 只在需要试听/Studio 预览时用；CLI 出片走 --muted + ffmpeg 封装，不挂 <Audio>。 */
export const getWemTrack = () =>
  pick(wemAudio, './track.mp3', 'tasks/world-execute-me/audio');

/** 切点 whoosh（assets/sfx/，SoundDino 授权，见 assets/sfx/catalog.json） */
export const getWhoosh = () => {
  const key = sfxAudio.keys().find((k) => k.includes('whoosh-transition__73722__'));
  if (!key) throw new Error('缺少素材 assets/sfx/whoosh-transition__73722__Sound16.mp3');
  return sfxAudio(key);
};

/* ---------------------------------------------------------------- 图片 */

const avatars = require.context('../../tasks/nekohome-intro-ja/assets/avatars', false, /\.(jpg|png)$/);
const logos = require.context('../../assets/logos', false, /\.png$/);

/** 立绘（tasks/nekohome-intro-ja/assets/avatars/<name>.jpg） */
export function getAvatar(name: string): string {
  const hit = avatars.keys().find((k) => k === `./${name}.jpg` || k === `./${name}.png`);
  if (!hit) throw new Error(`缺少立绘 tasks/nekohome-intro-ja/assets/avatars/${name}.jpg`);
  return avatars(hit);
}

/** 品牌字标（assets/logos/） */
export function getLogo(name = 'nekohome-logo'): string {
  const hit = logos.keys().find((k) => k === `./${name}.png`);
  if (!hit) throw new Error(`缺少 logo assets/logos/${name}.png`);
  return logos(hit);
}

/**
 * 统一的 src 解析：打包出来的 URL（`/xxx.mp3`、`http(s)://…`、`data:`）原样返回，
 * 其余仍按 public/ 路径走 staticFile（例如 `fonts/fonts.css` 这类只给 CSS 用的）。
 */
export function resolveMedia(src: string, staticFile: (p: string) => string): string {
  if (/^(https?:|data:|blob:|\/)/.test(src)) return src;
  return staticFile(src);
}