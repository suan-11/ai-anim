# HANDOFF · 2026-10-25 夜 → 10-26（采样 bug / 语义字号 / 竖屏 / 块级重渲 / 判据元测试 / 断行）

> **📦 已归档（2026-11-01）**：原在 `docs/HANDOFF-2026-10-25-night.md`，这一轮的六件事已全部落地（销账见 BACKLOG 1-44～1-52、1-57），移入 `docs/history/`。
> 归档目录的索引见 [`README.md`](./README.md)；活的待办一律以 [`../BACKLOG.md`](../BACKLOG.md) 为准 —— 别把本文的"留给下一步"当成待办，那是**当时**的状态。

> **一次性交接单**，假设读者看不到产生它的会话。待办仍以 [`BACKLOG.md`](../BACKLOG.md) 为准。
> 这两天做了六件事：**验环境 → 修两个采样 bug → 语义字号（1-46）→ 竖屏（1-52）→ 编码器兜底与块级重渲（1-45）→ 判据元测试（1-51）→ 母题库（1-49 部分）与字幕断行（1-57）**。
>
> **先读 §0.5 交接总览**（提交清单 / 机器状态 / 测试账 / 已知缺口），再按需往下翻。

---

## 0. 一分钟版本

1. **渲染环境验通**（`check spectrum` 从 27 条红 → **0 条红**）：GPU 是真的（AMD Radeon / ANGLE D3D11 / floatRT）。
2. **修掉两个自适应采样的 bug** —— 它们让「写了 `maxSamples: 8` 的段」成片比预览**暗 27%**，
   而 `maxSamples: 8` 正是 HANDOFF-spectrum-friction §1 里作者用来提速的那个旋钮（spectrum 全片在用）。
3. **W3 / 1-46 收尾**：`type.write` 认语义字号（`size: 'hero'`）+ 四套风格各自的 token 覆盖 + 六张风格样片。

---

## 0.5 交接总览（2026-10-26 定稿，先读这一节）

**四个提交，都在 `qyac/ai-anim` 的 `master` 上（`fca3cd8..5295244`）**：

| 提交 | 内容 |
|---|---|
| `aeced23` | **修** 自适应采样两处丢帧（成片暗 27%）+ **feat** 语义字号 + 竖屏 1080×1920 |
| `df372f8` | **feat** 编码器兜底 + 块级增量重渲（1-45）+ 判据元测试（1-51） |
| `2c40aa7` | **feat** 母题库 `src/kit/motifs/`（1-49 部分） |
| `5295244` | **feat** 中日文断行（1-57）+ JIZURA 参考拆解 |

**BACKLOG 状态**：`1-45 / 1-46 / 1-51 / 1-52 / 1-57` 已完成；`1-49` **部分**（只抽了 spectrum，另三处任务不在仓库里）；
`1-56`（绿幕导出）新登记、不排期。主线剩下的：**`1-48` 模板扩张 / `1-50` infoShot / `1-53` 封面章节**。

**这台机器现在的状态**（换机器时这一段要重做）：

| 项 | 值 |
|---|---|
| Chrome | 156.0.8078.48（原装坏了缺 chrome.dll，`winget install Google.Chrome` 重装） |
| ffmpeg | Gyan **9.0.2 full build**（带 libx264），路径写在用户环境变量 `ANIM_FFMPEG` / `ANIM_FFPROBE` |
| 备注 | PATH 里第一个 ffmpeg 仍是旧的 **LGPL 构建**（没有 libx264）—— 所以必须靠上面那两个环境变量 |

**测试账（都是纯 JS，一条一条跑）**：

```sh
node tools/test-cjk.mjs          # 28  字幕断行（禁则/平衡/不丢字）
node tools/test-motifs.mjs       # 38  母题（级数收敛 / DCT 往返 / 采样）
node tools/test-gates-meta.mjs   # 37  守门判据的"能红"证明
node tools/test-block-sig.mjs    # 21  分块增量重渲的签名
node tools/test-portrait.mjs     # 39  竖屏（含"横屏原样返回同一个对象"）
node tools/test-tokens.mjs       # 38  语义字号
node tools/test-style.mjs        # 66  风格包 + 字幕
node tools/test-sampling.mjs     # 51  采样判据
node tools/test-layout.mjs       # 47  版面守门
node tools/lint-agents-size.mjs / lint-agents-refs.mjs / lint-doc-facts.mjs   # 三个文档守门
```

渲染侧的验证（需要浏览器，跑起来才算数）：

```sh
node scripts/anim.mjs check spectrum        # 修完采样后：0 红（只剩响度 -16.5 LUFS 的已知告警）
node scripts/anim.mjs check demo --quick    # 横屏回归：✓
node scripts/anim.mjs still _portrait-lab -t 3,8   # 竖屏样片
node scripts/anim.mjs still _motif-lab -t 3,8      # 母题样片
```

**已知缺口（别当成"已经好了"）**：

1. `lint-narration-dup`（旁白复述）**没有纯 JS 红证明** —— 见 `test-gates-meta` 文末的覆盖表。
2. 整份 `regress-all` 没一次跑通过：`test-parallel` / `test-world` 要浏览器、`test-say` 要 TTS。
3. 竖屏只验了 `flat` 风格 + 自建夹具，**没有真片子端到端**。
4. 母题库只抽了 spectrum 那三样；`sodium`/`bikeshed`/`beast`/`fidus`/`nekohome` 的任务目录被 `.gitignore` 排除，
   **本仓库里没有**，抽不了也删不了。

**三个"新人最容易踩"的坑**（都写在正文里了，这里只列名字）：
`lines.flush()` 不传 `ctx.out` ⇒ 线静默消失（§9.1）；`maxSamples: 8` 曾让成片暗 27%（§1）；
渲染期间写任何文件 ⇒ Vite 崩、断流（AGENTS.md §7）。

---

## 1. 两个采样 bug（都修了，都在 `src/core/engine.js` 的 `render()`）

`check spectrum` 报的 27 条红全是同一句：**「单子帧与多子帧亮度差了 0.73×」**，
且只出现在 `hook / series / series2 / sound` 四段 —— 正好是**写了 `maxSamples: 8`** 的四段。

### bug ①：一级到底（`maxSamples: 8`）时，前半段子帧被丢掉

新加的「拆两半做静止判据」把 8 个子帧拆成 `newRT`(0..3) + `sumRT`(4..7)，
而**合并那一行写在 `else` 分支里**：

```js
if (done >= maxSamples) { verdict = { stop:true, reason:'cap' } }   // ← 一级到底，跳过合并
else { …err0…; acc.render(gl, sumRT); … }                            // ← 只有这里合并
```

于是 `sumRT` 里只有 4 个子帧，而除数仍是 `done = 8` ⇒ `avgRT = 4 帧之和 / 8` = **一半的光**。
显示空间上是 **0.73×**（线性 0.5 → sRGB ≈ 0.73），不是"看不出来"。
**凡给段写了 `maxSamples: 8` 的片子，成片都比预览暗 27%**。

修法：合并移出分支，**任何判定下都合并**（除数与累加数必须一致）。

### bug ②：`newRT` 在第一级没清零

`newRT` 是**加性**累加目标，以前只在 `while` 循环里（新一级开始前）清过，**第一级从来没清**。
于是第 N 次自适应渲染的"前半段" = 本次 4 帧 + **上一帧的残影** ⇒ 越渲越亮或越渲越暗，
同一帧渲两次结果不同。修法：第一级累加前 `this.gl.clear(this.newRT, …)`。

### 证据

| 检查 | 修前 | 修后 |
|---|---|---|
| `still spectrum -t 1.5 --samples 1` | YAVG 214.84 | 214.84 |
| `still … --samples 8`（非自适应） | 214.73 | 214.73 |
| `still … --samples auto`（成片路径） | **161.41（0.75×）** | **214.80**（连渲两次同值） |
| `check spectrum` | ✗ 27 条 | ✓ 0 条（只剩响度 −16.5 LUFS 那条已知告警） |
| `tools/test-sampling.mjs` | 51 项 | 51 项（未受影响） |

⚠ **上一个提交（`fca3cd8`）之前的代码没有这个 bug**（老实现是 8 帧全进 `sumRT`，不拆半）。
所以**已交付的 `spectrum.mp4` 是对的**；危险的是"用它之后重新渲一遍"。
→ 任何用 `maxSamples: 8` 的任务，在这次修复前重新出片都会暗 27%，**修完再渲**。

---

## 2. W3：`type.write` 认语义字号（1-46 收尾）

```js
type.write('把方波拆开', 140, 330, { size: 'hero', weight: 800, color: css(P.bone) });
type.write('FOURIER · 4 项', 140, 176, { size: 'label', family: 'mono', color: css(P.ash) });
```

* 阶梯六档：`hero / h1 / h2 / body / label / mono`（`src/style/tokens.js` 的 `TYPE_SCALE`）。
* 取值来自**这套风格的** `ctx.style.tokens`：引擎在 `applyStyleFonts()` 里把 token 下发到
  每个图层的 `TextKit`（一层一份），所以同一份场景换 `--style` 之后层级还在。
* **写错直接抛**（列出可用名字）。回落成默认 64 才是最贵的错法 —— `tools/test-tokens.mjs` 钉住了这条。
* **数字仍然合法**：`size: 24` 原样通过 ⇒ 120 个老场景一个像素都不变。
* 覆盖的 API：`write` / `writeLine` / `karaoke` / `wrap` / `paragraph` / `writeOnPath` / `measure` / `layout`。

### 各风格的覆盖（`src/style/index.js`）

| 风格 | hero | 理由 |
|---|---|---|
| `print` / `flat` | 136 | 吃 `tokens.js` 的基线 |
| `blueprint` | 120 | 工程图偏"密"，标注要留得住细节 |
| `paper` | 128 | 宋体字面小，正文 42 / 标注 26 给回来 |
| `terminal` | 112 | 等宽字窄，整套收一档；错峰 0.05 |
| `noir` | 152 | 电影感 = 更少更大的字；hero 字重 900 |

### 样片（六套各一张，接触表一张）

```sh
node scripts/anim.mjs still _token-lab -t 6.5 --style <名字> --out out/_token-lab/styles/<名字>
# → out/_token-lab/styles/{print,blueprint,paper,terminal,flat,noir}/f_0006.500.png
#   接触表：out/_token-lab/styles/_sheet.png（3×2）
```

夹具 `tasks/_token-lab/scenes/token.js` 也改成了**两条路并存**：`after` 段写语义名字（吃风格 token），
`before` 段写数字（对照组），所以这张图现在同时是"token 前后对比"和"跨风格对比"。

### 测试与文档

* 新增 `tools/test-tokens.mjs`（**38 项**，纯 JS）+ 挂进 `tools/regress-all.mjs` 的 `unit:` 组。
* `docs/STYLE.md` 新增 **§4.1 语义字号**（含六套风格的 hero 对照表 + 三条规矩）。
* `AGENTS.md` §5 的 `text`+`type` 那一行加了一句（体积守门仍绿）。
* `docs/BACKLOG.md` 的 `1-46` 划掉，证据写在行内。

---

## 3. 这台机器的两个环境坑（不是仓库的问题，但会挡住下一个人）

| 现象 | 真因 | 绕法 |
|---|---|---|
| `browserType.launch: spawn UNKNOWN` / 「应用程序的并行配置不正确」 | **Chrome 装残了**：`C:\Program Files\Google\Chrome\Application` 只有 12MB，`chrome.exe` 是个壳，`143.0.7499.169\` 里只有 `Installer`，**没有 chrome.dll** | 重装 Chrome；本次全程临时把 `scripts/anim.mjs:947` 的 `channel: 'chrome'` 改成 `'msedge'`（Edge 156 完好），**已改回** |
| `Unrecognized option 'x264-params'`，然后**引擎挂住不动**（不报错） | PATH 里是 **LGPL 构建**的 ffmpeg（`ffmpeg-n8.1-latest-win64-lgpl-shared`），**没有 libx264** | 装 GPL 全量构建（`winget install Gyan.FFmpeg`）或用 `--vcodec h264_mf`（实测 7.7 fps 出片、ffprobe 复核通过）。⚠ ffmpeg 死掉时 CLI **不会报错，会一直等帧** —— 这是 §4-D 那条的同类问题，值得单独修 |

---

## 4. 下一会话从这里接

1. **`1-45` 块级增量重渲**（W6）—— 仍然是"敢返工"的前提。
2. ~~**`1-52` 竖屏**~~（W4–W5）—— **已完成，见 §5**。
3. **`1-51` 判据元测试**：这次的两个 bug 说明"判据会静默失效"仍然成立 —— `check` 抓到了，
   但 `tools/` 里没有任何纯 JS 测试能抓到它（它需要 GPU 累加）。若要补，最省事的做法是给
   `_calib` 加一段 `maxSamples: 8` 的夹具，让 `check` 的"两条路径一致"成为回归项。
4. **ffmpeg 死亡不冒泡**：`spawn` 后没有监听 `ff.on('error')`/`close`，编码器一死就无限等帧。
   建议加一条"ffmpeg 退出 ⇒ 立即非零退出并删产物"（与 `video` 的产物复核同一条纪律）。

---

## 5. 追加（2026-10-26 早上）：1-52 竖屏落地

**结论：竖屏不需要放宽任何判据。** 改的是"几何按画幅走"，不是"阈值松一点"。

### 5.1 改了什么

| 位置 | 内容 |
|---|---|
| `src/style/index.js` | `GRID_PORTRAIT`（1080×1920 基准：`pad 88` / `top 104` / `contentBottom 1112` / 字幕带 `[1180,1344]` / `footerY 1622`）+ **`fitStyleToFrame(style, W, H)`**：`H > W` 时换栅格（按**短边=宽**缩放，`× W/1080`）与字号；`resolveStyle` 多出 `gridPortrait` 字段（可被任务/风格覆盖） |
| `src/style/tokens.js` | `PORTRAIT_TYPE_SCALE = 1.35` + `scaleTokens()`：**只放大 `type` 与 `rule`**，`weight` / `motion` / `texture` 不动 |
| `src/core/engine.js` | `load()` 里 `this.style = fitStyleToFrame(...)`；`_scaledGrid()` 不再二次按 `H/1080` 缩放（那是竖屏 ×1.777 的根源） |
| `src/kit/bands.js` | 竖屏的 `sub` 带按 **84% 内容宽**算（横屏 0.19×2 在竖屏会把"字幕其实压到的位置"判成没压 —— 假阴性） |
| `src/core/captions.js`（经 `fitStyleToFrame`） | 竖屏字幕：`size ×1.35`、每行 12 字、`position: 'bottom'` |
| `scripts/anim.mjs` | 新增 **`ANIM_CHANNEL`** 环境变量（默认 `chrome`）—— 这台机器的 Chrome 装残了，以前只能改源码 |

### 5.2 为什么是 1.35，不是"按高缩放"

横屏与竖屏的短边都是 1080：按短边算，136px 的"占短边比例"一样。但竖屏高 1920，
同样 136px 只占高度的 7%（横屏 12.6%）⇒ **看起来更小**。取 1.35 后 hero ≈ 184px，
四个汉字占短边 68%（横屏是 28% 的宽度），视觉重量相当；1.5 时标题吃掉半屏。

### 5.3 实测（`tasks/_portrait-lab/`）

```
check _portrait-lab：
  版面守门：2/2 段采到文字绘制 · 最挤的一帧 4 块（上限 6；主体之外 ≤ 2）
    hero  t=1.05s  4 块  主体区 0 块字（主体是图形：2 次非文字绘制；4 块字全是标注）
    bars  t=7.60s  3 块  主体区 0 块字（同上）
  节奏（静态）：CoV 0.39  ·  ≥ 0.25
  单帧 0.097 / 多子帧 0.097  —— 两条路径一致
  ✓ 没有发现问题
```

第一版夹具触发过两次，都是**画面该改**而不是阈值该松：
① 三个读数分开写（34 / 62 / 88）被数成 3 个"看的地方" → 合并成一行（`labelRow` 纪律）；
② 读数写在柱子基线下方、正压字幕带上沿 → 改成写在柱顶上方。

### 5.4 回归

* `tools/test-portrait.mjs` **39 项**（新）：横屏**原样返回同一个对象**（老任务零变化）/
  栅格按短边缩放 / 字号 ×1.35 / 字幕带 61%–70% 且在 B 站 UI 之上 / `gridPortrait` 可覆盖。
  已挂进 `regress-all` 的 `unit:` 组。
* 横屏回归：`check demo --quick` ✓ 没有发现问题（与改动前同样的 2 条 skipped）。
* `test-style` 66 / `test-tokens` 38 / `test-layout` 47 / 三个 lint 全绿。

### 5.5 下一会话

`1-45` 块级增量重渲（W6）是主线上剩下的第一条。`1-51` 判据元测试也还开着
（这次两个采样 bug 只能靠 `check` 抓，纯 JS 侧没有防线）。

---

## 6. 追加（2026-10-26）：编码器兜底 + ffmpeg 死亡不再静默

原来那两条"环境账"里，**ffmpeg 死亡不冒泡**已经修掉；LGPL 构建缺 libx264 也不再需要人肉换参数。

| 改动 | 位置 | 效果 |
|---|---|---|
| `pickVideoEncoder()` | `scripts/anim.mjs` | 出片前探一次 `ffmpeg -encoders`（缓存）。默认 `libx264` 不存在时自动退到 **`h264_mf`**（Windows 硬件编码）→ `libopenh264` → 报错并给出两条出路。默认链路直接可用 |
| `ANIM_VCODEC` | 同上 | 给"这台机器固定用某个编码器"留的口子（优先级低于 `--vcodec`） |
| ffmpeg 提前退出即失败 | `ff.on('close')` | 以前只记账，页面还在推帧、CLI 一直等到看门狗（300s）；现在**立刻收工**并说人话：退出码非 0 ⇒ "先查编码器，别急着重跑" |
| `ff.stdin` 的 EPIPE | 同上 | 加 `error` 监听 + `end()` 前查 `destroyed`，不再抛一段 Node 栈 |
| 退出码转有符号 | `signedExitCode()` | `4294967274` → **`-22`**（EINVAL），报错可读 |

实测（本机，Chrome 156 + LGPL ffmpeg）：

```
node scripts/anim.mjs shot demo --from 0 --to 2          # 默认链路
⚠ 这台 ffmpeg 没有 libx264（多半是 LGPL 构建），改用 h264_mf。
✓ out\demo\shot_0-2.mp4   120 帧（ffprobe 复核 120 帧）  7.7 MB

node scripts/anim.mjs shot demo --from 0 --to 0.3 --vcodec h264_amf   # 故意失败
✗ 只渲染了 5/18 帧 … 这一条是 ffmpeg 提前退出（不是页面断流）⇒ 先查编码器
用时 8.3s（以前会挂到看门狗 300s，实测有人挂了 20 分钟）
```

⚠ 想按原配方（`crf16` + `tune grain`）出片仍然要 GPL 全量构建：
`winget install Gyan.FFmpeg`（本次尝试从 gyan.dev 直连下载 114MB 的 zip，速度只有 ~9 KB/s，
半小时才 16MB，已放弃 —— 走 winget 或手动装更快）。


---

## 7. 追加（2026-10-26 中午）：ffmpeg 换 GPL 构建 + 1-45 块级增量重渲

### 7.1 ffmpeg

`winget install Gyan.FFmpeg` 装好了 **9.0.2 full build**（带 libx264 / libx265）。
它没进 `PATH` 的第一个位置（用户 PATH 里 `Downloads\ffmpeg\...lgpl-shared` 排在前面），
所以用引擎自己的口子固定下来 —— 用户级环境变量：

```
ANIM_FFMPEG  = %LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_...\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe
ANIM_FFPROBE = ...\bin\ffprobe.exe
```

实测：`shot demo --from 0 --to 2` 走 libx264 crf16 + tune grain、ffprobe 复核 120 帧通过。
⚠ **颗粒素材在 crf16 下极占空间**：2 秒 = **55.6 MB**（75 秒的片子 ≈ 2 GB）。
草稿/回归用 `--crf 20` 或 `--preset veryfast`，定稿再上原配方。

### 7.2 1-45 块级增量重渲（已落地）

| 位置 | 内容 |
|---|---|
| `scripts/lib/blocksig.mjs`（新） | `sceneFileIndex()`：段 id → 场景源文件（静态扫 `id:` / `makeShot(` / `shot(`）；`blockSignature()`：渲染参数 + 引擎签名 + 这一块**真正跨过**的段的文件与段参数 |
| `renderSegments()` | 逐块比对签名：`params` 变 ⇒ 整批重渲（P1-1 的结论不破）；`tasks/` 变 ⇒ 只重渲签名变了的那几块；`src/` 变 ⇒ 引擎签名进每一块 ⇒ 整批失效 |
| `tools/test-block-sig.mjs`（新） | 21 项纯 JS 断言（含"改一个镜头只有它那块失效"、"查不到源文件的段永远重渲"） |

实测（`demo`，4 块 / 999 帧 / `--draft`）：

| 场景 | 用时 |
|---|---|
| 首次全渲 | 47s |
| 什么都不改 | **0.9s**（4 块全跳过） |
| 只改 `chart.js` | **15.3s**（只重渲第 2 块 4–9s） |
| 改 `--samples 1→2` | 整批重渲，并打印 `samples: "1" → "2"` |

两个坑，都写进代码注释了：
1. **块签名里不要给时间边界加 padding**：第一版放了 ±0.5s，结果"改 chart.js 却重渲了 3 块"
   —— 交叠段本来就满足 `end > from && start < to`，再加 padding 只会把边界外的段拖进来。
2. **首次升级会整批重渲一次**：块签名从"时间区间"换成"内容指纹"，还顺带把路径分隔符统一成 `/`
   （跨平台一致）。这一次之后才会稳定复用。

---

## 8. 追加（2026-10-26）：1-51 判据元测试

`tools/test-gates-meta.mjs`（**37 项**，挂 `regress-all` 的 `meta:gates`）。

骨架统一成两条，缺一条都算没验：

```
注入缺陷  → 判决**必须报**（红证明）
去掉缺陷  → 判决**必须不报**（对照组：防"夹具本身永远报"）
```

覆盖：

| 判据 | 红证明 | 对照 |
|---|---|---|
| 版面·一屏块数 `blocks` | 7 块（每块独占一行） | 6 块 = 上限 |
| 版面·主体区 `in-focus` | 主体区 3 块 | 2 块 = 上限 |
| 版面·主体外 `off-subject` | 主体外 4 块 | 3 块（offSubject=2） |
| 背景守门 `missing` / `blackTail` | `full=0` / 窗后中点 mean≈0 | `full=1` |
| 采样 `tol` / `cap` / `stall` | 三个出口各一条 | 对应的"继续加档" |
| 采样 **NaN** | `err=NaN ⇒ 不许 stop` | 真误差 ⇒ 正常判 |
| 误差量具 | **全 0 直方图 ⇒ 0**（那个 bug 的形状） | 真直方图 ⇒ 高分位 |
| 节奏节拍器 | 等长 4 段 ⇒ `metronome=true` | 7/4/1.5s ⇒ false |

文末还有一张**覆盖表**，把"哪个判据的红证明在哪"列全，并**点名缺口**：
`lint-narration-dup`（旁白复述）只有 CLI 侧实现，没有纯函数红证明。

夹具本身踩的三个坑（都写进注释了）：
1. 块要在**行方向上拉开**（或独占一行），否则会被 `textGroups` 合并成一块（gap 28）——
   第一版 7 块被合成 2 组，判据当然不报；
2. `offSubject` **不数第一个**"看的地方"（那是主体入口），`maxOffSubject=2` 要 4 块才越线；
3. `worldAuditVerdict` 的 `blackTail` 读的是**第二条**样本（窗后中点），只传一条永远不红。

---

## 9. 追加（2026-10-26）：1-49 母题库（部分）

`src/kit/motifs/` 落地，统一从 `src/kit/index.js` 再导出：

| 模块 | 内容 | 来源 |
|---|---|---|
| `fourier` | `squareCoeffs` / `squareWave` / `growK` / `epicycles` / `drawEpicycles` | `tasks/spectrum` 的「方波 = 一串圆」 |
| `dct` | `dct2` / `idct2` / `normalizeBlock`（8×8，JPEG 口径） | `tasks/spectrum/scenes/keep.js` |
| `waveform` | `wavePoints` / `drawWave` / `drawTicks` / `playheadX` | 各镜头重抄的"采样折线 + 游标" |

验证：`tools/test-motifs.mjs` **38 项**（级数 RMS 随项数递减 / Gibbs 过冲 1.15–1.22 /
本轮末端 == `squareWave()` 到 1e-12 / DCT 往返 <1e-9 / 归一化不改形状 / 采样不出 NaN 且 x 单调 /
游标越界夹住），夹具 `tasks/_motif-lab`（两段样片），文档 `docs/MOTIFS.md`。

### 9.1 一个**重复犯的**坑：`lines.flush()` 不传目标

母题夹具第一版**文字在、线全没了**：`drawEpicycles()` 里写了 `lines.flush()`（没传 `ctx.out`）。
屏幕/导出目标由调用方决定，不传就落到引擎默认目标 —— 画了，但不在这一帧上，且**不报错**。
现在 `drawEpicycles()` 收 `target`，夹具里两处 `flush` 都显式传 `ctx.out`。

顺带一个量图技巧（模型看不了图时）：`ffmpeg -vf "crop=W:H:X:Y,signalstats"` 量某个矩形的平均亮度，
或 `node tools/png-rows.mjs <png> <x>` 看某列上"亮度>0.5 的 y 区间"——线在不在，一秒就知道。
第一版圆用 `P.ash` + 0.45 alpha，量出来 27.5（背景 25 左右），换成 `P.bone` 0.55 后同一列出现了
y=335 / 823 两段笔画 —— **"看着有点暗"和"根本没画"在数字上是两回事**。

### 9.2 没做完的部分（诚实登记）

`sodium` 积木 / `bikeshed` 会议室 / `beast`·`fidus`·`nekohome` 的私有 `_kit.js`：**都没抽**
—— 这些任务目录被 `.gitignore` 排除（含真实素材与音频），**本 checkout 里根本不存在**。
要接着抽，得先把那几个任务目录放回 `tasks/`，抽完用 `hashes --accept --note` 记录画面变化。

---

## 10. 追加（2026-10-26）：JIZURA 拆解 + 字幕断行质量

### 10.1 `docs/REFERENCE-jizura.md`

拆了 `852wa/JIZURA`（2094★，文字 PV 自动构成，浏览器 + Canvas2D + WebCodecs）。
**只学手法**：它把"好看"做成一张**带元数据的部件表**（860 部件 / 10 个注册表 / `tags` + 权重 `w` + 适用条件 `fits`），
seed 决定抽到什么。我们缺的正是这三个字段，不是部件数量。

→ 落地清单写进了那张文档的 §6：`1-48` 补 `tags/w/fits` + 登记改成扫目录；`1-50` 按"筛部件→抽→填"写；
  绿幕/透明导出登记为 **`1-56`（不排期）**。
同时写明**三条不抄**：Canvas2D 的上限、全局 `J`+IIFE 的范式、歌词领域锁定。

### 10.2 字幕断行（`1-57`，已完成）

`src/core/cjk.js` 的 `breakCaption()`（纯函数，28 项测试），`src/core/captions.js` 已接入：

| 规则 | 之前的实际表现 |
|---|---|
| 行首禁则 | `，。、）」` 会落在行首（`type.wrap` 按宽度贪心切） |
| 行尾禁则 | `「（` 会留在行尾 |
| 不拆词 | `24fps` / `v0.9.0` 会被切成两半 |
| 两行平衡 | 出现 15 + 1 的孤儿行 |
| **超长句** | `rows.slice(0, maxLines)` —— **静默吃掉后半句**（这条是 bug 级） |

现在：禁则挂行/推行、拉丁数字串算一个单元、两行按中点+标点平衡；
超长句**先缩字号 ×0.86**（每行多放 16%），仍不行就**多给一行**并 `console.warn` 一次。
`rows.join('') === 原文` 这条断言钉死"不丢字"。

**最基本的字幕没动**：淡入淡出、停留、底衬、字幕带位置、`karaoke` 开关全部照旧；
只是断行换了。验证：`still _portrait-lab` 重渲后字幕带 `YMAX=226`（文字仍亮）、
平均亮度高于背景 —— 字幕还在，只是断得更像字幕。

⚠ 已知影响：**已有的片子重渲时字幕会重新折行**（`spectrum` 等）。
这是有意的改进；若某支片子存过 `hashes` 基线，需要 `--accept --note "字幕断行升级"`。
---

## 11. 追加（2026-10-26 下午）：1-48 第一批 —— 模板 11 → 15

**做了什么**：四个新镜头模板 + 夹具 + 文档同步。都不动引擎（`src/core/` 一个字没改），
所以老片子的画面不可能变（`git diff --stat` 只有 `src/shots/` 的新文件与注册行）。

| 模板 | 画面 | 关键手法（与老模板的分工） |
|---|---|---|
| `bigtype` | 两三行 hero 级大字逐行上浮，一处关键词换信号色，左侧引导线 + 下划线 + 底部长线上一个游标 | **高亮词是切段画的**：先在整行里找子串，切成 前/中/后 三段按 `type.measure` 推进 x，逐字延迟用 `t - 段首字数×stagger` 续上。叠色重画会在动画途中把信号色与骨白混成脏色（试过） |
| `scan` | 扫描线从左走到右，走过的格子按 `hash2(i,j)` 的确定性读数填块，当前列偏信号色，右上跟「已扫 %」 | 与 `grid` 的分工写进两个文件的 meta：**grid 的亮度来自音频包络（要 music + analyze），scan 不读音频** —— 后者哪里都能用 |
| `device` | 窗口四条边依次展开 + 标题栏（三点 + 一行等宽小字）+ 一句标题 + 逐行填出来的内容骨架 + 闪烁光标 + 标题栏下一条加载条 | 骨架行用**不透明调色**（见 §11.2）；光标闪烁走 `cycle(t)`（确定性） |
| `lineart` | 一条折线按**弧长**画出来（幽灵线先铺全貌），走过的节点留圆点/刻度，笔尖带当前节点的名字 | `polylineLengths` + `pointAtLength`：按点数画会让长段快、短段慢 |

**夹具**：`tasks/_shots2-lab/`（只有 `task.config.mjs`）—— 4 段默认画面 + 4 段非默认分支
（`bigtype-mark` 高亮在第一行 / `scan-dense` 40×6 / `device-1row` 单行 + 空 chrome / `lineart-few` 三节点两标签）。

### 11.1 验收读数

```
node tools/test-shots.mjs            ✓ 153 项（TEMPLATES 手写表 11 → 15、spec/params/defaults 逐项一致）
node scripts/anim.mjs check _shots2-lab
  ✓ 没有发现问题（另有 3 项没跑：无交叠段 / 未声明 focus / 没有 motion.json 断言）
  版面守门：8/8 段采到文字 · 最挤的一帧 4 块（上限 6；主体之外 ≤ 2）
  节点：bigtype 3 块 / scan 2 块 / device 4 块 / lineart 3 块
node scripts/anim.mjs still _shots2-lab -t 3,9,15,21,27,33,39,45   # 8 张全看过了
```

出图后改掉的三处（都是"看着不对"才动手的，不是猜的）：
① `scan` 的格子最初是**一屏灰砖** —— 见下面那条坑；
② `device` 原来画了一条扫过窗口的红线，读起来像故障 ⇒ 换成标题栏下面一条"加载条"；
③ `lineart` 的笔尖太小、幽灵线太淡 ⇒ 线宽 ×1.4、节点 4.5 → 5.5、幽灵线 0.28 → 0.40。

### 11.2 一个**会重复犯**的坑：`lines.fillRect` 的柔边会互相叠加

`fillRect(x,y,w,h,[r,g,b,a])` 是"沿 y 铺一串胶囊"（`gl.js:1302`），宽 = 步进 + 0.5 的余量；
相邻两条的**抗锯齿柔边重叠**，而 LineBatch 的混合是 `ONE / ONE_MINUS_SRC_ALPHA` 的预乘 ——
于是半透明填充会**比写的 alpha 亮得多，而且出现横向条纹**（实测 a=0.1 就已经是中灰）。
`scan` 的格子与 `device` 的骨架行都栽在这上面，最后都改成**不透明 + 在颜色里调亮度**
（`mixColor(P.ink2, P.bone, 0.02 + 0.10*v)`）：没有叠加、没有条纹、亮度可控。

> 判据：**画"暗底上的暗块"时不要用 alpha 调暗度**，用 `mixColor` 调颜色。
> alpha 留给"真的要让后面的东西透出来"的场合（扫描线辉光、光晕）。

### 11.3 文档同步（"11 个模板"这一族）

模板数是**会过期的散文**，但读者会拿它当事实，所以这一轮把它一起改了：
`AGENTS.md`（§2.2 名字表 / §3.2「模板只有这 N 个」/ §9 表格）、`README.md`、
`docs/ENGINE.md`（§14.1 查询行、**§14.2 表新增 4 行**、§14.4、§14.5、§14.9）、
`docs/CONFIG-ONLY.md`（§0 / §1 / §3 / §4 标题与表格 / §9 排错）、`docs/DIAGNOSIS.md`。
守门全绿：`lint-agents-size`（58201 / 65536 B）、`lint-agents-refs`（200 处引用全部可解析）、
`lint-doc-facts`（15/15 键）。

### 11.4 下一会话从这里接

1. **1-48 第二批**：`chart-morph` / `paper-layer` / `lockup`（见 BACKLOG 1-48 的"剩下"）。同一套流程，一个模板约「写 150 行 + 一段夹具 + 4 张图」。
2. **`1-50` infoShot**（段落骨架）仍是主线第三条；它的前置正是"模板够不够用" —— 第二批做完再动它更省事。
3. `_shots2-lab` **没有进 `regress-all`**（和 `_shots-lab` 一样：一支 48 帧的夹具会让整份回归多 3–4 分钟）。要进就挂 `check:_shots2-lab --quick`。
---

## 12. 追加（2026-10-26 下午）：1-48 第二批 —— 模板 15 → 18

| 模板 | 画面 | 这一支解决的"手写要重算"的东西 |
|---|---|---|
| `morph` | 同一组数：柱子立起来 → **缩回基线、只留顶端刻度** → 刻度连成折线 → 折线下铺排线面积 | 三相位共用同一套 x 坐标 —— 形变时观众的眼睛不用重新找位置；面积排线**跟随折线画到的地方**长出来 |
| `layers` | 带透视的梯形纸页从后往前往上落位（实心 + 横线 + 左侧信号色标记），最前面那张写标题 | `fillTrap()` 梯形逐行铺（线段批没有 z-test，叠放顺序 = 绘制顺序 = 画家算法） |
| `lockup` | 环 / 菱形 / 方块标记画出来 + 字标 + 副标 + 从中间展开的分隔线 + 署名行，**停住不压黑** | 与 `outro`（片尾动作）分工写进两份 meta；`mark` 写错**在工厂里就抛** |

**夹具**：`tasks/_shots3-lab/`（6 段：morph / layers / lockup 默认 + `morph-flat` 两点 / `layers-6` 六层 + 空眉标 / `lockup-diamond` 菱形 + 空 meta）。

### 12.1 验收读数

```
node tools/test-shots.mjs                 ✓ 171 项（TEMPLATES 15 → 18）
node scripts/anim.mjs check _shots3-lab   ✓ 没有发现问题（6 段 36 帧 × 三条采样 × 双路径，189s）
node scripts/anim.mjs check _shots2-lab --quick / _shots3-lab --quick   ✓ 各 0 红
node scripts/anim.mjs still _shots3-lab -t 3,5.5,9,15,21,27,33         # 逐张看过
```

### 12.2 出图后改掉的四处（都是"看着不对"）

1. **面积排线**原来铺满整幅、而且是信号橙色 ⇒ 像斑马、比折线还抢眼。改成：只铺到折线已画到的地方（`pointAtLength`）、笔尖前 80px 淡出、颜色换成**中性灰**（信号色只留给线本身）。
2. **`layers` 的横线**原来铺满整页、和标题叠在一起 ⇒ 改成只铺标题下面那半页（k = 0.55 / 0.65 / 0.75）。
3. **`lockup` 的环**原来留了 6% 的缺口（想做"手画感"）⇒ 读起来像没画完，改成画满。
4. **暖色底噪**：`bigtype` 左下角实测 RGB **(39,15,14)**（旧模板 demo 是 22,21,21）—— 是 shader 里那团"信号色微光"给的，不是 bloom。降到 0.012 并把半径收紧到 3.2 之后回到中性。**量法**：`ffmpeg -vf "crop=240:160:60:820,scale=1:1" -f rawvideo -pix_fmt rgb24 -` 直接读一个区域的平均 RGB —— 比"看着有点红"可靠。

### 12.3 一个操作教训：完整的 `check` 会超过 10 分钟

`_shots2-lab` 8 段 × 3 点 × 2 路径 = 48 帧，静态画面会吃到 216 子帧，实测 **150–210s**；系统有别的负载时这次直接撞了 540s 的调用上限（输出全丢）。
**做法**：迭代期用 `check <任务> --quick`（每段 1 点 × 单子帧，6–8 秒），交付前再跑一次完整的；长跑用后台 job（`pwsh run_in_background` + `job_output`），别再盯着前台超时。

### 12.4 下一会话

1. **还差 2 个到 20+**：候选 `timeline`（横向事件轴）与 `radial`（径向分布）。1-48 现在是 18/20+。
2. 然后回主线 **1-50 infoShot**（段落骨架：标题 + 旁白 cue + 图形区 + 标注 + 出处行）。
3. `_shots3-lab` 同样没进 `regress-all`（理由同 §11.4）。
---

## 13. 追加（2026-10-26 下午）：1-48 收尾批 —— 模板 18 → 20，1-48 关闭

| 模板 | 画面 | 关键手法 |
|---|---|---|
| `timeline` | 横向事件轴：轴从左画到右，笔尖路过的事件节点依次弹出（outBack），事件名**上下交替**淡入 | 与 `lineart` 的分工写进 meta：lineart 画**路径形状**（y 拐弯），timeline 画**顺序**（直轴+名字）。节点在笔尖 ±40px 内弹出，标签随后淡入 |
| `radial` | 径向分布：中心呼吸核 + 一圈轮辐（节点/名字/沿辐条读数条）+ 外圈慢转的缺口环 | 名字在**外环背向圆心**排，读数条沿辐条方向 —— 文字与图形各占一环不互压；缺口环 = 直接**跳过绘制**那一段（不画透明线，省批次） |

**夹具**：`tasks/_shots4-lab/`（4 段：两个默认 + 7 事件边界 + 单节点边界）。**这批夹具声明了 focus**（radial 用 {cx,cy,w,h}，timeline 用 center）—— 不声明时守门直接 skipped，那才是"没判"。

### 13.1 验收

```
node tools/test-shots.mjs               183 项（TEMPLATES 18 → 20；typeOk 补 string[] 档）
node scripts/anim.mjs check _shots4-lab  没有发现问题（24 帧 × 3 点 × 双路径，85.5s）
  版面守门：主体区 2 块（上限 2）· 5 块（上限 6）—— 全绿（上一版"主体之外 3 块"的告警靠 focus 声明收掉）
外圈参考环实测：R=389 处亮度 0.34（邻带 0.10）—— 修完后环清晰可见
```

### 13.2 出图后改掉的两处

1. **radial 的外圈参考环画了但看不见**：graphite×0.55 在墨底上量出来 0.0958，与邻带（0.0996）无法区分 —— "画了"和"看得见"是两回事。改成 bone×0.35 后 R=389 处 0.34 vs 邻带 0.10。量法：按角度采样圆周的 ringAvg（out/_probe_radial.mjs，注意 R 要先算：min(W*0.30, H*0.36) = 389，第一版拿 324 去量了个寂寞）。
2. **缺口环的画法**：原来缺口段画 [0,0,0,0] 的透明线（白白占批次），改成 continue 跳过 —— 少 17 条线段，效果一样。

### 13.3 本轮踩到的坑（新会话会再踩）

- **模型不吃图时**（read_image 报 model does not declare image input）：改用 tools/png-rows.mjs（列亮度区间）+ 临时采样脚本（区域平均色）验证"线在不在、亮不亮"。比目视可复现，数字能进交接单。
- **bash IPC 坏了**（could not create signal pipe, Win32 error 5）：这台机器 ops_bash 全挂，改用 pwsh 工具跑命令。
- **字符串拼接漏加号**：notes 长文案多行相邻字符串漏 + 号 → Unexpected string。Node 只报"模块加载失败"，要用 import().catch 逐个文件定位。timeline.js 与 radial.js 各犯过一次。
- **typeOk 不认 string[]**：test-shots.mjs 的 spec 校验原来只有 number[]，events/nodes 挂掉。补一档：非空、每项字符串。

### 13.4 1-48 关闭后的状态

- **镜头库 20 个**：title chart kinetic whip outro wave pulse grid quote counter compare bigtype scan device lineart morph layers lockup timeline radial
- 四个夹具（_shots2-lab / _shots3-lab / _shots4-lab / 老 _shots-lab）都没进 regress-all（48 帧的夹具会让整份回归多几分钟）；要进就挂 check:名字 --quick。
- **下一会话**：主线剩 1-50 infoShot（段落骨架，判据"新片子手写行数占比 < 30%"）与 1-53（B 站封面 + 章节时间码）。1-50 的前置"模板够不够用"已由 1-48 关闭。
---

## 14. 追加（2026-10-26 傍晚）：1-50 infoShot —— 信息段骨架 + 一个真分叉的修复

做了两件事：`src/kit/info.js` 落地 + `timeline.js` 的 focus 搬运补回落。后者是**引擎级修复**，与骨架无关但被它暴露。

### 14.1 infoShot 的形态

```js
import { infoShot } from '../../../src/kit/index.js';
export default infoShot('频谱-概览', {
  title: '把信号拆开', kicker: 'SPECTRUM / 02',
  caption: '8×8 DCT · 基底图案', source: 'JPEG · Annex A', foot: '02 / 06',
  draw(ctx, rect, k) { /* 只画这段的图；rect=图形区，k=错峰后的入场进度 */ },
});
```

骨架包掉五件套（眉标 / 标题 / panelBox 面板底 / captionNote 侧标注+出处 / 页脚）+ 四段错峰（0.18s 间隔）+ post 三层合并（骨架默认 < 段 post < draw 返回值）。**draw 抛错不冒泡**：进 `ctx.warnings`（check 会打印），画面继续出。

### 14.2 顺带修的真分叉（值得记住的形状）

`timeline.js` 的 build 只搬 `cut()` 的 focus（`focus: c.focus`），**不回落** `scene.focus`；
引擎渲染倒是合并（`item.focus ?? scene.focus`）—— 于是「渲染知道主体、审计说没声明」两条路径分叉。
老任务全在 cut 上写 focus 或根本不声明，所以从未暴露；infoShot 在**场景对象**上声明 focus，第一批就撞上。
修法一行：`focus: c.focus ?? c.scene?.focus ?? null`。

### 14.3 验收

```
node tools/test-info.mjs           11 项（挂 regress-all 的 unit:info）
node scripts/anim.mjs check _info-lab   没有发现问题（18 帧 × 3 点 × 双路径，6.3s）
  demo/chartish：主体区 0 块字（主体是图形，3 次非文字绘制）—— focus 生效
  bare：主体未声明 = 刻意的 noFocus 豁免路径，预期读数
png-rows + 区域亮度实测：柱带 0.2411 vs 面板底 0.0777（柱浮在面板上）；
  面板 0.0848 vs 网格背景 0.1513（tone 压暗，「信息要安静」）；bare 无 >0.5 像素（空字段不画）
```

**判据（1-50 的原始目标）**：夹具三个信息段共 69 行，每个 draw 平均 ~15 行；
对照 promo 1529 / spectrum 767 / pdoom-lab 1187 行每支 —— **信息段这一类的手写占比 <30% 成立**。
（整支片子的占比取决于信息段在片中的比例；这是骨架的上限，不是终点。）

### 14.4 已知边界（诚实登记）

- `rect` 几何按横屏 1080p 标定（panelK 0.62）；竖屏任务传 `noFocus: true` 并在段上自己声明 focus。
- focus 的近似矩形是**静态声明**（渲染前引擎就要读）—— 自定义版面的任务同样用 `noFocus` 绕过。
- infoShot 未接旁白 cue（`dur: { vo }` 的配合）—— 跟 1-23（variants + narration 显式指定）一起做更顺。
- `captionNote` 画横线不走 begin/flush 周期：骨架在它后面补了一次 `lines.flush`（offset 0 时无害）。

### 14.5 下一会话

主线剩 **1-53（B 站封面 + 章节时间码）** 与 **1-23（variants + narration.json 显式指定）**；
1-49 母题库的剩余部分（sodium 积木等）仍卡在「任务目录不在本 checkout」。

---

## 15. 追加（2026-10-26 晚）：1-53 封面与章节 —— 主线最后一条工具面

两条命令，都进了 anim help（help 直接打印文件头 JSDoc，改头部就自动跟上）：

    node scripts/anim.mjs cover <任务> -t 12 --title "把信号拆开" --sub "SPECTRUM · 72s"
    node scripts/anim.mjs chapters <任务> [--min 4] [--json]

### 15.1 封面为什么在页面里压字

__anim.cover(t, {title, sub}) 先渲染那一帧，再在 Canvas2D 上画：底部渐变蒙版（0.42→1.0 高度，scrim 默认 0.82）
→ 主标题（96px，超宽自动缩到画宽 78%）→ 信号色短线 → 副标（26px 等宽）。

不用 ffmpeg drawtext 的理由：字体已经由 TextKit 加载（Noto Sans SC / Archivo / Plex Mono），
drawtext 要自己拼 fontfile 路径与转义，且中文字形与引擎里不是同一套 —— 封面和成片会像两家做的。
--scale 2 时文件名带 @2x（cover_2.50@2x.png），不覆盖 1080p 那张。

### 15.2 章节的三条规则（纯函数，可离线断言）

planChapters(segs, minDur)：
① 首段无论多短都是 00:00（YouTube 第一个时间戳非 00:00 时整组章节不生效）；
② 短于 minDur 的段不单独成章、时长并进上一章（3 秒的过场不该占一行）；
③ 起点取段自己的 start（不是累加），所以转场重叠时章节时刻仍然对。

输出 mm:ss 段名 + out/<任务>/chapters.txt；--json 给机器（要用 flag，不能用 opt —— opt 取的是值）。

### 15.3 验收

    node tools/test-cover-chapters.mjs   18 项（挂 regress-all 的 unit:cover）
    node scripts/anim.mjs cover _info-lab -t 2.5 --title "把信号拆开" --sub "SPECTRUM · 72s"
      → out/_info-lab/cover_2.50.png  1920×1080
      亮度实测：标题带 17.9% >0.5、副标带 17.5% >0.25（信号色亮度 0.43，所以 0.5 阈值量不到 —— 不是没画）
    node scripts/anim.mjs cover _info-lab -t 2.5 --title "4K 封面" --scale 2
      → cover_2.50@2x.png  3840×2160（ffprobe 实测）
    node scripts/anim.mjs chapters _info-lab → 00:00 demo / 00:06 chartish / 00:12 bare

### 15.4 这一轮踩到的两处（都很小，但都会静默出错）

1. 用 opt 读 --json 取得的是值不是开关 —— 写成 if (opt(...)) 永远为假，--json 静默无效。开关一律用 flag。
2. 4K 与 1080p 默认同名会互相覆盖 —— 第一次 --scale 2 直接把 1080p 那张覆盖成了 3840×2160（ffprobe 量出来的）。
   现在文件名带 @2x；--out 显式给了就照给的写。

### 15.5 主线状态

1-48（模板 20 个）、1-50（infoShot）、1-53（封面/章节）都已关闭。
接下来是 **1-23（variants + narration.json 显式指定）**：它同时解掉 infoShot 还没接旁白 cue 的问题。
1-49 母题库剩下的部分仍卡在「sodium / bikeshed 等任务目录不在本 checkout」。
