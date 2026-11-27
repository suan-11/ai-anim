// @ts-check
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './paths.mjs';
import { localBrowser } from './remotion.mjs';
import { createWebpackOverride } from '../../../packages/remotion/webpack-override.mjs';

const require = createRequire(import.meta.url);

/**
 * 打包一次、开一个浏览器实例、连续出多张帧（供 check / verify / review 复用）。
 * @param {{ compositionId: string, inputProps?: Record<string, unknown>, onBrowserLog?: (log: any) => void }} opts
 */
export async function openRemotionSession({ compositionId, inputProps = {}, onBrowserLog } = {}) {
  const { bundle } = require('@remotion/bundler');
  const { openBrowser, selectComposition, renderStill } = require('@remotion/renderer');

  const pkgDir = path.join(ROOT, 'packages', 'remotion');
  const serveUrl = await bundle({
    entryPoint: path.join(pkgDir, 'index.ts'),
    publicDir: path.join(ROOT, 'public'),
    webpackOverride: createWebpackOverride({ pkgDir, rootDir: ROOT }),
    enableCaching: true,
  });

  const browserExecutable = localBrowser() ?? null;
  const browser = await openBrowser('chrome', {
    browserExecutable,
    logLevel: 'warn',
  });

  try {
    const composition = await selectComposition({
      serveUrl,
      id: compositionId,
      inputProps,
      puppeteerInstance: browser,
      browserExecutable,
      timeoutInMilliseconds: 120000,
      logLevel: 'warn',
      ...(onBrowserLog ? { onBrowserLog } : {}),
    });

    return {
      composition,
      serveUrl,
      /**
       * @param {{ frame: number, scale?: number, output?: string|null, inputProps?: Record<string, unknown> }} p
       */
      async renderFrame({ frame, scale = 1, output = null, inputProps: overrideProps }) {
        return renderStill({
          composition,
          serveUrl,
          frame,
          scale,
          output,
          imageFormat: 'png',
          inputProps: overrideProps ?? inputProps,
          puppeteerInstance: browser,
          browserExecutable,
          timeoutInMilliseconds: 120000,
          logLevel: 'warn',
          overwrite: true,
          ...(onBrowserLog ? { onBrowserLog } : {}),
        });
      },
      async close() {
        await browser.close({ silent: true });
      },
    };
  } catch (err) {
    await browser.close({ silent: true }).catch(() => {});
    throw err;
  }
}
