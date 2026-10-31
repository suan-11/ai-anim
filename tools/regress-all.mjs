// @ts-check
/**
 * 一次跑完 `docs/history/STATUS-rounds-1-6.md` §11.15 的回归清单（第三轮那批 ⏸ 项 + 旧回归）。
 *
 *   node tools/regress-all.mjs                  # 全部
 *   node tools/regress-all.mjs --only smoke     # 只跑名字里含 "smoke" 的
 *   node tools/regress-all.mjs --list           # 只列清单
 *   node tools/regress-all.mjs --keep-going     # 出错也继续（默认就是继续，留着给以后改行为）
 *
 * 为什么要有这个脚本：
 *   上一轮（第三轮）在跑最后一批回归时被叫停，清单里留了一堆 ⏸。手工一条条敲不仅慢，
 *   而且**没人记得住哪些跑过**（STATUS.md 里就是这样积下来的）。这里把清单写死在代码里，
 *   每条一份日志（`out/_regress/<名字>.log`）+ 一张汇总表，跑完一眼看谁红了。
 *
 * ⚠ 两件必须知道的事：
 *   1. **同一时刻只允许一条渲染车道**。`smoke-overexposure` 会临时改 `src/core/engine.js`、
 *      `smoke-background` 会临时改 `tasks/_calib/`、`smoke-worktree-edit` 会临时改 `demo` 的场景文件。
 *      这些东西并行跑会互相污染，所以这里是**严格串行**的，而且跑的时候别去编辑 src/ 或 tasks/。
 *   2. 清单里若有**本来就该失败**的条目，用 `expectFail` 标出来：它红了不算这次回归的锅，
 *      但要打印出来给人看。**目前一条都没有** —— 曾经挂在 `check beast` 上的"退出码 1"
 *      从第四轮起没能复现，2026-10-06 整份 33/33 全绿（beast 是干净的 PASS），这条注记已撤掉。
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGDIR = path.join(ROOT, 'out', '_regress');
const node = process.execPath;
const only = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : null;
})();

/**
 * @typedef {Object} Item
 * @property {string} name
 * @property {string[]} cmd argv（第一项会被换成本机 node 可执行文件）
 * @property {Record<string,string>} [env]
 * @property {string} [note]
 * @property {boolean} [expectFail] 已知会失败（红 ≠ 回归），但仍然要打印
 * @property {number} [timeout] 毫秒
 * @property {boolean} [ciExclude] 这一项**不能**在 CI 上跑（要 GPU / Chrome / 本机私有任务目录 / 联网）
 * @property {string} [ciWhy] 为什么不能跑 —— 必填，写给人看；`tools/test-ci-coverage.mjs` 会验它不是空话
 */

/**
 * **哪些项算「CI 能跑」**（2026-10-30）。
 *
 * 起因是一个真事故：`.github/workflows/verify.yml` 只硬写了 4 条纯 JS 测试，
 * 而这份清单里已经有 43 条 `unit:`。于是 `anim say` 的节拍回落被改坏时
 * （`resolveBeat` 漏了「没有 analysis 就回落 narration.mjs 的 BPM」那一支），
 * 本地 `regress-all --only unit` 红 3 项，**CI 却是绿的** —— 因为它压根没跑那一条。
 *
 * 从此 CI 不再手抄清单，而是 `node tools/regress-all.mjs --ci`：
 * **按前缀收**，新加的 `unit:` / `meta:` / `harness:` 自动进 CI，不需要有人记得改 yml。
 * 唯一的出口是显式 `ciExclude: true` + `ciWhy`（会被 `tools/test-ci-coverage.mjs` 检查）。
 */
const CI_GROUPS = ['unit:', 'meta:', 'harness:', 'say:'];

/** @param {{name:string, ciExclude?:boolean}} it */
const isCiEligible = (it) => !it.ciExclude && CI_GROUPS.some((g) => it.name.startsWith(g));

/** @type {Item[]} */
const ITEMS = [
  // ── 纯 JS 单测（不需要 GPU、几秒钟）──
  { name: 'unit:doc-facts', cmd: ['tools/lint-doc-facts.mjs'], note: 'TIMELINE_KEYS（13 个）↔ 文档键表：漏键/数字不符就红（2026-10-17 focus 漏过一次）' },
  { name: 'unit:doc-facts-selftest', cmd: ['tools/lint-doc-facts.mjs', '--selftest'], note: '上面那个守门的判据自测（7 项，含"不误吃那 3 个面"的反例）' },
  { name: 'unit:agents-refs', cmd: ['tools/lint-agents-refs.mjs'], note: 'AGENTS.md 的章节号是外部锚点：全部 § 引用可解析（docs/history/ 的归档断链不计）' },
  { name: 'unit:agents-size', cmd: ['tools/lint-agents-size.mjs'], note: 'AGENTS.md 体积预算：超过 65536 B 会被注入器从尾部静默截断（当前余 ~10 KB）' },
  // CI 自己的守门（2026-10-30）：verify.yml 必须还在按清单跑（不是手抄），且清单没被悄悄排空。
  // 它守的不是某个功能，而是**「CI 有没有在跑东西」这件事本身** —— 上一版手抄了 4 条、
  // 清单里 43 条，漂移方向只有少跑，而少跑没有任何输出会提醒你。
  { name: 'unit:ci-coverage', cmd: ['tools/test-ci-coverage.mjs'], note: 'CI 覆盖守门：verify.yml 必须调 regress-all --ci（不许手抄）/ 组内每项要么被收要么写 ciWhy / 收的项数不低于下限（7 项）' },
  { name: 'unit:timeline-guard', cmd: ['tools/test-timeline-guard.mjs'], note: 'P0-2 伪时间线必须抛错 + 配置档展开（40 项）' },
  { name: 'unit:easing-warn', cmd: ['tools/test-easing-warn.mjs'], note: 'P2-3 缓动名写错要警告（7 项）' },
  { name: 'unit:narration', cmd: ['tools/test-narration.mjs'], note: 'P1-5 旁白表 + C 档词级时间戳（44 项）' },
  { name: 'unit:karaoke', cmd: ['tools/test-karaoke.mjs'], note: 'C 档 karaoke 的秒/下标混用 bug（80 项）' },
  { name: 'unit:xform-math', cmd: ['tools/test-xform-math.mjs'], note: '场景级变换数学（旧回归）' },
  { name: 'unit:cam-math', cmd: ['tools/test-cam-math.mjs'], note: '3D 相机/投影/透视变换 + **手性**（33 项）' },
  { name: 'unit:segment-cuts', cmd: ['tools/test-segment-cuts.mjs'], note: 'P2-4 分块切点只落在安全处' },
  { name: 'unit:shots', cmd: ['tools/test-shots.mjs'], note: 'A 档镜头库：模板登记/参数名/任务段名（写错就响）+ 选型元数据齐全（1-62 §2.6）' },
  { name: 'unit:shot-pick', cmd: ['tools/test-shot-pick.mjs'], note: '选型器（1-62，学 JIZURA 部件表）：筛的语义（energy/tags/角色锁/缺省放行）+ 抽的确定性 + 落空诊断（36 项）' },
  // 要 Chrome：它把页面真的渲一遍再比对像素
  { name: 'style:palette', cmd: ['tools/test-style-palette.mjs'], note: '风格包的底色是否真的画到画面上（比对 __animPalette.hex.bg 与画面像素 + 亮/暗分档）', slow: true, ciExclude: true, ciWhy: '要 Chrome + 真 GPU（起私有 Vite 渲一帧再读回像素）' },
  { name: 'unit:event-density', cmd: ['tools/test-event-density.mjs'], note: '事件密度判据回归（合成静止/运动片）：静止跨度与稀薄窗口必须分开报对，纯静止片必须被报成问题' },
  { name: 'unit:tempo', cmd: ['tools/test-tempo.mjs'], note: 'tempo 估计回归（合成鼓 80/96/120/140 + 半拍踩镲诱饵）：bpm 偏 ≤0.6%、网格间隔偏 ≤1% —— 修的是「analyze 把 80bpm 报成 83.3」那个 4% 偏差' },
  { name: 'unit:tasks-meta', cmd: ['tools/test-tasks-meta.mjs'], note: 'tasks --json（1-58）的字段解析 + 变体块不许污染任务级字段 + 真实任务能解析；--table 表路径（1-23③）的接线自检' },
  { name: 'unit:motion-caps', cmd: ['tools/test-motion-caps.mjs'], note: '运动上限静态扫描（BACKLOG 1-33）：判据与 waterfallOver 同口径（items × stagger > 0.5）/ 元素个数怎么读（const 字符串、数组，别抓 family 样式值）/ 读不出进 unchecked（含简写）/ 接线自检 + 夹具 _motion-lab 的 --strict 红证明' },
  { name: 'unit:transition-collision', cmd: ['tools/test-transition-collision.mjs'], note: '碰撞式转场（BACKLOG 1-33 ③ / MOTION.md §3.5）：受害者时长 = 入侵者 × 0.40–0.50 —— 区间内原样返回 / 越界夹回并给说明（不静默）/ NaN·±Inf 当场抛 / enterDur ≤ 0 ⇒ 时长记 0 / victimSpan 与 planCollision 同口径 / **不传 victimRatio ⇒ shader 源码与四个 uniform 逐字不变**（已交付片子的画面一个像素都不许动）+ kit 转发与回归清单接线自检' },
  { name: 'unit:paper', cmd: ['tools/test-paper.mjs'], note: '剪纸 / 纸艺层叠（BACKLOG 1-49 缺口表第 5 行，覆盖素材包 20 条）：撕边采样密度必须跟边长走（默认 40 点 ⇒ 毛刺被 fillPoly 抹平，出图是直线）/ 白芯只浅 5–9%（第一版 35% ⇒ 雪白高光带）/ 投影必须不透明（半透明会在扫描行之间出条纹）/ 撕边只吃 seed 不吃 t / 层栈由远到近 / 平移不改原对象 + kit·文档接线自检' },
  { name: 'unit:transition-modes', cmd: ['tools/test-transition-modes.mjs'], note: '参数化转场（BACKLOG 1-13）：八种模式两张表不许有孤儿 / 写错模式名当场抛并列出可用清单 / **push 的源码与 uniform 逐字符不变**（已交付片子的画面一个像素都不许动）/ 每支 shader 共用 6 个 uniform 且不重复声明 GLSL_COMMON 的函数（踩过：自写 vnoise ⇒ 编译失败）/ 掩码型转场不许再叠全局淡出 + engine·kit·文档接线自检' },
  { name: 'unit:variants', cmd: ['tools/test-variants.mjs'], note: '变体（BACKLOG 1-23）：deepMergeInto 语义（对象递归 / 数组整体替换 / 原始值覆盖）+ CLI 接线（--variant 进 URL、产物目录 taskOut 带子目录、无漏网调用点）+ 夹具声明' },
  { name: 'unit:pin-timing', cmd: ['tools/test-pin-timing.mjs'], note: 'anim say --pin-timing（BACKLOG 1-23）：同 id 且放得下 ⇒ slot/stretch 逐位不动；放不下 ⇒ 只重解那一段并警告长多少；部分钉住；pinned 缺 id / 为空 / 陌生 id 的边界' },
  { name: 'unit:pin-timing-e2e', cmd: ['tools/test-pin-timing-e2e.mjs'], note: 'anim say --pin-timing 端到端（真跑 CLI + 假 TTS 驱动 tools/fake-tts.mjs）：改短一句 ⇒ 时间线逐位不动；改长一句 ⇒ 只重解那一段' },
  { name: 'unit:cover', cmd: ['tools/test-cover-chapters.mjs'], note: '封面/章节（BACKLOG 1-53）：planChapters 三条规则（首段必是 00:00 / 短段并进上一章 / 起点取段自己 start）+ formatChapterTime 边界（0 / 59.9 / 60 / 3599 / 负 / NaN）' },
  { name: 'unit:info', cmd: ['tools/test-info.mjs'], note: 'infoShot 段落骨架（BACKLOG 1-50）：场景对象形状 / focus 声明（默认近似矩形、noFocus 豁免）/ draw 抛错进 warnings 不冒泡 / post 三层合并（骨架默认 < 段 post < draw 返回值）' },
  { name: 'unit:subs', cmd: ['tools/test-subs.mjs'], note: '1-40 anim subs：ASS 文本转义（\\\\ / {} / 换行）、assTime 向上取整不留三位小数、接线自检（11 项）' },
  { name: 'unit:hashes-policy', cmd: ['tools/test-hashes-policy.mjs'], note: '基线策略（2026-10-24）：--accept 必须带 --note / --save 拒绝覆盖 / notes 审计 / 前后对比图 / negligible 判据不许放松 / 文档与回归清单接线（10 项）' },
  // BACKLOG 0-3 的真正修法（2026-10-24）：`write` 的 align 从"逐字生效"改成"整行对齐"。
  // 判据是**几何**的（假 Canvas2D 记录每次 fillText 的 x），不是"代码里有某个字符串"——
  // 这条 bug 活了很久正是因为 5 个模板都用着错的写法而没人量过像素。
  { name: 'unit:text-align', cmd: ['tools/test-text-align.mjs'], note: 'type.write 的 align 是整行（BACKLOG 0-3）：三种 align 的落点几何 / 与 writeLine(anchor) 逐字等价 / 7 字居中不出画 / 逐字动画共存 / 三份文档不再教旧绕法（13 项）' },
  // 风格 / 字幕 / 版面（docs/history/IMPROVEMENTS-4-5.md）：全部纯 JS，毫秒级。
  // ⚠ **不把 `lint-narration-dup` 放进清单**：已交付的 sodium / optifine 必然命中（12 / 3 句），
  //   放进来会让回归清单永久变红，反而没人看了。它是「交付前自检」（AGENTS.md §10.9）
  //   与 `check` 的警告项（见 scripts/anim.mjs 里那段的注释）。
  { name: 'unit:style', cmd: ['tools/test-style.mjs'], note: '风格包 + 字幕层：合并规则 / 默认值一致 / "不写 style 时零变化"的底线（54 项）' },
  { name: 'unit:tokens', cmd: ['tools/test-tokens.mjs'], note: '设计 token 的语义字号（1-46）：数字原样通过 / 六档按风格取值 / 拼错必须抛（不许静默回落 64）/ 每套风格 6 档齐全（38 项）' },
  { name: 'unit:portrait', cmd: ['tools/test-portrait.mjs'], note: '竖屏 1080×1920（1-52）：横屏原样返回同一个对象（老任务零变化）/ 栅格按短边缩放而不是按高 / 字号 ×1.35 / 字幕带 61%–70% 且在 B 站 UI 之上 / gridPortrait 可覆盖（39 项）' },
  { name: 'unit:block-sig', cmd: ['tools/test-block-sig.mjs'], note: '分块增量重渲（1-45）：段 id→源文件（三种写法）/ 块的覆盖范围只算真正跨过的段 / 改一个镜头只有它那块失效 / 引擎或参数变=全失效 / 查不到源文件的段永远重渲（21 项）' },
  { name: 'unit:cjk', cmd: ['tools/test-cjk.mjs'], note: '字幕断行（禁则 / 平衡 / 不丢字）：行首不许出现 ，。）」/ 行尾不许留 「（/ 不拆 24fps 与 v0.9.0 / 两行不许 15+1 / 超长句给更多行而不是截断 / emoji 与全角标点拼接不丢字（28 项）' },
  { name: 'unit:motifs', cmd: ['tools/test-motifs.mjs'], note: '母题库（1-49）：方波级数收敛 + Gibbs 过冲 / 本轮末端 == 级数值 / DCT 往返 <1e-9 / 归一化不改形状 / 采样不出 NaN 且 x 单调 / 游标越界夹住（38 项）' },
  { name: 'unit:woodcut', cmd: ['tools/test-woodcut.mjs'], note: '多方向排线（src/kit/views.js 的 woodcut 模式，BACKLOG 1-68，缺口表第 10 行）：五条出图才看得见的纪律 —— 每层更细 / 层边界要抖 / 断线段长 ≥8 格（3 格 ⇒ 出图是一排点划线）/ 明暗取 24 点黄金角螺旋局部平均（网格采样会与底纹拍频）/ 线距 22px 且低于下限要夹住并留痕（12px 时 45° 投影 8.5px 与行距凑成近整数比 ⇒ 整屏次谐波横带）/ woodcut 必须是第 9 个模式 / 两份夹具配置语义逐字相同 + 文档接线自检' },
  { name: 'unit:pixel', cmd: ['tools/test-pixel.mjs'], note: '像素精灵 / 调色板量化 / 5x7 像素字（BACKLOG 1-67，素材包缺口表第 9 行）：抖动必须按**块**坐标取（按像素取 = 块被撕成噪点）/ 量化只在最近两色之间（按亮度找色阶会把饱和橙摊成灰）/ 覆盖率随距离单调 / 像素字的胶囊端点内缩半格（不缩每字右边多出半格墨）/ 时间台阶由整片时间算且 snapTime ≡ snapIndex/fps / 字模表每项恰好 7 行 x 5 列 + 覆盖 A-Z 0-9 标点 / 调色板名与精灵名写错必须抛 + kit·回归清单·AGENTS 接线自检' },
  // BACKLOG 1-69：手绘笔迹（中心线 + 压力 -> 轮廓多边形）。钉的是**几何事实**：
  // 窄了一半的坑全在这一层：斜率夹 / minW 下限 / 圆头半径 / 弧长生长 / 曲率 < 半宽时轮廓必然自交
  { name: 'unit:dry-run-tiers', cmd: ['tools/test-tier-estimate.mjs'], note: 'dry-run 按档预估（C-1）：草稿档 scale 绝对 0.5 + samples 1、成片档 = 任务 scale + auto，两档都不属于才补「本次参数」；current 永远恰好一个；分钟数含编码（草稿 2ms/帧）；anim.mjs 接线自检（不走 planTiers/estimateTier 就红）' },
  { name: 'unit:stroke', cmd: ['tools/test-stroke.mjs'], note: '手绘笔迹（src/kit/stroke.js，BACKLOG 1-69，缺口表第 6 行）：MAX_WIDTH_SLOPE 0.45（>1 时上下偏移边互相追上 ⇒ 偶奇规则把自交处填成「洞」）/ minW 1.2 物理下限（更细时 fillPoly 的扫描行穿透 ⇒ 出一串虚线点）/ 端点圆头用**这一端自己的半宽**（平均值会在收笔处鼓墨滴）/ 生长按**弧长**截断（按点数截断时密采样段走得慢）/ 曲率半径 < 半宽时**轮廓必然自交**（这是几何事实，不是 bug：圆角 R 偏移 h 后内圈 = R-h，R<h 就翻转）⇒ drawStroke 的 auto 会自动退到胶囊链（端点沿切向外扩半宽补掉内切缝）/ boil 每 2 帧换一次且同组内不动 + kit·regress·文档接线自检' },
  { name: 'unit:views', cmd: ['tools/test-views.mjs'], note: '仪器视图（src/kit/views.js，BACKLOG 1-11）：九种成像的清单与默认格子 / 字模必须按**实际着墨点数**排序（第一版手写顺序不单调，中灰底整片消失）/ 模式名写错必须抛而不是静默回落（27 项）' },
  { name: 'unit:post-wear', cmd: ['tools/test-post-wear.mjs'], note: '胶片磨损（post.weave/flicker/scratch，BACKLOG 1-64）：默认必须全 0（不写 = 一个像素不变）/ uniform 与引擎喂 t 的接线自检 / 0 时走不到磨损代码 / 磨损函数只吃 t 不读帧号（23 项）' },
  { name: 'unit:fill', cmd: ['tools/test-fill.mjs'], note: '填充面（src/core/fill.js，LineBatch 的 fillPoly/fillCircle/fillSector）：偶奇带洞 / 圆面积误差 <2% / 扇区角度方向（0=右 90=下 180=左 270=上，写反画面照样出） / 进度环缺口落在起点一侧（39 项）' },
  { name: 'meta:gates', cmd: ['tools/test-gates-meta.mjs'], note: '守门判据的**元测试**（1-51）：每条判据都要"注入缺陷必须报 + 去掉缺陷不许报"。覆盖版面三条 / 背景守门 / 采样四个出口（tol·cap·stall·NaN）/ 误差量具 / 节奏节拍器；文末一张覆盖表点名"哪个缺口没验"（37 项）' },
  { name: 'unit:blocks', cmd: ['tools/test-blocks.mjs'], note: '方块世界 kit：面朝向判据 / 深度排序 / 世界切片 / 摄影机关键帧' },
  { name: 'unit:check-skipped', cmd: ['tools/test-check-skipped.mjs'], note: '1-19「空≠干净」：skipped 收集/聚合/结论行 + --quick 分档 + 接线自检（25 项）' },
  { name: 'unit:timeline-audit', cmd: ['tools/test-timeline-audit.mjs'], note: '段级审计（纯函数）：under 的 missing / 第 1 段不判 / 与引擎同口径；背景守门采两个时刻 + world:false 分流 + 判定只落在窗中点（钉住 demo 那个假报）；+ 接线自检（26 项）' },
  { name: 'unit:layout', cmd: ['tools/test-layout.mjs'], note: '版面守门（纯函数，第十一轮）：块合并随字号缩放 / 主体图连通 / 母题保留区豁免 / 没声明 focus = 没判 / layoutReport 平铺一层（钉住那次 undefined）/ 接线自检（31 项）' },
  { name: 'unit:motion', cmd: ['tools/test-motion.mjs'], note: '运动规则（纯函数，BACKLOG 1-27）：nudgeCurve 的端点/单调/10-65-25 距离分配 + 两处接缝速度相等（这条是【我方推导】，数值本身是外部经验值）/ waterfallStagger 的四个边界（远小于、正好等于、超过、items=0）/ glowPeakCap 正反例 + NaN 不许静默通过 / motion.js 无 Math.random 也无 GPU import 的静态扫描 / kit 再导出与回归清单接线自检（42 项）' },
  { name: 'unit:carry', cmd: ['tools/test-carry.mjs'], note: 'carry 词表与连贯/节奏审计（纯函数，BACKLOG 1-34/1-35/1-36）：morphRect/iris/zoomThrough/hop/gather/operatorCam 的端点、单调、确定性、hold 归零（clearing 假红教训）/ carry 分类三档边界与 burst 豁免 / score=(carried+anchored/2)/judged 口径 / rhythmStats 的 CoV 验算与节拍器判据 / carry 字段三处接线 + CLI 子命令 + 回归清单自检' },
  { name: 'unit:motion-assert', cmd: ['tools/test-motion-assert.mjs'], note: '画面语义断言（纯函数，BACKLOG 1-18）：before 正反 / 段名找不到单列 missing（--only 后段表会变，绝不当通过）/ 采样计划形状（appearsBy 两时刻、keepsMoving 每 0.5s 一对、noEdgeContent 三点）/ 持久性感知（单点瞬态降级 info 不 gate、跨采样点保持才 error）/ 空≠干净（无断言、uncovered、报错行都进 skipped）/ 阈值覆盖只认认识的键 / edgeSafeHits 的 bbox 压边四边+贴线+坏数据 / app.js 的 motionAudit 与 cmdCheck 接线自检（21 项）' },
  { name: 'unit:notes', cmd: ['tools/test-notes.mjs'], note: '1-29 后半：NOTES.json 的读写/校验纯函数 + clean 保护判据（57 项）' },
  // ⚠ **不是 gate**（与 lint-narration-dup 同一个前例，见上面那段注释）：现在 6 个有事实表的任务里
  //   3 个必然命中（nekohome 5 / promo 4 / fidus 1，全是没登记的镜号），当 gate 会让清单永久变红。
  //   这一项只断言**工具自身可用**（正例响 / 反例静 / 条数钉死 / 空≠干净 / 退出码三档），
  //   不会因为片子内容而红。夹具在 `tools/fixtures/lint-numbers/`。
  { name: 'unit:lint-numbers', cmd: ['tools/test-fabricated-numbers.mjs'], note: '1-22 画面数字必须有出处：正例必须响 / 反例必须静 / 显示位条数钉死 / 空≠干净 / 退出码三档 + 「算出来的值」（判据 ③）单列且明说没验（183 项）' },
  { name: 'harness:demo', cmd: ['tools/scene-harness.mjs', 'demo'], note: '离线跑场（假 ctx，不起 Chrome，0.1s）：未定义变量 / 确定性 / 文字出画' },
  { name: 'harness:style-sampler', cmd: ['tools/scene-harness.mjs', '_style-sampler'], note: '风格采样器：配置档 4 段 + 风格解析走通' },

  // ── Node 侧整条链（合成/摆位/闪避；不需要 GPU，但要 ffmpeg）──
  { name: 'say:offline', cmd: ['tools/test-say.mjs'], note: 'B 档 anim say + anim mix 全链路（stub 驱动，30 项）', timeout: 10 * 60e3 },
  { name: 'say:real-tts', cmd: ['tools/probe-tts-edge.mjs'], allowSkip: true, ciExclude: true, ciWhy: '要联网、要真 TTS 服务（edge-tts 端点），CI 上必然退化成 skip', note: 'B/C 档真 TTS（联网；连不上会「跳过」退出码 2 —— 服务端 403 也算这一类）', timeout: 10 * 60e3 },
  // ⚠ 这一项**会**在没有 ffmpeg 的机器上退出 2（"跳过，不算通过"）—— 所以挂 allowSkip
  // ⚠ CI 上必须有这一项：显式装 ffmpeg 之后它是硬门（不是 allowSkip 的挡箭牌）
  { name: 'unit:loudness', cmd: ['tools/test-loudness.mjs'], allowSkip: true, note: '响度数字守门：合成已知响度的测试音、对不上就是函数错了 + **-t 是输入侧选项**与"真的截断"（39 项）' },
  // `anim mix --target`：**默认关**是硬约束（已交付片子的音轨不能因为这次改动而重新编码），
  // 所以这里同时钉"开"与"不开"两条路 —— 不开时逐字节相同、开了真的落在靶子上。
  { name: 'unit:mix-loudnorm', cmd: ['tools/test-mix-loudnorm.mjs'], allowSkip: true, note: 'anim mix --target：靶子解析 / planLoudnorm 六条出口 / 已知响度测试音 ±1 LU / **默认路径逐字节不变**（53 项）' },
  // 1-39：黑场/静帧/音量扫描。纯函数（解析 + 分档）不依赖 ffmpeg；端到端那几条自己跳过并明说"没验"。
  { name: 'unit:media-qa', cmd: ['tools/test-media-qa.mjs'], note: '成片级技术扫描：blackdetect/freezedetect 解析（含片尾只有 start）+ 分档（片头片尾白名单 / 静帧阈值 / 黑场里的静帧去重）+ 真 ffmpeg 夹具（17 项）' },

  // ── 注入式回归（会临时改文件；必须串行）──
  { name: 'smoke:scene-error', cmd: ['tools/smoke-scene-error.mjs'], note: 'P0-3 场景抛错 = 硬失败（10 项）', timeout: 20 * 60e3 },
  { name: 'smoke:background', cmd: ['tools/smoke-background.mjs'], note: 'P0-2 漏画背景必须被点名', timeout: 20 * 60e3 },
  { name: 'smoke:overexposure', cmd: ['tools/smoke-overexposure.mjs'], note: 'P0-3 多子帧过曝必须被拦住', timeout: 20 * 60e3 },
  { name: 'smoke:worktree-edit', cmd: ['tools/smoke-worktree-edit.mjs'], note: 'P2-2 渲染期间改源文件要点名', timeout: 20 * 60e3 },
  { name: 'smoke:interrupt', cmd: ['tools/smoke-interrupt.mjs'], note: 'P0-2 中断必须非零退出 + 删产物', timeout: 20 * 60e3 },
  {
    name: 'smoke:backpressure',
    cmd: ['tools/smoke-backpressure.mjs', 'demo', '0.5', '30', '12'],
    env: { ANIM_FFMPEG: `"${node}" tools/slow-ffmpeg.mjs`, ANIM_SLOW_MBPS: '12' },
    note: 'P0-1 背压不能被判成停滞',
    timeout: 20 * 60e3,
  },

  // ── 逐任务 check（2026-10-06 整份回归 33/33 全绿，含下面每一条）──
  { name: 'check:beast', cmd: ['scripts/anim.mjs', 'check', 'beast', '--quick'], note: '12 段 / 127.5s', timeout: 30 * 60e3 },
  { name: 'check:demo', cmd: ['scripts/anim.mjs', 'check', 'demo', '--quick'], note: '5 段', timeout: 30 * 60e3 },
  { name: 'check:beat', cmd: ['scripts/anim.mjs', 'check', 'beat', '--quick'], note: '3 段', timeout: 30 * 60e3 },
  { name: 'check:_calib', cmd: ['scripts/anim.mjs', 'check', '_calib', '--quick'], note: '标定夹具', timeout: 30 * 60e3 },
  // carry 词表的图册 + 1-38 静/动标定样本（2026-10-17）：7 段全走 makeShot（rhythm 段裸场景），
  // check 验证六个 carry 函数真的画得出来；节奏腿在它身上 CoV ≈0.27（好样本）。
  { name: 'check:_carry-lab', cmd: ['scripts/anim.mjs', 'check', '_carry-lab', '--quick'], note: 'carry 图册夹具：morphRect/iris/zoomThrough/hop/gather/operatorCam 各一段 + rhythm 静/动标定', timeout: 30 * 60e3 },
  // 1-41：同一模板 blur 0 / 20 / 20 三段 —— 画面本身要人眼验收，这里只防它腐烂（模板参数 / 背景 / 版面）。
  { name: 'check:_blur-lab', cmd: ['scripts/anim.mjs', 'check', '_blur-lab', '--quick'], note: 'blur 通道夹具：title 的 blur 0 vs 20（三段，长度故意不等以免节奏腿报节拍器）', timeout: 30 * 60e3 },
  { name: 'check:nekohome', cmd: ['scripts/anim.mjs', 'check', 'nekohome', '--quick'], note: '8 段', timeout: 30 * 60e3 },
  { name: 'check:fidus', cmd: ['scripts/anim.mjs', 'check', 'fidus', '--quick'], note: '9 段', timeout: 30 * 60e3 },
  { name: 'check:pdoom-lab', cmd: ['scripts/anim.mjs', 'check', 'pdoom-lab'], note: '3D 验证片：raymarch 走廊 + 非有限值扫描', timeout: 30 * 60e3 },
  { name: 'check:example-config-only', cmd: ['scripts/anim.mjs', 'check', 'example-config-only', '--quick'], note: 'B 档：整个任务只有 task.config.mjs（配置档）', timeout: 30 * 60e3 },
  { name: 'check:_three-calib', cmd: ['scripts/anim.mjs', 'check', '_three-calib', '--quick'], note: '第 3 种 3D 的标定夹具（桥的颜色/朝向/透明合成）', timeout: 30 * 60e3 },
  // Three.js 沙盒：3 段（Two Three.js 镜头 + 中间那一段**完全由引擎画**的过渡镜头），
  // 走完整的三点两路径 —— 它同时是"背景守门 + 多子帧"这两件事在桥上的现场证据。
  { name: 'check:_three-lab', cmd: ['scripts/anim.mjs', 'check', '_three-lab'], note: '第 3 种 3D 沙盒：3 段（含引擎自绘过渡），完整三点两路径', timeout: 30 * 60e3 },
  // promo 是引擎自己的一镜到底宣传片，也是**唯一**跨 4 段连续世界（走廊 → 门 → SDF 大厅 → 晶格隧道）的片子，
  // 所以这里不省：跑完整的 3 点 × 2 条路径（36 帧，实测 18.3s）。
  { name: 'check:promo', cmd: ['scripts/anim.mjs', 'check', 'promo'], note: '48s 一镜到底 / 6 段；raymarch 大厅 + 晶格隧道，完整三点两路径', timeout: 30 * 60e3 },

  // ── 引擎级探针 ──
  { name: 'probe:alpha', cmd: ['scripts/anim.mjs', 'probe-alpha', '_calib'], note: 'P0-1 数值型 alpha + P1-5 旁白接线（9 项）', timeout: 20 * 60e3 },
  { name: 'probe:ribbon', cmd: ['tools/probe-ribbon.mjs', '11.2', '1,2'], note: '真 4K 矢量几何一致', timeout: 20 * 60e3 },
  { name: 'probe:raymarch', cmd: ['tools/probe-raymarch.mjs'], note: 'raymarch 通电 + 手性/朝向 + 非有限值判据（14 项）', timeout: 20 * 60e3 },
  { name: 'probe:three', cmd: ['tools/probe-three.mjs'], note: '第 3 种 3D 的桥：朝向 / 两条颜色管线一致 / 线性 alpha（10 项）', timeout: 20 * 60e3 },
  { name: 'probe:nv12', cmd: ['tools/probe-nv12.mjs', '_calib'], note: '出片推流的新编码路径：GPU 的 NV12 vs CPU 参考实现（判据 ±1）', timeout: 20 * 60e3 },
  { name: 'probe:r8', cmd: ['tools/probe-r8.mjs'], note: 'NV12 回读的 R8/RG8 路径：ANGLE 的 readPixels(RED/RG) 支持度 + PACK_ALIGNMENT（含非 4 对齐宽度；全绿才退出 0）', timeout: 20 * 60e3 },
  { name: 'probe:fonts', cmd: ['tools/probe-fonts.mjs', '_calib'], note: '任务字体真的生效', timeout: 20 * 60e3 },
  { name: 'probe:colorspace', cmd: ['tools/probe-colorspace.mjs', '_calib'], note: '导出 = 显示', timeout: 20 * 60e3 },
  { name: 'probe:trans2', cmd: ['tools/probe-trans2.mjs', '_calib'], note: '转场：推走而不是糊在一起（第四轮重写了判据）', timeout: 20 * 60e3 },
  { name: 'probe:determinism', cmd: ['tools/probe-determinism.mjs', 'beat', '1', '2'], note: 'P1-2 更正：帧起点口径逐字节相同', timeout: 30 * 60e3 },
  { name: 'test:parallel', cmd: ['tools/test-parallel.mjs', 'demo', '6'], note: 'P2-1 并行渲染 6 项', timeout: 40 * 60e3 },
  // 抖动守门：`docs/history/IMPROVEMENTS-1-3.md` 那次事故（用户"最后像地震"）的回归项。
  // 整片要跑 2880 帧、raymarch 段 170ms/帧（几分钟），所以只体检收尾 8 秒 —— 事故就出在那里
  // （摄影机停住了、幅度却只升不降）。判据与 `video` 收尾的守门共用 scripts/lib/shake.mjs。
  { name: 'shake:promo', cmd: ['scripts/anim.mjs', 'shake', 'promo', '--from', '40', '--to', '48'], note: '抖动：收尾段必须是平滑手持而不是逐帧白噪声（480 帧，约 35s）', timeout: 20 * 60e3 },

  // ── 画面没变（重构验收）──
  { name: 'hashes:fidus', cmd: ['scripts/anim.mjs', 'hashes', 'fidus', '--baseline'], note: 'kit 重构后画面是否没变（基线已重存）', timeout: 30 * 60e3 },
  // promo 的基线是**每段一帧**（t=3/11/21/31/39/45，6 段各一帧，63.3 MB）：
  // 原来 `--save` 的默认四点（0/12/24/36）**漏掉了晶格隧道与落版两段**，改了引擎也照绿。
  { name: 'hashes:promo', cmd: ['scripts/anim.mjs', 'hashes', 'promo', '--baseline'], note: '一镜到底整片：6 段各一帧逐像素比对（判据**只有** negligible()：over16 === 0 且 mean < 0.002；日志里的 max / >16 / >32 只是给人看的读数）', timeout: 30 * 60e3 },
];

function runItem(it) {
  const log = path.join(LOGDIR, `${it.name.replace(/[:]/g, '_')}.log`);
  const t0 = Date.now();
  const r = spawnSync(node, it.cmd.map((a) => (a === process.execPath ? node : a)), {
    cwd: ROOT,
    env: { ...process.env, ...(it.env ?? {}) },
    encoding: 'utf8',
    timeout: it.timeout ?? 15 * 60e3,
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - t0;
  const body = `$ node ${it.cmd.join(' ')}\n\n--- stdout ---\n${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}\n`;
  writeFileSync(log, body);
  const code = r.status;
  const pass = code === 0;
  /**
   * **"跳过"是第三种结局**（2026-10-16 加，BACKLOG 头部 ⑧ 那一轮带出来的）：
   * 有些项在**环境不满足**时会按约定用**退出码 2** 明说"我没跑"（真 TTS 连不上、
   * 没有 ffmpeg……）—— 那是"没验"，既不是通过、也不该记成"失败"。
   * ⚠ 只对显式声明 `allowSkip: true` 的项生效：别的工具里退出码 2 是**用法错**（真失败），
   *   不能一刀切（`lint-narration-dup` / `png-rows` / `test-fabricated-numbers` 都是那样）。
   * ⚠ 跳过**不算通过**：汇总里单独列，并写明"跳过 ≠ 通过"。
   */
  const skip = !!it.allowSkip && code === 2;
  return { ...it, code, pass, skip, ms, log: path.relative(ROOT, log), out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * 从输出里挑几行最像「结论/错误」的，汇总表与 Job Summary 里显示。
 *
 * ⚠ 2026-10-30 修：原来只返回**最后一个**匹配行，于是 `say:offline` 的失败长这样 ——
 *   最后一行是 `通过 110/112　❌ 失败 2`（它含「失败」二字，被正则抓中），
 *   真正的 `✗ <断言名> <实测值>` 反而被它挤掉了。汇总表因此只显示「失败 2」，
 *   谁也不知道是哪两条。现在的口径：
 *   ① 先认**具体断言**（`FAIL` / `✗`）—— 那是真正有信息量的行；
 *   ② 没有具体断言时，才退回「像错误/结论」的行；
 *   ③ 最多给 3 行（>3 行说明问题很多，但汇总表不该变成日志）。
 * 这样「失败 N」这种汇总行再也不会盖住「哪一条失败了」。
 */
function headline(res) {
  const lines = res.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const clip = (s) => (s.length > 120 ? `${s.slice(0, 117)}…` : s);

  // ① 具体断言：`FAIL  xxx` / `✗ xxx` —— 优先，且**按出现顺序**取，不取最后一行
  const asserts = lines.filter((l) => /^(FAIL|✗|×)\s/.test(l));
  if (asserts.length) return asserts.slice(0, 3).map(clip).join(' ／ ');

  // ② 退回「像错误/结论」的行（保持旧行为：取最后一条）
  const bad = lines.filter((l) => /^[✗×]|FAIL|错误|失败|Error|error:|on problem|个问题/.test(l));
  const pick = bad[bad.length - 1] ?? lines[lines.length - 1] ?? '(无输出)';
  return clip(pick);
}

if (process.argv.includes('--list')) {
  for (const it of ITEMS) console.log(`${it.name.padEnd(24)} ${it.note ?? ''}`);
  process.exit(0);
}

// `--list-ci`：把「能在 CI 上跑 / 被排除且为什么」两张表打出来（人看的，不进退出码）
//
// 排除分两类，**只有第一类需要写理由**：
//   ① 组内的项（`unit:` `meta:` `harness:` `say:offline`）被单独摘掉 —— 那是刻意的例外，必须写 `ciWhy`；
//   ② 组外的项（`check:` `probe:` `smoke:` `hashes:` …）根本不进 CI 的收口 —— 它们默认就要 GPU/Chrome。
if (process.argv.includes('--list-ci')) {
  const inc = ITEMS.filter(isCiEligible);
  const inGroupButExcluded = ITEMS.filter((it) => it.ciExclude && CI_GROUPS.some((g) => it.name.startsWith(g)));
  const outOfGroup = ITEMS.filter((it) => !it.ciExclude && !CI_GROUPS.some((g) => it.name.startsWith(g)));
  console.log(`CI 收 ${inc.length} / 共 ${ITEMS.length} 项`);
  console.log(`  组外 ${outOfGroup.length} 项（check/probe/smoke/hashes …，默认要 GPU/Chrome，不进 CI）`);
  console.log(`  组内显式排除 ${inGroupButExcluded.length} 项：`);
  for (const it of inGroupButExcluded) console.log(`    ✗ ${it.name.padEnd(24)} ${it.ciWhy ?? '(没写理由 —— test-ci-coverage 会红)'}`);
  process.exit(0);
}

// `--ci`：只跑 CI 能跑的那一批（判据见文件头的 CI_GROUPS / isCiEligible）。
// 加了这一条之后 `.github/workflows/verify.yml` 不再手抄清单 —— 手抄必然漂移，
// 而且漂移的方向永远是「少跑」（2026-10-30 那次 test-say 变红而 CI 全绿就是这样来的）。
const ciMode = process.argv.includes('--ci');
if (ciMode) {
  const picked = ITEMS.filter(isCiEligible);
  console.log(`CI 模式：清单 ${ITEMS.length} 项，其中 ${picked.length} 项在 CI 上跑；`
    + `${ITEMS.length - picked.length} 项显式排除（--list-ci 看为什么）。\n`);
}

const list = (ciMode ? ITEMS.filter(isCiEligible) : ITEMS).filter((it) => (only ? it.name.includes(only) : true));
if (!list.length) {
  console.error(`✗ --only ${only} 没匹配到任何项。用 --list 看清单。`);
  process.exit(2);
}
mkdirSync(LOGDIR, { recursive: true });

console.log(`跑 ${list.length} 项回归（串行；日志在 out/_regress/）\n`);
const results = [];
for (const it of list) {
  process.stdout.write(`· ${it.name.padEnd(24)} 跑 … `);
  const res = runItem(it);
  results.push(res);
  const tag = res.pass ? 'PASS' : (res.skip ? 'SKIP(没跑)' : (it.expectFail ? 'FAIL(已知)' : 'FAIL'));
  console.log(`${tag}  ${(res.ms / 1000).toFixed(1)}s`);
  if (!res.pass) console.log(`    ${headline(res)}`);
}

const failed = results.filter((r) => !r.pass && !r.skip && !r.expectFail);
const known = results.filter((r) => !r.pass && !r.skip && r.expectFail);
const skipped = results.filter((r) => r.skip);
console.log(`\n${'─'.repeat(72)}`);
console.log(`通过 ${results.filter((r) => r.pass).length}/${results.length}`
  + (skipped.length ? `　**跳过 ${skipped.length} 项（没跑 ≠ 通过）**：${skipped.map((k) => k.name).join(', ')}` : '')
  + (known.length ? `　已知失败 ${known.length}（${known.map((k) => k.name).join(', ')}）` : '')
  + (failed.length ? `　❌ 真失败 ${failed.length}` : '　✅ 没有真失败'));
for (const s of skipped) console.log(`  ⏭ ${s.name}  (exit 2：环境不满足，这一项**没验**)  → ${s.log}`);
for (const f of failed) console.log(`  ❌ ${f.name}  (exit ${f.code})  → ${f.log}\n     ${headline(f)}`);

// ⚠ **失败项要在这里把完整输出打出来**（2026-10-30 加，起因是一次真实的排查卡壳）：
//   日志落在 `out/_regress/<名字>.log`，而 `out/` 是 gitignore 的、CI 上 job 一结束**整个工作区就没了** ——
//   于是「CI 红了」在 Actions 页面上只剩一行 exit code，看不到到底哪条断言断了。
//   而在本地复现又可能因为 Node / ffmpeg / 平台差异而通不出同样结果（本轮实测本地 48/48 绿、CI 红）。
//   把失败项的 stdout/stderr 直接吐进 CI 日志，是唯一不依赖权限、不依赖复现的取证方式。
//   只在**有失败**时打（成功的项不刷屏），且每项最多 200 行（防止某个测试把日志撑爆）。
if (failed.length) {
  console.log(`\n${'='.repeat(72)}\n失败项完整输出（${failed.length} 项）\n${'='.repeat(72)}`);
  for (const f of failed) {
    const body = (f.out ?? '').split(/\r?\n/);
    const capped = body.length > 200
      ? [...body.slice(0, 200), `…（省略 ${body.length - 200} 行）`]
      : body;
    console.log(`\n--- ${f.name}  (exit ${f.code}) ---`);
    console.log(capped.join('\n'));
  }
}

const summary = {
  at: new Date().toISOString(),
  results: results.map((r) => ({ name: r.name, code: r.code, pass: r.pass, skip: !!r.skip, expectFail: !!r.expectFail, ms: r.ms, log: r.log, headline: headline(r) })),
};
writeFileSync(path.join(LOGDIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
writeFileSync(
  path.join(LOGDIR, 'summary.md'),
  `# 回归汇总 ${summary.at}\n\n| 项 | 结果 | 用时 | 结论 |\n|---|---|---|---|\n`
  + results.map((r) => `| ${r.name} | ${r.pass ? '✅' : (r.skip ? '⏭ 跳过（没验）' : (r.expectFail ? '🟡 已知失败' : '❌'))} | ${(r.ms / 1000).toFixed(1)}s | ${headline(r).replace(/\|/g, '\\|')} |`).join('\n')
  + '\n',
);
console.log(`\n汇总：out/_regress/summary.md`);

// ⚠ **同时写一份到 GitHub Actions 的 Job Summary**（2026-10-30 加）。
//
//   为什么：CI 红了的时候 `out/_regress/*.log` 随 job 一起消失，而下载完整 raw 日志要仓库
//   admin 权限（`/actions/jobs/<id>/logs` 对普通协作者返回 403）。Job Summary 是 Actions 页面上
//   直接能看的一段 Markdown，**不用下载、不用权限** —— 失败的项名与实测值会出现在那里，
//   而不是埋在 200 行日志中间。本地跑没有这个环境变量，整段静默跳过。
const stepSummary = process.env.GITHUB_STEP_SUMMARY;
if (stepSummary && failed.length) {
  const md = [
    `## 回归失败 ${failed.length} 项（共 ${results.length}）`,
    '',
    '| 项 | 退出码 | 最像结论的一行 |',
    '|---|---|---|',
    ...failed.map((f) => `| \`${f.name}\` | ${f.code} | ${headline(f).replace(/\|/g, '\\|')} |`),
    '',
    '### 失败项完整输出（前 120 行）',
    '',
    ...failed.flatMap((f) => [
      `\`\`\`\n--- ${f.name} (exit ${f.code}) ---\n${(f.out ?? '').split(/\r?\n/).slice(0, 120).join('\n')}\n\`\`\``,
      '',
    ]),
    `跳过（没跑 ≠ 通过）：${skipped.length ? skipped.map((k) => k.name).join(', ') : '无'}`,
  ].join('\n');
  try { appendFileSync(stepSummary, md + '\n'); } catch { /* 写不进去就算了，别把回归本身带崩 */ }
}

process.exit(failed.length ? 1 : 0);