# Remotion 生产验收矩阵

> **状态：阶段验收完成，暂不签署最终生产验收。** 验收日期：2026-11-28。
> 本轮已完成 **R1（`example-config-only` 11.40–12.32s 排查处置）/ R3（本机环境记录与全仓 CI 回归）/ R4（Three.js `_three-lab` 登记与全链路实测）/ M2 工程链路实测与 R5 跨环境对照包建包自检**；**全程未触发正式成片全渲染**。
> 因 **R2 真实音画（`nekohome-intro-ja`、`paperfold`）仍阻塞** 且 **R5 跨驱动对照仍待第二环境回传**，本轮不签署最终生产验收。

## 1. 状态口径

| 状态 | 使用条件 |
|---|---|
| **已验证** | 仅当本轮有可复跑命令、退出码、环境/版本、产物与检查结果时使用。代码存在、旧日志或口头未附证据的结果都不算。 |
| **待本轮验证** | 已列入本轮矩阵，尚待执行或补足证据；可附数据/环境阻塞说明。 |
| **阻塞** | 如 **阻塞（素材缺失）**：前置生产素材或外部依赖缺失导致无法执行真实验证；不得以静音渲染或合成音频夹具替代真实结论。 |
| **待第二环境回传** | 基准机（Machine A）已完成打包与本机自检，等待独立第二环境（Machine B）运行对照包并回传报告。 |
| **未验证** | 当前没有可用验收入口或证据，不能把它算成通过。 |
| **不适用** | 该场景在设计上不涉及该项；需写明理由，不等于跳过一项必要验收。 |

只有本表更新并附证据后才可变更状态。整片、渲染确定性、音画与交付事务是不同验收项，不能用离线单测、一张静帧或 `--noaudio` 无声草稿互相代替。

## 2. 注册任务与场景覆盖

当前注册清单来源：`packages/remotion/registry.json` + `packages/remotion/bridges.generated.tsx`（schema `remotion.registry/1`，共 **5 个任务**）。注册记录只说明有可选的 Remotion Composition，不等于生产验证通过。

| 场景 | 注册/入口 | 本轮覆盖目标 | 当前状态与限制 |
|---|---|---|---|
| 原生配置 | `example-config-only` / `ExampleConfigOnly`，`kind=native`，`eval=config-only`，`audio=false`，固定 `samples=1` | 完整草稿、乱序跳帧、硬切点、分块续渲、成片复核与 R1 `outro` 处置 | **已验证（工程草稿 & R1 处置完成）**。音轨同步 **不适用**；多子帧 **不适用**（注册配置明确限制 `samples=1`）。草稿不代替正式成片视觉终审。 |
| 含旁白真实桥接 | `nekohome-intro-ja` / `Task-nekohome-intro-ja`，`kind=bridge`，`eval=task-eval`，`audio=true`，`samples=auto` | 真实引擎桥、字幕与旁白时间点、首/中/尾音画、跨切点片段、单/多子帧 | **阻塞（素材缺失）**。`tasks/nekohome-intro-ja/audio/` 仅见 `bed.mp3`、`bed.analysis.json`、`ja.narration.json`、`ja-sub-zh.narration.json`、`ja.timing.json`、`ja.timing.mjs`，仍缺配置引用的 `ja-vo.mp3`、`ja-mix.mp3`。未以静音渲染或合成音频夹具替代真实音画结论。 |
| 复杂 WebGL / 交叠 | `paperfold` / `PaperfoldBridgeMB`，`kind=custom-bridge`，`eval=task-eval`，`audio=true`，`samples=auto` | 复杂旧引擎画面桥、乱序重渲、1/4/auto 子帧、交叠窗、跨切点分块与真实音画 | **无声画面已验证（`--noaudio`，0 音轨）；真实音画阻塞（素材缺失）**。`--noaudio` 整片草稿、`1920x1080` 交叠片段及 `1/4/auto` 子帧均已实测通过；`tasks/paperfold/audio/` 仅见 `bed.mp3`、`bed.analysis.json`、`narration.json`、`timing.json`、`timing.mjs`，仍缺 `paperfold-vo.mp3`、`paperfold-mix.mp3`，真实音画保持 **阻塞（素材缺失）**。 |
| Three.js | `_three-lab` / `Task-three-lab`，`kind=bridge`，`eval=task-eval`，`audio=false`，`samples=auto`（`_three-calib` 仍为未登记旧夹具） | Remotion 中实际 Three.js 网格/实例网格镜头、多子帧、乱序跳帧与整片草稿 | **已验证（R4 已登记并实测通过）**。`node tools/gen-remotion-registry.mjs --add _three-lab` 写入 `Task-three-lab`（`1920x1080`, `60fps`, `876f`/`14.6s`）；`check`、`1/4/auto` 静帧、乱序同帧 SHA-256、草稿 MP4 及 `samples=4` 1080p 片段均已实测通过。 |
| 旧引擎（legacy） | 未登记的 `demo` 显式 `--renderer legacy` | 短整片草稿、代表帧和视频探测，确认回退/旧入口仍能工作 | **已验证**。`demo.legacy.draft.mp4`（`999f`/`16.65s`）及 `qa` 通过；`verify` 因 `demo` 既有基于 `f.idx` 的白噪声 `post.shake` 在 `6/18` 帧超容差（属既有旧引擎特性限制）。与 Remotion 结果分别记录，不混用基线。 |
| `world-execute-me` | `WemBridgeMB`，`kind=custom-bridge`，`audio=true`；原曲由用户本地提供 | 可选的长片 custom-bridge 压力样本 | **未验证（本轮非必需主样片）**。版权音轨 `audio/track.mp3` 不入仓库，缺失会阻断带音轨交付；不作为 Three.js 或 R2 覆盖证据。 |

## 3. 环境快照、R1 处置与生产验收矩阵

Windows 下所有测试、渲染与对照包复跑均固定使用工作区内临时目录，避免子进程读取不同系统临时路径：

```powershell
New-Item -ItemType Directory -Force -Path 'out/_remotion-migration/acceptance/tmp' | Out-Null
$env:TEMP = (Resolve-Path 'out/_remotion-migration/acceptance/tmp').Path
$env:TMP = $env:TEMP
```

### 3.1 本机环境与版本快照（R3）

以下为本轮实测记录的绝对临时目录及各组件版本（2026-11-28）：

| 组件 | 实测命令 | 实测结果 |
|---|---|---|
| 工作区 `TEMP` / `TMP` | `$env:TEMP` / `$env:TMP` | `D:\ai-anim\out\_remotion-migration\acceptance\tmp` |
| Node.js | `node -v` | `v26.13.0`（退出码 `0`） |
| npm | `npm -v` | `12.0.2`（退出码 `0`） |
| `@remotion/*` | `node -e "import { createRequire } from 'node:module'; const r = createRequire(import.meta.url); for (const p of ['remotion','@remotion/cli','@remotion/renderer','@remotion/bundler','@remotion/media','@remotion/media-utils','@remotion/transitions']) { const j = r(p+'/package.json'); console.log(j.name + '@' + j.version); }"` | `remotion@4.0.404`、`@remotion/cli@4.0.404`、`@remotion/renderer@4.0.404`、`@remotion/bundler@4.0.404`、`@remotion/media@4.0.404`、`@remotion/media-utils@4.0.404`、`@remotion/transitions@4.0.404` |
| Chrome | `localBrowser()` + `(Get-Item $chromeExe).VersionInfo.ProductVersion` | `C:\Program Files\Google\Chrome\Application\chrome.exe`，版本 `158.0.8127.88` |
| ffmpeg | `ffmpeg -version` | `ffmpeg version 8.1.2-full_build-www.gyan.dev`（`libavutil 60. 26.102`, `libavcodec 62. 28.102`, `libavformat 62. 12.102`） |
| ffprobe | `ffprobe -version` | `ffprobe version 8.1.2-full_build-www.gyan.dev` |
| Windows GPU / 驱动 | `Get-CimInstance Win32_VideoController`（`Name`, `DriverVersion`, `DriverDate`, `AdapterRAM`） | 1) `NVIDIA GeForce RTX 3070 Laptop GPU`（驱动 `32.0.16.2124`，`2026/11/7`，`4293918720`）<br>2) `AMD Radeon(TM) Graphics`（驱动 `31.0.21924.61`，`2025/12/11`，`536870912`，`0x1638`）<br>3) `OrayIddDriver Device`（`17.1.58.818`，`2022/11/15`）<br>4) `GameViewer Virtual Display Adapter`（`15.6.5.199`，`2026/2/28`） |
| Chrome 实际 WebGL GPU | `node scripts/anim.mjs gpu _calib` | `{"ok":true,"renderer":"ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)","vendor":"Google Inc. (AMD)","version":"WebGL 2.0 (OpenGL ES 3.0 Chromium)","unmasked":true,"floatRT":true}` |

### 3.2 R1 专项：`example-config-only` 11.40–12.32s 近黑段排查与处置

- **判定**：**有意极简 `outro` 开场留白，非渲染缺陷或漏层**。
- **结构依据**：`tasks/example-config-only/task.config.mjs:87-98` 定义段 4 `outro`（`dur: { beat: 5 } = 2.50s`，`11.40–13.90s`，帧 `684–833`）：2px 居中水平细线于段内 `0.2→1.6s` 收拢，9 字标题 `一段配置，一支片子` 以 `stagger: 0.11, dur: 0.7` 逐字显现（`12.98s` 写完），副标于段内 `1.2s`（`12.60s`）淡入，末尾 `0.6s`（`13.30–13.90s`）压黑收尾；`packages/remotion/shots/OutroShot.tsx` 与 `src/shots/outro.js` 实现一致。
- **静帧核验**：命令 `node scripts/anim.mjs still example-config-only --renderer remotion -t "11.40,11.80,12.32" --out out/_remotion-migration/acceptance/r1-outro-stills`（退出码 `0`）输出三帧并已直接目视确认：
  - `out/_remotion-migration/acceptance/r1-outro-stills/f_0011.400.png`（帧 `684`，`38,202 B`，SHA-256 `DA25E0692EF2957388027618DC436ED7AC15CB13C13E47810A2D5D98B6A5E26B`）：`#0a0a0b`（`P.ink`）底色、居中带刻度 2px 灰线、右下橙色署名 `anim · config-only█`（段内 `0.00s`，主标题第 0 字尚未开始淡入）。
  - `out/_remotion-migration/acceptance/r1-outro-stills/f_0011.800.png`（帧 `708`，`45,889 B`，SHA-256 `E40C3DC6713D75BACCC2B9E8CBFA68519426448075B91A20D64E92E53B12EBED`）：细线上方逐字浮现 `一段配置`（`置` 字淡入中）。
  - `out/_remotion-migration/acceptance/r1-outro-stills/f_0012.320.png`（帧 `739`，`52,558 B`，SHA-256 `E03738CD8B481C8BB1ACE753C8CDF75272EBC1EC7C7003CF39072504404BEA0A`）：完整标题 `一段配置，一支片子`（`子` 字淡入中）与居中细线清晰可见。
- **QA 阈值与 `verify` 口径处理**：
  - Remotion 路径不叠加旧版 WebGL `grain`/`bloom`，`#0a0a0b` 画布在 `yuvj420p` 编码下有 `>98%` 像素低于 ffmpeg `blackdetect` 默认 `pix_th=0.10`，因此 `outro` 前 `0.92s`（`11.40–12.32s`）触发默认 `--tail 1.2`（仅豁免 `>= 12.70s`）的 1 条期望告警：`⚠ 第 11.40s 起黑场 0.92s（到 12.32s）`（`0 错 / 1 警`，退出码 `0`）。
  - 按 [交接文档](HANDOVER-remotion.md) 既定口径传入 `--tail 2.5 --strict` 覆盖完整 `2.50s` 片尾段后：`node scripts/anim.mjs qa example-config-only --renderer remotion --file out/_remotion-migration/acceptance/native-config.remotion.draft.mp4 --tail 2.5 --expect-size 960x540 --expect-fps 60 --expect-duration 13.9 --audio none --strict` → 退出码 `0`，**`0 错 / 0 警`**。
  - `node scripts/anim.mjs verify example-config-only --renderer remotion --file out/_remotion-migration/acceptance/native-config.remotion.draft.mp4 --times "1,3.5,5.7,7.9,9.65,11.4,12.32,13.5" --samples 1` → 退出码 `0`（`8/8` 时刻全通过，`mean 0.18–1.62 < 18`；注：`config-only` 的 `buildFrameTimeline` 仅发射 `startFrame`/`endFrame`，不传 `--times` 时 `anim verify` 默认仅采样帧 `0`）。

### 3.3 生产验收矩阵

| 验收项 | 实测命令与退出码 | 产物与核验数据（字节 / SHA-256 / `ffprobe` / 检查） | 当前状态与限制 |
|---|---|---|---|
| 1. 原生整片草稿（`example-config-only`） | `node scripts/anim.mjs video example-config-only --renderer remotion --draft --segments 4 --out out/_remotion-migration/acceptance/native-config.remotion.draft.mp4`（退出码 `0`）；<br>`qa --tail 2.5 --expect-size 960x540 --expect-fps 60 --expect-duration 13.9 --audio none --strict`（退出码 `0`）；<br>`verify --times "1,3.5,5.7,7.9,9.65,11.4,12.32,13.5" --samples 1`（退出码 `0`） | 产物：`out/_remotion-migration/acceptance/native-config.remotion.draft.mp4`（`569,657 B`，SHA-256 `9CBB394C4E8B956D133119FDFF6F457D263E9276F6F811D73D60BB224CB3B17E`）；<br>`ffprobe`：`h264` High、`960x540`、`yuvj420p`、`60/1 fps`、`834` 帧、`13.900000s`、`nb_streams: 1`（`0` 音轨）；<br>默认 `qa --tail 1.2`：`0 错 / 1 警`（`11.40–12.32s`）；`qa --tail 2.5 --strict`：**`0 错 / 0 警`**；`verify`：`8/8` 通过（`mean 0.18–1.62 < 18`）；R1 静帧 `r1-outro-stills/` 3 张已查看。 | **已验证**（工程草稿与 R1 处置完成；草稿仅作工程/流程验收，不代正式成片视觉终审）。 |
| 2. 真实旁白桥接整片（`nekohome-intro-ja`） | 仅做只读素材盘点：`tasks/nekohome-intro-ja/audio/` 未见 `ja-vo.mp3`、`ja-mix.mp3`（未以 `--noaudio` 或合成音频夹具替代执行）。 | 缺失文件：`tasks/nekohome-intro-ja/audio/ja-vo.mp3`、`tasks/nekohome-intro-ja/audio/ja-mix.mp3`（目录保持未修改）。 | **阻塞（素材缺失）**。需补齐或重建真实配音与混音轨后才能验收真实音画与字幕边界。 |
| 3. 复杂桥接无声整片草稿（`paperfold --noaudio`） | `node scripts/anim.mjs video paperfold --renderer remotion --draft --samples 1 --noaudio --segments 10 --out out/_remotion-migration/acceptance/paperfold.remotion.draft.mp4`（退出码 `0`）；<br>`still paperfold --renderer remotion --samples 1 -t "1,8.7,24,36.3,46" --out out/_remotion-migration/acceptance/paperfold-stills-v2`（退出码 `0`）；<br>`verify` `--samples 1`（退出码 `0`）；`qa --expect-size 960x540 --expect-fps 24 --expect-duration 48 --audio none --strict`（退出码 `0`） | 产物：`out/_remotion-migration/acceptance/paperfold.remotion.draft.mp4`（`3,818,440 B`，SHA-256 `0106C1BF17212A715A3E25E096FB213054901D76772E548841FD4D110F4C019E`）；<br>`ffprobe`：`h264` High、`960x540`、`yuvj420p`、`24/1 fps`、`1152` 帧、`48.000000s`、`nb_streams: 1`（**`0` 音轨**）；<br>静帧 `paperfold-stills-v2/` 5 张已查看；`verify`：`18/18` 通过（`mean 0.22–0.82 < 18`）；`qa --strict`：**`0 错 / 0 警`**。 | **无声画面已验证（`--noaudio`，0 音轨）；真实音画阻塞（素材缺失）**。本项仅覆盖无声视觉桥接路径，不代表真实音画通过。 |
| 4. Three.js 桥接整片与多子帧（`_three-lab` / `Task-three-lab`，R4） | `node tools/gen-remotion-registry.mjs --add _three-lab`（退出码 `0`）；<br>`node scripts/anim.mjs check _three-lab`（退出码 `0`）；<br>`still` `--samples 1` / `4` / `auto` `-t "2,5.65,7.5,8.95,12"`（退出码 `0`）；<br>`video _three-lab --renderer remotion --draft --segments 5 --out out/_remotion-migration/acceptance/three-lab.remotion.draft.mp4`（退出码 `0`）；<br>`shot _three-lab --renderer remotion --from 5 --to 6.5 --samples 4 --out out/_remotion-migration/acceptance/three-lab.remotion.s4.shot_5-6.5.mp4`（退出码 `0`）；<br>两支视频 `verify` 与草稿 `qa --strict`（均退出码 `0`） | 草稿：`out/_remotion-migration/acceptance/three-lab.remotion.draft.mp4`（`33,748,229 B`，SHA-256 `E7E3105F4671A3D8B8F52400F8B33D4C65C01B677DA9F724EA942AB0F30D037F`；`ffprobe`：`h264` High、`960x540`、`yuvj420p`、`60/1 fps`、`876` 帧、`14.600000s`、`0` 音轨；`verify` `10/10` `mean 3.02–3.79`；`qa --strict` **`0 错 / 0 警`**）；<br>多子帧片段：`out/_remotion-migration/acceptance/three-lab.remotion.s4.shot_5-6.5.mp4`（`30,598,463 B`，SHA-256 `7FA1ECCDB00F5E58382B18D761AFE3A2062C1737E6CDE948CA0002A11C62CDE6`；`ffprobe`：`h264` High、`1920x1080`、`yuvj420p`、`60/1 fps`、`90` 帧、`1.500000s`、`0` 音轨；`verify --from 5 --samples 4` `3/3` `mean 3.91–11.19`）；<br>`check`：2 个交叠中点整帧铺底通过，9 采样点 Remotion vs Legacy `mean 0.00–0.07 < 6`；`three-stills-{s1,s4,auto}/` 已查看（`InstancedMesh` 80 单元与快门平均可见）。 | **已验证**（`Task-three-lab` 已真实登记并通过网格、交叠、乱序、1/4/auto 子帧、草稿与 1080p 多子帧实测）。 |
| 5. Legacy 回退整片草稿（`demo`） | `node scripts/anim.mjs video demo --renderer legacy --draft --out out/_remotion-migration/acceptance/demo.legacy.draft.mp4`（退出码 `0`）；<br>`node scripts/anim.mjs qa demo --renderer legacy --file out/_remotion-migration/acceptance/demo.legacy.draft.mp4 --expect-size 960x540 --expect-fps 60 --expect-duration 16.65 --audio none`（退出码 `0`） | 产物：`out/_remotion-migration/acceptance/demo.legacy.draft.mp4`（`94,983,404 B`，SHA-256 `CB86436CCB29E6E6025E579F13271784FACB140198D954D1D5447AB61CCFC75F`）；<br>`ffprobe`：`h264` High、`960x540`、`yuv420p`、`60/1 fps`、`999` 帧、`16.650000s`、`0` 音轨；<br>`qa`：**`0 错 / 0 警`**（确认未误走 Remotion）。另测 `anim verify demo --renderer legacy` 退出码 `1`（`6/18` 帧超容差），因 `demo` 自身存在基于 `f.idx` 的白噪声 `post.shake`。 | **已验证**（legacy 回退整片出片与 `qa` 通过；`demo` 自带随机帧抖动限制已单列说明）。 |
| 6. 随机跳帧 / 顺序独立 | `seek-native-{a,b}/` & `ExampleConfigOnly` 单会话 `[60, 210, 684, 210, 60]`；<br>`seek-pf-{a,b}/` & `PaperfoldBridgeMB` 单会话 `[200, 204, 228, 48, 204, 200]`；<br>`openRemotionSession({ compositionId: 'Task-three-lab' })` 单会话 `[120, 339, 537, 720, 339, 120]`（`samples=1` & `samples=4`）与反序校验（均退出码 `0`） | Native：`60`=`990713449840ca0cd20797472149629a4c01895f0e0f981685c809fad41fb38b`、`210`=`c50f18240227db7452ebd325b0f6cdede0d4bff8947728c2465ec1eb28b77aa3`、`684`=`da25e0692ef2957388027618dc436ed7ac15cb13c13e47810a2d5d98b6a5e26b`（跨顺序/重复一致）；<br>`paperfold`：`200`=`4c1158bf17faf54541764589f6c78f0275a4d040abd6ba544b360efc37337179`、`204`=`9a2f8766229efdce4f0a32bd0c658db64bc63a27684f4db81deb1c5c9e1e5328`、`48`=`689edf5239ce970194a938da1874e5a735c42f483aeff7b27944bc681482dece`（跨顺序/重复一致）；<br>`_three-lab`（`three-seek-order/hashes.json` `664 B` `825318C5...` & `three-seek-order-s4/hashes.json` `664 B` `5EC2A144...`）：`s1` 帧 `120`=`39BCB259...`、`339`=`7412A730...`、`s4` 帧 `120`=`292504BF...`、`339`=`EB195121...`（`take-0==take-5`、`take-1==take-4` 且与 `three-stills-s1/s4` 逐字节一致）；R5 `detFail=0`。 | **已验证**（覆盖原生、复杂 WebGL 桥与 Three.js 桥 `s1`/`s4`）。 |
| 7. 单 / 多子帧（`--samples 1 / 4 / auto`） | `PaperfoldBridgeMB` 对帧 `48`、`204` 各档重复两次；<br>`Task-three-lab` 对 `[2, 5.65, 7.5, 8.95, 12]` 跑 `--samples 1 / 4 / auto` + `samples=4` 1080p 片段（均退出码 `0`） | `PaperfoldBridgeMB` 帧 `48`/`204` 同档两次全匹配：`s1`（`689edf52...`、`9a2f8766...`）、`s4`（`8ced7ea5...`、`629c324d...`）、`auto`（`925e52ad...`、`6da9d7d7...`）；<br>`_three-lab`：`three-stills-s1/`（`2,883,174–3,085,839 B`）、`three-stills-s4/`（`2,885,577–3,086,021 B`）、`three-stills-auto/`（`2,883,515–3,084,347 B`）+ `three-lab.remotion.s4.shot_5-6.5.mp4`；`f_0007.500.png` 运动快门平均与 `f339` 像素差（`s1 vs s4 max=168`、`s4 vs auto max=55`）已实测核对。 | **已验证**（`paperfold` 与 `_three-lab` 均实测通过）；原生 `example-config-only` **不适用**（契约固定 `samples: 1`）。 |
| 8. 跨切点 / 跨交叠窗（无声画面） | `still example-config-only` `-t "3.483,3.500,7.883,7.900,11.383,11.400"`（`native-cuts/`）；<br>`still paperfold --samples 1 -t "8.375,8.417,8.708,8.958,9.042"`（`pf-overlap-stills/`）；<br>`shot paperfold --renderer remotion --from 8.2 --to 9.2 --samples 1 --noaudio --out out/_remotion-migration/acceptance/paperfold-overlap-v2.remotion.mp4` + `verify`（均退出码 `0`） | `native-cuts/` 6 PNGs、 `pf-overlap-stills/` 5 PNGs 及 `_three-lab` `f_0005.650`/`f_0008.950` `worldPass` 交叠帧已查看，无黑闪、缺帧或残留；<br>交叠片段：`out/_remotion-migration/acceptance/paperfold-overlap-v2.remotion.mp4`（`365,775 B`，SHA-256 `0234E547D3AD59D224785C7AD83DF03A220094FEB517F470C9E099EE605D1976`；`ffprobe`：`h264` High、`1920x1080`、`yuvj420p`、`24/1 fps`、`24` 帧、`1.000000s`、`0` 音轨；`verify` `3/3` `mean 0.68–0.77 < 18`）。 | **已验证（无声画面）**。带真实音轨交叠窗裁切仍受 R2 阻塞。 |
| 9. 分块 / 中断续渲 | `video example-config-only --renderer remotion --draft --segments 4 --out out/_remotion-migration/acceptance/resume-verify.remotion.draft.mp4` 首块 `f0-209.mp4` 发布后中断，再以完全相同命令续跑 + `verify --times "1,3.5,7.9,11.4,13.5" --samples 1`（续跑与 `verify` 均退出码 `0`） | 续跑日志命中 `复用分块 0–209`（`f0-209.mp4` `156,172 B`）；拼接成片：`out/_remotion-migration/acceptance/resume-verify.remotion.draft.mp4`（`569,790 B`，SHA-256 `61A36DAE3CD6EC43A71E3F6799D66E9E472E2715DD2DDB2A9F18143BAB39C17D`；`ffprobe`：`960x540`、`60/1 fps`、`834` 帧、`13.900000s`、`0` 音轨；5 个分块连续覆盖）；`verify` `5/5` 通过（`mean 0.18–1.07 < 18`）。 | **已验证**。 |
| 10. 失败保旧 | 预置隔离目标 `preserve-verify.remotion.draft.mp4`，设置 `$env:ANIM_FFMPEG = 'node -e "process.exit(1)"'` 后执行分段渲染 `video example-config-only --renderer remotion --draft --segments 4 --out out/_remotion-migration/acceptance/preserve-verify.remotion.draft.mp4` | 进程非零退出码 `1`（`Error: ffmpeg 退出码 9`）；目标文件保持 `50,930 B`、SHA-256 `28EC06116F9A9CB005412AC80D4C52A425A48CDC42D255F12CB209343B3A2BAA` 不变（`PRESERVE_MATCH=True`）；`LEFTOVER_STAGING_COUNT=0`。 | **已验证**（原子发布失败保旧与暂存清理实测成立）。 |
| 11. 成片 / 帧复核（`verify` / `qa`） | 上述 `native-config`、`paperfold`、`paperfold-overlap-v2`、`three-lab`（草稿 & `s4` 片段）、`resume-verify` 均已逐一运行 `anim verify`、`anim qa --strict` 与 `ffprobe`（均退出码 `0`） | `anim verify` 全数通过（`mean 0.18–11.19 < 18`）；`anim qa --strict` 均 `0 错 / 0 警`（`example-config-only` 用 `--tail 2.5`）。 | **已验证**（注：`tools/remotion-verify.mjs` 仅适用 `scale=1` 1080p 产物，且画面比对不验音轨）。 |
| 12. 真实音画（`nekohome-intro-ja` & `paperfold`） | 只读检查确认缺失 4 份真实音频文件；未用静音或合成音频替代真实音画验证 | `tasks/nekohome-intro-ja/audio/` 缺 `ja-vo.mp3`、`ja-mix.mp3`；`tasks/paperfold/audio/` 缺 `paperfold-vo.mp3`、`paperfold-mix.mp3`。 | **阻塞（素材缺失）**；原生配置 `example-config-only` **不适用**。 |
| 13. 跨驱动 / 跨机器（R5） | Machine A 建包与隔离自检：`node tools/cross-gpu-repro.mjs --init-baseline`（退出码 `0`）→ `node tools/cross-gpu-repro.mjs`（退出码 `0`） | 交付脚本与文档：`tools/cross-gpu-repro.mjs`、`docs/CROSS-GPU-REPRO.md`；<br>对照包（gitignore）：`out/_remotion-migration/acceptance/cross-gpu-bundle/`（`manifest.json` `21,168 B` `6B58C561D53C9087D05C6FFE51D524E7A0BC872D3660FC7154BCB1A52B592DCA`、`README.md` `1,754 B` `C60A8ADFF8ECEF9F7452CACA3F425959D92611DA29DC168A153B15589CF28B57`，含 5 组用例 **28 张基准 PNG** 与 **3 支基准草稿 MP4**：`example-config-only-draft.mp4` `569,922 B` `7394DE2E...`、`paperfold-overlap-draft.mp4` `--noaudio` `137,287 B` `404EFA6A...`、`three-lab-draft.mp4` `33,748,172 B` `9C0F51C0...`）；<br>Machine A 自检报告 `cross-gpu-bundle/runs/2026-11-28T10-22-00-153Z-angle-amd-amd-radeon-tm-graphics-0x0/repro-report.{json,md}`：**`PASS`（`exact=28/28, withinTol=0, diverged=0, detFail=0, videos=3/3, skipped=0`）**，且 `31/31` 基线文件逐字节未改。 | **待第二环境回传**（Machine A 对照包与自检已就绪，待 Machine B 运行并回传报告）。 |

### 复核工具口径

- `tools/remotion-verify.mjs` 用 `ffprobe` 读取视频规格、抽取帧并以 Remotion 重渲同帧后做灰度差比较；它**不验音轨**，且仅适用于 `scale=1`（1080p）输出（`--draft` `960x540` 产物由 `anim verify` 覆盖）。该工具注释示例写 `--tol 2`，代码默认 `tol=8`、`meanTol=2.0`、`pctTol=3.0`。
- `tools/test-remotion-*` 与 `tools/test-cross-gpu-repro.mjs` 等离线单测证明时间线求值、注册表、CLI 选路/分块规划、内联音频解析与对照包逻辑正确，不替代 Chrome/WebGL 渲染或真实旁白同步。

## 4. 历史遗留、旧产物隔离与剩余限制

1. **已作废的 M1/M2 前旧产物（请勿引用为本轮证据）**：`out/_remotion-migration/acceptance/` 中仍保留一批 `2026-11-28T04:53Z–05:50Z` 期间生成的早期短切片与草稿，以及内部验证轨道目录 `e2e-verify/`。它们均已被上表 M1/M2 完整产物取代，仅作目录清理参考，不作为当前验收证据：
   - 早期短切片/旧草稿：`native-stills/`（5 张）、`native-single.mp4`（`32,158 B`, `12f`/`0.2s`, `B77C0000...`）、`native-crosscut.mp4`（`30,012 B`, `12f`/`0.2s`, `2CC6DD26...`）及 `native-crosscut.parts/`、`preserve-test.remotion.draft.mp4`（已被 `preserve-verify.remotion.draft.mp4` 取代）、`webgl-stills/`、`narration-bridge-stills/`、`paperfold-stills/`（已被 `paperfold-stills-v2/` 与 `pf-overlap-stills/` 取代）、`paperfold-overlap.remotion.draft.mp4`（`90,026 B`, `22f`, `960x540`, 已被 `paperfold-overlap-v2.remotion.mp4` 与 R5 `paperfold-overlap-draft.mp4` 取代）、`seek-order/`（已被 `seek-pf-{a,b}/` 取代）、`native-full.remotion.draft.mp4`（`577,389 B`, 已被 `native-config.remotion.draft.mp4` 取代）、`resume-test.remotion.draft.mp4`（`85,843 B`, `60f`/`1.0s`, 已被 `resume-verify.remotion.draft.mp4` 取代）、`native-black-window-01..04.png`（已被 `r1-outro-stills/` 取代）、`demo-legacy.draft.mp4`（`7,880,304 B`, `60f`/`1.0s`, 已被 `demo.legacy.draft.mp4` `999f` 取代）。
   - 验证轨道暂存：`e2e-verify/`（内部复核记录，非生产交付产物）。
2. **缺失的历史阶段目录**：2026-11-27 交接文档提及的 `out/_remotion-migration/stage2-agent/verification.md`、`stage3-agent/verification.md` 与 `stage4-agent/final/segmented.mp4` 仍不在当前工作区，本轮不引用、不继承其结论。
3. **本轮代码关键修复（已进仓库回归）**：
   - `scripts/lib/cli/remotion.mjs`：`resolveRemotionBinariesDir()` 自动探测 Windows workspace ACL `0xC0000142` 启动失败并同步 compositor DLL 与二进制到可运行目录（健康环境零开销）；
   - `scripts/lib/cli/audio.mjs`、`scripts/lib/media.mjs`、`scripts/lib/remotion-registry.mjs`：通过 `blankJsComments()` 与安全边界匹配修复内联对象 `audio:{...}` 与注释中 `audio:` 误解析（`resolveAudioTracks('paperfold')` 正确解析 `bed.mp3`）；
   - `scripts/lib/cli/renderer.mjs`：保持 `queue` 由 `legacy` 编排并将渲染器参数透传子进程 `video`。
4. **当前未闭环限制**：
   - **R2 真实音画阻塞**：`nekohome-intro-ja` 与 `paperfold` 的真实 VO/mix MP3 仍缺失；
   - **R5 第二环境待回传**：单一 Windows 本机仅实测了 `AMD Radeon(TM) Graphics` D3D11 WebGL 后端；
   - **未触发正式成片全渲染**：本轮严格遵守边界，未执行任何无 `--draft` 的全片正式渲染。

## 5. 仓库完整回归与离线检查实测记录（R3）

以下全部检查均在工作区 `TEMP`/`TMP`（`D:\ai-anim\out\_remotion-migration\acceptance\tmp`）下实测执行，**全部退出码 `0`**：

| 检查项 | 执行命令 | 退出码 | 实测输出摘要 |
|---|---|---|---|
| 全仓 CI 回归（最新） | `node tools/regress-all.mjs --ci` | `0` | **`通过 102/102 ✅ 没有真失败`**（`96 unit:` + `3 harness:` + `2 meta:` + `1 say:offline`；`failed: 0, skipped: 0, envSkipped: 0`；注：M1 收口时曾先跑通 `101/101` 退出码 `0`，M2 新增 `unit:cross-gpu-repro` 后复跑 `102/102` 退出码 `0`） |
| CI 覆盖守门 | `node tools/test-ci-coverage.mjs` | `0` | `✓ 8 项全部通过（共 8 项）`（`102` 项进 CI，`1` 项带 `ciWhy` 豁免） |
| Remotion CLI 单测 | `node tools/test-remotion-cli.mjs` | `0` | `test-remotion-cli: PASS`（含 `resolveAudioTracks('paperfold')`、内联/注释 `audio:`、`resolveRemotionBinariesDir` DI 与 `queue` 选路） |
| Remotion 注册表单测 | `node tools/test-remotion-registry.mjs` | `0` | `test-remotion-registry: PASS（26 项）` |
| R5 跨 GPU 对照包单测 | `node tools/test-cross-gpu-repro.mjs` | `0` | `test-cross-gpu-repro: PASS（16 项）` |
| Remotion TypeScript 类型检查 | `npm run typecheck -w @ai-anim/remotion` | `0` | `tsc -p tsconfig.json` 通过 |
| Remotion 注册表同步校验 | `node tools/gen-remotion-registry.mjs --check` | `0` | `✓ Remotion 登记表校验通过（5 个任务，packages\remotion\bridges.generated.tsx 最新）` |
| 镜头分类卡校验 | `node tools/gen-shot-cards.mjs --check` | `0` | `✓ 镜头分类齐全（30 个模板 / 10 个分类）` |
| `AGENTS.md` 体积守门 | `node tools/lint-agents-size.mjs` | `0` | `AGENTS.md：52418 B / 65536 B（80.0%）`，`§4` 止于 `23491 B <= 24000 B` |
| `AGENTS.md` 引用守门 | `node tools/lint-agents-refs.mjs` | `0` | 断链 `0` |
| 上游改动清单校验 | `node tools/gen-changes.mjs --check` | `0` | `✓ 改动清单是最新的` |

## 6. 后续闭环条件与第二环境回传指引

仅当以下三项全部满足并回填本矩阵后，才可签署最终 Remotion 生产验收：

1. **R5 第二环境回传**：在独立第二套 GPU / 驱动 / 系统环境（Machine B）按 [CROSS-GPU-REPRO.md](CROSS-GPU-REPRO.md) 运行 `node tools/cross-gpu-repro.mjs`，回传 `out/_remotion-migration/acceptance/cross-gpu-bundle/runs/<run-id>/repro-report.{json,md}`（同会话重复帧 `SHA-256` 必须全等，跨驱动像素/流规格在容差内）。
2. **R2 真实音画解除阻塞**：补齐或重建 `tasks/nekohome-intro-ja/audio/{ja-vo,ja-mix}.mp3` 与 `tasks/paperfold/audio/{paperfold-vo,paperfold-mix}.mp3`，补跑真实音画整片草稿、短切段试听、`ffprobe` 音轨核查、首/中/尾字幕与声音边界抽查及 `anim qa --audio required --strict`（含 AAC padding 实测读数）。
3. **正式成片终审授权**：以上两项均闭环且用户审阅草稿并明确同意后，再触发无 `--draft` 的正式成片全渲染。
