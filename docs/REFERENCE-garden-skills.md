# 参考拆解：ConardLi/garden-skills —— `motion-showreel`（"用代码做动画视频"的 agent skill）

> 拆解日期 **2026-11-15**。上游：<https://github.com/ConardLi/garden-skills>（MIT），
> 主体是 `skills/motion-showreel/`：`SKILL.md` 32,386 B + `references/` 12 份 +
> `references/styles/` 44 份风格字典 + `scripts/` 10 个可执行工具。
> 本文只回答一件事：**它有哪些东西是 anim 该拿的**。
>
> 结论写在 §0，抄与不抄的判据写在 §3 / §4。**看完只记一条也可以：§3 的 1-76。**

---

## 0. 一句话结论（先给）

**同一条管线，不同的杠杆。** 它和我们是**同一套底层约束** —— 页面暴露确定性的 `render(t)`、
脚本逐帧截图、ffmpeg 合成；它 `references/stack.md` 的禁列表（`Math.random` / `Date.now` /
rAF / 定时器 / CSS 动画 / 帧间保存状态）和 `AGENTS.md` §4 铁律几乎逐条同构。

所以**架构上没有可抄的**。它的增量全在两端：

- **输入端**：把"对标一支参考片"从形容词变成**可量出来的数**（`inspect.mjs grid/heat`）。
- **判据粒度**：验收按"文件规格逐项点名"，没传的规格叫 **NOT CHECKED**，不算通过。

我们的强项在**中间层**：29 个镜头模板 + 配置档（零代码出片）+ 32 套可执行风格 + 16 个 `lint-*` +
42 个命令模块 + CI 80/80。这些它一样没有（它是"每片写一份 `motion.js`"）。

**一句话取舍**：学它的**入口**，不学它的**结构**。

---

## 1. 它到底是什么

| 层 | 内容 | 规模 |
|---|---|---|
| 契约 | `SKILL.md`：适用范围 / 8 步工作流 / 两条 🛑 确认节点 / 六条底线 / 工具速查 | 32 KB |
| 方法库 | `references/`：`craft`(22.5K 手法库) / `sound`(28.1K) / `recipes`(17.3K) / `review`(15.0K) / `stack`(13.6K) / `narration`(12.7K) / `progress`(11.1K) / `brief-template`(9.5K) / `formats`(9.2K) / `editor`(7.3K) / `long-form`(6.2K) | 12 份 / 160 KB |
| 风格库 | `references/styles/<slug>.md`（swiss-editorial / ink-wash / risograph / synthwave-neon / data-motion / guochao / pixel-game …）+ `INDEX.md` + `_template.md` | 44 份 |
| 工具 | `render.mjs`(25.4K) `inspect.mjs`(24.0K) `audio.mjs`(22.0K) `build-long.mjs`(17.6K) `editor.mjs`(11.8K) `preview.mjs` `narration.mjs` `progress.mjs` `scaffold.sh` `check-env.mjs` | 10 个 |
| 产出 | 每个项目 `<slug>/`：`brief.md` `index.html` `motion.js` `timeline.js` `score.mjs` `build.sh` `qa/` `out/` | 每片一套 |

工作流八步：**0 环境 → 1 需求确认(🛑) → 2 brief → 3 风格帧(🛑) → 4 制作 → 5 音效混音 →
6 工作区预览(🛑 等确认导出) → 7 导出与验收 → 8 交付**。

---

## 2. 逐项对照（我们的读数都实测过）

| 维度 | garden-skills `motion-showreel` | 我们（ai-anim） | 谁强 |
|---|---|---|---|
| 确定性 | 禁 `Math.random`/`Date.now`/rAF/定时器/CSS 动画；字体素材加载完才 `READY` | `AGENTS.md` §4 八条铁律 + `src/timeline.js` 纯函数；另有 `anim determinism` 专测量具 | **平** |
| 出图验证 | `--still` + `--sheet`，自查看图 | `still` / `sheet` / `board` / `cuts` / `rhythm`，agent 用 Read 看图 | **我们深** |
| 镜头复用 | 无模板层，每片手写 `motion.js` | A 档 29 个镜头模板 + B 档配置档（连 `scenes/` 都不用建） | **我们** |
| 风格 | 44 份 **markdown 风格字典**（人读，靠模型遵守） | 32 套**可执行风格包**（`anim styles`，写 `style: 'paper'` 一像素生效） | **我们**（但见 §3-①） |
| 判据 | `inspect.mjs qa`：解码/尺寸/帧率/时长/帧数/音轨/黑帧/响度/真峰/循环接缝；**没传的规格 = NOT CHECKED ≠ 通过** | `check` 十条腿 + 16 个 `lint-*` + `qa`/`verify`/`hashes`/`stamp`；`qa` **没有期望值校验** | **各有胜负**（见 §3-③） |
| 参考片拆解 | `inspect.mjs grid/heat/sheet/strip` —— **吃外部 mp4**，量剪点、BPM 候选、每段占几步、运动热图 | **没有**。`sheet`/`cuts` 只渲自己的任务 | **它**（见 §3-②） |
| 声音 | 内置零依赖合成器 `score.mjs`（鼓/贝斯/铺底/FM/侧链/混响）+ Tone.js 采样 + 外部曲子；**BGM 与音效分开选来源** | 每片手搓 `scripts/make-*-audio.mjs`（6 份，最大 36 KB）；音效走 SoundDino + `anim mix --sfx` | **它**（见 §3-⑤） |
| 口播 | 用户原稿 TTS（Gemini/MiniMax），真实时长 + 句段/词级时间戳 | `anim say`（Edge TTS）自动量真实时长、解 `stretch/slot`、写词级 `words` | **我们**（更自动化） |
| 长片 | 分章制作到 20 分钟 + 章节缓存 + `build-long.mjs` | `--segments` 分块断点重渲 + `stamp` 认版本；无"按章制作"流程 | **平** |
| 预览 | `editor.mjs` 剪辑工作区（拖动 / 试听 / 调音 / 点按钮导出） | `npm run dev`（实时预览）+ `anim film-html`（单文件播放器） | **它**（给非 CLI 用户） |
| 画面能力 | Canvas/SVG/DOM/WebGL/Three.js 混用，靠人写 | 3 种 3D（解析投影 / raymarch / Three 真网格）+ `view` 九种整片成像 + 母题库 | **我们** |
| 循环片 | 一等公民：`--loop` 构建旋钮 + qa 接缝检查 + `craft.md` 专门的 Loop 时长模板 | `grep -- "--loop"` 在 `scripts/` 下 **0 命中** | **它**（见 §3-④） |

---

## 3. 值得拿的（①对方怎么做 ②我们缺什么 ③改哪、代价 ④值不值）

### 3.1 ① 风格包的「辨识信号 / 最俗的版本」两节 —— 纯文档，性价比最高 · **BACKLOG 1-75**

**① 对方怎么做。** 每个风格 md 有固定两张表：

- **辨识信号**（挑 2–3 个，**至少一个不在俗套里**）—— 例如 `data-motion.md` 给了 10 条：
  长出来的柱子 / 画出来的折线 / 滚动计数 / 高亮一个其余变灰 / 刻度变化 / 单位图 / 面积比例 / 地图 / 排名赛跑 / 注释标注。
- **这个风格最俗的版本** —— 同文件的原文：*"深色底、发光的条形图赛跑、角落里一个滚动计数器、结尾一个大数字反色"*。
  写 brief 时**必须写明翻掉了哪几条**，或说明为什么刻意保留。

**② 我们缺什么。** `src/style/index.js` §字段表的 7 个字段（`palette` / `fonts` / `post` / `grid` /
`captions` / `motif` / `view`）**全是机器参数**，没有一个字写"这套长什么样才叫像它"。
32 套风格目前各只有 `anim styles` 里的一行备注。

**③ 改哪、代价。** 不动代码：`docs/STYLE.md` 为 top 8 套各补两节（信号 3–5 条 + 最俗版本 3–4 条），
`anim styles` 输出加一行指针。**约半天**，零回归风险。

**④ 值不值。** 值。`STYLE.md` §6 现在只有一句"风格由内容决定"，**没有判据**；补上这两节，
选风格才从"凭感觉"变成"挑信号 + 躲俗套"，而且它正好接上已有的 `lint-color-family` / `lint-anti-ppt` 的判据风格。

### 3.2 ② 参考片拆解器 `anim ref <外片.mp4>` —— **硬缺口，建议第一个做** · **BACKLOG 1-76**

**① 对方怎么做。** `inspect.mjs` 吃**别人的成片**，输出可比较的读数：

| 子命令 | 量出什么 |
|---|---|
| `sheet <ref> --cells 30` | 整片接触表，先看全貌 |
| `grid <ref> --strips` | **剪点**（scene-cut）+ 它们落在的**节拍网格**（BPM 候选、每段占几步、每个转场的连续帧） |
| `heat <ref>` | 每段的**运动热图**（哪里在动、动多大面积） |
| `strip --at 4.2` | 某一时刻的连续帧小样 |
| `motion` / `loop` | 按 `SHOTS`/`HOLDS` 报**按镜头的运动、跳变、闪帧** / 循环接缝 |

写 `brief.md` 时，"对标"一栏必须填**量到的数**，不是形容词。

**② 我们缺什么。** `anim sheet` / `anim cuts` 走 `openSession({ task })` —— **只渲自己的任务**，
不读外部 mp4；`tools/` 下 `grep -i "scenecut|heat"` **0 命中**；`docs/` 里"对标"只有 3 处提及，
且都在复盘文档里，**流程里没有这一步**。

**③ 改哪、代价。** **不造新算法** —— 我们已经有：

- `scripts/cmd/rhythm.mjs`：降采样 → 相邻帧差 → 静/动分段表（`stillRatio` / `longest` / `holds`）。
- `tools/lint-event-density.mjs`：同一套帧差，判静态跨度 ≤3.5s、稀薄窗口 ≤25%（`STATIC_SPAN` / `THIN_SHARE`）。

缺的只是**换输入源**：ffmpeg 抽帧（已有 `scripts/lib/media.mjs`）→ 复用帧差 → 出：
①场景切点表 ②BPM 候选（切点间隔的最大公约数 / 直方图峰）③每段运动量 ④热图。
**代价：2–3 天**（新增 `scripts/cmd/ref.mjs` + 一个纯 JS 回归夹具，不需要 GPU 就能测判据）。

**④ 值不值。** **最值。** 其余四条都是"补一条规则"，这条补的是**输入端**：接上之后，
`SCENE-BRIEF-TEMPLATE.md` §11「选题 → brief」的对标环节才第一次有据可依，
所有审美判据（运动上限、事件密度、转场比例、时长 CoV）也才有**外部参照**可比。

### 3.3 ③ 验收极性：没传的规格 = NOT CHECKED ≠ 通过 —— 我们已完成 80% · **BACKLOG 1-77**

**① 对方怎么做。** `inspect.mjs qa out/final.mp4 --expect-size 1920x1080 --expect-fps 30 --expect-duration 16 --audio required`；
原文：**"没传的规格项会列成 NOT CHECKED，这时不算验收通过"**；任一项 FAIL 退出码就是 1。

**② 我们缺什么。** 分两半，**一半已经很强**：

- ✅ `check` 侧已经做对了 —— `pushSkipped` / `formatSkipped`，`tools/test-check-skipped.mjs` 已断言
  "全跑了"与"这一段没执行"必须可区分，结论行带 skipped 计数。
- ❌ `qa` 侧没有 —— `scripts/cmd/qa.mjs` 只报解码/黑场/静帧/音量四类**读数**，**没有尺寸、帧率、时长、
  帧数、音轨存在性**的期望值校验。而"期望值表"这套机制在别处已经存在（`src/lib/media.mjs:270` 的 `LOUDNESS_TARGET`）。

**③ 改哪、代价。** `qa` 加 `--expect-size/--expect-fps/--expect-duration/--audio required|none`，
沿用 `LOUDNESS_TARGET` 的"表 + assess + 逐项说人话"写法；缺项打 **NOT CHECKED** 且**结论不算通过**。
**代价：半天**。要小心的一条：默认行为必须保持"只报读数"（`qa` 现在的设计原则），
只有显式传了 `--expect-*` 才把极性翻成门。

**④ 值不值。** 值，成本最低的一条。现在"没验"和"验过了"在 `qa` 的输出里长得一样 ——
这正是我们自己反复吃过亏的那类假绿。

### 3.4 ④ 循环片是一等公民 · **BACKLOG 1-78**

**① 对方怎么做。** 三处一起做：`build` 带 `--loop` 旋钮；`inspect.mjs qa --loop` 验**接缝**；
`craft.md` 有专门的 **Loop 时长模板（4–12 秒）**。

**② 我们缺什么。** `grep -- "--loop"` 在 `scripts/` 下 **0 命中**；`qa` 不做接缝；`craft` 没有对应章节。

**③ 改哪、代价。** 判据本身就是现成的像素比对：**末帧 vs 首帧差 ≤ 阈值**（`hashes` 的比对代码可复用）。
加 `anim qa --loop` + `video --loop`（首帧静置或末帧回卷两种模式选一）+ `docs/MOTION.md` 补一条时长建议。
**代价：1 天**。

**④ 值不值。** 值，但**排在 1-76 之后**。理由不是审美 —— 循环片（bumper / 直播待机 / 官网 hero）
是**唯一能把判据完全机器化**的产出形态，比任何审美判据都便宜，而且它现在**根本做不了**。

### 3.5 ⑤ 声音方向写进 brief，而不是"找首 BGM" · **BACKLOG 1-79**

**① 对方怎么做。** brief 的 `sound` 字段要求写清：**声音对标**（哪支片的哪一层）+ 律动 + 和声 + 配器 + 曲线，
外加一份"**音频默认要避免的清单**"（A 小调四踩 / 每个重拍 impact+crash / 钟声落版）。
合成器是**共享的**：`score.mjs`（零依赖，鼓/手鼓/贝斯/铺底/拨弦/马林巴/FM/环境底噪/侧链/混响/lo-fi）
或 `score.tone.js`（Tone.js 离线渲染 + 采样乐器）；`audio.mjs build` 统一输出 −14 LUFS。

**② 我们缺什么。** 分两层：

- `docs/SFX.md` 有「语义规则：不再每个切点一声风」—— 说明**吃过同款亏**，但只修了**摆位**，没修**方向从哪来**。
- 合成器层面更明显：`scripts/` 下 6 个 `make-*-audio.mjs`（`make-promo-audio.mjs` **36 KB**）
  **是每支片子抄一份**，`scripts/lib/` 里**没有**共享合成器。

**③ 改哪、代价。** 两步：①`docs/SCENE-BRIEF-TEMPLATE.md` §11 的 brief 增加 `sound` 栏（含"避免清单"）；
②把 6 个脚本的共同部分提成 `scripts/lib/score.mjs`（鼓 / 贝斯 / 铺底 / FM / 侧链 / 混响 / lo-fi），
`task.config` 里写 `score: './score.mjs'`。**代价：①半天 ②2–3 天**（重构 6 个脚本，需逐支对拍响度）。

**④ 值不值。** ①值得立刻做（纯文档）。②中等：收益是"新片子的声音从手搓变成改参数"，但要先确认
这 6 个脚本的共同部分到底有多少（如果各片音色差异大，抽出来反而拧巴）——**动手前先量重复率**。

---

## 4. 看着好但不该抄的（以及为什么）

| 别抄 | 为什么 |
|---|---|
| **44 个风格写成 markdown** | 我们的 32 套是**可执行**的（一行 `style: 'paper'` 逐像素生效，`still _style-sampler` 直接试色）。抄成手册是**降级** —— 只抄 §3.1 那两节**元数据** |
| **七步流程 + 两道 🛑 等确认** | `AGENTS.md` §2 的"先草稿后成片"颗粒度已经对了，且我们多了 `--draft` / `--dry-run` / `queue` 的成本控制。搬进来只会跟 65536 B 预算打架 |
| **`editor.mjs` 剪辑工作区** | 它是给"不会跑 CLI 的用户"的。我们的 `npm run dev` + `film-html` 已覆盖，用户是 agent，不值当维护一个 web 应用 |
| **`progress.mjs` 制作进度页** | 同上；agent 的"看过程"就是 `still` + Read 看图，已经在做 |
| **`build-long.mjs` 章节缓存** | 我们的 `--segments` 已经是分块断点重渲；差别只在"按章组织"，等真有 20 分钟片子再谈 |
| **它承认的短板** | `craft.md` 自述做不了写实人物 / 物理精度；我们有 Three.js 真网格 + raymarch，**这条本来就更强** |

---

## 5. 许可证与使用纪律

- 上游 **MIT**（README 徽章指向 `./LICENSE`）。
- 本文**没有**拷贝它的 `references/` 正文进仓库，只提炼了两处（§3.1 的两节结构、§3.5 的 brief 字段），
  以及 §2 对照表里的**事实性读数**（文件大小、子命令名）。
- 若将来真要成段引用它的风格字典（44 份），按 `docs/REFERENCE-style-pack.md` §5 的口径重新过一遍授权，
  并保留出处。

---

## 6. 证据（2026-11-15 实测，怎么复核）

| 断言 | 怎么复核 |
|---|---|
| `qa` 只报四类读数、没有期望值校验 | `scripts/cmd/qa.mjs` 的 `classifyMediaScan` 调用 + `--file/--strict/--freeze/--no-decode/--json` 参数表 |
| `sheet` / `cuts` 只渲自己任务 | `scripts/cmd/sheet.mjs` 里的 `openSession({ task, only })` |
| 仓库里没有"外部参考片"的通路 | `grep -i "scenecut\|heat" tools/` → 0；`docs/` 里"对标"仅 3 处 |
| 没有循环片支持 | `grep -r -- "--loop" scripts/` → 0 |
| 风格包只有 7 个机器字段 | `src/style/index.js` §字段表（`palette/fonts/post/grid/captions/motif/view`） |
| 合成器没共享 | `scripts/lib/` 目录清单里没有 synth/score 模块；`scripts/make-*-audio.mjs` 6 份各自 import `node:fs` |
| 上游规模读数 | `api.github.com/repos/ConardLi/garden-skills/contents/skills/motion-showreel/...` 的 `size` 字段 |
