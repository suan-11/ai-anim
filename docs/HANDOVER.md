# 交接文档（HANDOVER）

> 写给接手的人 / agent：**先读这一页，再读 `AGENTS.md`**。这一页回答四件事 ——
> 现在是什么状态、这轮做了什么、怎么验证、接下来从哪接着做。
> 最后更新：**2026-11-04**（反 PPT P0 落地 + 推送完成）。

## 0. 一句话现状

引擎侧这三天补了六类能力（判据 / 音效 / 单文件播放器 / 色系 / 反 PPT / 编码器健壮性），**回归 70/70 全绿**；
片子侧有两支已交付 PV（`pv-king` 121MB、`pv-kattachi` 279MB），其中 `pv-kattachi` 尾段有一个**已知的歌词错位**没修。

```
cd <repo>
npm install
node tools/regress-all.mjs --ci        # 预期：通过 70/70 ✅ 没有真失败（约 2 分钟）
node scripts/anim.mjs tasks            # 看有哪些片子
```

## 1. 仓库与分支

| 项 | 值 |
|---|---|
| 工作仓库 | `C:/Users/haoxu/Downloads/NekoHome/ai-anim` |
| 我的 fork | `qyac/ai-anim`（**可直接推**） |
| 上游 | `suan-11/ai-anim`（只读；PR 历史在那边） |
| 当前 | `master`，与 `qyac/master` 同步 |
| 未提交 | 无（工作区干净） |

## 2. 这轮做了什么（2026-11-02 ~ 11-04）

### 2.1 判据（机器能拦的，都进了 `regress-all --ci`）

| 判据 | 抓什么 | 当前读数 |
|---|---|---|
| `tools/lint-lyric-sync.mjs` | 歌词句首 vs 人声起音（中位 / p90） | `pv-king` 5ms/374ms ✓；`pv-kattachi` 105ms/563ms ✗（尾段三句错位，见 §5） |
| `tools/lint-color-family.mjs` | 主色系加权 ≥55%、前二 ≥85%、底/字对比、信号色 | 32/32 风格全绿；`--compare` 可判两支片子撞色系 |
| `tools/lint-anti-ppt.mjs` | 状态差 / 接力物 / 淡出转场 / 时长 CoV / 每 10s 钩子 / 匀速漂移 | `demo` 全绿（参照样本）；`pv-king` 状态差 0%、接力物断链（见 §5） |
| `tools/gen-changes.mjs --check` | 改动清单不许过期 | 绿（生成物，别手改数据段） |
| `tools/test-sfx.mjs` | 音效：库查找 / 摆位 / 侧链 / 语义规则 | 30 项 |
| `tools/test-anti-ppt.mjs` | 反 PPT 判据自身 | 12 项 |

### 2.2 引擎变化（会影响你写片子的）

1. **时间线新字段**：`state: { from, to, diff }` 与 `relayTo`（反 PPT 声明）。已进 `TIMELINE_KEYS`，
   且**搬到 `build()` 出来的段上** —— 判据读段，不读配置。
2. **强调色跟着 `signal` 旋转**（`src/core/palette.js`）：风格只改 `signal` 也不会出现三四个色系。
3. **编码器兜底**：`ffmpegEncoderWorks()` 真编一帧再决定用谁 —— `h264_nvenc` 在这台机器列出得来但**用不了**
   （`Cannot load nvcuda.dll`），旧代码会因此「只渲染 5/N 帧」而看不出原因。
4. **`anim mix --sfx`**：音效第三轨（峰归一 + 侧链让路 + 语义选声），纯音乐片子也能混。
5. **`anim film-html`**：一个 HTML 双击就播（`src/player.js` + `tools/film-html.mjs`），量具 `tools/probe-film-html.mjs`；`P` 键截当前帧。
6. **`anim check` 里多了两行**：歌词同步、色系（`--strict` 才当门）。

### 2.3 音效库

`assets/sfx/` 有 **10 条**（whoosh / whoosh-long / click / 错误提示 / glitch / energy / flash / UI 点击 / 断电 / 撞击），
索引 `assets/sfx/catalog.json` **2081 条 / 36 分类**（只有元数据，可放心进仓库）。
站点匿名配额 5 条/天，`tools/sfx-fetch.mjs` 默认按这个节奏走（别去顶限额）。

## 3. 怎么验证（按这个顺序，别跳）

```sh
node tools/regress-all.mjs --ci               # 70 项，交付前的默认门（约 2 分钟）
node tools/regress-all.mjs                    # 全量（含 smoke / probe / check:*，约 50 分钟）
node scripts/anim.mjs check <任务> --quick     # 单片体检：静态 + 逐段试渲染 + 背景/版面/卡点/密度/歌词/色系
node tools/lint-anti-ppt.mjs <任务> [--strict]
```

回归项是**清单驱动**的（`tools/regress-all.mjs` 里的数组）：加测试只改清单，**不要**改 `.github/workflows/verify.yml`。
已知会红但不算锅的用 `expectFail: 原因` 标注 —— 现在没有这一类。

## 4. 环境坑（不知道这些会白花几小时）

| 坑 | 事实 / 做法 |
|---|---|
| 推仓库 | 系统 `OpenSSH/ssh.exe` 返回 255 且无输出；用 `C:/Program Files/Git/usr/bin/ssh.exe`，**并显式给密钥**：`GIT_SSH_COMMAND="C:/Program Files/Git/usr/bin/ssh.exe" -o IdentitiesOnly=yes -i C:/Users/haoxu/.ssh/id_ed25519`（不给 `-i` 会间歇 `Permission denied (publickey)`） |
| GitHub 5xx | 偶发 `remote: fatal error in commit_refs` / `Internal Server Error`：等 20–30 秒重试即可，别怀疑密钥 |
| 编码器 | 这台 ffmpeg **没有 libx264**，自动退 `h264_mf`；`h264_nvenc` 无显卡不可用（引擎现在会探） |
| 渲染期 | **一个文件都别写**（Vite HMR 重载会断流）；只有 `out/**` 安全 |
| 前置 | Chrome（`playwright-core` 的 `channel: chrome`）+ ffmpeg/ffprobe 在 PATH |
| 长片 | 必须 `--segments 10`；单进程长时间推流会中途卡死 |

## 5. 已知问题 / 欠账（按优先级）

1. **`pv-kattachi` 尾段歌词错位**（唯一还红着的片子）：`lint-lyric-sync` 报 217.08s `+2620ms`、223.77s `-2578ms`、
   229.32s `+1346ms`。原因：QQ 音乐 LRC 只到 115.34s，尾段三句是按字数外推的。修法 = 按人声起音重排尾段 + 重渲（约 100 分钟）。
2. **`pv-king` 没写 `state` / `relayTo`**：判据说它「状态差 0%、接力物 46 段全断」，但 C7 成片运动 CV 1.24、
   最长静止 0.8s —— 画面是活的，缺的是声明与接力。新片子必须写；存量回填可选。
3. **两支 PV 的音轨都没有音效**：`anim mix <任务> --sfx auto` 已能出（`out/pv-king/_sfx-test.mp3` 试过），
   但要进成片得改 `audio.mix` + 重渲。
4. **反 PPT 的 P1/P2 没做**：三类运动模板（揭示 / 因果 / 变形）、触发式文字、非均匀时长模板、环境音层、真三维视差、
   把 C7 接进 `anim check`。清单在 `docs/ANTI-PPT.md` §六。

## 6. 文件地图（这轮新增 / 改动的）

| 文件 | 作用 |
|---|---|
| `tools/lint-lyric-sync.mjs` | 歌词 vs 人声起音 |
| `tools/lint-color-family.mjs` | 色系判据 + 撞色系对比 |
| `tools/lint-anti-ppt.mjs` / `tools/test-anti-ppt.mjs` | 反 PPT 判据与它的回归 |
| `tools/gen-changes.mjs` | `docs/CHANGES-vs-upstream.md` 的生成器（`--check`） |
| `tools/sfx-fetch.mjs` / `assets/sfx/**` | 音效索引、共享库、manifest |
| `scripts/lib/sfx-rules.mjs` | 按语义选音效（标题 / 数据 / 歌词换族 / 片尾） |
| `scripts/lib/mix.mjs` | 加了 sfx 混音（峰归一 / 侧链 / offset+len 裁剪） |
| `src/player.js` / `tools/film-html.mjs` / `tools/probe-film-html.mjs` | 单文件播放器与量具 |
| `src/timeline.js` | `state` / `relayTo` 白名单与搬运 |
| `src/core/palette.js` | 底色 `bg` 缺省修复 + 强调色跟随 `signal` |
| `docs/ANTI-PPT.md` / `docs/SFX.md` / `docs/FILM-HTML.md` | 三份新文档（判据与做法） |

## 7. 接手第一小时建议

1. 跑 `node tools/regress-all.mjs --ci`，确认 70/70（不绿先查环境，别改代码）。
2. `node scripts/anim.mjs still demo -t 1.8,6,9.5`，然后**真的用 Read 打开那几张 PNG 看** —— 先建立画面直觉。
3. 读 `docs/ANTI-PPT.md` §二（两个新字段）+ `tasks/demo/task.config.mjs`（照着抄结构）。
4. 挑一件事：**修 `pv-kattachi` 尾段**（片子侧，最影响观众）或 **P1 第一项：三类运动模板**（引擎侧）。
