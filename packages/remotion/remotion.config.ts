import { Config } from '@remotion/cli/config';
import path from 'node:path';

// 子包根 = 本文件所在目录（Remotion CLI 以 remotionRoot 为 cwd 加载本配置）。
const PKG = process.cwd();
// 仓库根 = 子包向上一级（packages/remotion → 仓库根）。
const ROOT = path.resolve(PKG, '../..');

// 产物一律落 out/_remotion-migration/ 之外由调用方给路径；这里只管渲染参数。
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setConcurrency(4);
Config.setEntryPoint('./index.ts');
// world-execute-me 桥：release 段多子帧（自适应最高 216）× 4 并发在 CPU 光栅上
// 单帧可超默认 30s（f230 实测超时）。放宽到 120s；正常帧不受影响。
Config.setDelayRenderTimeoutInMilliseconds(120000);

// 只打包明确引用的音轨/立绘（require.context，见 media-assets.ts / audio-assets.ts）。
//
// @/ 别名：tsc 用本包 tsconfig 的 paths 指向 stubs/*.d.ts（严格类型检查不深入旧引擎 JS），
// webpack 用同一组别名指回仓库里的真实模块 —— 类型与运行时各走各的解析，接口形状由 stubs 钉住。
Config.overrideWebpackConfig((config) => {
  return {
    ...config,
    // ⚠ 旧引擎的场景对象是「方法在对象字面量里」的普通 JS（makeShot 返回 {id,setup,render}）。
    // webpack 生产模式默认开 usedExports+sideEffects 树摇，会把这些「看起来没被引用」的方法摇掉
    // （症状：_scene 只剩 id/handlesTransition，render=undefined，SCENE ERROR）。
    // 关掉树摇与模块拼接，保留完整对象 ——  bundle 大一点无所谓，画面正确优先。
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
  };
});