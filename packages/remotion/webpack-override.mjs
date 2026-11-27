import path from 'node:path';

/**
 * 共享 Webpack 配置覆盖：同时服务于 remotion.config.ts（CLI / Studio）
 * 与 scripts/lib/cli/remotion-api.mjs（编程式 bundle()）。
 * 不依赖 process.cwd()，由调用方传入或按模块目录推导 pkgDir/rootDir。
 */
export function createWebpackOverride({ pkgDir, rootDir } = {}) {
  const PKG = pkgDir ?? process.cwd();
  const ROOT = rootDir ?? path.resolve(PKG, '../..');
  return (config) => ({
    ...config,
    // ⚠ 旧引擎的场景对象是「方法在对象字面量里」的普通 JS（makeShot 返回 {id,setup,render}）。
    // webpack 生产模式默认开 usedExports+sideEffects 树摇，会把这些「看起来没被引用」的方法摇掉
    // （症状：_scene 只剩 id/handlesTransition，render=undefined，SCENE ERROR）。
    // 关掉树摇与模块拼接，保留完整对象 —— bundle 大一点无所谓，画面正确优先。
    optimization: {
      ...(config.optimization ?? {}),
      usedExports: false,
      sideEffects: false,
      concatenateModules: false,
      providedExports: false,
    },
    resolve: {
      ...config.resolve,
      alias: {
        ...(config.resolve?.alias ?? {}),
        '@/engine/cjk': path.resolve(ROOT, 'src/core/cjk.js'),
        '@/engine/narration': path.resolve(ROOT, 'src/core/narration.js'),
        '@/engine/timeline': path.resolve(ROOT, 'src/timeline.js'),
        '@/engine/util': path.resolve(ROOT, 'src/core/util.js'),
        '@/engine/style': path.resolve(ROOT, 'src/style/index.js'),
        '@/engine/engine': path.resolve(ROOT, 'src/core/engine.js'),
        '@/engine/palette': path.resolve(ROOT, 'src/core/palette.js'),
        '@/engine/audio': path.resolve(ROOT, 'src/core/audio.js'),
        '@/rm/timeline': path.resolve(PKG, 'timeline.mjs'),
        '@/rm/task-eval': path.resolve(PKG, 'task-eval.mjs'),
        '@/tasks/example-config-only': path.resolve(ROOT, 'tasks/example-config-only/task.config.mjs'),
        '@/tasks/nekohome-intro-ja': path.resolve(ROOT, 'tasks/nekohome-intro-ja/task.config.mjs'),
        '@/tasks/paperfold': path.resolve(ROOT, 'tasks/paperfold/task.config.mjs'),
        '@/tasks/world-execute-me': path.resolve(ROOT, 'tasks/world-execute-me/task.config.mjs'),
      },
    },
  });
}
