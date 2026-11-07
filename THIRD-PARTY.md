# 第三方内容与许可声明

本仓库的**引擎代码**（`src/`、`scripts/`、`tools/` 及仓库根下的配置文件）以 **MIT** 许可发布，
全文见仓库根的 [`LICENSE`](./LICENSE)。

本文件列出仓库里**随附的第三方内容**（目前只有字体）及其许可，以及那些**容易被误会成第三方素材、
但其实是本仓库自己生成的东西**。目标是：任何人 clone 下来，都能自己确认「哪些东西是谁的、按什么条件用」。

> 一句话结论：**除字体外，仓库里没有第三方素材、没有第三方运行时依赖的代码副本。**
> 唯一的第三方**代码/文档**是一个 MIT 许可的 skill 目录（`skills/motion-design/`，见 §2.1），
> 已随目录带上 `LICENSE` 与 `NOTICE.md`。没有第三方图片、没有第三方音乐、没有第三方视频、
> 没有第三方 3D 模型，也没有随仓库分发的浏览器。

---

## 1. 字体

仓库自带 **10 个 `.woff2` 文件**，全部为 **SIL Open Font License 1.1（OFL-1.1）**，
许可证全文见 [`LICENSES/OFL-1.1.txt`](./LICENSES/OFL-1.1.txt)。

下列「字体名 / 版本 / 版权行」不是从文件名猜的，而是**从每个 `.woff2` 的 `name` 表里逐条读出来的**
（即字体自述的元数据 `nameID 1/2/4/5/6/13/14`）。每个文件都能读出 `nameID 14`（许可证 URL）
指向 SIL 的 OFL 地址：

| 文件 | 字体名（nameID 4） | 版本（nameID 5） | 版权行（nameID 0） | 许可证 URL（nameID 14） | 许可 |
|---|---|---|---|---|---|
| `public/fonts/Manrope-600.woff2` | Manrope ExtraLight SemiBold（Typographic Family: Manrope） | `Version 4.504` | `Copyright 2019 The Manrope Project Authors (https://github.com/sharanda/manrope)` | `http://scripts.sil.org/OFL` | OFL-1.1 |
| `public/fonts/Archivo-var.woff2` | Archivo SemiBold（可变字重 `wght` 100–900） | `Version 2.001` | `Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo)` | `http://scripts.sil.org/OFL` | OFL-1.1 |
| `public/fonts/IBMPlexMono-Regular.woff2` | IBM Plex Mono Regular | `Version 2.3` | `Copyright 2017 IBM Corp. All rights reserved.` | `http://scripts.sil.org/OFL` | OFL-1.1 |
| `public/fonts/IBMPlexMono-SemiBold.woff2` | IBM Plex Mono SemiBold | `Version 2.3` | `Copyright 2017 IBM Corp. All rights reserved.` | `http://scripts.sil.org/OFL` | OFL-1.1 |
| `public/fonts/CormorantGaramond-var.woff2` | Cormorant Garamond Light（可变字重 `wght` 300–700） | `Version 4.001` | `Copyright 2015 The Cormorant Project Authors (github.com/CatharsisFonts/Cormorant)` | `https://openfontlicense.org` | OFL-1.1 |
| `tasks/_calib/fonts/BrandFont.woff2` | 同 Manrope（**改名副本**，见下方⚠） | `Version 4.504` | 同上 | `http://scripts.sil.org/OFL` | OFL-1.1 |
| `tasks/promo/fonts/inter-latin-400.woff2` | Inter Regular | `Version 4.001;git-66647c0bb` | `Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)` | `https://openfontlicense.org` | OFL-1.1 |
| `tasks/promo/fonts/inter-latin-600.woff2` | Inter SemiBold | `Version 4.001;git-66647c0bb` | `Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)` | `https://openfontlicense.org` | OFL-1.1 |
| `tasks/promo/fonts/inter-latin-800.woff2` | Inter ExtraBold | `Version 4.001;git-66647c0bb` | `Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)` | `https://openfontlicense.org` | OFL-1.1 |
| `tasks/promo/fonts/ibm-plex-mono-latin-400.woff2` | IBM Plex Mono Regular | `Version 2.3` | `Copyright 2017 IBM Corp. All rights reserved.` | `http://scripts.sil.org/OFL` | OFL-1.1 |
| `tasks/promo/fonts/ibm-plex-mono-latin-600.woff2` | IBM Plex Mono SemiBold | `Version 2.3` | `Copyright 2017 IBM Corp. All rights reserved.` | `http://scripts.sil.org/OFL` | OFL-1.1 |
| `tasks/promo/fonts/noto-sans-sc-subset.woff2` | Noto Sans SC Thin（可变字体，`wght` 轴 100–900） | `Version 2.004-H2;hotconv 1.0.118;makeotfexe 2.5.65603` | `(c) 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.` | `http://scripts.sil.org/OFL` | OFL-1.1 |

补充说明：

- **`tasks/promo/fonts/` 这 6 个文件是子集化的 woff2**（latin 子集 / 中文按码位裁切），
  上游版本与取用方式写在 [`tasks/promo/fonts/brand.css`](./tasks/promo/fonts/brand.css) 顶部的注释里
  （`@fontsource/inter@5.3.0`、`@fontsource/ibm-plex-mono@5.3.0`、Google Fonts CSS2 API 的 `text=` 子集）。
  **子集化只裁剪码位、没有修改字形**，因此按 OFL-1.1 属于再分发「原始版本」的组成部分，
  不构成需要改名的「Modified Version」（详见下一条）。
- ⚠ **`tasks/_calib/fonts/BrandFont.woff2` 就是改名的 Manrope**，不是另一个字体：
  它与 `public/fonts/Manrope-600.woff2` 的 **SHA256 完全相同**
  （`F7AC6258DA20AB7541939B59851155753D1D24F1B30CBCB949077A3FAA3D1593`，两者均 14 172 字节）。
  它只是把文件改了个名字用作标定夹具，**字体内部的自述信息一个字都没动**（`name` 表仍写着 Manrope）。
  按 OFL-1.1 的措辞，文件名不是「面向用户呈现的主字体名」，所以这不涉及 Reserved Font Name。
- **`public/fonts/` 下那三个 `Archivo` / `IBM Plex Mono` / `Cormorant Garamond` 文件是 2026-10-24 补进仓库的。**
  在那之前 `public/fonts/fonts.css` **声明了这三条 `@font-face`、但文件并不存在** ——
  浏览器会静默忽略这种规则，于是全引擎的拉丁字回退到微软雅黑、等宽回退到 Consolas，
  「换风格连字体一起换」这条支柱实际不生效（`docs/history/IMPROVEMENTS-4-5.md` §1.3 的审计结论）。
  现在它们是真的文件了，来源与字节数见下表；中文字体仍然走系统字体（这是**刻意的选择**，不是缺失，
  见 `src/style/index.js` 的 SONG / KAI / ENG 与 `tools/test-style.mjs` 的字体断言）。

  | 新增文件 | 字节 | 来源 |
  |---|---|---|
  | `Archivo-var.woff2` | 34 928 | `@fontsource-variable/archivo`（latin 子集，可变字重） |
  | `IBMPlexMono-Regular.woff2` | 14 708 | `@fontsource/ibm-plex-mono@5.3.0`（latin 子集） |
  | `IBMPlexMono-SemiBold.woff2` | 15 620 | `@fontsource/ibm-plex-mono@5.3.0`（latin 子集） |
  | `CormorantGaramond-var.woff2` | 37 640 | `@fontsource-variable/cormorant-garamond`（latin 子集，可变字重） |

  四者均为 **OFL-1.1、未修改字形**（只做了码位子集化，与下面 `tasks/promo/fonts/` 那 6 个同例）。

### 1.1 OFL-1.1 对本仓库的实际要求

OFL-1.1 允许**商用、嵌入、修改、再分发**，包括随软件一起打包分发。与本仓库做法相关的义务只有两条：

1. **保留版权声明与许可证** —— 再分发这些字体（无论原样还是修改过）时，必须一并带上字体的版权行
   与本许可证全文。本仓库的做法就是本文件（版权行）＋ `LICENSES/OFL-1.1.txt`（全文）。
2. **不得单独出售字体本身** —— 可以把字体随本引擎一起分发，但不能把字体文件单独拿去卖。

另外两条**本仓库没有触发**，但使用者改字体时要注意：

3. **派生字体不得使用 Reserved Font Name** —— 只有在**你修改了字形**并对外发布衍生字体时才适用
   （四条字体里只有 Noto Sans SC 声明了保留字体名 `'Source'`）。本仓库只做码位子集化、未改字形，
   也未在任何地方使用该保留名。
4. 不得用字体版权方的名义为衍生版本做推广背书。

> 以上只是与本仓库做法相关的摘要，**不构成对许可证的替代**；具约束力的是
> [`LICENSES/OFL-1.1.txt`](./LICENSES/OFL-1.1.txt) 的全文。

---

## 2. 运行时依赖

`package.json` 的直接依赖共 4 个（版本取自 `package-lock.json`，锁定版本与下表一致）：

| 包 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| [`three`](https://www.npmjs.com/package/three) | 0.186.1 | MIT | 3D 第 ③ 种：真网格渲染（`src/core/three-bridge.js` 与 `makeThreeShot`）——真深度、真遮挡、实例化、材质光照 |
| [`vite`](https://www.npmjs.com/package/vite) | 5.4.21 | MIT | 开发服务器与打包（CLI 渲染时会自己起一个**私有**的 Vite 服务） |
| [`ws`](https://www.npmjs.com/package/ws) | 8.22.0 | MIT | CLI 与无头 Chrome 之间的 WebSocket 通道（推帧、收协议消息） |
| [`playwright-core`](https://www.npmjs.com/package/playwright-core) | 1.63.0 | **Apache-2.0** | 驱动**用户自己安装的 Chrome**（`channel: 'chrome'`）逐帧截帧 |

关于 `playwright-core`：

- 它是 **Apache-2.0**（不是 MIT）。Apache-2.0 允许商用与再分发，要求保留版权与许可声明、
  并附带其 `NOTICE`（如有）。它的完整许可证文本随 npm 包一起分发在
  `node_modules/playwright-core/` 内，安装依赖即可获得。
- 本仓库**不随包分发浏览器**。`playwright-core` 这个包本身刻意不含浏览器二进制
  （这正是它区别于 `playwright` 的地方）；引擎通过 `channel: 'chrome'` 使用
  **用户本机已安装的 Chrome**，因此不存在「把 Chromium 打包进仓库」的再分发问题。
- 同理，**ffmpeg / ffprobe 也不随仓库分发**，需要用户自行安装并在 `PATH` 里
  （或用 `ANIM_FFMPEG` / `ANIM_FFPROBE` 指定）。

**传递依赖**：`package-lock.json` 共 **61 个**受管条目，全部带有 `license` 字段，
许可证分布为 **MIT 58 个 · Apache-2.0 1 个 · ISC 1 个 · BSD-3-Clause 1 个**，
**没有任何** GPL / AGPL / LGPL / SSPL / CC-BY-NC / BUSL 等限制性更强的许可证。
（条目数、版本与许可证字段均可由 `package-lock.json` 直接复核。）

---

## 2.1 随附的第三方 skill（`skills/motion-design/`）

**这是仓库里唯一的第三方**文档/方法论**内容**（不是代码、不是素材）。**

| 目录 | 内容 | 上游 | 许可 |
|---|---|---|---|
| `skills/motion-design/` | 17 个 markdown（`SKILL.md` + `director/` + `patterns/` + `reference/`），约 1.5k 行 | [LottieFiles/motion-design-skill](https://github.com/LottieFiles/motion-design-skill) v1.0.0 | **MIT** |

- 逐字节照抄上游、未做本地修改；许可全文在 `skills/motion-design/LICENSE`，
  出处与 vendor 日期在 `skills/motion-design/NOTICE.md`。
- 它**只作为提问清单**被引用（`docs/REFERENCE-motion-design-skill.md`），
  引擎侧的落点是 `src/kit/motion-persona.js` 与三条判据 —— 数值**换算并放宽过**，不是照抄。
- 与 `AGENTS.md` 冲突时以 `AGENTS.md` 为准（它只是方法论参考，不是引擎契约）。
- 它**不含任何代码**，因此不影响 §2 的依赖口径，也不改变「仓库没有第三方素材」这条结论。

---

## 3. 音频与图像素材

**仓库里出现的音频与图像，全部由本仓库内的代码生成，没有一个是外部素材。**

| 内容 | 怎么来的 | 生成脚本 |
|---|---|---|
| 音乐 / 节奏床（`tasks/*/audio/*.mp3`） | 纯合成：正弦 + 噪声 + 包络，用**确定性随机**（xorshift32 一类），同一个 seed 每次跑出**逐字节相同**的 wav | [`scripts/make-demo-audio.mjs`](./scripts/make-demo-audio.mjs)（`demo` / `beat` 的测试音乐）、[`scripts/make-promo-audio.mjs`](./scripts/make-promo-audio.mjs)（`promo/audio/bed.*`）。仓库里每个被收录音轨的**同目录下都留着生成它的脚本**，可自行核对 |
| 画面（`docs/images/*.webp`） | **引擎自己渲出来的帧**（`anim still` 的产物），不是截图、不是图库素材 | `scripts/anim.mjs` + `src/` 里的着色器与几何 |
| 旁白语音（`tasks/*/audio/vo/`） | `anim say` 经 Edge TTS 合成 | `scripts/lib/say.mjs`（驱动见 `tools/tts-edge.py`） |

关于旁白：旁白是**按任务在本地合成**的产物。公开发布时，相关任务的语音轨**留在作者本地、不进仓库**，
仓库里只保留生成它们的脚本与文本。因此**仓库不包含任何第三方语音素材**。

**仓库不包含任何第三方图片、音乐、视频素材。** 具体地说：

- **没有位图素材** —— 仓库里被版本管理收录的图像文件只有 `docs/images/` 下那 **4 张 `.webp`**，
  而它们是引擎渲染输出；除此之外**没有任何** png / jpg / svg / mp4 / glb / gif 被收录。
- **没有第三方音乐**，没有音效库，没有采样包。
- **没有第三方 logo**，没有产品截图，没有游戏截图。

---

## 4. 示例片子里出现的第三方名称

- `tasks/promo` 是**本引擎自己的宣传片**，画面完全由引擎生成。
- 仓库里的示例**不包含** Minecraft、OptiFine、Sodium 等第三方项目的**素材**
  （纹理、截图、模型、音效一概没有）。那几支涉及第三方项目的片子**留在作者本地、不进仓库**，
  仓库里最多只留下它们的任务脚本与文本。
- 如果某支示例的文字里出现了第三方项目的**名称**，那是**名指性使用**（nominative use）：
  仅用于指称该对象本身，**不代表任何隶属、赞助或背书关系**，相关名称与商标归各自所有者所有。

---

## 5. 报告许可问题

如果你发现本文件有遗漏、错标，或者仓库里混进了不该出现的第三方内容，
**请开一个 issue 说明文件路径与你的判断依据**，我们会核实并修正。
