// @ts-check
import { spawn } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright-core";
import { flag, opt } from "./args.mjs";
import { die, log, warn } from "./log.mjs";
import { ROOT } from "./paths.mjs";
import { changedSources, sourceMtimes } from "./sources.mjs";
import { acquireRenderLock, clearRenderLock, renderLockRel } from "../render-guard.mjs";
/**
 * 本进程直接拉起的子进程（Vite），退出时统一收掉。
 * 注意：**只收自己拉的**。绝不要按进程名去 kill 系统里别的 node——
 * 这个 CLI 自己就跑在 node 上，按名字清理会把宿主一起带走（踩过，很痛）。
 */
const children = new Set();
let cleaned = false;
function cleanupChildren() {
  if (cleaned) return;
  cleaned = true;
  for (const c of children) { try { c.kill(); } catch { /* 已经没了 */ } }
  children.clear();
}

/* ------------------------------------------------------------------ 浏览器会话 */

let session = null;
/**
 * 会话开始时的源文件 mtime 快照（`docs/history/IMPROVEMENTS-4-5.md` §3）。
 *
 * 为什么要它：渲染期写了仓库里的文件 → 私有 Vite 触发 HMR → 整页重载 → 页面里的引擎状态没了
 * → 下一次 `page.evaluate` 抛 `Cannot read properties of undefined (reading 'stats')`。
 * **报错里没有一个字提到"文件被改了"**，为此白跑过一轮 40 秒的 check，还差点误判成"场景写出了 NaN"。
 * 有了这份快照，失联时就能直接点名是哪个文件在几点被改的。
 */
let sessionWatch = null;

async function portReady(url, timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1200) });
      if (res.ok) return true;
    } catch { /* 还没起来 */ }
    await sleep(180);
  }
  return false;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 起一个无头 Chrome，打开 app，等它就绪。
 * @param {{ task: string, scale?: number, only?: string, offline?: boolean }} o
 */
async function openSession(o) {
  // 先留一份源文件 mtime 基线：页面中途失联时用它点名"是谁在渲染期间写了文件"（docs/history/IMPROVEMENTS-4-5.md §3）
  sessionWatch = sourceMtimes();
  // scale > 1 = 真 4K。曾经因为 LineBatch 在 SCALE>1 下不出图而被整体拒绝；
  // 根因已定位并修好（顶点着色器用物理分辨率换算裁剪空间，见 gl.js 的 LineBatch VS），
  // 现在 scale 1..4 都可用。
  if (o.scale && (Number(o.scale) < 0.25 || Number(o.scale) > 4)) {
    die(`--scale 只接受 0.25..4（收到 ${o.scale}）。1 = 1080p，2 = 真 4K，0.5 = 草稿档（--draft 用的就是这个）。`);
  }
  const wantUrl = opt('url', '');
  let url = wantUrl;
  let vite = null;
  if (!url) {
    const candidate = 'http://127.0.0.1:5173';
    if (await portReady(candidate, 1200)) {
      url = candidate;
      log('· 复用已在运行的 Vite 服务 (5173)');
    } else {
      // 自己起一个，关掉热重载（渲染途中保存文件不能让页面刷新）
      const port = 5300 + Math.floor(Math.random() * 500);
      // 直接用当前 node 跑 vite 的 JS 入口：不进 shell、不产生中间 cmd 进程，
      // 这样 vite.kill() 真的能杀掉它（Windows 上 shell:true + npx 会留下一棵杀不掉的进程树）
      const viteEntry = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
      const viteArgs = [viteEntry, '--port', String(port), '--strictPort', '--host', '127.0.0.1'];
      vite = spawn(process.execPath, viteArgs, {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ANIM_NO_HMR: '1' },
      });
      children.add(vite);
      vite.stdout.on('data', () => {});
      vite.stderr.on('data', (d) => { const s = String(d); if (/error/i.test(s)) warn('vite:', s.trim()); });
      url = `http://127.0.0.1:${port}`;
      if (!(await portReady(url))) { vite.kill(); die('Vite 启动失败，试试手动 npm run dev 再带 --url'); }
      log(`· 已启动私有 Vite 服务 ${url}`);
    }
  }

  const browser = await chromium.launch({
    /**
     * 浏览器通道。默认 `chrome`（官方 Chrome，`channel: 'chrome'` 是 **playwright-core 的
     * 硬要求**：它不会替你下载浏览器，见 AGENTS.md §1 前置条件）。
     *
     * `ANIM_CHANNEL` 是给"Chrome 装坏了/没有 Chrome"的机器留的后门：
     * `ANIM_CHANNEL=msedge` 用系统里的 Edge（同 Chromium，渲染路径一致）。
     * 本机实测踩过：Chrome 的 `Application\` 里只剩 `chrome.exe` 壳、没有 `chrome.dll`，
     * 启动报「并行配置不正确」，playwright 只会说 `spawn UNKNOWN` —— 报错位置在 `launch`，
     * 看不出是浏览器装坏了。有了这个环境变量就不必改源码。
     */
    channel: process.env.ANIM_CHANNEL || 'chrome',
    headless: !flag('headed'),
    args: [
      '--use-angle=default',
      '--enable-gpu-rasterization',
      '--ignore-gpu-blocklist',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--hide-scrollbars',
      '--mute-audio',
      // 让无头 Chrome 也拿到真 GPU（否则 WebGL 可能退化成软件渲染）
      '--enable-unsafe-swiftshader',
      // ⚠ `--force_high_performance_gpu`：**默认不加**，用 `--gpu high` 显式开。
      //
      // 历史结论（`docs/PERF.md` §2①）曾经是「独显更慢」（核显 420ms/帧 vs 独显 520ms）。
      // **那条已经作废**：它量在 readPixels 要 195ms/帧 的年代，而当时的成本大头正是
      // 「整帧回读 + 跨适配器拷贝」，不是填充率。2026-10 重测（readPixels 降到 ~6ms 之后，
      // 同一个 promo、同一台 5800H + RTX 3070 Laptop、1080p、samples=1、连续 40 帧）：
      //   · raymarch 大厅段：核显 125.4ms/帧 → 独显 58.3ms/帧（**2.15×**）
      //   · 走廊段（轻）：  核显  45.0ms/帧 → 独显 51.4ms/帧（慢 14%）
      // 也就是「GPU 填充越重，独显越划算；轻场景付跨适配器拷贝的钱」。
      // 所以做成开关，别替用户预设 —— 拿不准就先 `anim perf <任务> --gpu high` 量。
      ...(opt('gpu', 'auto') === 'high' || flag('force-gpu') ? ['--force_high_performance_gpu'] : []),
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const consoleLog = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleLog.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));

  const params = new URLSearchParams({ task: o.task, offline: o.offline === false ? '0' : '1' });
  if (o.scale) params.set('scale', String(o.scale));
  if (o.only) params.set('only', o.only);
  // `--style paper`：临时换风格出图/预览（不改任务文件）。
  // 用途就一个 —— **一眼对比**："同一段画面在几套风格下各长什么样"（docs/STYLE.md）。
  if (opt('style', '')) params.set('style', String(opt('style')));
  // 变体（BACKLOG 1-23）：把名字交给页面，深合并在那边的 loadTask 里做（报错也带任务名）。
  if (opt('variant', '')) params.set('variant', String(opt('variant')));
  params.set('hud', '0');

  await page.goto(`${url}/?${params}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // 等就绪或失败
  const status = await page.waitForFunction(
    () => { const a = /** @type {any} */ (window).__anim; return a && a.status && (a.status().state === 'ready' || a.status().state === 'error') ? a.status() : null; },
    null, { timeout: 240000 },
  ).then((h) => h.jsonValue());

  if (status.state === 'error') {
    await browser.close();
    vite?.kill();
    die(`页面初始化失败：\n${status.error}`);
  }
  const info = await page.evaluate(() => /** @type {any} */ (window).__anim.info());
  // E-1：per-任务渲染锁。会话已经**真的起来了**（浏览器 + 页面就绪），这时锁才有意义 ——
  // 锁落在 out/<任务>/.render-lock（out/ 不进 git，锁天然只属于本机工作区）。
  // 判定与读写都在 scripts/lib/render-guard.mjs；并行模式的子进程是**同一把锁的持有者之一**
  // （父进程先渲着、又 spawn 我们），带 ANIM_RENDER_LOCK_SKIP=1 跳过 —— 不跳过就是自己锁死自己。
  // verify/qa/clean 这些不开渲染会话的命令不走 openSession，天然不受影响。
  let renderLockPath = null;
  if (process.env.ANIM_RENDER_LOCK_SKIP === '1') {
    log('· 渲染锁：--parallel 子进程跳过（父进程持有同一把锁）');
  } else {
    const got = acquireRenderLock({
      root: path.join(ROOT, 'out'),
      task: o.task,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      cmd: `anim ${process.argv.slice(2).join(' ')}`.trim(),
      log,
    });
    if (!got.ok) {
      const h = got.holder ?? {};
      try { await browser.close(); } catch { /* ignore */ }
      vite?.kill();
      die(
        `任务 ${o.task} 正在被 pid ${h.pid ?? '?'} 渲染（startedAt ${h.startedAt ?? '?'}），锁：${renderLockRel(o.task)}；
` +
        `  锁内容：${JSON.stringify(h)}
` +
        `  确认没有别的进程在渲就删掉锁文件重跑：del out\\${o.task}\\.render-lock`,
      );
    }
    renderLockPath = got.file;
    log(`· 渲染锁：${renderLockRel(o.task)}（pid ${process.pid}）`);
  }
  session = { browser, page, vite, url, consoleLog, info, task: o.task, renderLockPath };
  return session;
}

async function closeSession() {
  if (!session) return;
  try { await session.browser.close(); } catch { /* ignore */ }
  try { if (session.vite) { children.delete(session.vite); session.vite.kill(); } } catch { /* ignore */ }
  // E-1：会话结束（正常收尾 / 异常退出 finally）都清锁。锁里记着我们的 pid，
  // 就算这里没清掉（进程被 -9），下一次 acquireRenderLock 的探活也会判出"死进程"并清掉。
  if (session.renderLockPath) {
    try { clearRenderLock(session.renderLockPath); } catch { /* ignore */ }
  }
  session = null;
}

/**
 * 包一层 `page.evaluate`：页面失联时给一条**可读诊断**，并点名渲染期间被改过的源文件。
 *
 * 背景（`docs/history/IMPROVEMENTS-4-5.md` §3）：渲染期写文件 → Vite HMR 整页重载 → 页面里那个装着引擎
 * 状态的全局对象没了 → 下一次 `page.evaluate` 抛的是
 * `TypeError: Cannot read properties of undefined (reading 'stats')`。
 * 这句话指向"stats 读不到"，让人往"场景写出了 NaN / 段名写错"上查 —— 方向完全错。
 *
 * 现在：失败时对比 mtime 快照，直接列出"最近被改过的源文件"，并说明规则
 * （**只要有一场渲染在跑，仓库里一个文件都别写**；并发子代理的产出先落 `out/_staging/`）。
 * 没检测到改动时也会说清楚 —— 那就是页面自己崩了，去看控制台。
 *
 * @param {Function} fn 传给 page.evaluate 的函数
 * @param {any} [arg]
 * @param {string} [what] 出错时显示"在做什么"（默认就是 page.evaluate）
 */
async function evaluateSafe(fn, arg, what = 'page.evaluate') {
  try {
    return await session.page.evaluate(fn, arg);
  } catch (err) {
    const head = String(err && err.message ? err.message : err).split('\n')[0];
    const changed = changedSources(sessionWatch, sourceMtimes());
    const lines = [`页面在 ${what} 时失联：${head}`];
    if (changed.length) {
      lines.push('  ⚠ 渲染期间有源文件被改动 —— 私有 Vite 会因此 HMR 整页重载，页面里的引擎状态就没了。');
      lines.push('     （规则：只要有一场渲染在跑，仓库里**一个文件都别写**；并发子代理的产出先落 out/_staging/。）');
      for (const c of changed.slice(0, 8)) lines.push(`     · ${c}`);
      if (changed.length > 8) lines.push(`     · …另有 ${changed.length - 8} 个`);
      lines.push('  → 让所有写文件的动作停手，然后重跑这条命令。');
    } else {
      lines.push('  没有检测到源文件改动 —— 更像页面自己崩了（GPU 掉线 / shader 编译超时 / OOM）。');
      lines.push('  先看上面打印的浏览器控制台错误，必要时用 --url 挂到手动 npm run dev 的页面上复现。');
    }
    const e = new Error(lines.join('\n'));
    e.readable = true;
    throw e;
  }
}

function getSession() { return session; }

process.on('exit', cleanupChildren);
process.on('SIGINT', () => { cleanupChildren(); process.exit(130); });
process.on('SIGTERM', () => { cleanupChildren(); process.exit(143); });
// E-1 兜底：closeSession 只在"走到了 finally"的路径上清锁；kill / 未捕获异常不走它。
// 'exit' 是同步的，rmSync 在这里可靠（异步 API 在 exit 里来不及跑）。
// 锁只在 openSession 成功后存在（renderLockPath），没渲染过的命令这里什么也不做。
process.on('exit', () => {
  if (session?.renderLockPath) { try { clearRenderLock(session.renderLockPath); } catch { /* ignore */ } }
});

export { children, closeSession, evaluateSafe, getSession, openSession };
