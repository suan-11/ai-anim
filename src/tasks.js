// @ts-check
/**
 * 任务（一支片子 / 一段小动画）= 一个目录 tasks/<名字>/，里面有 task.config.mjs。
 *
 * task.config.mjs 直接 `export default { ... }`，字段见下方 TaskSpec。
 * 模板项目的 timeline 用 timeline.js 里的 seq()/cut() 拼，也可以手写数组。
 */

/** @type {Record<string, () => Promise<any>>} */
// 注意：glob 必须用「以 / 开头的绝对路径」写法，相对路径会被当成模块说明符而匹配不到任何文件。
const configs = import.meta.glob('/tasks/*/task.config.mjs');

import { makeNarration } from './core/narration.js';
import { resolveStyle } from './style/index.js';
// 深合并（变体用）：放 core/util.js 而不是这里 —— tasks.js 顶层是 Vite 专属的 import.meta.glob，
// Node 直接 import 会炸；纯函数要能被 tools/test-variants.mjs 直接测到。
import { deepMergeInto } from './core/util.js';

/**
 * @typedef {Object} TaskSpec
 * @property {string} title
 * @property {number} [width]      逻辑宽（默认 1920）
 * @property {number} [height]     逻辑高（默认 1080）
 * @property {number} [fps]        帧率（默认 60）
 * @property {number} [scale]      输出倍率 1=1080p 2=4K
 * @property {number} [duration]   总时长；不填则取时间线最后一个 end
 * @property {Record<string,string>} [palette]  覆盖默认调色板
 * @property {string|{music?:string,vo?:string,mix?:string}} [audio]
 *                                   音频（相对任务目录）。两种写法：
 *                                   · 字符串：一条轨，分析节拍与封装成片都用它（老写法）；
 *                                   · 对象：**分轨**。`music` 只用来分析节拍，`mix`（或 `vo`）
 *                                     交给 ffmpeg 封装。做带旁白的片子必须这样写 ——
 *                                     从混音里测 bpm 会被人声带偏（见 docs/history/IMPROVEMENTS-1-3.md P1-4）。
 * @property {string} [analysis]   预计算好的音频特征 json（CLI: npm run video 前会自动生成）
 * @property {string} [lyrics]     歌词 json（词级时间戳）
 * @property {{lines?: any[], source?: string}} [narration]
 *                                  口播/旁白表（`docs/NARRATION.md` A 档）：场景里读 `ctx.narration`。
 *                                  形如 `{ lines: [{ id, text, start, dur }] }`（秒）。
 * @property {string|string[]} [fonts] 任务自己的字体，相对任务目录：`.css` 会作为样式表加载，
 *                                   字体文件（.woff2/.ttf/.otf）会自动包成 @font-face。
 *                                   有了它就不必改全局的 public/fonts/fonts.css（多个任务各用各的字体）。
 * @property {any[]} timeline      段列表（见 timeline.js 的 seq()）
 * @property {(ctx: any) => any} [world]  全片共用的背景：`(ctx) => Pass`。
 *                                   时间线里写 `cut(shot, { world: 'auto' })` 的段由**引擎**每帧先铺它，
 *                                   场景不必记得调用（「漏了就静默黑底」这个坑由此封死，见 docs/history/IMPROVEMENTS-1-3.md P0-2）。
 *                                   `src/kit/world.js` 的 `worldPass(ctx, opts)` 就是一个现成的实现。
 */

/** 从 glob 的 key 里取出任务名：'/tasks/demo/task.config.mjs' -> 'demo' */
function nameOfKey(key) {
  const m = /\/tasks\/([^/]+)\/task\.config\.mjs$/.exec(key);
  return m ? m[1] : key;
}

/** 列出所有任务名。 */
export async function loadTaskList() {
  return Object.keys(configs).map(nameOfKey).sort();
}

/**
 * 把 `task.audio` 的两种写法归一成 `{ music, vo, mix, analysis, packaging }`。
 *
 *   · `analysis`   = 用来测节拍的那条轨（优先 music）；
 *   · `packaging`  = 交给 ffmpeg 封装进成片的那条轨（优先 mix）。
 * 单轨写法下两者是同一个文件（老行为不变）。
 *
 * ⚠ 与 CLI 侧 `scripts/anim.mjs` 的 `resolveAudioTracks()` 是**同一套规则的两份实现**：
 *   CLI 没法 import 任务配置（那是 Vite 模块），只能从文本里读 `audio:` 字段。
 *   改这里时记得同步那边（两边都留了这条注释）。
 *
 * @param {any} audio
 */
export function normalizeAudio(audio) {
  const s = (v) => (typeof v === 'string' && v ? v : null);
  if (!audio) return { music: null, vo: null, mix: null, analysis: null, packaging: null, split: false };
  if (typeof audio === 'string') {
    return { music: null, vo: null, mix: audio, analysis: audio, packaging: audio, split: false };
  }
  const music = s(audio.music), vo = s(audio.vo), mix = s(audio.mix);
  const analysis = music ?? mix ?? vo;
  const packaging = mix ?? music ?? vo;
  return { music, vo, mix, analysis, packaging, split: true };
}

/** 载入某个任务的配置。 */
export async function loadTask(name, { music = null, variant = null, narrationData = undefined } = {}) {
  // 允许任务名里带引号/斜杠之类的意外输入，直接拒绝比默默跑挂好
  if (!/^[\w.-]+$/.test(name)) throw new Error(`任务名不合法：${name}`);
  const key = Object.keys(configs).find((k) => nameOfKey(k) === name);
  const loader = key ? configs[key] : null;
  if (!loader) {
    const list = await loadTaskList();
    throw new Error(
      `没有任务 "${name}"。可用：${list.join(', ') || '(空)'}\n` +
      `（如果是刚新建的任务目录：dev 服务需要重启一次才能看到新任务；用 CLI 渲染则不受影响。）`,
    );
  }
  const mod = await loader();
  const spec = /** @type {TaskSpec} */ (mod.default ?? mod);
  if (!spec) throw new Error('tasks/' + name + '/task.config.mjs 没有 export default');
  const variantName = variant == null ? null : (String(variant).trim() || null);
  // 变体（BACKLOG 1-23）：export const variants = { 名字: {…覆盖…} }，CLI 的 --variant 选一个。
  // 深合并规则只有一条：普通对象逐键递归合并，**数组与原始值整体替换**
  //（timeline / palette 这类不适合把两个数组拼起来；要拼就在变体里写全）。
  // 未知变体名直接抛错并列出可用的 —— 与镜头模板参数拼错同一个口径：写错不许静默。
  const variants = (mod.variants && typeof mod.variants === 'object') ? mod.variants : null;
  if (variants) spec.variants = variants;
  if (variantName) {
    const patch = variants && variants[variantName];
    if (!patch) {
      const known = Object.keys(variants ?? {}).join(' / ') || '（这个任务没有 export const variants）';
      throw new Error('任务 "' + name + '" 没有变体 "' + variantName + '"。可用：' + known);
    }
    deepMergeInto(spec, patch);
    spec.variantName = variantName;
  }
  /**
   * `export const world = (ctx) => Pass` 是**具名导出**，而这里只拿 `default` ——
   * 所以必须显式带过来，否则时间线里的 `{ world: 'auto' }` 永远解析不到东西
   * （症状：声明了共享背景却依然黑底，而且不报错。第一版就是漏了这一行。）
   * 兼容 `export default { ..., world }` 的写法。
   */
  if (spec.world == null && mod.world != null) spec.world = mod.world;
  /**
   * **音频分轨**（`docs/history/IMPROVEMENTS-1-3.md` P1-4）：`audio` 可以是字符串（一条轨）
   * 或 `{ music, vo, mix }`。
   *
   * 为什么要分：做带旁白的片子时只交给引擎一条混音轨，于是 `analyze` 从**人声 + 配乐**
   * 里测 bpm —— beast 那轮实测 136bpm，配乐床实际 96bpm，`f.beat` 全错。
   * 现在 `ctx.music`（也就是 `f.beat` / `f.a` / `music.*`）一律指向 **music 轨**，
   * 而成片封装在 CLI 那侧用 `mix` 轨（见 `resolveAudioTracks`）。
   *
   * 这里把解析结果挂到 `spec.audioTracks`，并让 `spec.audio` 仍然是"用来分析的那条轨"，
   * 这样页面与 `ensureAnalysis` 都不用改语义。
   */
  spec.audioTracks = normalizeAudio(spec.audio);
  if (spec.audioTracks.analysis) spec.audio = spec.audioTracks.analysis;
  /**
   * 旁白表（`docs/NARRATION.md` A 档）：把 `task.narration` 归一成
   * `{ lines: [...排好序、带派生量...], source, warnings, ... }`，并挂到 `spec.narrationData`。
   *
   * 这里**同时**把体检结果打出来（叠句 / 越界 / 留白不足）—— 那些正是
   * `docs/NARRATION.md` §5 的验收口径，以前每个任务各写一遍。
   * 浏览器控制台能看到；离线渲染时 CLI 的 chromium 也会把 console 收走并打印。
   */
  if (spec.narration && typeof spec.narration !== 'string') {
    spec.narrationData = makeNarration(spec.narration, { duration: spec.duration });
  } else if (typeof spec.narration === 'string') {
    // 从文件来：调用方（src/app.js）把表 fetch 好从 `narrationData` 注入进来
    //（浏览器里才拿得到任务目录的 URL，这里不做 fetch）。
    // 1-8（2026-10-31）：注入通道落地 —— app.js 在 loadTask **之前**就把表 fetch 好，
    // 两次 loadTask 都带上。于是 `dur: { vo: id }` 与"旁白表放在外部 json 里"可以同时用了
    //（build() 在本函数内发生，那时表已经在）。没注入（老调用方 / 表还没取到）时保持原行为：
    // narrationData 为 null，build 时 dur:{vo} 会抛错并说清楚原因。
    spec.narrationData = narrationData ?? null;
  }
  if (spec.narrationData?.warnings?.length) {
    for (const w of spec.narrationData.warnings) console.warn(`[旁白] ${w}`);
  }
  /**
   * 风格包（`docs/STYLE.md`）：`style: 'paper'` 一行换掉整片观感。
   *
   * 解析放在这里（而不是引擎里）的理由与时间线一样：**报错要带任务名**。
   * 写法不合法时给出可用风格清单，别让人去翻源码。
   * 不写 `style` 时得到的是 `print` —— 它的色板/字体/post 都等于引擎从前的默认值，
   * 所以老任务一个像素都不会变。
   */
  try {
    spec.styleResolved = resolveStyle(spec);
  } catch (err) {
    throw new Error(
      `tasks/${name}/task.config.mjs 的 style 不合法：\n  ${err && err.message ? err.message : err}`,
    );
  }
  // timeline 可以是数组（写死秒数 / 已经展开好的段）、seq()/par() 方案（由 music 解析拍号），
  // 或者**配置档**（B 档：数组里直接写 { type: 'chart', … }，见 `docs/CONFIG-ONLY.md`）。
  //
  // ⚠ 配置档**必须**走 build()：展开只发生在那里。而纯数组在旧写法里是"已经展开好的段"、
  //   故意不经过 build —— 所以这里要按内容选路，不能只看类型。
  if (spec.timeline) {
    const { build, isConfigNode } = await import('./timeline.js');
    const cfg = Array.isArray(spec.timeline) && spec.timeline.some(isConfigNode);
    if (!Array.isArray(spec.timeline) || cfg) {
      try {
        spec.timeline = build(spec.timeline, {
          ...(music ? { beats: music.beats, downbeats: music.downbeats, bpm: music.bpm } : {}),
          // `dur: { vo: id }` 要在这张表里查句子时长
          narration: spec.narrationData ?? null,
        });
      } catch (err) {
        // 把任务名带上：同一条时间线写错，报错里有没有 "tasks/<名字>/task.config.mjs"
        // 决定了能不能一眼找到该改哪个文件（docs/history/IMPROVEMENTS-1-3.md P0-2）。
        const msg = err && err.message ? err.message : String(err);
        throw new Error(`tasks/${name}/task.config.mjs 的时间线不合法：\n${msg}`);
      }
    }
  }
  if (!Array.isArray(spec.timeline) || !spec.timeline.length) {
    throw new Error(`tasks/${name} 的 timeline 是空的。至少给一段：timeline: [cut(hello, { dur: 4 })]`);
  }
  return spec;
}
