// @ts-check
/**
 * 浏览器入口。两件事：
 *   1) 人看的预览（实时播放、拖时间轴、音频）
 *   2) 机器用的离屏协议 window.__anim（CLI 靠它逐帧取图 / 推流给 ffmpeg）
 *
 * 预览和成片跑的是同一套渲染代码，唯一区别是预览只出 1 个子帧（快），
 * 离屏出很多子帧求平均（真运动模糊）。所以「预览里看着对」=「成片里一定对」。
 *
 * URL 参数：?task=demo&t=1.5&scale=2&fps=60&only=a,b
 */

import { Engine } from './core/engine.js';
import { makePalette } from './core/palette.js';
import { MusicData } from './core/audio.js';
import { loadTaskList, loadTask } from './tasks.js';
import { auditUnderRequires, planWorldAudit, worldAuditVerdict } from './timeline.js';
import { layoutVerdict, LAYOUT_LIMITS } from './layout.js';
import { DEFAULT_POST } from './core/post.js';

const q = new URLSearchParams(location.search);
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const status = {
  state: 'booting',
  task: '',
  error: null,
  message: '启动中…',
};

function setHud(lines, cls = '') {
  const el = $('hud');
  el.innerHTML = lines;
  el.className = cls;
}
function setMsg(s) { $('msg').textContent = s ?? ''; }

/**
 * 把任务自带的字体加载进来（task.fonts）。
 *
 * 为什么需要它：以前想用一款官网同款字体，只能把 woff2 丢进 `public/fonts/` 并改**全局**的
 * `public/fonts/fonts.css` —— 两个任务想用不同字体就会打架，而且是全局可变状态。
 *
 *   fonts: './fonts/brand.css'                  // 自己写 @font-face 的样式表
 *   fonts: ['./fonts/Brand-600.woff2']          // 字体文件，自动包成 @font-face
 *   fonts: [{ file: './fonts/Brand-600.woff2', family: 'Brand', weight: '600' }]
 *
 * **必须在第一帧之前 await 完成**：离屏截帧时字体还没就绪会拍到一片方框（font-display 也救不了
 * 已经画进 Canvas2D 的那一帧）。
 *
 * @param {any} spec 任务配置
 * @param {(p: string) => string} url 相对任务目录 -> 可 fetch 的 URL
 */
async function loadTaskFonts(spec, url) {
  const list = spec?.fonts ? (Array.isArray(spec.fonts) ? spec.fonts : [spec.fonts]) : [];
  const families = [];
  const links = [];
  for (const entry of list) {
    const e = typeof entry === 'string' ? { file: entry } : (entry ?? {});
    if (!e.file) continue;
    const href = url(e.file);
    if (/\.css(\?|$)/i.test(e.file)) { links.push(href); continue; }
    const family = e.family ?? `task-font-${families.length + 1}`;
    families.push({ family, weight: e.weight ?? '100 900', style: e.style ?? 'normal', href });
  }

  // 字体文件：自己拼 @font-face，插到 head 末尾（比任务目录里的 css 优先级高，方便覆盖）
  if (families.length) {
    const style = document.createElement('style');
    style.dataset.animTaskFonts = '1';
    style.textContent = families.map((f) => `@font-face {
  font-family: '${f.family}';
  src: url('${f.href}');
  font-weight: ${f.weight};
  font-style: ${f.style};
  font-display: block;
}`).join('\n');
    document.head.appendChild(style);
  }
  for (const href of links) {
    await new Promise((res) => {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      l.onload = () => res(null);
      l.onerror = () => { console.warn(`[fonts] 样式表加载失败：${href}`); res(null); };
      document.head.appendChild(l);
    });
  }
  if (!list.length) return [];

  const anyDoc = /** @type {any} */ (document);
  try {
    if (anyDoc.fonts?.ready) await anyDoc.fonts.ready;
    // 显式请求几个字形，逼浏览器真的把文件下下来（否则首帧会拍到回退字体）
    if (anyDoc.fonts?.load) {
      await Promise.all(families.flatMap((f) => [
        anyDoc.fonts.load(`${f.weight.split(' ')[0]} 64px "${f.family}"`, 'Aa动画'),
      ])).catch(() => {});
    }
  } catch { /* 字体加载失败不致命，回退系统字体 */ }
  if (families.length) {
    console.log(`· 任务字体已加载：${families.map((f) => f.family).join(', ')}`);
  }
  return families.map((f) => f.family);
}

/** 把错误显示在页面上（离屏时也会回传给 CLI，不然就是黑屏无解） */
function fail(err) {
  const msg = err && err.stack ? err.stack : String(err);
  status.state = 'error';
  status.error = msg;
  setHud(`<span class="err">渲染失败</span>\n\n${escapeHtml(msg.split('\n').slice(0, 12).join('\n'))}`, 'err');
  console.error(err);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));
}

/* ------------------------------------------------------------------ 启动 */

let engine = /** @type {Engine | null} */ (null);
let audio = /** @type {HTMLAudioElement | null} */ (null);
let clock = 0;
let playing = false;
let frameCount = 0;
let lastName = '';
/** 推流状态：CLI 卡住时靠它定位（readyState 0=CONNECTING 1=OPEN 2=CLOSING 3=CLOSED） */
const streamState = { started: 0, url: '', readyState: -1, sent: 0, total: 0, lastError: '' };

async function boot() {
  const list = await loadTaskList();
  const taskName = q.get('task') ?? list[0];
  if (!taskName) throw new Error(`没有找到任何任务。先跑： node scripts/anim.mjs new 我的第一个动画\n可用任务：${list.join(', ') || '(空)'}`);
  status.task = taskName;
  setMsg(`任务 ${taskName}`);

  // 先把音乐（可选）拿到：时间线里可能用拍号而不是秒来写
  setHud('读取任务…');
  // 变体（BACKLOG 1-23）：--variant 名字 ⇒ 深合并覆盖。必须**两次**都带上 ——
  // preTask 决定"有没有音乐/要不要先分析"，task 才是真正跑的那份；只带一次会出现
  // "音乐按变体加载、时间线按原配置"的错位。
  const variantName = q.get('variant') || null;
  if (variantName) console.info('[variant] 使用变体 "' + variantName + '"');
  // 1-8（2026-10-31）：外挂旁白表在**第一次 loadTask 之前**取好 —— build() 发生在 loadTask 内部，
  // 表必须在那时就在位，`dur: { vo: id }` 才能与"旁白表放在外部 json 里"同时用。
  // 失败是软的（记下原因，A-2 的 check 会点名）：没有表时行为与从前完全一致。
  /** @type {any} */
  let narrationPreload = null;
  /** @type {{ file: string, message: string } | null} */
  let narrationError = null;
  {
    // 先要任务目录 —— preTask 还没取，先拿一次"裸"配置只为读 narration 路径与变体。
    // 裸取用同一 loadTask（不带 music/narration，代价只是一次模块缓存命中）。
    const pre = await loadTask(taskName, { variant: variantName });
    if (typeof pre.narration === 'string') {
      const file = pre.narration;
      try {
        // 任务目录此时还算不出来（taskBase 在下面才定义）——自己算：相对 tasks/<名>/ 解析
        const base = new URL(`tasks/${taskName}/`, location.href);
        const url = new URL(file.replace(/^\.\//, ''), base).href;
        const j = await (await fetch(url)).json();
        const { makeNarration } = await import('./core/narration.js');
        narrationPreload = makeNarration(j, { duration: pre.duration });
      } catch (err) {
        narrationError = { file, message: err && err.message ? String(err.message) : String(err) };
        console.warn(`[旁白] 读不到 ${file}（${narrationError.message}）—— ctx.narration 会是空的`);
      }
    }
  }
  const preTask = await loadTask(taskName, { variant: variantName, narrationData: narrationPreload });
  /**
   * 任务里的路径（audio / lyrics / analysis）都是**相对任务目录**的：
   * './audio/x.mp3' 指的是 tasks/<任务>/audio/x.mp3。
   * 注意不能拿 location.href 当基准——页面 URL 是 '/?task=x'，没有结尾斜杠，
   * 相对路径会解析到站点根目录去（踩过：音频 404，然后落到解码失败）。
   */
  const taskBase = new URL(`tasks/${taskName}/`, location.href);
  const taskUrl = (p) => new URL(p.replace(/^\.\//, ''), taskBase).href;

  let music = null;
  if (preTask.audio) {
    const audioUrl = taskUrl(preTask.audio);
    // 预计算好的特征：CLI 会放在音频旁边，叫 <文件名>.analysis.json
    const guess = audioUrl.replace(/\.[^./]+$/, '') + '.analysis.json';
    music = await MusicData.load(audioUrl, {
      analysisUrl: preTask.analysis ? taskUrl(preTask.analysis) : guess,
      onProgress: (m) => setHud(escapeHtml(m)),
    });
  }

  const task = await loadTask(taskName, { music, variant: variantName, narrationData: narrationPreload });
  /**
   * 旁白表可以从**文件**来（`narration: './narration.json'`）。
   * 与 `lyrics` 同一个套路：JSON 是外部脚本（TTS 量长那一步）产出的，任务目录里相对路径引用。
   * 加载失败只警告、不致命 —— 没有旁白表时 `ctx.narration` 是个安全的空实现。
   */
  if (typeof preTask.narration === 'string' && narrationPreload) {
    // 1-8：表已在 loadTask 里生效（task.narrationData 已有），这里只做警告转发
    for (const w of task.narrationData?.warnings ?? []) console.warn(`[旁白] ${w}`);
  } else if (typeof preTask.narration === 'string' && !task.narrationData) {
    // 兜底：调用方没注入（预览/dev 直开且上面取失败了）——保持旧路径，失败要可见（A-2）
    if (!narrationError) {
      try {
        const url = taskUrl(preTask.narration);
        const j = await (await fetch(url)).json();
        const { makeNarration } = await import('./core/narration.js');
        task.narrationData = makeNarration(j, { duration: task.duration });
        for (const w of task.narrationData?.warnings ?? []) console.warn(`[旁白] ${w}`);
      } catch (err) {
        narrationError = { file: preTask.narration, message: err && err.message ? String(err.message) : String(err) };
        console.warn(`[旁白] 读不到 ${preTask.narration}（${narrationError.message}）—— ctx.narration 会是空的`);
        task.narrationData = null;
      }
    } else {
      task.narrationData = null;
    }
  }
  // A-2：加载失败要可见 —— 标记挂在 task 上，CLI 的 check 直接读它（不依赖浏览器回传）
  if (narrationError) task.narrationError = narrationError;
  /**
   * 分辨率倍率：1 = 1080p，2 = 真 4K。**也接受 0.5 / 0.25**（草稿档 `--draft` 用它，BACKLOG 1-44）：
   * 半分辨率渲染，GPU 填充只有 1/4，用来审节奏与信息密度；**不是成片**。
   * 下限取 0.25 是因为再小字就认不出来了（Layer2D 的画布按 scale 缩放，0.5 时字号实际只有一半像素）。
   */
  const scaleRaw = Number(q.get('scale') ?? task.scale ?? 1);
  const scale = Math.min(4, Math.max(0.25, Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1));
  const width = Number(q.get('w') ?? task.width ?? 1920);
  const height = Number(q.get('h') ?? task.height ?? 1080);
  const fps = Number(q.get('fps') ?? task.fps ?? 60);
  const offline = q.get('offline') === '1';

  // `--style paper`（CLI 会把它放进 URL 的 ?style=）—— 临时换风格出图对比，不改任务文件。
  // 这也是"每片换一套"这条纪律最容易执行的方式：先出几张对比图，再写进 task.config.mjs。
  const styleOverride = q.get('style');
  if (styleOverride) {
    const { resolveStyle } = await import('./style/index.js');
    try {
      task.styleResolved = resolveStyle({ style: styleOverride });
      console.info(`[style] 临时覆盖为 "${styleOverride}"（${task.styleResolved.label}）`);
    } catch (err) {
      console.warn(`[style] --style 覆盖失败：${err && err.message ? err.message : err}`);
    }
  }

  const canvas = /** @type {HTMLCanvasElement} */ ($('c'));
  // 调试出口：让 agent / 工作台能读到"这一帧到底用的哪份调色板"（风格串皮排查用）
  window.__animPalette = makePalette({ ...(task.styleResolved?.palette ?? {}), ...(task.palette ?? {}) });

  engine = new Engine(canvas, {
    width, height, scale, fps,
    // 调色板 = 风格包的 palette + 任务自己的 palette（任务优先）。
    // ⚠ 必须在 new Engine 之前合成：Post 构造时就把调色板常量注进 shader 源码了，
    //   之后再换 P 只会让场景变、后处理链还是旧配色（Engine 构造函数里也写了这条）。
    palette: makePalette({ ...(task.styleResolved?.palette ?? {}), ...(task.palette ?? {}) }),
  });

  setHud('编译着色器…');

  // 任务自带字体：必须赶在第一帧之前（离屏截帧会拍到方框）
  await loadTaskFonts(preTask, taskUrl);

  // 歌词（可选）
  let lyrics = null;
  if (task.lyrics) {
    try { lyrics = await (await fetch(taskUrl(task.lyrics))).json(); } catch { lyrics = null; }
  }

  await engine.load({
    timeline: task.timeline,
    music,
    lyrics,
    // 口播/旁白表（可选，docs/NARRATION.md A 档）：场景里读 ctx.narration / f.narration
    narration: task.narrationData ?? null,
    title: task.title ?? taskName,
    duration: task.duration,
    only: q.get('only'),        // '--only a,b'：只加载这几段（快，且隔离写坏的场景）
    // 全片共享背景（可选）：时间线里声明 { world: 'auto' } 的段由引擎先铺它。
    // 这样"忘了画背景"不再是静默黑底 —— 见 docs/history/IMPROVEMENTS-1-3.md P0-2。
    worldPass: task.world ?? null,
    // 风格包（docs/STYLE.md）：色板已在上面合成，这里传进来的是 grid / post / captions / fonts / motif
    styleResolved: task.styleResolved ?? null,
    // 引擎级字幕层（docs/CAPTIONS.md）：`captions: true` 才开；默认关 = 老任务零变化
    captions: task.captions ?? null,
  });

  // 每段的图层各有一份 TextKit，字体是全局的：等一次就够，但每层都要刷一遍缓存
  await engine.hud2d.type.load().catch(() => {});
  for (const it of engine.timeline) it._layer?.type?.clearCache?.();

  engine.hud = !offline && q.get('hud') !== '0';
  engine.hudInfo.hint = '空格 播放/暂停 · ←→ ±1s · , . 逐帧 · [ ] 上下段 · h 隐藏信息';

  // 音频播放器
  if (task.audio && !offline) {
    audio = new Audio(new URL(task.audio, location.href).href);
    audio.preload = 'auto';
    audio.volume = 1;
  }

  const t0 = Number(q.get('t') ?? 0);
  clock = Number.isFinite(t0) ? t0 : 0;
  engine.render(clock, { preview: true, toScreen: true, samples: 1 });

  status.state = 'ready';
  const v = engine.validate();
  const errs = [...engine.errors.map((e) => `[场景] ${e}`), ...v.problems.map((p) => `[时间线] ${p}`)];
  refreshHud(errs, v.gaps);

  if (!offline) {
    setupWorkbench(engine);
    setupPanel(engine);
    requestAnimationFrame(loop);
  }
  return { task, engine, fps, offline };
}

function clampInt(x, a, b) { return Math.max(a, Math.min(b, Math.round(Number.isFinite(x) ? x : a))); }

function refreshHud(errs = [], gaps = []) {
  if (!engine) return;
  const e = errs.length ? `\n<span class="err">${escapeHtml(errs.slice(0, 6).join('\n'))}</span>` : '\n<span class="ok">✓ 无错误</span>';
  const g = gaps.length ? `\n<span class="err">空档: ${escapeHtml(gaps.join('; '))}</span>` : '';
  const items = engine.timeline
    .map((i) => `  ${i.id.padEnd(12)} ${i.start.toFixed(2)} → ${i.end.toFixed(2)}s  ${(i.end - i.start).toFixed(2)}s${i.note ? '  ' + i.note : ''}`)
    .join('\n');
  setHud(
    `<b>${escapeHtml(status.task)}</b>  ${engine.gl.w}×${engine.gl.h} @${engine.fps} ×${engine.gl.scale}\n` +
    `时长 ${engine.duration.toFixed(2)}s · 段 ${engine.timeline.length} · bpm ${engine.music.bpm?.toFixed?.(1) ?? '—'}${e}${g}\n${escapeHtml(items)}`
  );
}

/* ------------------------------------------------------------------ 预览循环 */

let lastWall = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (!engine) return;
  const wall = now / 1000;
  const dt = lastWall ? Math.min(0.25, wall - lastWall) : 1 / engine.fps;
  lastWall = wall;

  if (playing) {
    clock += dt;
    if (wbLoop && clock >= wbLoop.to) { clock = wbLoop.from; if (audio) audio.currentTime = clock; }
    else if (clock > engine.duration) { clock = engine.duration; setPlaying(false); }
    // 跟音频对齐（允许 ±60ms 漂移，超了就硬拉）
    if (audio) {
      const d = audio.currentTime - clock;
      if (Math.abs(d) > 0.06) audio.currentTime = Math.max(0, clock);
    }
  }
  try {
    engine.render(clock, { preview: true, toScreen: true, samples: 1 });
    const name = engine._activeId(clock);
    if (wbSync) wbSync();
    if (name !== lastName) { lastName = name; refreshHud(engine.errors, engine.validate().gaps); }
  } catch (err) {
    fail(err);
    setPlaying(false);
  }
}

function setPlaying(v) {
  playing = v;
  if (audio) {
    if (v) audio.play().catch(() => {});
    else audio.pause();
  }
  setMsg(v ? '播放中（实时预览 = 1 子帧，成片会更细腻）' : '已暂停');
}

function seek(t) {
  if (!engine) return;
  clock = Math.max(0, Math.min(engine.duration, t));
  if (audio) audio.currentTime = Math.max(0, clock);
  engine.render(clock, { preview: true, toScreen: true, samples: 1 });
}

/** 跳到上/下一段边界 */
function stepScene(dir) {
  if (!engine) return;
  const bounds = engine.timeline.map((i) => i.start);
  if (dir < 0) {
    const prev = bounds.filter((b) => b < clock - 0.05).pop();
    seek(prev ?? 0);
  } else {
    const next = bounds.find((b) => b > clock + 0.05);
    seek(next ?? engine.duration);
  }
}

addEventListener('keydown', (e) => {
  if (!engine) return;
  const step = e.shiftKey ? 5 : 1;
  switch (e.key) {
    case ' ': e.preventDefault(); setPlaying(!playing); break;
    case 'ArrowLeft': seek(clock - step); break;
    case 'ArrowRight': seek(clock + step); break;
    case ',': seek(clock - 1 / engine.fps); break;
    case '.': seek(clock + 1 / engine.fps); break;
    case '[': stepScene(-1); break;
    case ']': stepScene(1); break;
    case 'Home': seek(0); break;
    case 'End': seek(engine.duration); break;
    case 'h': case 'H':
      engine.hud = !engine.hud;
      $('hud').style.display = engine.hud ? '' : 'none';
      break;
    default: break;
  }
});

/* ------------------------------------------------------------------ 离屏协议 */

/**
 * 像素数组的确定性指纹：两个 32 位 FNV-1a（不同种子与质数）拼成 64 位十六进制。
 *
 * 为什么不用 crypto.subtle：它是异步的、而且要求安全上下文；更实际的问题是
 * 我们只需要「改了没有」，两个独立哈希同时撞车的概率可以忽略（同一位被两种不同
 * 混合方式抹平才可能漏，实际不会发生）。0.1ms 级别，1080p 也不算负担。
 */
function hashPixels(buf) {
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  const PRIME1 = 16777619, PRIME2 = 2246822519;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    h1 = Math.imul(h1 ^ b, PRIME1) >>> 0;
    h2 = Math.imul(h2 ^ (b + i), PRIME2) >>> 0;
  }
  // 长度也进哈希：内容相同但尺寸不同必须区分开
  const len = buf.length >>> 0;
  h1 = Math.imul(h1 ^ len, PRIME1) >>> 0;
  h2 = Math.imul(h2 ^ (len * 2654435761), PRIME2) >>> 0;
  return { hash: h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'), bytes: buf.length };
}

/**
 * 逐通道比两张 RGBA（显示空间 0..255），返回 max / mean / 超阈值像素占比。
 * `diffTo` 与 `diffToB64` 共用（两处判据必须完全一致，否则 `hashes` 的结论会飘）。
 */
function comparePixels(a, b) {
  if (a.length !== b.length) throw new Error(`像素长度不一致：${a.length} vs ${b.length}`);
  let max = 0, sum = 0, over8 = 0, over16 = 0, over32 = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
    sum += d;
    if (d > 8) over8++;
    if (d > 16) over16++;
    if (d > 32) over32++;
  }
  return {
    max, mean: sum / a.length,
    over8: over8 / a.length, over16: over16 / a.length, over32: over32 / a.length,
    bytes: a.length,
  };
}

/**
 * 版面守门的采样时刻（纯函数，tools/test-layout.mjs 钉住）。
 *
 * 三点：15% / 50% / 85% —— 与逐段亮度守门同一套（入场头 1 秒最容易出问题，只看中点会漏）。
 * ⚠ 15% 落进开头 0.4s 时去掉：那时字多半还在逐字入场，"还没揭晓"不该算成"一屏挤了这么多"。
 */
export function planLayoutSamples(start, dur) {
  const pts = [0.15, 0.5, 0.85].map((k) => start + dur * k);
  const keep = pts.filter((t, i) => !(i === 0 && t - start < 0.4));
  return keep.length ? keep : [start + dur * 0.5];
}

/**
 * 这一支片子的版面阈值：默认 LAYOUT_LIMITS，任务可以用 layout 字段覆盖（见 docs/LAYOUT.md）。
 * 只覆盖认识的键 —— 写错键名不会静默变成"没有上限"。
 */
export function layoutLimits(overrides) {
  const out = { ...LAYOUT_LIMITS };
  if (overrides && typeof overrides === "object") {
    for (const k of Object.keys(out)) {
      const v = Number(overrides[k]);
      if (Number.isFinite(v) && v >= 0) out[k] = v;
    }
  }
  return out;
}

/** base64 → Uint8Array（`atob` 出来的是 latin1 字符串，逐字节取 code）。 */
function b64Bytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * CLI 通过 window.__anim 驱动：
 *   info()                     元信息
 *   still(t, {samples})        渲染并返回 PNG dataURL
 *   frame(t, opts)             渲染并返回 RGBA（自下而上）
 *   png()                      把当前帧转 PNG
 *   stream({from,to,fps,ws,…}) 逐帧渲染 -> WebSocket 推给 ffmpeg（带背压）
 *                              `scanNf` = 每几帧顺带扫一次这一帧的浮点 RT 有没有 NaN/±Inf
 *   readAt(t)                  在 t 处取像素统计（做自动检测用）
 */
const api = {
  /** 单帧预览（1 子帧）：agent 自检用，快 */
  preview(t) { return this.still(t, { samples: 1 }); },
  /** 一段时间的缩略拼图（n 帧），agent 一眼看节奏 */
  async previewRange(t0, t1, n = 9, cols = 3) {
    const c = document.createElement('canvas');
    const W = 480, H = Math.round((W * (engine?.gl.h ?? 9)) / (engine?.gl.w ?? 16));
    const rows = Math.ceil(n / cols);
    c.width = W * cols; c.height = H * rows;
    const g = c.getContext('2d');
    for (let i = 0; i < n; i++) {
      const t = t0 + ((t1 - t0) * i) / Math.max(1, n - 1);
      // still() 返回 { png, samples, errors }，不是裸 dataURL
      const { png } = await this.still(t, { samples: 1 });
      const img = new Image();
      img.src = png;
      await img.decode();
      g.drawImage(img, (i % cols) * W, Math.floor(i / cols) * H, W, H);
      g.fillStyle = 'rgba(0,0,0,.55)';
      g.fillRect((i % cols) * W, Math.floor(i / cols) * H + H - 16, 64, 16);
      g.fillStyle = '#ff4d12';
      g.font = '11px monospace';
      g.fillText(t.toFixed(2) + 's', (i % cols) * W + 4, Math.floor(i / cols) * H + H - 4);
    }
    return c.toDataURL('image/png');
  },
  /** 精确帧：与导出同一条路径（多子帧），返回与 1 子帧预览的差异 */
  precise(t) { seek(t); return preciseFrame(); },
  info() {
    return {
      task: status.task,
      width: engine?.gl.w ?? 0,
      height: engine?.gl.h ?? 0,
      scale: engine?.gl.scale ?? 1,
      pw: engine?.gl.pw ?? 0,
      ph: engine?.gl.ph ?? 0,
      fps: engine?.fps ?? 60,
      duration: engine?.duration ?? 0,
      onlyDuration: engine?.onlyDuration ?? 0,
      only: engine?.only ?? null,
      bpm: engine?.music?.bpm ?? 0,
      timeline: (engine?.timeline ?? []).map((i) => ({ id: i.id, start: i.start, end: i.end, note: i.note ?? '' })),
      errors: engine?.errors ?? [],
      /** 场景 render 抛的异常（结构化；P0-3 的机器判据用它） */
      renderErrors: engine?.renderErrors ?? [],
      timelineProblems: engine?.validate().problems ?? [],
      gaps: engine?.validate().gaps ?? [],
      renderer: engine?.gl.renderer ?? '',
      /** 完整的 GPU 信息（含 unmasked 串）—— `check` 与 `gpu` 读同一份，见 gl.js 的注释 */
      gpu: engine?.gl.rendererInfo ?? null,
      rendererLabel: engine?.gl.rendererLabel ?? '',
      /** 风格包（docs/STYLE.md）：`check` 会打印当前用的是哪一套 */
      style: engine?.style
        ? { name: engine.style.name, label: engine.style.label, motif: engine.style.motif, fonts: Object.keys(engine.style.fonts ?? {}).length }
        : null,
      /**
       * 字幕层状态（docs/CAPTIONS.md）：`check` 用它提示"有旁白却没开字幕"，
       * 以及字幕带落在哪 —— 观众反馈里"两条字幕"那件事就发生在这一层没被开起来的时候。
       */
      captions: engine?.captions
        ? { on: true, band: engine.captions.band, hold: engine.captions.style.hold, karaoke: !!engine.captions.style.karaoke }
        : { on: false },
      narrationLines: engine?.narration?.lines?.length ?? 0,
      /**
       * 旁白句子明细：`check` 用它查"字幕会不会跨越场景切换"
       * （Netflix timed-text 规范：字幕不得跨 scene change，见 `docs/CAPTIONS.md`）。
       */
      narration: (engine?.narration?.lines ?? []).map((l) => ({
        id: l.id, text: l.text, start: l.start, end: l.end,
      })),
      /**
       * 版面守门的阈值（docs/LAYOUT.md）：任务可以用 layout: { maxBlocks: 8 } 覆盖。
       * check 会把它打出来 —— 阈值是"看得见"的，改没改一眼就知道。
       */
      layoutLimits: layoutLimits(engine?.style?.layout),
      /** 风格/版面的运行期警告（kit 的 assertInBand / captionNote 过长等会 push 到这里） */
      warnings: engine?.warnings ?? [],
    };
  },

  /** 渲染一帧（默认 1 子帧，预览用）。 */
  async frame(t, opts = {}) {
    if (!engine) throw new Error('引擎未就绪');
    const r = engine.render(t, {
      samples: opts.samples ?? 1,
      shutter: opts.shutter ?? 0.5,
      tol: opts.tol,
      toScreen: true,
      preview: opts.preview ?? false,
      seeked: true,
    });
    // 自适应采样的**结论**跟着回来：子帧数只是结果，"为什么停在这里"才是有用的信息
    // （docs/history/HANDOFF-spectrum-friction.md §1 抱怨的正是"引擎从不解释自己"）。
    return {
      samples: r.samples, errors: r.errors,
      reason: engine.lastSampleReason, maxSamples: engine.lastMaxSamples,
      cappedBy: engine.lastCappedBy,
    };
  },

  /**
   * 渲染并返回 PNG dataURL（给 CLI 存 stills / 给 agent 用 Read 看图）。
   * 同时带上这一帧实际用掉的子帧数与采样误差，方便判断运动模糊够不够。
   */
  async still(t, opts = {}) {
    const r = await api.frame(t, opts);
    return { png: api.png(), samples: r.samples, errors: r.errors, reason: r.reason };
  },

  /** 当前帧（或指定时刻）的 RGBA 像素，自下而上（WebGL 原生顺序），**显示空间（已 sRGB 编码）**。 */
  async pixels(t, opts = {}) {
    if (t !== undefined && t !== null) await api.frame(t, opts);
    const buf = engine.readPixels();
    return new Uint8Array(buf);
  },

  /**
   * 渲染 t 时刻并返回裸像素（base64 的 RGBA，自下而上、显示空间）。
   *
   * CLI 的 `verify` 用它和**成片抽出来的那一帧**逐像素比 —— 渲染是 t 的纯函数，
   * 所以同一条时间线上「成片第 N 帧」与「still 出来的那帧」必须一致。
   * 一次性能抓住三类问题：分段拼接错位 / 帧数不对 / 色彩空间不一致。
   * @param {number} t @param {{samples?: any, shutter?: number}} [opts]
   */
  async framePixels(t, opts = {}) {
    const buf = await api.pixels(t, opts ?? { samples: 1 });
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) {
      s += String.fromCharCode.apply(null, /** @type {any} */ (buf.subarray(i, i + CH)));
    }
    return { pixels: btoa(s), bytes: buf.length };
  },

  /**
   * 当前帧转成 PNG dataURL。
   *
   * `engine.readPixels()` 内部已经做了 linear→sRGB 编码（见 engine.js），
   * 所以这里的 PNG 与浏览器里看到的画面逐像素一致。
   */
  png() {
    if (!engine) throw new Error('引擎未就绪');
    const gl = engine.gl;
    const buf = engine.readPixels();
    const cv = document.createElement('canvas');
    cv.width = gl.pw; cv.height = gl.ph;
    const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
    const img = ctx.createImageData(gl.pw, gl.ph);
    // WebGL 自下而上 -> ImageData 自上而下
    const row = gl.pw * 4;
    for (let y = 0; y < gl.ph; y++) {
      const src = (gl.ph - 1 - y) * row;
      img.data.set(buf.subarray(src, src + row), y * row);
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  },

  /**
   * **封面**：渲染 t 时刻的帧，再在它上面压字（BACKLOG 1-53）。
   *
   * 为什么在页面里压而不是用 ffmpeg 的 drawtext：字体已经由 TextKit 加载好了
   * （Archivo / Noto Sans SC / IBM Plex Mono），ffmpeg 那边的 drawtext 还要自己
   * 拼 fontfile 路径 + 转义，中文字形与引擎里的**不是同一套**。这里用的是同一份字体栈，
   * 封面与成片里的字看起来是一家人。
   *
   * 压字结构（自下而上）：底部渐变蒙版（保证任何画面上都读得清）→ 主标题 → 一条信号色短线 → 副标。
   *
   * @param {number} t
   * @param {{ title?: string, sub?: string, scrim?: number, scale?: number }} [opts]
   */
  async cover(t, opts = {}) {
    const r = await api.frame(t, { samples: 'auto' });
    const gl = engine.gl;
    const buf = engine.readPixels();
    const cv = document.createElement('canvas');
    cv.width = gl.pw; cv.height = gl.ph;
    const c = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
    const img = c.createImageData(gl.pw, gl.ph);
    const row = gl.pw * 4;
    for (let y = 0; y < gl.ph; y++) {
      const src = (gl.ph - 1 - y) * row;
      img.data.set(buf.subarray(src, src + row), y * row);
    }
    c.putImageData(img, 0, 0);

    // 逻辑坐标 → 物理坐标（--scale 2 出 4K 封面时，字的视觉大小不变）
    const k = gl.scale || 1;
    const W = gl.w, H = gl.h;
    const fam = (n) => engine.text?.families?.[n] ?? n;
    const title = String(opts.title ?? '').trim();
    const sub = String(opts.sub ?? '').trim();

    // 1) 底部渐变蒙版：0 → scrim（默认 0.82），只压下半屏
    if (title || sub) {
      const scrim = Math.max(0, Math.min(1, opts.scrim ?? 0.82));
      const g = c.createLinearGradient(0, cv.height * 0.42, 0, cv.height);
      g.addColorStop(0, 'rgba(6,6,7,0)');
      g.addColorStop(0.55, 'rgba(6,6,7,' + (scrim * 0.55).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(6,6,7,' + scrim.toFixed(3) + ')');
      c.fillStyle = g;
      c.fillRect(0, 0, cv.width, cv.height);
    }

    const px = 120 * k;
    let baseline = (H - 150) * k;
    c.textBaseline = 'alphabetic';

    if (sub) {
      // 2) 副标在上（等宽、信号色）—— 先算它，标题再往上排
      const subSize = 26 * k;
      c.font = '400 ' + subSize + 'px ' + fam('mono');
      c.fillStyle = 'rgba(255,77,18,0.92)';
      c.fillText(sub, px, baseline);
      // ⚠ 原来只上移 46px，而标题 96px —— 副标会压在标题字身上（实测踩过）
      baseline -= 92 * k;
    }
    if (title) {
      // 3) 主标题：大字、自动缩到 78% 宽以内（长标题不被裁）
      let size = 96 * k;
      c.font = '800 ' + size + 'px ' + fam('sans');
      const maxW = cv.width * 0.78;
      const w = c.measureText(title).width;
      if (w > maxW) size *= maxW / w;
      c.font = '800 ' + size + 'px ' + fam('sans');
      c.fillStyle = '#eee9df';
      c.fillText(title, px, baseline);
      // 4) 标题下一条信号色短线
      c.fillStyle = '#ff4d12';
      c.fillRect(px, baseline + 18 * k, Math.min(260 * k, cv.width * 0.2), 4 * k);
    }
    return { png: cv.toDataURL('image/png'), samples: r.samples };
  },

  /**
   * 非有限值（NaN / ±Inf）扫描：**「整屏白」这一类事故的唯一可靠判据**。
   *
   * 为什么不能靠看图或靠 `stats()`：`readPixels()` 读的是 8bit，
   * `Math.round(NaN * 255)` → 0、`Inf` → 255，而**两者在后处理之后长得一模一样**
   * （实测 NaN 与 Inf 两帧 PNG 逐字节相同，都是"整屏白 + 暗角"）。
   * 多子帧那条路更绕：累加 pass 会把非有限值丢掉，于是同一段成片里反而发黑。
   * 这里直接读浮点缓冲，NaN / Inf 分开数，并给出第一个坏像素的位置。
   *
   * @param {number} t
   */
  nonFinite(t) {
    if (!engine) throw new Error('引擎未就绪');
    return engine.probeNonFinite(t);
  },

  /**
   * 渲染当前帧并返回画面统计（做「是不是全黑 / 是不是过曝」这类自动检查）。
   * 像素已在显示空间（sRGB 编码后），所以这里的阈值就是「肉眼看到的亮度」。
   */
  async stats(t, opts = {}) {
    if (t !== undefined && t !== null) await api.frame(t, opts);
    const buf = engine.readPixels();
    let sum = 0, max = 0, dark = 0, blown = 0, clipped = 0, n = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const l = (buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722) / 255;
      sum += l; if (l > max) max = l;
      if (l < 0.02) dark++;
      if (l > 0.99) blown++;
      if (buf[i] >= 253 && buf[i + 1] >= 253 && buf[i + 2] >= 253) clipped++;
      n++;
    }
    return {
      mean: sum / n, max, darkRatio: dark / n, pixels: n,
      /** 亮度 > 0.99 的像素占比：过曝的第一信号 */
      blownRatio: blown / n,
      /** RGB 三通道都顶到 253+ 的像素占比：真正的「死白」（信息已经丢了） */
      clippedRatio: clipped / n,
    };
  },

  /**
   * 逐帧渲染并推流。契约（CLI 和页面各守一半，改动前想清楚）：
   *   · 每帧发一个二进制消息：[12 字节帧头 = 子帧数 | shake.dx | shake.dy，三个 float32][**NV12** 像素]
   *     （NV12 = YUV420 半平面：Y 全分辨率 + 交错 UV 半分辨率 ⇒ 每帧 3.11MB 而不是 RGBA 的 8.3MB；
   *      GPU 侧已经转好，ffmpeg 用 `-pix_fmt nv12` 直接吃，见 `engine.readNV12()`）
   *   · 像素是**显示空间（已 sRGB 编码）**，与 ffmpeg 侧的 bt709 标记一致
   *   · 页面发完就等 ack 文本消息，收到才继续（背压，防止 4K 撑爆内存）
   *   · CLI 只做「收帧 / 写 ffmpeg / 回 ack」三件事，绝不在回 ack 前调 page.evaluate，
   *     否则会和这里的同步渲染循环互相等待而死锁
   *   · 文本消息（`'ack'` 之外）全是**诊断**，一律不参与帧计数：
   *     `{diag:'renderError'}`（场景抛异常，P0-3）与 `{diag:'nonFinite'}`（这一帧的浮点 RT 里有
   *     NaN/±Inf/量级爆掉，BACKLOG 1-4，由 `o.scanNf` 决定每几帧扫一次）
   */
  stream(o) {
    let ws;
    try {
      ws = new WebSocket(o.ws);
    } catch (err) {
      status.error = `WebSocket 无法创建 (${o.ws}): ${err && err.message}`;
      throw err;
    }
    ws.binaryType = 'arraybuffer';
    const total = Math.max(0, Math.round((o.to - o.from) * o.fps));
    let i = 0;
    let inflight = 0;
    streamState.started++;
    streamState.url = o.ws;
    streamState.total = total;
    streamState.sent = 0;
    streamState.readyState = ws.readyState;
    streamState.lastError = '';

    /**
     * 推流期间报「这段场景抛异常了」（P0-3）。
     *
     * 为什么要走 WS 而不是让 CLI 用 `page.evaluate` 去问：契约里写死了
     * 「CLI 绝不在回 ack 前调 page.evaluate」（会和这里的同步渲染循环互相等待而死锁），
     * 而这个循环一跑就是几十分钟。所以由页面**主动推**一条文本消息 ——
     * CLI 本来就在按 `isBinary` 过滤文本消息，加一条 'diag' 完全不影响帧计数。
     */
    let lastErrCount = 0;
    const reportRenderErrors = () => {
      const n = engine?.renderErrors?.length ?? 0;
      if (n <= lastErrCount) return;
      lastErrCount = n;
      const e = engine.renderErrors[engine.renderErrors.length - 1];
      try {
        ws.send(JSON.stringify({
          diag: 'renderError',
          id: e.id, t: e.t, idx: e.idx, message: e.message,
          total: n, atFrame: i,
        }));
      } catch { /* 连接断了就算了，CLI 收尾还会问一次 */ }
    };

    /**
     * 出片路径的「非有限值」扫描（`docs/BACKLOG.md` 1-4）。
     *
     * 为什么扫描点必须在**页面里**：CLI 收到的是 NV12（GPU 上已经转成 8bit 的 YUV），
     * 帧数据里**已经没有浮点信息** —— `Math.round(NaN * 255)` → 0、`Inf` → 255，
     * 两者在显示上一模一样（实测两张 PNG 逐字节相同）。所以只能扫这一帧的 float RT。
     *
     * `o.scanNf` = 每多少帧扫一次（0 / 未给 = 不扫）。扫描由 `engine.render` 顺带做
     * （`opts.scanNf`，见 `Engine._scanFrameNonFinite`）：**不额外渲一帧**，
     * 只多一次整屏浮点回读 + 一次 JS 扫描。频率与实测代价见 `scripts/anim.mjs` 的 `--scan-nf`。
     */
    const scanNf = Math.max(0, Math.floor(Number(o.scanNf) || 0));

    /** 把一次扫描结果推给 CLI（CLI 侧做聚合、限流与收尾汇总）。 */
    const reportNonFinite = (nf) => {
      if (!nf || !nf.bad) return;
      try {
        ws.send(JSON.stringify({
          diag: 'nonFinite',
          id: nf.id, ids: nf.ids, t: nf.t, subT: nf.subT, idx: nf.idx, sub: nf.sub,
          nan: nf.nan, inf: nf.inf, huge: nf.huge, hugeMax: nf.hugeMax,
          bad: nf.bad, pixels: nf.pixels,
          first: nf.first ? { x: nf.first.x, y: nf.first.y, kind: nf.first.kind } : null,
          atFrame: i,
        }));
      } catch { /* 连接断了就算了 */ }
    };

    const step = () => {
      if (i >= total) { ws.send(JSON.stringify({ done: i })); return; }
      const t = o.from + i / o.fps;
      // 每 scanNf 帧扫一次这一帧的浮点 RT（NaN / ±Inf）。第 0 帧必扫 —— 一开场就错的场景
      // 不该等到第 30 帧才报出来。扫描由 render 顺带做，不额外渲一帧。
      const doScan = scanNf > 0 && i % scanNf === 0;
      const r = engine.render(t, {
        samples: o.samples ?? 'auto',
        shutter: o.shutter ?? 0.5,
        tol: o.tol,
        toScreen: false,
        seeked: true,
        scanNf: doScan,
      });
      const px = engine.readNV12();
      // 帧头 12 字节 = 子帧数 + 这一帧的 post.shake（逻辑像素，y 向下），其后是 **NV12** 像素
      // （Y 平面 w×h + 交错 UV 平面 w/2×h/2 = 每帧 3.11MB，比 RGBA 少 62%）。
      // 载荷格式由 `scripts/anim.mjs` 的 ffmpeg 参数（`-pix_fmt nv12`）对接，两边必须一起改。
      // shake 搭车回去是**故意的**：CLI 收尾时能顺手统计「这一整片是不是逐帧白噪声」
      // 并当场提醒 —— 不用等成片出来、更不用拿成片做互相关（docs/history/IMPROVEMENTS-1-3.md 建议 F）。
      // ⚠ 改帧头长度要同时改 scripts/anim.mjs 里读它的地方（搜 `FRAME_HEADER`）。
      const sh = engine.lastPost?.shake;
      const out = new Uint8Array(12 + px.length);
      const dv = new DataView(out.buffer);
      dv.setFloat32(0, r.samples, true);
      dv.setFloat32(4, Array.isArray(sh) ? (Number(sh[0]) || 0) : 0, true);
      dv.setFloat32(8, Array.isArray(sh) ? (Number(sh[1]) || 0) : 0, true);
      out.set(px, 12);
      ws.send(out);
      i++;
      streamState.sent = i;
      streamState.readyState = ws.readyState;
      reportRenderErrors();
      // 非有限值只在这一帧扫过时才可能非空（`engine.lastNonFinite` 每帧开头会清零）
      if (doScan) reportNonFinite(engine.lastNonFinite);
      if (i % 30 === 0) setMsg(`渲染中 ${i}/${total} 帧 · ${r.samples} 子帧 · ${((100 * i) / total).toFixed(0)}%`);
      if (inflight < (o.inflight ?? 4)) { inflight++; step(); }
    };

    ws.onopen = () => { streamState.readyState = ws.readyState; status.message = '推流中…'; step(); };
    ws.onmessage = () => { inflight--; if (i < total) step(); };
    ws.onerror = (e) => {
      streamState.lastError = 'onerror';
      status.error = `WebSocket 连接失败：${o.ws}（端口不通？）`;
      console.error('stream ws error', e);
    };
    ws.onclose = (e) => {
      streamState.readyState = ws.readyState;
      streamState.lastError = `onclose code=${e.code} reason=${e.reason}`;
      if (i < total) console.error(`stream ws 提前关闭 code=${e.code} reason=${e.reason}`);
    };
    return { total, ws: o.ws };
  },

  /**
   * 渲染一帧并算一个**确定性指纹**（像素的 64 位哈希）。
   *
   * 用途：改引擎或重构场景之后，证明「画面逐像素没变」。这比人眼看图可靠得多，
   * 也是 A 档镜头库那条验收（「模板化之后 still 与改造前逐像素一致」，`docs/history/STATUS-rounds-7-10.md` §14）的机械判据。
   *
   * ⚠ 只对 `samples: 1` 有意义：多子帧本身是确定的，但子帧数会随自适应误差浮动，
   *   指纹也就跟着浮动。要比指纹就固定 `--samples 1`。
   *
   * @param {number} t @param {{samples?: any, shutter?: number}} [opts]
   */
  async hash(t, opts = {}) {
    if (!engine) throw new Error('引擎未就绪');
    const r = await api.frame(t, opts);
    const buf = engine.readPixels();
    const out = { ...hashPixels(buf), samples: r.samples };
    if (opts.pixels) {
      // base64 原始 RGBA（自下而上、显示空间）：比 JSON 数字数组小 5 倍，
      // 且能直接喂回 diffTo 做「差了多少」的比对（CLI 侧再按帧做 delta 压缩）。
      let s = '';
      const CH = 0x8000;
      for (let i = 0; i < buf.length; i += CH) {
        s += String.fromCharCode.apply(null, /** @type {any} */ (buf.subarray(i, i + CH)));
      }
      out.pixels = btoa(s);
    }
    return out;
  },

  /**
   * 与 `hash(t, {pixels:true})` 配对：传入上次的像素，返回**逐通道差的最大值与均值**。
   *
   * 为什么不用哈希判断"改没改"：GPU 在若干 tile 上会有最后一位（1/255）的噪声，
   * 例如「转场交叠到 95% 的那一帧」对上游微扰极敏感，跨进程重渲可能差 1 个 LSB。
   * 所以正确的比对方式是**看差了多少**，而不是看是否完全相等。
   * @param {number[]|Uint8Array} prev @param {number} t @param {{samples?:any, shutter?:number}} [opts]
   */
  async diffTo(prev, t, opts = {}) {
    if (!engine) throw new Error('引擎未就绪');
    await api.frame(t, opts);
    const b = engine.readPixels();
    const a = prev instanceof Uint8Array ? prev : Uint8Array.from(prev);
    return comparePixels(a, b);
  },

  /**
   * 与 `diffTo` 等价，但**参考帧用 base64 传**（`anim hashes --baseline` 走这条）。
   *
   * 为什么需要它：`diffTo` 的参数要经 `page.evaluate` 序列化，如果传的是普通数组，
   * CLI 就得把 8.3MB 展开成 **830 万个数字**（demo 基线 11 帧实测要几分钟）。
   * base64 只是一条字符串，解码 ~几十毫秒。
   * @param {string} b64 参考帧（RGBA，自下而上、显示空间；由 `Buffer.toString('base64')` 得来）
   * @param {number} t @param {{samples?:any, shutter?:number}} [opts]
   */
  async diffToB64(b64, t, opts = {}) {
    if (!engine) throw new Error('引擎未就绪');
    await api.frame(t, opts);
    const b = engine.readPixels();
    const a = b64Bytes(b64);
    return comparePixels(a, b);
  },

  /**
   * 连续渲染同一个时刻 n 次，返回每次的哈希 —— 用来抓「首帧与后续帧不一致」这类
   * 只在第一次渲染时出现的问题（惰性编译、未初始化的缓冲）。
   * @param {number} t @param {number} [n]
   */
  async hashTimes(t, n = 4) {
    if (!engine) throw new Error('引擎未就绪');
    const out = [];
    for (let i = 0; i < n; i++) {
      await api.frame(t, { samples: 1 });
      out.push(hashPixels(engine.readPixels()).hash);
    }
    return out;
  },

  /**
   * 渲染两帧并做**逐像素差分**（显示空间 0..255）。返回通道差的 max / mean 与超阈值像素占比。
   *
   * `hash` 是严格的（差一个 bit 就不一样），实践中更常用的是它：
   * 判断「同一时刻两次渲染到底差多少」「成片抽帧和 still 差多少」。
   * @param {number} t1 @param {number} t2
   * @param {{ samples?: any, shutter?: number }} [opts]
   */
  async diff(t1, t2, opts = {}) {
    if (!engine) throw new Error('引擎未就绪');
    await api.frame(t1, opts);
    // ⚠ `readPixels()` 返回的是**复用缓冲**（1080p 下每帧省 ~190ms，见 gl.js 的说明），
    // 这里必须显式复制：下面还有一次 `await`，第二次读回会把 a 覆盖掉。
    const a = new Uint8Array(engine.readPixels());
    await api.frame(t2, opts);
    const b = engine.readPixels();
    let max = 0, sum = 0, over8 = 0, over32 = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (d > max) max = d;
      sum += d;
      if (d > 8) over8++;
      if (d > 32) over32++;
    }
    return { max, mean: sum / a.length, over8: over8 / a.length, over32: over32 / a.length, samples: a.length };
  },

  /**
   * 按给定顺序渲染一串时刻，返回每一帧的**粗指纹**与亮度统计。
   *
   * 粗指纹 = 每 16 个像素取一个（1080p 约 51 万个采样点）。用它比"完整哈希"更宽容：
   * 1 个 LSB 的噪声会被平均掉，但画面真的变了（元素错位、颜色整体偏）一定会露出来。
   * `--warm` 这类"渲染顺序会不会影响结果"的问题就靠它回答。
   * @param {number[]} times
   */
  async probe(times) {
    if (!engine) throw new Error('引擎未就绪');
    const out = [];
    for (const t of times) {
      await api.frame(t, { samples: 1 });
      const px = engine.readPixels();
      let h1 = 0x811c9dc5, sum = 0, max = 0, n = 0;
      for (let i = 0; i < px.length; i += 64) {   // 每 16 像素（64 字节）取一个
        h1 = Math.imul(h1 ^ px[i], 16777619) >>> 0;
        const l = (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) / 255;
        sum += l; if (l > max) max = l; n++;
      }
      out.push({ t, hash: h1.toString(16).padStart(8, '0'), mean: sum / n, max, n });
    }
    return out;
  },


  /**
   * **画面语义断言的页面侧**（BACKLOG 1-18）：按 `planMotionAsserts()`（src/timeline.js 的
   * 纯函数，采样计划与阈值都在那儿）给的行渲帧、算像素差、读版面记账。写法对照 worldAudit()。
   *
   * 每行的形状 `{ key, kind, id, times, param }`（plan.render 的字段），我们只做三件事：
   *   · **appearsBy**：times[0]（基线）→ times[1]（判据点）渲一帧对，算 changedRatio；
   *   · **keepsMoving**：times 相邻两两渲帧对（前一对的第二帧就是后一对的第一帧，不重复渲）；
   *   · **noEdgeContent**：times 各渲一帧，读 layoutRows() 的记账（白拿，不额外花渲染）。
   *
   * changedRatio 口径：**每 4 个像素取 1 个**（与 worldAudit 的 meanOf 同一下采样量级）、
   * 每像素用 luma 权重（stats() 同一套）算亮度，`|Δ亮度| > 1/255` 记"发生了可见变化"，
   * 占比即 changedRatio。判定阈值是 motion.json 的 `thresholds.changed`（判读在纯函数
   * `motionVerdict()` 里，这里只出**读数**）。
   *
   * 渲染异常照 worldAudit 的 try/catch 模式：把 `error` 记进 samples，**不中断**整次审计 ——
   * 某一段渲不出来是那一行"没判"（motionVerdict 进 skipped），不是整个 check 崩掉。
   */
  async motionAudit(rows) {
    if (!engine) throw new Error('引擎未就绪');
    const list = Array.isArray(rows) ? rows : [];
    const out = [];
    /** 与 worldAudit 的 meanOf 同一个下采样思路，但这里要的是**差分**而不是均值 */
    const changedRatioOf = (a, b) => {
      let changed = 0, n = 0;
      for (let i = 0; i < a.length; i += 16) {
        const la = (a[i] * 0.2126 + a[i + 1] * 0.7152 + a[i + 2] * 0.0722) / 255;
        const lb = (b[i] * 0.2126 + b[i + 1] * 0.7152 + b[i + 2] * 0.0722) / 255;
        if (Math.abs(la - lb) > 1 / 255) changed++;
        n++;
      }
      return n ? changed / n : 0;
    };
    for (const row of list) {
      if (!row || typeof row.key !== 'string') continue;
      const samples = [];
      let prev = null;          // 上一帧的像素副本（keepsMoving 相邻对共用，不重复渲）
      const nTimes = Array.isArray(row.times) ? row.times.length : 0;
      for (let i = 0; i < nTimes; i++) {
        const t = Number(row.times[i]);
        try {
          await api.frame(t, { samples: 1 });
          // ⚠ readPixels() 返回复用缓冲：只要下面还有一次渲染，就必须先存副本（diff() 踩过的坑）
          const px = new Uint8Array(engine.readPixels());
          if (row.kind === 'keepsMoving') {
            // 相邻时刻各成一对（时刻间距 = MOTION_STEP，帧本身渲 samples:1）：
            // 变化的是"这一对之间动没动"，与子帧数无关。
            if (prev) samples.push({ t, changedRatio: changedRatioOf(prev, px) });
            if (i === nTimes - 1 && samples.length === 0) {
              // 只排出一个时刻 = 段太短：给个"在动"的读数占位，判读那边按"零对帧"说没判
              samples.push({ t, changedRatio: 1, placeholder: true });
            }
            prev = px;
          } else if (row.kind === 'appearsBy') {
            if (i === 0) { prev = px; continue; }     // times[0] = 基线帧
            if (prev) samples.push({ t, changedRatio: changedRatioOf(prev, px) });
            prev = px;
          } else {
            // noEdgeContent：读这一帧的版面记账（layoutRows 不渲染，白拿）
            let groups = [], W = engine.gl.w, H = engine.gl.h;
            try {
              const lr = await api.layoutRows({ id: row.id });
              if (lr?.length && lr[0]?.verdict) {
                groups = lr[0].verdict.groups ?? [];
                W = lr[0].verdict.W ?? W;
                H = lr[0].verdict.H ?? H;
              }
            } catch (e2) { samples.push({ t, error: String(e2 && e2.message ? e2.message : e2) }); prev = px; continue; }
            samples.push({ t, groups, W, H });
            prev = px;
          }
        } catch (err) {
          samples.push({ t, error: String(err && err.message ? err.message : err) });
          prev = null;
        }
      }
      out.push({ key: row.key, kind: row.kind, id: row.id, samples });
    }
    return { rows: out };
  },

  status() { return { ...status }; },

  /**
   * **场景抛异常**的汇总（P0-3）。
   *
   * 为什么要单独一个入口：`engine.errors` 是"人看的字符串"，而且只在装载时读一次；
   * 回读一次（CLI 在渲染完之后调它）。去重 + 归并成"哪一段崩了、崩了多少帧、第一帧是哪个"，
   * 这样 CLI 可以一句话点名，而不是刷 7000 行一样的栈。
   *
   * @returns {{ count: number, bySegment: {id:string, frames:number, firstT:number, message:string}[], text: string[] }}
   */
  renderErrors() {
    const list = engine?.renderErrors ?? [];
    const by = new Map();
    for (const e of list) {
      const hit = by.get(e.id);
      if (hit) { hit.frames++; continue; }
      by.set(e.id, { id: e.id, frames: 1, firstT: e.t, message: e.message });
    }
    const bySegment = [...by.values()];
    return {
      count: list.length,
      bySegment,
      text: bySegment.map((b) => `[${b.id}] 场景 render 抛异常 ${b.frames} 帧（最早 t=${b.firstT.toFixed(3)}s）：${b.message.split('\n')[0]}`),
    };
  },

  /** 自上次调用以来新增的场景异常（推流时用：一帧都不该带着异常流出去）。 */
  takeRenderErrors() {
    const r = api.renderErrors();
    if (engine) engine.renderErrors.length = 0;
    return r;
  },

  /**
   * 背景守门（P0-2）：检查有没有「声明了 handlesTransition、但在交叠期整帧什么都没画」的段。
   *
   * 为什么需要它：漏调共享背景的那一段，底是一块**纯黑**（只有 grain 和暗角），而且
   * 不报任何错 —— 亮度统计也抓不到，因为文字/面板/grain 自己就有亮度（实测 0.054，
   * 而"全黑"判据是 0.004 的 13 倍）。做 fidus 时 9 段里 8 段这样，直到抽帧才看出来。
   *
   * 判据是**实际发生的绘制**（`gl.paint` 记账）：一帧里**一次整帧覆盖都没有**（`full === 0`）
   * 就说明这一段根本没往画面里铺底（`gl.clear` 不算绘制）。
   *
   * ── 2026-10-16 两处收紧（BACKLOG 头部 ①⑦）────────────────────────────────────
   *
   * ① **`handlesTransition` 读场景那一份兜底**（`it.handlesTransition ?? it._scene?.handlesTransition`）。
   *    引擎读的是**场景**上的标记（`engine.js` 的 `k > 0 && !scene.handlesTransition && under`），
   *    而守门以前只读**段**上的：配置档节点上没写时，段对象上是 `undefined`，
   *    模板自带的那份（`src/shots/whip.js` 的 `handlesTransition: true`）到不了段对象 ⇒
   *    守门把一段"声明了转场"的段报成 `n`，少算一段。**画面一直是对的**（引擎走场景那份），
   *    错的只是这一行报告 —— 但"报告与引擎口径不齐"本身就会让人误判。
   *
   * ② **每个交叠段采两个时刻**：交叠窗中点（判"铺没铺底"）+ **交叠窗之后**的中点（`tail`）。
   *    以前只采中点，于是"交叠窗之外的部分"没有任何守卫 —— `_config-lab` 的甩镜
   *    19.50–20.50 那 1 秒就是这样一段没人看的区间（"如果那 1 秒真的漏了底，守门也抓不到"）。
   *    **判据仍然只落在交叠窗中点**（`full === 0 && risky`）；窗后中点**只做读数**。
   *    这一条是踩过假报之后定下来的：转场模板在窗后走的是"没有 under"的分支，而那条分支
   *    本来就可能是近黑的（`whip` 的设计值 0.037–0.051）—— 第一版把同一条判据也压上去，
   *    `check demo` 当场把一个**设计如此**的尾巴报成"没铺背景"（假报比不报贵）。
   *    判据本身在纯函数 `src/timeline.js` 的 `worldAuditVerdict()` 里，单测钉住。
   *    顺带把每一刻的**画面平均亮度**也带回去（`samples[].mean`，按每 4 个像素取 1 个估），
   *    让"这一秒到底黑没黑"在 `anim audit` 里看得见 —— 亮度只是**读数**，不 gate。
   *
   * 仍然**不判**的两件事（刻意的）：
   *   · 没有 `handlesTransition`、也没有声明 `world` 的段 —— 清个底色就够了，
   *     不该被要求画全屏 Pass（那种段本来就没有转场语义）；
   *   · `world: false` 的段**不判"铺没铺底"**（那是它自己的声明）—— 它们进的是
   *     返回值的 `selfBase` 那一栏，**读数照给**（`samples[].mean` / `dark`），
   *     只是不进 `results` 那条判据。
   */
  async worldAudit() {
    if (!engine) throw new Error('引擎未就绪');
    const items = engine.timeline;
    const results = [];
    /**
     * 声明了 `world: false`（"整帧底我自己负责"）的段**单独放**：不判"铺没铺底"（那是它的声明），
     * 但**仍然采两个时刻的读数** —— 声明不等于"这段没人看着"。
     * `_config-lab` 的甩镜 19.50–20.50 那 1 秒就是靠这一栏第一次有了读数（BACKLOG 头部 ⑦）。
     */
    const selfBaseRows = [];
    /** 显示空间平均亮度（与 `stats()` 同一套权重；每 4 个像素取 1 个，够判"是不是一片黑"） */
    const meanOf = () => {
      const buf = engine.readPixels();
      let sum = 0, n = 0;
      for (let i = 0; i < buf.length; i += 16) {
        sum += (buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722) / 255;
        n++;
      }
      return n ? sum / n : 0;
    };
    // 采样计划（在哪几个时刻渲、哪几段判、哪几段只给读数）是**纯函数**，见
    // `src/timeline.js` 的 `planWorldAudit()` —— 离线单测 `tools/test-timeline-audit.mjs`
    // 钉住"交叠窗中点 + 窗后中点"两个时刻与 `world: false` 的分流（BACKLOG 头部 ①⑦）。
    for (const plan of planWorldAudit(items)) {
      const it = items[plan.index];
      const { handlesTransition, selfBase, declaredWorld: w, risky, times } = plan;
      const samples = [];
      for (const t of times) {
        try {
          await api.frame(t, { samples: 1 });
        } catch (err) {
          samples.push({ t, error: String(err && err.message ? err.message : err) });
          continue;
        }
        const paint = it._lastPaint ?? null;
        samples.push({
          t,
          full: paint?.full ?? -1,
          any: paint?.any ?? -1,
          lines: paint?.lines ?? -1,
          trace: paint?.trace ?? null,
          mean: meanOf(),
        });
      }
      const first = samples[0] ?? {};
      // 判据是**纯函数**（`src/timeline.js` 的 `worldAuditVerdict()`，离线单测钉住）：
      //   · `missing`  只看**交叠窗中点**那一个采样点（"整帧覆盖"= 全屏 Pass（blend:false）；
      //     文字/矢量层都是带混合的，不算。`world: 'auto'` / 自定义 world 的段由引擎先铺底，
      //     天然满足 —— 引擎那一笔也算进 full）。
      //   · 窗后中点**只做读数**：转场模板在窗后走"没有 under"的分支，本来就可能是近黑的
      //     （`whip` 的设计值 0.037–0.051）—— 把同一条判据也压上去会当场假报（`check demo` 实测）。
      const verdict = worldAuditVerdict(plan, samples);
      const bare = verdict.missing ? [first] : [];
      // `world: false` 的段进 `selfBaseRows`：不判"铺没铺底"，但读数照给（CLI 那边单独打印）
      (selfBase ? selfBaseRows : results).push({
        id: it.id,
        // 兼容旧字段（`anim audit` 的表格与 CLI 的判据读的是这几个）
        t: first.t ?? it.start,
        handlesTransition,
        drawAny: first.any ?? -1,
        full: first.full ?? -1,
        lines: first.lines ?? -1,
        declaredWorld: w,
        trace: first.trace ?? null,
        missing: bare.length > 0,
        missingAt: bare.map((s) => s.t),
        /** 整片段读数（不给判据用，只给 `anim audit` 看）：交叠窗中点 / 窗后中点各一条 */
        samples,
        /** 窗后中点采到了"一片黑"（< 0.004，与逐段亮度守门同一个阈值）——**读数**，不 gate */
        dark: verdict.blackTail,
        /** true = 这一段声明了 `world: false`（"整帧底我自己负责"）⇒ 只给读数、不判铺底 */
        selfBase,
        error: first.error,
      });
    }
    return { results, selfBase: selfBaseRows, timeline: items.length };
  },

  /**
   * **依赖令牌 `under` 的段级审计**（BACKLOG 头部 ② 的收口，2026-10-16）。
   *
   * 判据本身是纯函数，在 `src/timeline.js` 的 `auditUnderRequires()` 里（可离线单测：
   * `tools/test-timeline-audit.mjs`）；这里只负责把**引擎手里那份已展开的时间线**喂给它 ——
   * "交叠够不够"这件事只有在 `build()` 排完时间之后才是个事实
   * （所以它不能像 `music` / `analyze` 那样在开浏览器之前用文本扫描判）。
   */
  underAudit() {
    if (!engine) throw new Error('引擎未就绪');
    return { results: auditUnderRequires(engine.timeline), timeline: engine.timeline.length };
  },

  /**
   * **版面守门**（docs/LAYOUT.md）：**当前这一帧**画了几块字、哪块在主体区里。
   *
   * 为什么必须在这里做、而不是静态扫描源码：**"同一帧里画了几块"是运行期事实**。
   * 钠那一期的问题（观众：「有些动画元素相互遮挡害得我搞不清楚到底要看哪个主体」）
   * 正是"每一屏同时出现的东西太多"—— 场景里写了几处文字、它们什么时候同时出现，
   * 源码文本一个都答不上来（可以跨函数、可以跟着旁白时刻出现、可以是循环里的 16 个编号）。
   *
   * 数据来源是**实际发生的绘制**：gl.paint.blocks（由 src/core/text.js 的 noteText 记下来，
   * 只记画在**这一段自己的图层**上的字）。位置来自绘制参数，宽度在**这一段自己的**
   * TextKit 实例上实测（不同实例的字体栈不同，宽度会差）。
   *
   * ⚠ 它**不渲染**：读的就是"上一次 frame(t) 留下的那一帧记账"。所以 check 里它跟在
   *   逐段亮度采样后面白拿，不额外花一次渲染（246 秒的 sodium 有 12 段，这里省下的是几十秒）。
   *   想要"按自己的采样点跑一遍"，就用 api.frame(t) 把 t 排好再逐点调用它。
   *
   * 判断逻辑一个字都不在这里 —— 全在纯函数 src/layout.js 的 layoutVerdict()
   * （离线单测 tools/test-layout.mjs）。这里只负责"把记账读回来、组装成行"。
   */
  /**
   * @param {{ id?: string }} [o] 只要某一段的记账（`check` 逐段读时用 —— **必须显式点名**：
   *   时间线重叠时当前在播的段可能不止一个，而「某一段这一帧画了几块字」问的是那一段）。
   */
  layoutRows(o = {}) {
    if (!engine) throw new Error('引擎未就绪');
    const W = engine.gl.w, H = engine.gl.h;
    const blocks = [];
    const focusRects = [];
    const ids = [];
    /**
     * 「主体区 0 块字」那一条读数要用的两个量（见 `src/layout.js` 的 `countNonTextDraws()`）：
     *   · `paint` = 这一段的绘制账（次数，没有坐标）；
     *   · `textDrawn` = 这一帧场景有没有提交自己的 2D 图层（= 文字层那次合成要减掉）。
     * 与 focus 同一个口径：交叠期同时画着两段时取**第一段**的那一份。
     */
    let paint = null;
    let textDrawn = false;
    // 这一帧的时刻：引擎渲染完会把 t 记在 lastT 上（check 是离屏渲染，clock 一直停在 0）。
    const t = Number.isFinite(engine.lastT) ? engine.lastT : 0;
    const list = o.id
      ? engine.timeline.filter((i) => i.id === o.id)
      : engine.timeline.filter((i) => (clock >= i.start && clock < i.end) || i._lastPaint);
    for (const it of list) {
      const book = it._lastPaint ?? null;
      if (!book) continue;
      ids.push(it.id);
      const mine = (book.blocks ?? []).map((b) => ({ ...b }));
      // 宽度实测：必须在**这一段自己的** TextKit 上量（字体栈 / 字距缓存都在实例里）
      const tk = it._layer?.typekit;
      if (tk?.measure) {
        for (const b of mine) {
          try { b.w = tk.measure(b.sample, { size: b.size, weight: 400, family: 'sans' }); }
          catch { /* 量不到就留 0：判据会退回中心点判定，不抛 */ }
        }
      }
      blocks.push(...mine);
      if (it.focus) focusRects.push(it.focus);
      if (!paint) { paint = book; textDrawn = !!it._layer?._uploaded; }
    }
    // 交叠期两段同时在画：焦点取第一段声明的那份（引擎的顺序 = 时间线顺序）
    const verdict = layoutVerdict({
      id: ids[0] ?? '', t: t, blocks, focus: focusRects[0] ?? null, W, H,
      limits: layoutLimits(engine.style?.layout),
      paint, textLayerDrawn: textDrawn,
    });
    // 返回整份 verdict（**含真实的 t**）：CLI 直接把它 push 进采样数组。
    // 曾返回过 { id, t: clock, verdict } —— CLI 那边照着旧字段名读，报告里全是 undefined。
    return (ids.length ? ids : ['']).map((id) => ({ id, verdict }));
  },

  /** 调试：把引擎内部状态摊开（时间线、当前活跃段、后处理参数）。 */
  debug(t) {
    const items = t == null ? [] : engine.timeline.filter((i) => t >= i.start && t < i.end).map((i) => i.id);
    return {
      clock: t,
      active: items,
      duration: engine.duration,
      timeline: engine.timeline.map((i) => ({ id: i.id, start: i.start, end: i.end, hasScene: !!i._scene, name: i._scene?.constructor?.name ?? typeof i._scene })),
      errors: engine.errors,
      lastSamples: engine.lastSamples,
      stream: { ...streamState },
    };
  },
};

/** 最近一帧用掉的子帧数 / 采样误差（CLI 统计运动模糊采样分布用）。 */
Object.defineProperty(api, 'lastSamples', { get() { return engine?.lastSamples ?? 1; }, enumerable: true });
Object.defineProperty(api, 'lastErrors', { get() { return engine?.lastErrors ?? []; }, enumerable: true });

/** 等状态就绪（CLI 用） */
api.ready = new Promise((res) => { api._resolveReady = res; });

/** @type {any} */ (window).__anim = api;
/**
 * 引擎实例也挂出来（只给诊断用：`anim determinism` 要读 lastSamples / lastPost /
 * music 这些内部量，来判断"跨帧依赖"到底出在哪一项上）。
 */
Object.defineProperty(window, '__animEngine', { get() { return engine; }, enumerable: false });

boot()
  .then((r) => {
    api.boot = r;
    api._resolveReady?.(status);
    if (status.state === 'ready') {
      setMsg(`就绪 · ${engine?.timeline.length ?? 0} 段 · ${engine?.duration.toFixed(2)}s`);
    }
  })
  .catch(fail);
/* ------------------------------------------------------------------ 预览工作台 */
/**
 * 把 dev 页从「播放器」升级成 **编辑反馈回路**：
 *   · 时间轴 scrub（任意位置立即出帧，不依赖顺序播放）
 *   · 场景边界 + 节拍刻线（切点在哪一眼看到）
 *   · 精确帧按钮：按**导出同一条路径**（多子帧）重渲当前帧，并报与预览的差异
 *   · `window.__anim.preview(t)` / `previewRange(t0,t1,n)`：给 agent 自检用
 *
 * 为什么差值是核心读数：预览默认 1 子帧（快），成片是自适应多子帧 ——
 * 「预览好看、导出翻车」只有把两者差异量化出来才防得住。
 */
let wbLoop = null;   // 循环区间 { from, to } | null
/** 工作台的刷新函数（boot 里装上；loop 每帧调它同步 scrub 指针） */
let wbSync = null;

function wbEl(id) { return document.getElementById(id); }

function setupWorkbench(engineRef) {
  const wrap = wbEl('wb');
  if (!wrap) return;
  wrap.hidden = false;
  const scrub = wbEl('wbScrub');
  const ticks = wbEl('wbTicks');
  const readout = wbEl('wbReadout');
  const dur = Math.max(0.001, engineRef.duration);
  scrub.max = String(dur);

  // 场景刻线 + 节拍刻线
  const frag = document.createDocumentFragment();
  for (const it of engineRef.timeline) {
    const i = document.createElement('i');
    i.style.left = (it.start / dur * 100) + '%';
    frag.appendChild(i);
    if (it.end - it.start > 2.2) {
      const b = document.createElement('b');
      b.style.left = (it.start / dur * 100) + '%';
      b.textContent = it.id;
      frag.appendChild(b);
    }
  }
  const bpm = engineRef.music?.bpm ?? 0;
  if (bpm > 30) {
    const beat = 60 / bpm;
    for (let t = 0; t <= dur; t += beat) {
      const i = document.createElement('i');
      i.className = 'beat';
      i.style.left = (t / dur * 100) + '%';
      frag.appendChild(i);
    }
  }
  const cursor = document.createElement('i');
  cursor.className = 'cur';
  frag.appendChild(cursor);
  ticks.appendChild(frag);

  const sync = () => {
    scrub.value = String(clock);
    cursor.style.left = (clock / dur * 100) + '%';
    const id = engineRef._activeId(clock);
    readout.textContent = `t ${clock.toFixed(2)} / ${dur.toFixed(2)}s · 段 ${id} · 预览 1 子帧`;
  };
  wbSync = sync;
  sync();

  // 拖动中走快路径（跳过后处理）；松手补一次完整渲染 —— 「拖得动」和「看得准」都要成立
  let dragging = false;
  scrub.addEventListener('pointerdown', () => { dragging = true; });
  scrub.addEventListener('input', () => {
    const nt = Number(scrub.value);
    clock = Math.max(0, Math.min(engineRef.duration, nt));
    if (audio) audio.currentTime = clock;
    engineRef.render(clock, { preview: true, toScreen: true, samples: 1, skipPost: true });
    sync();
  });
  const endDrag = () => { if (!dragging) return; dragging = false; seek(clock); sync(); };
  scrub.addEventListener('pointerup', endDrag);
  addEventListener('pointerup', endDrag);
  wbEl('wbPlay').addEventListener('click', () => { setPlaying(!playing); wbEl('wbPlay').textContent = playing ? '❚❚ 暂停' : '▶ 播放'; });
  wbEl('wbPrev').addEventListener('click', () => { stepScene(-1); sync(); });
  wbEl('wbNext').addEventListener('click', () => { stepScene(1); sync(); });
  wbEl('wbF1').addEventListener('click', () => { seek(clock - 1 / engineRef.fps); sync(); });
  wbEl('wbP1').addEventListener('click', () => { seek(clock + 1 / engineRef.fps); sync(); });
  wbEl('wbLoop').addEventListener('click', (e) => {
    const on = wbLoop != null;
    if (on) { wbLoop = null; e.currentTarget.classList.remove('on'); setMsg('循环关闭'); }
    else {
      const it = engineRef.timeline.find((i) => clock >= i.start && clock < i.end) ?? engineRef.timeline[0];
      wbLoop = { from: it.start, to: it.end };
      e.currentTarget.classList.add('on');
      setMsg(`循环 ${it.id}：${it.start.toFixed(2)} → ${it.end.toFixed(2)}s`);
    }
  });
  wbEl('wbPrecise').addEventListener('click', () => preciseFrame());
}

/** 预览与精确帧的像素差（8bit RGBA，自下而上，两条路径同尺寸） */
function frameDiff(a, b) {
  let sum = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    n += 3;
  }
  const mae = n ? sum / n : 0;
  const psnr = mae <= 1e-6 ? 99 : 20 * Math.log10(255 / mae);
  return { mae, psnr };
}

/** 按导出同一条路径重渲当前帧，并报与预览的差异 */
async function preciseFrame() {
  if (!engine) return null;
  const t = clock;
  await api.frame(t, { samples: 1, seeked: true });
  const fast = api.pixels();
  await api.frame(t, { samples: 'auto', seeked: true });
  const slow = api.pixels();
  const d = frameDiff(fast, slow);
  setMsg(`精确帧 t=${t.toFixed(2)}s：多子帧重渲完成 · 与预览差 ${d.mae.toFixed(2)}/255（PSNR ${d.psnr.toFixed(1)} dB）`);
  const ro = wbEl('wbReadout');
  if (ro) ro.textContent = `t ${t.toFixed(2)}s · 精确帧 Δ ${d.mae.toFixed(2)} · PSNR ${d.psnr.toFixed(1)} dB`;
  return d;
}
/* ------------------------------------------------------------------ 参数面板 */
/**
 * 参数面板（工作台第二阶段）：改一个数，立刻看到。
 *
 * 两类参数两条路：
 *   · 数值项（泛光/颗粒/暗角/像素化）→ 写 engine.livePost，下一帧生效（不重载、不重渲）。
 *   · 结构项（风格包 / 主色）→ 要重建调色板与 post shader 常量，必须重载一次页面（仍然不重渲整片）。
 *
 * 不做成图形编辑器：这一层只要回答「改完好不好看」，不替人做设计。
 */
function setupPanel(engineRef) {
  const box = wbEl('wbPanel');
  if (!box) return;
  box.hidden = false;
  const post = { ...(engineRef.lastPost ?? {}) };
  const basePost = engineRef.style?.post ?? {};
  const cur = (k, d) => Number(post[k] ?? basePost[k] ?? d);

  const bind = (id, key, fmt, dflt) => {
    const el = wbEl(id);
    const lab = wbEl(id + 'V');
    if (!el) return;
    el.value = String(cur(key, dflt));
    if (lab) lab.textContent = fmt(Number(el.value));
    el.addEventListener('input', () => {
      const v = Number(el.value);
      engineRef.livePost = { ...(engineRef.livePost ?? {}), [key]: v };
      if (lab) lab.textContent = fmt(v);
      engineRef.render(clock, { preview: true, toScreen: true, samples: 1 });
    });
  };
  bind('wbBloom', 'bloom', (v) => v.toFixed(2), 0.3);
  bind('wbGrain', 'grain', (v) => v.toFixed(3), 0.02);
  bind('wbVig', 'vignette', (v) => v.toFixed(2), 0.4);
  bind('wbPixel', 'pixel', (v) => String(v), 0);

  const sig = wbEl('wbSignal');
  if (sig) {
    sig.value = engineRef.P?.hex?.signal ?? '#ff4d12';
    sig.addEventListener('change', () => reloadWith({ signal: sig.value }));
  }

  const sel = wbEl('wbStyle');
  if (sel) {
    const names = ['print', 'blueprint', 'paper', 'terminal', 'flat', 'noir',
      'mg-cel', 'mg-isometric', 'mg-flat-vector', 'mg-lineart', 'mg-soft3d', 'mg-morph', 'mg-sticker',
      'mg-hud', 'mg-collage', 'mg-aurora', 'mg-bauhaus', 'mg-vhs', 'mg-pixel', 'mg-liquid', 'mg-variety'];
    const now = engineRef.style?.name ?? 'print';
    sel.innerHTML = names.map((n) => '<option' + (n === now ? ' selected' : '') + '>' + n + '</option>').join('');
    sel.addEventListener('change', () => reloadWith({ style: sel.value }));
  }

  const reset = wbEl('wbReset');
  if (reset) reset.addEventListener('click', () => {
    engineRef.livePost = null;
    box.querySelectorAll('input[type=range]').forEach((el) => el.dispatchEvent(new Event('input')));
    setMsg('已重置为任务配置里的后处理');
  });
}

/** 带参数重载当前页（保留 task 与当前 t，其余参数从现有 query 带过去） */
function reloadWith(patch) {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) q.set(k, v);
  q.set('t', String(clock.toFixed(3)));
  location.search = q.toString();
}
