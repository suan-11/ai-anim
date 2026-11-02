# 我们在上游 main 之上做了什么

> **这份文件是生成的**（node tools/gen-changes.mjs），--check 会拦住过期版本。
> 数据段自动统计；「改动分块」这类必须人写的留在 manual 标记之间。
>
> 复现：git log --oneline 237e985..HEAD · git diff --stat 237e985..HEAD

## 一、总量

```
62 个提交 · 455 个文件 · +73,874 / −1,009 行
基线 237e985　当前 ce7ea0e 判据修完：亮底风格的「底色不符」三层原因（2 层是判据自己的错）
```

| 目录 | 文件 | 新增行 | 删除行 |
|---|---:|---:|---:|
| tasks | 270 | 53,931 | 301 |
| src | 58 | 7,319 | 168 |
| tools | 53 | 6,197 | 50 |
| docs | 54 | 3,822 | 77 |
| scripts | 10 | 2,079 | 55 |
| (root) | 4 | 332 | 358 |
| .github | 2 | 108 | 0 |
| skills | 1 | 58 | 0 |
| .githooks | 1 | 16 | 0 |
| assets | 2 | 12 | 0 |

## 二、提交一览

| 提交 | 日期 | 内容 |
|---|---|---|
| ce7ea0e | 2026-11-02 | 判据修完：亮底风格的「底色不符」三层原因（2 层是判据自己的错） |
| 98e8592 | 2026-11-02 | 修引擎：编码器「能不能真的编一帧」+ 底色 bg 缺省 + 回归清单整治 |
| 3fd755a | 2026-11-01 | 引擎夜班：lint-lyric-sync（词句对得上人声，已接进 check）+ gen-changes（改动清单生成物，--check 防过期）+ 播放器 P 键截帧 |
| 29daf26 | 2026-11-01 | 融 OpenFilm 的「一个 HTML 文件就是一支片子」：anim film-html（esbuild 打包 + 音轨内联 + 单页播放器）+ 量具 probe-film-html + agent skill 包 |
| 4605745 | 2026-11-01 | KING PV: 片门晃动 1.6px + 曝光闪烁 0.18 + 呼吸推近 1.028——白底静止段不再被判据当静帧 |
| 60215a6 | 2026-11-01 | KING PV: 片头 14.4s 静态大字拆成三段（mask → キング竖排 → glitch 署名），修掉事件密度红灯 |
| d63f0ea | 2026-11-01 | Merge branch 'master' of github.com:suan-11/ai-anim |
| 272b7e7 | 2026-11-01 | 新 PV：KING（Kanaria feat. GUMI）· Cotton 翻唱 —— QQ音乐逐行 LRC + 线性拟合（0.99974）+ 起音吸附；bauhaus 白底、文字自适应深色、几何底纹 |
| fb2ecd6 | 2026-11-01 | feat(relay): 相机接力 —— transition: relay，相机在两段位姿间飞、内容换手窗交接（1-12） |
| e8dcc4b | 2026-11-01 | docs: 归档已完成的交接文档 —— 8 份入库 + 3 份本地随移（docs/history/） |
| 280ad7f | 2026-11-01 | PV: 间奏空拍改成 interlude（拍尺 + 罗马音慢移 + kick/snare/hat 能量条），不再出现单音符空场 |
| 9e1245c | 2026-11-01 | fix(sampling): 自适应梯子的采样窗几何错误 —— ternaryOffsets 改层级序（1-72） |
| 95a500a | 2026-11-01 | fix(timeline): resolveDur 拒绝非有限 dur/tail + refRT 释放 + sampling 入回归清单 |
| bc32a06 | 2026-10-31 | feat(杂活批次): 后处理/CLI/引擎杂活一次收账 —— 1-14/1-15/1-37/A-2/D-1/E-1/1-24① + 1-8 注入通道 |
| f02541a | 2026-10-31 | feat(render): 多子帧亚像素抖动（真 4× 超采样）+ 填充面硬边带（1-71） |
| 0d80c0d | 2026-10-31 | PV: 错误色加强（普通 0.22 / split 0.45 / glitch 0.85 + 随 kick 0.45），节拍扫描线压暗 |
| 4a2d55a | 2026-10-31 | PV: 加错误色（post ca，随 kick 抖动；glitch/split 段更狠），准备带运动模糊重渲 |
| c9599d5 | 2026-10-31 | merge: 拉上游 12 个提交（PR #2 已合并、图元层/介质层/像素/手绘笔迹/1-69）；AGENTS 冲突按并集解——保留上游压缩版 §10 与我们的 11.5b |
| 156ee82 | 2026-10-31 | docs(agents): 推仓库改用 Git 自带的 ssh（系统那个在本机返回 255 且无输出） |
| 4057562 | 2026-10-31 | feat(segments): 引擎改动按 import 图收窄，改通用件不再整片重渲 |
| fdaa967 | 2026-10-31 | feat(video): dry-run 按草稿/成片档预估，审片先草稿后全渲染 |
| 580bb2c | 2026-10-31 | PV 改用 QQ音乐官方逐行 LRC 时间轴（songmid 0016bZbj0QvC1C）：首句 1.33s 与原曲一致；揭示类效果压到 0.42s 内，歌词到句即读' |
| 633ecea | 2026-10-31 | PV: 句首改由人声起音驱动（DP 挑峰 + 80ms 内吸拍）+ 每拍可见的扫描线；片头合成一个镜头（标题+作者+署名） |
| 582f234 | 2026-10-31 | docs: 计数同步 —— 模板 25 个 / 仪器九种 / CHANGES 刷新（37 提交 381 文件） |
| 5fe36b8 | 2026-10-31 | PV 歌词版 + tools/lint-cut-beats.mjs（切点必须踩拍） |
| c444859 | 2026-10-31 | docs(rules): P4 —— 合别人分支的纪律（预演 / 并集vs二选一 / 编号撞车） |
| 8bba890 | 2026-10-31 | merge: 合入 PR #2「选型器 anim shots --pick」（1-62），解冲突并收回编号撞车 |
| 3efea97 | 2026-10-31 | feat: 手绘笔迹 —— 中心线+压力 -> 轮廓多边形，曲率 < 半宽时自动退胶囊链（1-69） |
| df5d91d | 2026-10-31 | feat: 像素精灵 + 多方向排线 —— 像素四件事齐全、木刻按明暗加方向（1-67 / 1-68） |
| 554f98b | 2026-10-31 | fix(shots): 角色槽从 fits 里提出来，落空诊断点名 slot（1-62） |
| e0c6c3e | 2026-10-31 | feat(shots): 选型器 `anim shots --pick`（BACKLOG 1-62，学 JIZURA 的部件表） |
| 3befa47 | 2026-10-30 | feat: 介质层第二批 —— style.view 整片介质、胶片磨损、N 版套印（+ 两套风格） |
| 8a3c0c9 | 2026-10-30 | feat: 图元层+介质层 —— 填充面 fillPoly/fillCircle/fillSector、八种仪器视图、九套版式风格 |
| d9c4194 | 2026-10-30 | test(say): 修掉两条靠运气才过的断言（CI 上差 1ms 就翻脸） |
| 41b1821 | 2026-10-30 | ci: 失败清单写进 GitHub Job Summary（Actions 页面直接可见） |
| 9205426 | 2026-10-30 | test(say): 修一条假通过的断言（mp3 按 utf8 读，字节不同也会解成同一串） |
| e5a51c6 | 2026-10-30 | ci: 让失败自己说清楚（CI 红了却看不到是哪条断言） |
| 70cd771 | 2026-10-30 | fix: 修掉两处回归 + CI 改成按清单跑（不再手抄） |
| 9ecdc60 | 2026-10-30 | Merge pull request #1 from qyac/master |
| 1a52d9b | 2026-10-30 | chore: 加 PR 模板（点 Create pull request 时正文自动填好） |
| 051f651 | 2026-10-30 | docs: 改动清单补 20 个提交一览表 |
| a64dc31 | 2026-10-30 | docs: 相对上游 237e985 的改动清单（20 提交 / 311 文件 / 六块） |
| 4d57d6a | 2026-10-30 | 音效层第一步：tools/sfx-fetch.mjs 从 SoundDino 取音效（含出处/许可记账） |
| e146cd9 | 2026-10-30 | AGENTS: 记下沙箱里怎么推仓库（native OpenSSH）与钩子起不来的处理 |
| 685b491 | 2026-10-30 | 镜头卡（按叙事功能分类）+ 判例式准则 docs/RULES.md |
| 364f23d | 2026-10-29 | 把内置图标接进镜头模板（compare / device） |
| 37b9a9c | 2026-10-29 | 素材库第二层：共享位图素材（manifest + 加载器 + 校验命令） |
| d15a222 | 2026-10-29 | 素材库第一层：内置矢量图标（26 个）+ 扩素材库的分层策略 |
| 0d387ba | 2026-10-29 | 引擎：流体原语（域扭曲 fbm + 涟漪）+ liquid 模板 |
| d9956f5 | 2026-10-29 | 引擎：线条沸腾（line boil）原语 + cel 模板 |
| 11e3620 | 2026-10-29 | AGENTS §10 加 11.7：提交前钩子会跑 anim report |
| 7880a89 | 2026-10-29 | CI: 预提交自检钩子 + GitHub Actions 纯 JS 回归 |
| 6d9aaf1 | 2026-10-29 | 新镜头模板 isometric：等距 2.5D 体块（纯代码几何） |
| 7b93be6 | 2026-10-29 | 工作台第二阶段：参数面板 + 实时后处理覆盖 |
| a960eb2 | 2026-10-29 | 主片事件密度 43% → 13%：给最静的两段补大面积持续运动 |
| 938b2a0 | 2026-10-29 | 新增 anim report：一屏自检（成片 / 卡点 / 事件密度 / 风格 / 一致性） |
| b7ae42b | 2026-10-29 | 预览工作台：拖动快路径（skipPost）+ 更正 scrub 延迟的度量口径 |
| 0a47f6c | 2026-10-29 | 底色语义统一（bg）+ 像素化 post 参数；15 套风格判据全绿 |
| 3b69297 | 2026-10-29 | 风格调色板：修 world Pass 缓存 key，加「底色是否真的画上」的机器判据 |
| cd9044d | 2026-10-29 | 预览工作台 + 15 套 MG 风格包 |
| 8c3f1c9 | 2026-10-29 | 引擎：卡点/事件密度两条守门 + 多语言配音链路 |
| dc03518 | 2026-10-26 | feat(blocksig): 配置档任务的按段切片签名（1-59）+ 表情包图层 + nekoclicker 介绍片 |

## 三、改动分块（人写）

<!-- manual:start -->
## 二、六块改动

### A. 引擎核心（`src/core/`，+356 行）

| 文件 | 改了什么 | 为什么（都是「不报错但结果不对」那类） |
|---|---|---|
| `audio-analysis.js` | `estimateTempo` 重写：分数延迟 + 去掉 120bpm 先验 + 底鼓锚定 + 格点精确率×召回 + 最小二乘精修 | 合成床 80bpm 被估成 83.3（偏 4%），整片卡点全飘 |
| `engine.js` | `livePost`（工作台实时覆盖，永远最后合并）；`skipPost` 拖动快路径；`gl.paint` 空值守卫 | ① 滑块要能实时看；② 拖 scrub 时省掉后处理；③ 错误分支里 `paint` 已被摘成 null，崩在报错路径上 |
| `palette.js` | 新增显式 `bg`（默认 = `ink`） | 底色以前是隐含约定：`gl.clear`/`worldPass` 用 `ink`、`chart` 的纸面用 `bone`，换风格就「背景反色」 |
| `post.js` | 新增 `pixel` 参数（uv 量化 N×N + 最近邻） | 像素风不能只换色板，要真出块 |
| `world.js` | 共享背景 Pass 的缓存 key 补调色板指纹 | 同 key 会复用上一套风格建的实例 → 换了风格背景不换 |
| `app.js` | 预览工作台全部逻辑（+228） | 见 B |
| `style/index.js` | 注册 15 套 MG 风格 | 见 D |

### B. 预览工作台（上游没有，`src/app.js` + `index.html`）

从「播放器」升级成「编辑反馈回路」：

- **时间轴 scrub** + **场景/节拍刻线**（段边界白线、长段带段名、有音乐时叠拍点）；
- **走带**：播放/暂停、上下段、±1 帧、**循环当前段**；
- **精确帧按钮**：按导出同一条路径（多子帧）重渲当前帧，并报与 1 子帧预览的 **MAE / PSNR**；
- **参数面板**：风格包（写作时的 21 套，现 32 套下拉）、主色、泛光/颗粒/暗角/像素化滑块 —— 数值项写 `livePost` 实时生效，结构项走带参重载；
- **拖动快路径**：拖 scrub 时 `skipPost`，松手补一次完整渲染（实测完整链路 p50 3.4ms、快路径 2.1ms）；
- **agent 接口**：`__anim.preview(t)` / `previewRange(t0,t1,n)`（缩略拼图）/ `precise(t)`；
- `window.__animPalette` 调试出口：给「底色到底有没有画上去」这类判据用。

### C. 镜头库：25 个模板（上游 20 → +5）

> 本节写于第 20 号提交（当时 23 个）；此后 `8a3c0c9` / `df5d91d` / `3efea97` 又加了 `pixel`（1-67）、
> `handwrite`（1-69），以及选型器 `src/shots/pick.js`（1-62，`anim shots --pick`）。

| 新模板 | 干了什么 | 关键实现 |
|---|---|---|
| `isometric` | 等距 2.5D 体块，一格一格从地面长起来 | 画家算法排序（线段批没有 z-test）、只画朝镜头三面、`spring()` 落位不累积 |
| `cel` | 逐帧手绘 / 线条沸腾 | 纸面 Pass + 每 2 帧重描的线，抖动来自 `hash(帧组, 线号)` |
| `liquid` | 域扭曲流体底 + 同心圆涟漪 | 两层 fbm 域扭曲；涟漪是 `ripple(t - birth)` |
| （`compare` / `device` 加参数） | `compare.icons` 行业图标、`device.icon` 应用图标 | 图标走内置矢量库，不传就完全不画（旧画面逐像素不变） |
| `pixel`（1-67） | 像素机：调色板 / 块 / Bayer 抖动 / 12fps 台阶四件事齐全，中文走引擎文字层最后压同一栅格 | `src/kit/pixel.js` + `shot('pixel')`；压栅格块内平均、读回翻 y、文字最后压半格 |
| `handwrite`（1-69） | 手写讲解：中心线+压力 → 轮廓多边形，急弯自动退胶囊链 | `src/kit/stroke.js` + `shot('handwrite')`；笔迹不许半透明（`inkOn`）、minW 1.2 物理下限 |

### D. 风格包：32 套（原 6 → +15 MG → +9 版式 H 系 → +2 介质系）

`src/style/mg15.js`：把 <https://github.com/Vincentwei1021/mg-styles-15> 的 15 种 MG 风格落地成风格包
（`mg-cel` `mg-isometric` `mg-flat-vector` `mg-lineart` `mg-soft3d` `mg-morph` `mg-sticker` `mg-hud`
`mg-collage` `mg-aurora` `mg-bauhaus` `mg-vhs` `mg-pixel` `mg-liquid` `mg-variety`），每套带色板/字体/
后处理基线/栅格/字幕样式/字号阶梯。其中 3 个「骨」已由引擎原语支撑（cel / isometric / liquid + pixel）。
此后两批：`8a3c0c9` 加九套版式 H 系（`h-biennale` … `h-poster`，浅底纸面不再只有 paper）；
`3befa47` 加 `h-riso`（双版套印）/ `h-vhs`（CRT + 胶片磨损）—— 后两套是仅有的写了 `style.view` 整片介质的风格。

### E. 判据与工具（`tools/`，写作时 12 个新增，现 26 个新增文件）

| 工具 | 判据 |
|---|---|
| `lint-beat-align.mjs` | 切点对拍子：从音频**自己重建**拍网格，不信 `analysis.json` 的 bpm；最小二乘精修，±30ms |
| `lint-event-density.mjs` | 每一秒都有东西看：4fps 灰度帧间差，最长静止 ≤3.5s、稀薄窗口 ≤25% |
| `test-style-palette.mjs` | 底色真的画上去了：画面角落像素 vs `__animPalette.bg`，+ 亮底/暗底分档 |
| `lint-prog-range.mjs` | `prog(t,a,b)` 里 `b ≤ a`（元素永远不出现） |
| `test-tempo.mjs` / `test-event-density.mjs` | 上面两条判据自己的回归（合成素材，不依赖片子） |
| `precommit-report.mjs` | 提交前跑 `anim report`，判据红就拦（只读成片、不渲染） |
| `gen-shot-cards.mjs` | 从模板 meta 生成镜头卡 + 索引（随模板数自动增减），`--check` 保证新模板不漏分类 |
| `sfx-fetch.mjs` | 从 SoundDino 取音效，写 manifest（id/来源/许可/sha1），限速 + 每次 5 条 |
| `nuomi-{vary,shuffle,vo,vo-ja}.mjs` | 15 支短片的去同质化与配音链（主色轮换 / 段序移位 / 中继配音） |
| `tts-gptsovits.py` | 我们自己的 Cotton 声线驱动（替代 edge-tts） |
| `install-git-hooks.mjs` | 把 `core.hooksPath` 指到 `.githooks/` |

### F. 流程：CI、钩子、文档、片子

- **CLI 新命令**：`anim report`（一屏 5 项自检）、`anim shot-cards`、`anim icons`、`anim assets`；
- **CI** `.github/workflows/verify.yml`：语法 / 契约测试 / 镜头分类 / 文档守门（**故意不含渲染类判据** —— CI 上没有成片，塞进去只会变成永远 skipped 的假绿灯）；
- **预提交钩子** `.githooks/pre-commit`：对改到的任务跑 `anim report`；只是被引擎改动顺带扫到的片子只提醒不拦；
- **新文档 4 篇**：`docs/RULES.md`（判例式准则 R/Q/S/C/P 12 条）、`docs/ASSETS.md`（素材库四层）、`docs/SFX.md`（音效接入）、`docs/STYLE-mg15.md`（15 套风格对照 + 「骨」的缺口）；
- **镜头卡 + 索引**：`docs/shots/<分类>/<名字>.md`（写作时 23 张，现随 25 个模板生成），按叙事功能分 9 类（生成物，`anim shot-cards` 重生成）；
- **片子**：`tasks/nekohome-intro-ja`（小糯米主片，日语配音 + 中文字幕）、`tasks/nuomi{,2..15}`（15 支短片，主色/段序/切法各不相同）、`tasks/nekoclicker-intro`，以及 8 个夹具（`_iso-lab` `_cel-lab` `_liquid-lab` `_icon-sheet` `_asset-lab` `_sfx-lab` `_probe-flush` `_icon-templates`）。

## 三、一句话版本

> 上游是一支**能出片的引擎**；我们在它上面加了 **三样它没有的东西**：
> ① **可交互的预览工作台**（scrub / 刻线 / 精确帧差异 / 参数实时调）；
> ② **机器可验证的质量判据**（卡点 / 事件密度 / 底色 / 预览一致性 + 提交钩子 + CI）；
> ③ **可复用的表现层**（新镜头模板 / 引擎原语 / 风格包见上 C / D 两节 —— 均比写作时又增了；26 个图标、素材库四层、镜头卡）。
>
> 地基（`gl.js` / `text.js` / `timeline.js` / 采样与合成）在写作时**一行没改**（此后 `gl.js` / `trans.js` 有过两次受审的改动，见 §一「没动的部分」的更正）—— 所有增量都长在它上面。
<!-- manual:end -->

