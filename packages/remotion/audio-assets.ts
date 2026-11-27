type AudioContext = {
  keys(): string[];
  (path: string): string;
};

declare const require: {
  context(directory: string, recursive: boolean, filter: RegExp): AudioContext;
};

// webpack 只打包指定的混音。生成音轨可以缺席，其他 Composition 仍可构建。
const mixes = require.context('../../tasks/nekohome-intro-ja/audio', false, /^\.\/ja-mix\.mp3$/);

export function getNekohomeJaMix() {
  const file = './ja-mix.mp3';
  if (!mixes.keys().includes(file)) {
    throw new Error('任务 "nekohome-intro-ja" 缺少音轨 ./audio/ja-mix.mp3');
  }
  return mixes(file);
}
