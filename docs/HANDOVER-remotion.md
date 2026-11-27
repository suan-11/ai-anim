# ai-anim 迁移到 Remotion · 计划与交接

更新于 2026-11-27。已完成全部迁移收尾与全面切换：`registry.json` + `bridges.generated.tsx` 单一登记、`nekohome-intro-ja` 切换为真实镜头桥、修复 `Compositor` `mode` uniform 类型缺陷与 `EngineBridge` 初始化/内联旁白/缓存键隐患、`check`/`review`/`verify`/`qa` 全面接入 Remotion、`npm run dev` 切换为 Remotion Studio（旧预览保留 `npm run dev:legacy`）、`anim new` 自动登记、已登记任务默认走 Remotion（未登记旧任务与带 `--only`/`--variant`/`--gpu` 等选项时自动回退旧引擎）。

## 本轮派工与汇合顺序

| 工作 | 交付与衔接 |
| --- | --- |
| 阶段 2 · 任务数据与音画 | 从已有 `rm/` 入口继续，完成日配样片和切点、字幕、片段音轨验收。缺生成音轨的环境仍须能打开原生样片。 |
| 阶段 3 · 复杂镜头 | 在独立入口验证 `paperfold`，产出并发、跳帧、交叠和运动模糊结果，再决定哪些镜头可进入主入口。 |
| 阶段 4 · CLI 与交付 | 先接显式渲染器选项和原生样片，再验证草稿、分块、诊断和 AstrBot。每个命令按已验证能力选渲染器。 |

三个工作包并行，验收按依赖汇合。共用注册和配置在样片接口稳定后统一接入，默认入口按阶段 4 的切换门槛决定。验证产物各自落在 `out/_remotion-migration/` 的独立目录。

## 本轮验收与入口

| 验收 | 结果与复跑资料 |
| --- | --- |
| 阶段 2 · 日配音画 | 完整标定片 2835 帧、60 fps、47.25s，含立体声 AAC。既有片段 120 帧，修复素材解析后另用 Node 20 导出 24 帧跨 `f495`。干净环境缺生成音轨时，原生样片正常，打开日配样片才报告缺少 `./audio/ja-mix.mp3`。 [独立验证](../out/_remotion-migration/stage2-agent/verification.md) |
| 阶段 3 · `paperfold` 局部 | `rm/webgl/index.jsx` 的 38 帧 1080p 交叠窗口已走 Remotion 两并发导出。切点无黑帧，乱序跳帧后复现同一 Canvas 哈希。1 和 4 子采样分别做了重复帧对照，整片及跨驱动还需验证。 [复杂镜头复跑记录](../out/_remotion-migration/stage3-agent/verification.md) |
| 阶段 4 · 原生 CLI | `example-config-only` 支持 Remotion 的 `still`、`shot`、`video`、`queue`，实测草稿、跨切点分块、缺块续渲、失败时保留上次产物和严格 QA。默认文件名保留 `.remotion` 标识，带 `--out` 时发布到指定路径。AstrBot 本地桩验证了 Remotion 的进度、PNG 与 MP4 拾取以及旧引擎单帧。 [分块产物](../out/_remotion-migration/stage4-agent/final/segmented.mp4) |

```powershell
npm run studio
npm run studio
node scripts/anim.mjs still example-config-only --renderer remotion -t 5
node scripts/anim.mjs video example-config-only --renderer remotion --draft --from 3.45 --to 3.55 --segments 0.1
node scripts/anim.mjs qa example-config-only --renderer remotion --file out/example-config-only/example-config-only.remotion.draft.3.45-3.55.mp4 --audio none --strict
```

默认切换已于 2026-11-27 落地：`nekohome-intro-ja` 已接入真实镜头桥 `Task-nekohome-intro-ja`（`NekohomeJaVerify` 保留用于 Studio 音画标定），`check` / `review` / `verify` / `qa` 均已接入 Remotion（编程式 `bundle + openBrowser + renderStill`），`Compositor` 的 `uniform float mode` 已修复。新增或移除登记任务运行 `node tools/gen-remotion-registry.mjs`（CI 守门 `--check`）。

完整样片的技术 QA 使用明确口径。原生样片的整段暗色片尾计入 `--tail 2.5`，日配标定画面的静帧以 `--freeze 5` 复核。两者在默认阈值下各有预期告警，日配标定片仅用来验音画同步。

## 目标和职责

Remotion 负责帧时钟、镜头编排、Studio 预览和视频渲染。同一个 Composition 用来预览、取帧和导出。新任务用 React 组件写镜头，普通图文镜头用 DOM 或 SVG，复杂效果可用由帧号驱动的 Canvas、GLSL 或 Three.js。每帧仍应能从输入和帧号直接求值。 [Composition](https://www.remotion.dev/docs/composition) · [Sequence](https://www.remotion.dev/docs/sequence)

`ai-anim` 负责制片数据与流程。复用现有分镜、镜头模板参数、风格和字体、旁白词点、音频分析、混音、字幕、诊断和质检。逐步让这些工具读取新渲染器的时间线或产物。旧任务暂由原引擎独立运行，逐个验收后再切换任务的渲染器。

这项计划更新了之前对 Remotion 的采用方向。旧选型记录保留了自适应子帧采样、断点续渲和交付复核等能力的来历，可用于核对迁移范围。 [早期选型记录](REFERENCE-remotion.md) · [当前制作交接](HANDOVER-2026-11-23-v2.md)

## 已核实的起点

| 项目 | 当前情况 |
| --- | --- |
| 工作区 | 盘点时 `master` 位于 `2cffa9c`，比本地记录的 `origin/master` 超前 42 个提交。`tasks/tube-map/` 有未提交修改，`tasks/world-execute-me/` 是未跟踪目录。实施时先看实时 Git 状态，按新任务单独落改动，现有制作任务归原工作区继续维护。 |
| 本机运行环境 | Windows，Node 24.13.1、npm 11.8.0、Chrome 157.0.8103.80、FFmpeg 和 ffprobe 8.1.2，仓库已有 `node_modules`。现有 CI 使用 Linux 和 Node 20，接入时按项目的 Node 版本要求验证并锁定同版本的 Remotion 包。 [依赖声明](../package.json) · [CI](../.github/workflows/verify.yml) |
| Remotion 探针 | 仓库同级 `_rm_probe` 已有独立项目，使用 Remotion 4.0.404 和 React 18.3.1。现有 `out/probe-audio.mp4` 经 ffprobe 确认为 H.264 + AAC，1280×720、30 fps、90 个视频帧。以此确认本机基础导出可用，正式依赖版本以仓库内验证结果为准。 |
| 任务发现 | 本机 `anim tasks --json` 返回 `anim.tasks/1` 和 107 个任务。这个命令用静态读取生成清单，时长有时为 `null`。Composition 的时长应来自实际解析后的时间线。 [任务清单实现](../scripts/cmd/tasks.mjs) |
| 准备阶段回归 | 已通过 `test-tasks-meta`、`test-timeline-guard`、`test-cues` 和 `test-segment-cuts`。正式接入前还要留存同一批样片的旧引擎画面、机读元数据和耗时作为对照。 |

## 分阶段实施

### 1. 在仓库里跑通原生样片

- 在 `ai-anim` 建立 Remotion 入口和 Composition 注册，新增独立的 Studio、单帧和视频试跑入口。
- 以 [`example-config-only`](../tasks/example-config-only/task.config.mjs) 的四个镜头为切片，先做 `title`、`chart`、`kinetic`、`outro` 的 React 实现。沿用任务配置里的内容、镜头 ID、段时长和基本样式。用显式导入注册样片，后续按需扩展任务发现。
- 开工时先在旧引擎记录每段代表帧和首尾、切点帧，作为构图与节奏参照。旧引擎基线命令见下方。原生组件的有意画面差异随样片记录。
- **验收**。Studio 能拖到任意帧，独立导出 PNG 和 H.264 MP4。1080p、60 fps、834 帧，镜头边界为第 0、210、474、684、834 帧，最后一个值是排他终点。重复渲染代表帧的结果一致，切点前后无缺帧或黑帧。留存复跑命令和产物路径。 [renderStill](https://www.remotion.dev/docs/renderer/render-still) · [renderMedia](https://www.remotion.dev/docs/renderer/render-media)
- **实测记录**。独立复渲通过上述检查。产物在 `out/_remotion-migration/review-stage1/`，阶段 1 的开工命令和画面对照在 `out/_remotion-migration/HANDOVER-stage1.md`。收尾已改为按绝对切点换算帧，明确拒绝当前还不支持的 `at` 排程。TypeScript 5.9.3 严格类型检查通过，Remotion 重新构建后登记 834 帧，Windows / Node 24 本地执行 `regress-all --ci` 通过 94 项，含新增的时间线回归。

### 2. 接入制片数据和音画同步

#### 2A. 先对齐任务解析

- 从 [`src/tasks.js`](../src/tasks.js) 把 Vite 专属的 `import.meta.glob` 任务发现与可共享的配置解析分开。用显式任务导入接入 Remotion，优先复用变体合并、音轨选择和 `build()` 的时间语义。解析结果包含尺寸、帧率、镜头 ID、绝对起止位置与素材引用，供 Composition 和诊断共同读取。浏览器侧的镜头组件由注册表提供。
- 用 `example-config-only` 的 834 帧、[`_info-lab`](../tasks/_info-lab/task.config.mjs) 的 `dark` 和 `paper` 变体以及 `nekohome-intro-ja` 的六段切点做数据对照。覆盖秒、拍点、旁白时长和已解析的绝对排程，逐项核对变体的合并与数组替换。时间线内部用左闭右开区间，统一量化绝对切点。交叠段的排程结果可以先做数据对照，视觉合成在阶段 3 验证。 [现有时间线](../src/timeline.js)

#### 2B. 接入可预览、可导出的音画样片

- 用 [`nekohome-intro-ja`](../tasks/nekohome-intro-ja/task.config.mjs) 做一个六段音画验证 Composition，每段可先用简化 React 画面标明镜头和切点。镜头段长以 `audio/ja.timing.mjs` 为准，配音与配乐播放现有 `audio/ja-mix.mp3`，中文字幕用 `audio/ja-sub-zh.narration.json`。Studio 和导出读取同一份解析结果和素材映射。
- 用现有字幕布局和字体口径核对中文字幕的换行、保留区和出现时刻。剪出含一次切点和一句字幕的片段，验证裁切后的音轨起播位置。内部 `[startFrame, endFrame)` 在调用 `renderMedia` 时转为 `[startFrame, endFrame - 1]`。CLI 的 `--only` 重定位和 `--from/--to` 兼容归阶段 4。 [字幕规范](CAPTIONS.md) · [Remotion 帧区间](https://www.remotion.dev/docs/renderer/render-media#framerange)

#### 2C. 验收，再交给阶段 3

- 对照首、中、尾三处字幕和日语声音事件，字幕与源标注的边界误差在一帧以内。用 ffprobe 确认完整导出和片段的帧数、时长和音轨，并试听片段首尾。整体落点以采样或帧位置对照，AAC 容器的填充时长单独记录。
- `ja-mix.mp3` 本机已有，干净克隆需按任务注释重建音轨。CI 用可复现的短音频验证时间对齐和缺失素材提示。指定音轨缺失时报告任务和文件，便于重建。用干净环境验证 Node 20 安装与离线回归后，记录命令、边界帧、音轨探测结果和产物路径，再进入 `paperfold` 复杂镜头。 [音轨忽略规则](../.gitignore)

### 3. 验证 WebGL、转场和运动模糊

- 先用 [`paperfold`](../tasks/paperfold/task.config.mjs) 的代表镜头验证画布初始化、资源就绪和卸载。由 Remotion 的帧号驱动绘制，使用同一帧的输入重新计算画面。再用该片的交叠区间验证跨镜头效果、公共背景和后处理。 [现有绘制生命周期](../src/core/engine.js) · [Remotion 异步资源就绪](https://www.remotion.dev/docs/delay-render)
- 测试随机跳帧、单帧与批量的一致性、并行渲染和 1080p 下的性能。运动模糊分别检查旧引擎的快门、子帧采样和最终视觉效果。画面比较使用固定环境的 PNG，测同一段的耗时与内存，记录可接受的差异。
- **验收**。复杂镜头在目标环境可重复渲染，交叠处无黑闪，同帧结果与前一帧或任务顺序无关。只有依赖都满足的任务进入 Remotion 默认出片范围。仍依赖旧引擎跨镜头合成、自适应采样或硬件行为的任务保留旧入口，优先迁移实际需要再出片的任务。

### 4. 接回 CLI，切换默认路径

- 用现有 `scripts/anim.mjs` 作为统一入口。先给已验证任务接入 `still`、`shot`、`video`，再接 `review`、`check`、`verify` 等依赖旧浏览器会话的诊断。纯数据检查和基于成片的 `qa` 优先复用。迁移中的渲染检查应明确报告支持状态。
- 保留 `out/<任务>/` 下的产物命名、退出码、`anim.tasks/1` 字段语义和帧进度输出。AstrBot 会解析进度行并从产物目录挑选 PNG / MP4。临时产物在验证通过后发布到正式路径，失败保留上一份可交付产物。 [CLI](../scripts/anim.mjs) · [出片与校验](../scripts/cmd/video.mjs)
- 对齐草稿缩放、时段导出、队列和 `--segments` 的断点续渲。分块避开转场，缓存签名包含能改变画面或声音的输入，以及渲染器、版本和参数。用中断重跑验证已完成块的复用、无缝拼接和音画同步。受影响的镜头和缓存才需要重出。
- **切换门槛**。同时跑通原生样片、含旁白样片、代表性复杂镜头和一个旧引擎任务的出片。覆盖帧数与音画时长、确定性、草稿、片段、分块续渲、`qa` 和 AstrBot 本地联调。随后把 `npm run dev` 切到 Studio，新任务默认 Remotion。通过显式任务选择可回切渲染器，旧成片的基线和版本戳继续与生成它们的渲染器关联。
- 更新 [README](../README.md) 和 [AGENTS.md](../AGENTS.md) 的开工与交付说明。保留章节锚点，执行 `lint-agents-size` 和 `lint-agents-refs`。跨渲染器的预览、出片和质检结果达成约定后，再收尾清理旧入口。

## 接手时先做什么

1. 在 `ai-anim` 仓库根目录确认 `git status --short --branch`，阅读 [AGENTS.md](../AGENTS.md) 的确定性与渲染约定。环境盘点和样片素材以本机实时结果为准。
2. 重跑阶段 1 时，用下列命令恢复旧引擎基线并验证阶段 1 收尾。抽帧、探测结果与命令记录放在 `out/_remotion-migration/`，文件名注明渲染器、任务、帧号和版本。仓库进行旧引擎渲染时，只向 `out/` 写入制品。

   ```powershell
   node scripts/anim.mjs tasks --json
   node scripts/anim.mjs still example-config-only -t "1,5,9,12.5"
   node scripts/anim.mjs shot example-config-only --from 3.25 --to 3.75
   npx.cmd --yes --package typescript@5.9.3 tsc -p packages/remotion/tsconfig.json
   node tools/regress-all.mjs --ci
   ```

3. 开始阶段 2 时先跑 `node scripts/anim.mjs cues nekohome-intro-ja --json`。本机已确认该命令可读出六段切点。旁白逐词数据另从 `tasks/nekohome-intro-ja/audio/ja.timing.json` 读取，中文字幕以任务配置引用的中文表为准。先完成 2A 的元数据对照，再接音画，阶段 3 开始记录复杂镜头的性能数据。
