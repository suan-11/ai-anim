# 参考拆解：Ebony-Vinyl/EAC-design-world（DSH 里的本地视频工作室）

> 拆解日期 **2026-10-24**。上游 <https://github.com/Ebony-Vinyl/EAC-design-world>，
> 钉在 `main` 的 **`cde9fa6`**（2026-10-24，v0.5.0）。由主代理逐文件读源码产出：
> `src/`（渲染桥 / 媒体执行 / 字幕 / 转录 / 引擎）、`scripts/`、`ui/`、`tests/`、`docs/`，
> 以及 `vendor/video-shotcraft/` 的 **124 篇配方全文 + catalog.json**（全树 9265 个条目，只按目录白名单抓了 **266 个文本文件**；
> 唯一的失败是 `examples/eac-launch/capture.mp4` 超时 —— 那段是演示素材，不影响结论。快照在 `out/_staging/eacdw/raw/`，`out/` 不进版本控制）。
>
> ⚠ **许可证红线**：自有代码是 **AGPL-3.0-or-later**，与本仓库（MIT）不兼容 ——
> **一行代码、一段注释都不能抄进来**（会整库换证）。可以用的只有**思路、阈值口径、文档格式**（不受版权保护）。
> 例外：它 vendor 的 Shotcraft 是 **Apache-2.0（代码与文档）**，改写 + 署名是合法的；
> 但 `motion-web`（CC BY-NC 4.0）与 `onetake`（PolyForm Noncommercial）**只能看不能进商业交付**。
>
> **本文件只记"别人怎么做"** —— 可执行待办一律以 [`BACKLOG.md`](BACKLOG.md) 为准（本轮的 1-39 ~ 1-42 在 §1.E）。
> 与 hyperframes / video-use / hypit / onetake 的横向关系见 [`REFERENCE-agent-video-projects.md`](REFERENCE-agent-video-projects.md)。

---

## 0. 一句话结论

**它和我们做的是同一件事的两半：它把「HTML/CSS 页面」逐帧 seek 成片子，我们把「GLSL 画面」逐帧算成片子。**
所以它在渲染质量上全面弱于我们（Edge + 只能缩小 + JPEG 中间帧），但在**动效知识库**和**成片级质检词汇**上比我们厚。

最值得拿的三样，按性价比排：

1. **124 篇中文动效配方**（Apache-2.0）：每篇固定「一句话 / 意图 / 动效核心（带 px 与帧数）/ 参数表（甜点区 + 手感）/ 已知坑」，
   **124/124 都有参数表和已知坑**，平均 2154 字。这是 [`MOTION.md`](MOTION.md) 与 [1-37 动作图册](BACKLOG.md) 缺的那层"设计知识"。
2. **成片级技术质检的词汇**：`blackdetect` + `freezedetect` + `volumedetect` + 解码校验 + 时长容差。
   我们的三条质检腿（`check` 三点采样 / `rhythm` 逐帧差分 / `verify` 抽帧比对）**没有一条扫过整份编码后的文件**。
3. **一个"真实素材 + 代码镜头"的成品样例**（`examples/eac-launch/film.html`，129 行），
   以及 `BEATS.md` 那种六行镜头表 —— 我们目前没有产品片/真截图片的范例。

反过来，它顺手暴露了我们一个**画面能力缺口**：这类配方里的"默认标题解"是
**y / blur / opacity 三个通道共用同一个进度**（从虚焦里浮出来），而我们的 `type.write`
只有 `stagger / from / dist / alpha`，**没有 blur 通道**。

---

## 1. 它是什么（可核实的部分）

一个 **DSH 插件 + 独立工作台**：对话里选模板 → 多轨时间线 → 录屏/配音/音乐/字幕 → H.264 出片，
外加设计成品（HTML/SVG/MD，不可变修订，PDF/PNG/PPTX 导出）。Windows 优先，Node 22+。

### 1.1 技术盘（和我们同构，这才是"可信"的前提）

| 维度 | EAC design world | anim（我们） |
|---|---|---|
| 合成约定 | `renderAt(t)` / `__seek(t)` + `__ready`；回落到 `window.__timelines[].seek` 与 CSS 动画 `currentTime`（`src/render-template.mjs:80-102`） | `render(t)` 纯函数；场景对象 + 时间线 DSL |
| 逐帧出图 | Playwright 截图（**Edge**，`channel:'msedge'`，`:68`）→ JPEG q96（`:182`）→ ffmpeg | 无头 Chrome → `readPixels` → **NV12 直推** ffmpeg |
| 分辨率 | `deviceScaleFactor` 只许 **0.2–1**（`:58`）⇒ **没有 4K，只能缩** | `--scale 1..4`，真 4K 可用 |
| 确定性 | 同一 t 渲两次比哈希；不等则算像素差，**mean<0.5 且 >3/255 的像素 <0.05%** 记为一致（`:144-177`） | 逐像素哈希基线（`hashes`）+ `determinism` / `diff` 量具；多子帧运动模糊 |
| 成片质检 | 解码 + 时长容差 + 黑场/静帧/音量（`src/media/index.mjs:586-613`） | `check`（渲染时）+ `verify`（抽帧）+ `hashes`（基线）；**没有整片扫描** |
| 音频 | `sidechaincompress` 闪避 + `loudnorm I=-16`（`:539-548`） | JS 里算闪避曲线（`scripts/lib/mix.mjs`）+ 两遍 `loudnorm` 量具（靶子 -14 LUFS） |
| 字幕 | ASS 烧录，词级时间戳按剪辑重映射（`src/media/captions.mjs:152-201`） | 引擎内字幕层 + `anim subs` 导出 SRT/ASS（平台软字幕） |
| 内容库 | 152 设计体系 + 517 模板条目 + 150 镜头条目（`THIRD_PARTY_NOTICES.md:108-123`） | 11 个镜头模板 + 几套风格包 |

### 1.2 它自己写明的边界（值得学的是这个诚实）

- "模板数量代表可检索内容，**不代表每个模板均可离线直接渲染**"；517 条里 **205 项需要外部生成服务**（README）。
- 150 个 Shotcraft 镜头是 **Remotion TSX**，catalog 里 `renderable:false` / `status:'requires-dependencies'`
  （`vendor/video-shotcraft/catalog.json`，`docs/shotcraft-library.md:55-60`）；
  能预览的是用户自备的 MP4，**不是能直接渲的入口**。
- "输出成功不等于艺术评价通过"、"机器质检不能替代构图、文字、品牌和叙事审查"（`docs/harness-ai-workflow.md:41-45`）。
- 一次没跑绿就写没跑绿：`docs/review-2026-10-17.md:115-117` 明说"没有将这次全量运行记为全绿"。

---

## 2. 值得拿的第一样：124 篇动效配方（Apache-2.0）

### 2.1 数据（全部实测自 `catalog.json` / 配方文件）

| 项 | 读数 |
|---|---|
| 条目 / 配方 / 精选 | **150 / 124 / 59** |
| 分类（10 类） | 文字与字卡 25 · 光效与强调 23 · 界面登场 22 · 转场 19 · 交互演示 13 · 运镜与空间 13 · 开场与品牌 11 · 数据与指标 9 · 节奏与蒙太奇 8 · 收尾 7 |
| 时长 | 1.43–6.67s，中位 **4.7s**（与我们的单镜头尺度一致） |
| 结构完整度 | **124/124** 有「参数表」与「已知坑」，全部含 px / 帧数 / ms 级数值 |
| 平均篇幅 | 2154 字（中文） |

### 2.2 单篇长什么样（`blur-slide`，节选；原文 Apache-2.0，这里只摘要点与数字）

> 一句话：标题逐词入场，y 0.38em→0 + blur 18→0 + opacity 0→1 **三通道走同一条 ease-out 同步收敛**，词间隔约 4f
>
> 参数表：词间 stagger 主 4f / 副 2.4f（3–4f 是甜点；<2f 整行齐入，>8f 观众开始数词）；
> y 位移主 64px / 副 26px（主副不等幅是层级来源；>0.6em 变成滑入）；blur 主 18px / 副 9px（超过字号 12% 中间帧糊成色块）
>
> 已知坑：三通道必须共用同一个 `p`，分开写会出现"位移到了但还糊着"；中文 `split(' ')` 得到一整块，要按语义切 3–5 段

### 2.3 对我们怎么用

- **格式直接借**（格式不受版权保护）：我们自己的动作图册（1-37）就缺"参数甜点区 + 已知坑"这两栏。
- **选题清单**：我们题材（科普/技术介绍）最对味的是**转场 19**（`ink-bleed-reveal` / `light-leak-burn` /
  `mosaic-reframe` / `letterform-zoom` / `line-carry-transition`）与**文字 25**（`paper-title-card` /
  `marker-underline-title` / `outline-word-fill` / `text-on-path`）。界面登场 22 / 交互 13 是产品片专用，不是我们的主线。
- **数值只是起点**：它的数字是 1920×1080@30fps、DOM/GSAP 的调校结果。搬到我们的 60fps + GLSL/Canvas 上要重标，
  不能当"我方实测"写进 [`MOTION.md`](MOTION.md)（那里的证据分级要求写明出处）。
- **不能抄实现**：TSX 是 Remotion 组件（Apache-2.0 但仍要重写成我们的 `type`/`lines`/`Pass`）。

---

## 3. 值得拿的第二样：成片级质检的词汇

它的 `qualityCheck` / `analyzeMedia`（`src/media/index.mjs:189-211, 586-613`）是**对编码后的文件**做的：

| 手段 | 它用的参数 | 抓什么 |
|---|---|---|
| 解码校验 | `-xerror -map 0:v? -map 0:a? -f null -` | 文件损坏 / 半截流 |
| 时长容差 | `max(0.15, 2/fps)` | 帧数不符 / 拼接错位 |
| 黑场 | `blackdetect=d=0.25:pix_th=0.10` | 切点黑闪、某段没画东西 |
| 静帧 | `freezedetect=n=-50dB:d=1` | 画面停了但文件照样出 |
| 音量 | `volumedetect` 的 `mean_volume` / `max_volume` | 静音轨、贴满刻度 |

**我们的缺口在哪**：`check` 每段只采 15% / 50% / 85% 三个点（[`AGENTS.md`](../AGENTS.md) §10.1），
`rhythm` 是按 0.5s 步长**重新渲染**再差分（`scripts/cmd/rhythm.mjs:90`），`verify` 只在若干时刻抽帧比对（`scripts/cmd/verify.mjs:236`）。
**三者都不覆盖"切点两侧 0.3 秒的黑闪"** —— 三点采样正好跨过去。

⚠ **不能照抄阈值就 gate**：我们的片尾本来就有 0.6s 压黑（`outro`），hold 段本来就不动（`rhythm` 的标定样本）。
所以只能是「报区间 + 上下文」为主、`--strict` 才拦，且片头/片尾要有白名单。

---

## 4. 值得拿的第三样：产品片的形态

- `examples/eac-launch/film.html`（129 行）：真实 UI 截图/录屏放进一个浮动窗口，窗口位移、光标环、进度条、
  章节文案**全是 t 的函数**；`window.__FPS/__DUR/__seek` 三个字段就构成可渲染契约。
- `examples/eac-launch/BEATS.md`：24 秒片的六行镜头表（时间 / 拍 / 画面 / 文案 / 声音），
  配 `scripts/demo-film.mjs` 一条链：真实录屏 → 截图 → 原创音乐 → SAPI 旁白 → 渲染 → 混音 → 质检报告。
- 对我们的用处：真素材我们允许（[`AGENTS.md`](../AGENTS.md) §0），但**没有一支"真实截图 + 代码镜头"的成品**；
  另外它的"六行镜头表 + 一句 `All UI media is captured from the running local application`"是
  对外材料里很好的事实纪律样板（对应我们的 `FACTS.md`）。

---

## 5. 它暴露的我们的三个缺口（2026-10-24 已补，见 [`BACKLOG.md`](BACKLOG.md) §1.E / §4）

| # | 缺口 | 证据 | 本轮动作（已完成） |
|---|---|---|---|
| 1 | **ASS 文本没有转义**：`cmdSubs` 把旁白原文直接拼进 `Dialogue:`，含 `\` / `{` / `}` 的行会被当成换行或覆盖块 | `scripts/cmd/subs.mjs:30`；旁白没有这类字符时看不出来 | ✅ 1-40：`assText()` / `assTime()` + `tools/test-subs.mjs` |
| 2 | **没有整片扫描**（见 §3） | `check` 三点采样 / `rhythm` 重渲 / `verify` 抽帧 | ✅ 1-39：`anim qa`，纯 ffmpeg，不起浏览器 |
| 3 | **`type.write` 缺 blur 通道** | `src/core/text.js:259-334` 只有 stagger/from/dist/alpha | ✅ 1-41：`blur` 参数（数组才随进度插值）+ `title` 的 `blur` + `tasks/_blur-lab/` |

第四条是知识层的：**镜头模板没有"什么时候用 / 别什么时候用"**。

| # | 缺口 | 证据 | 本轮动作 |
|---|---|---|---|
| 4 | `anim shots` 只有一句 `summary` + 参数表；11 个模板在什么场合选哪个、能量高低、什么时候**不该**用，全在作者脑子里 | `tools/test-shots.mjs:235` 只断言 summary 非空 | ✅ 1-42：`meta.use` / `meta.energy` / `meta.avoid` + `anim shots --use` 过滤 |

---

## 6. 明确不要学的

| 别学 | 为什么 |
|---|---|
| **代码**（AGPL） | 与本仓库 MIT 不兼容；只能借思路与口径 |
| 目录规模崇拜（517 / 152 / 150） | 是"可检索内容"不是"可渲染能力"；205 项要外部生成服务，150 镜头要 Remotion |
| 渲染路径（Edge / 最大 1x / JPEG q96） | 我们 Chrome + 4K + NV12 全面更强 |
| 确定性容差（mean 0.5 就放行） | 我们的逐像素基线更严；子帧运动模糊也不允许这种容差 |
| GUI / 时间线编辑器 / 自更新器（`maintenance-updater.mjs` 1591 行） | 不是我们的产品形态（作者读代码，改时间就是改代码） |
| 把 152 套设计体系直接变风格包 | 那是 web 设计令牌，不是运动设计；我们的风格包是"配色+字体+母题+后处理+版面+字幕带"六件套 |
| 逐词高亮字幕（`karaoke-fill-sync` 配方） | 与 [`CAPTIONS.md`](CAPTIONS.md) 的实验结论正面冲突（关键词突显是负效应） |

---

## 7. 证据索引（想复核时从这查）

| 结论 | 上游位置 |
|---|---|
| 渲染桥 / 确定性容差 / JPEG 中间帧 / Edge / scale 上限 | `src/render-template.mjs:43-209`（`:58` scale、`:68` Edge、`:144-177` 确定性、`:182` JPEG） |
| 成片质检 / 黑场 / 静帧 / 音量 / 时长容差 | `src/media/index.mjs:189-211`、`:586-613`（`:600` 容差） |
| 时间线合成 / 闪避 / loudnorm | `src/media/index.mjs:460-583`（`:539-545` sidechain、`:548` loudnorm） |
| ASS 转义 / 时间取整 / 词级重映射 | `src/media/captions.mjs:78-84`、`:94-120`、`:152-201` |
| 拍速分析（可选 BPM 锁相） | `src/media/index.mjs:213-265` |
| Shotcraft 目录与不可渲染边界 | `vendor/video-shotcraft/catalog.json`、`docs/shotcraft-library.md:55-60` |
| 许可证与来源 | `THIRD_PARTY_NOTICES.md`、`README.md` §许可证与致谢 |
| 真实素材成品样例 | `examples/eac-launch/{film.html,BEATS.md}`、`scripts/demo-film.mjs` |
| 自审记录（诚实纪律） | `docs/review-2026-10-17.md`、`docs/open-design-integration.md` §验证 |

> 复核提示：`out/_staging/eacdw/` 里有 `tree.json`（全树）与 `raw/`（白名单文本）。
> 需要更多文件时按 `tree.json` 里的路径从 `raw.githubusercontent.com` 拉，别整仓 clone（280MB，其中 vendor 263MB）。
