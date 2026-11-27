import { Config } from '@remotion/cli/config';
import path from 'node:path';
import { createWebpackOverride } from './webpack-override.mjs';

// 子包根 = 本文件所在目录（Remotion CLI 以 remotionRoot 为 cwd 加载本配置）。
const PKG = process.cwd();
// 仓库根 = 子包向上一级（packages/remotion → 仓库根）。
const ROOT = path.resolve(PKG, '../..');

// 产物一律落 out/_remotion-migration/ 之外由调用方给路径；这里只管渲染参数。
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setConcurrency(4);
Config.setEntryPoint('./index.ts');
// ⚠ CLI 以子包为 cwd 起进程，Remotion 默认把 <cwd>/public 当静态目录 —— 那目录不存在，
// 于是 staticFile('fonts/fonts.css') 全 404、文字拍成方框。这里显式指回仓库根的 public/。
Config.setPublicDir(path.resolve(ROOT, 'public'));
// world-execute-me 桥：release 段多子帧（自适应最高 216）× 4 并发在 CPU 光栅上
// 单帧可超默认 30s（f230 实测超时）。放宽到 120s；正常帧不受影响。
Config.setDelayRenderTimeoutInMilliseconds(120000);

// webpack 配置与编程式 bundle() 共用同一份，见 webpack-override.mjs。
Config.overrideWebpackConfig(createWebpackOverride({ pkgDir: PKG, rootDir: ROOT }));
