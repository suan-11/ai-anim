# HANDOFF · 2026-10-30 晚 · 介质层第二批（style.view / 胶片磨损 / N 版套印）

> **📦 已归档（2026-11-01）**：原在 `docs/HANDOFF-2026-10-30-media.md`，介质层第二批（style.view / 胶片磨损 / N 版套印）已落地，移入 `docs/history/`。
> 归档目录的索引见 [`README.md`](./README.md)；活的待办一律以 [`../BACKLOG.md`](../BACKLOG.md) 为准 —— 别把本文的"留给下一步"当成待办，那是**当时**的状态。

> **自包含的一次性交接文档**：假设读者看不到产生它的会话。
> 上一份交接单是 [HANDOFF-2026-10-30.md](HANDOFF-2026-10-30.md)（图元层 + 介质层第一批）；
> 活的待办只以 [BACKLOG.md](../BACKLOG.md) 为准。

---

## 0. 一分钟版本

用户拍板三件事后，本轮把「介质」这一层做完了：

| # | 做了什么 | 规模 | 对应待办 |
|---|---|---|---|
| ① | **`style.view`**：八种成像提成**风格包字段**，整片换介质（默认 off） | 引擎接线约 60 行 + 风格 2 套 | 1-63 |
| ② | **胶片磨损** `post.weave` / `flicker` / `scratch` | shader 约 90 行 + 测试 23 项 | 1-64 |
| ③ | **N 版套印**（`halftone` 的 `passes` / `misreg`） | shader 约 70 行 | 1-65 |

**三条拍板（用户当场定的）**：① `style.view` 做、**默认 off**；② H/K/Z 三组 65 条素材
（正文只有一句话、只有 3 张静帧）**放着不投入**；③ 本轮范围 = 胶片磨损 → N 版套印。

---

## 1. 做了什么（事 / 位置 / 验证）

### ① `style.view`：整片介质成了风格包字段

| 项 | 位置 |
|---|---|
| 字段 + 校验（模式名写错**当场抛**） | `src/style/index.js` 的 `resolveView()` / `resolveStyle()` |
| 整帧成像入口（先拷离屏再成像） | `src/kit/views.js` 的 `applyStyleView()` |
| 引擎接线（「全部段合成完 → post 之前」） | `src/core/engine.js` 的 `composite()` 收尾 |
| 示范风格 | `h-riso`（双版套印）/ `h-vhs`（CRT + 磨损），`src/style/panels.js` |
| 夹具 | `tasks/_style-view-lab`（2 段，整片 CRT + 磨损） |
| 回归 | `tools/test-style.mjs` 新增 view 小节；`tools/test-views.mjs` 不变（模式数没变） |

**为什么放在风格而不是场景**：它是「这一支片子是什么做的」这种介质级决定，和色板/字体同层；
做成场景级函数就只能一段一段地记得调用。**默认 off** 是拍板的核心：不写 `view` 的风格
一个像素不变（`hashes demo` / `beat` 各 11/11 max 0 是证据）。

### ② 胶片磨损：三个 post 参数（默认全 0）

`src/core/post.js` 的 `pFinal`：

- **`weave`（片门晃动）**：采样前动 uv（水平、按行、双频 2.9/4.7Hz）。单频会像「机械晃动」，
  所以刻意让两个频率不成整数比。单位**逻辑像素**（与 `shake` 的物理像素不同，文档已写）。
- **`flicker`（放映闪烁）**：调色之后、flash/fade 之前，整帧亮度按 1.3Hz 慢波下陷，只压暗。
- **`scratch`（划痕）**：几根竖痕，每 5 秒一个「生死窗」；位置/宽度/深度全是 `t` 的哈希。
  **极性混合**：亮底发暗、暗底发亮 —— 它是「没显影的缝」，不是叠白线也不是压暗线。

时间源：`Post.render(gl, src, dst, p, seed, t)` 的第 6 参 `t`（引擎在 `engine.js` 的
`post.render` 调用处喂 `f.t`）→ uniform `wearT`。**磨损函数不读 `seed`**（帧号种子），
所以任意 seek 都重放同一帧（`tools/test-post-wear.mjs` 钉着这一点）。

### ③ N 版套印：`halftone` 的两个新参数

`src/kit/views.js` 的 `VIEW_FRAG`（mode 0 的 `passes > 1.5` 分支）：

- `passes`：1 = 单版（**与历史逐像素相同** —— 所有老基线靠这一条），2..4 = 分版；
- `misreg`：套准偏移（逻辑像素）。相邻版边界的彩色边是这层的灵魂；
- 分版：`th = i/N · 0.8`，`band = (1-l-th)/(1-th)` —— 越深的版越晚进入；
- 每版网角 +30°、偏移方向按黄金角散开（`fi * 2.4 rad`）。

夹具：`_view-lab` 的 `halftone2` / `halftone4`（2 版 / 4 版，30 秒 10 段）。

---

## 2. 踩掉 / 发现的坑（**这一节最值钱，别跳**）

1. **只压暗的划痕在深色段完全隐形**。第一版 `c *= 1 - dark * (1 - luma/0.55)`：深色底上
   暗痕看不见，亮纸底又被亮度因子归零 —— 夹具两段都没有划痕。改成极性混合后两种底都成立。
2. **crt 的 1.55 亮度补偿会打出 20%+ 死白**。裸乘在浅底画面（纸面图表）上把纸推到 1.4+，
   `check _style-view-lab` 的过曝门当场红；改成亮部软肩（0.72 以下原样、之上渐近 0.97）。
   教训：**任何「整帧乘一个数」的补偿都要在浅底画面上过一遍 `check`**。
3. **disjoint 分版把纸面染红**。第一版 `band = (1-l)*N - i`：纸面（亮度 0.62）就有 72%
   强调色覆盖 ⇒ 整屏红的、纸色全丢。改成「越深的版越晚进入」后纸色回来。
4. **夹具要避开「同向纹理」**。划痕第一版演示段用的是竖直网格线标题 —— 划痕被网格埋掉，
   出图根本看不见。换成纸面图表才看得清。**验证一个效果，先给它一个不会抢戏的底**。
5. **给「默认 off」做证明要用老片子**：`hashes demo` / `beat` 的 11/11 max 0 比任何单元
   测试都硬 —— 它证明整条新链路在默认档下**逐像素不动**。

---

## 3. 验收（全部可复现）

| 检查 | 结果 |
|---|---|
| `node tools/regress-all.mjs --ci` | **51/51**（新增 `unit:post-wear`） |
| `hashes demo --baseline`（已交付片子） | **11/11 max 0** |
| `hashes beat --baseline` | **11/11 max 0** |
| `hashes _fill-lab --baseline` | **3/3 max 0** |
| `hashes _view-lab --accept --note …` | crt 软肩 + 新增 2 段（有意改画面，已记 notes） |
| `hashes _wear-lab` / `_style-view-lab` | 新基线（12 / 10 帧） |
| `check _wear-lab` / `_style-view-lab` / `_view-lab` | 0 红（版面/节奏 warning 是夹具设计：等长段、无 focus） |
| `test-style` / `test-views` / `test-post-wear` | 294 / 27 / 23 项 |

---

## 4. 还没做（下一个会话从这里接）

> 与 [REFERENCE-style-pack-capability.md](../REFERENCE-style-pack-capability.md) §3 的能力缺口表同源。

| 能力 | 覆盖条数 | 代价 | 备注 |
|---|---|---|---|
| 剪纸 / 纸艺层叠（层 + 硬投影 + 撕边） | 20 | 中，约 200 行 | 需要「硬投影」的 Post 或几何方案 |
| 手绘笔迹（可变宽笔 + 逐笔生长） | 17 | 中，约 250 行 | `lineart` + `boil.js` 已占七成 |
| 彩墨 / 水彩湿边 | 12 | 中，约 200 行 GLSL | 只能做「像」，做不到「真」 |
| 像素精灵（调色板量化 + 8–12fps） | 7 | 小 | `post.pixel` + `stickerShot` 已有大部分 |
| 木刻 / 铜版多方向排线 | 5 | 小，约 80 行 | 基于 `engrave` 扩双方向 |

另外三件**不需要新能力、只要接线**的：

- **H/K/Z 65 条**：已拍板**放着**；要落地先向素材包作者要截图（否则是猜配色）。
- **`sodium` 积木 / `bikeshed` 会议室 / 私有 `_kit.js` 抽取**：任务目录被 `.gitignore`
  排除（含真实素材），**本 checkout 没有**，抽不了（BACKLOG 1-49 剩余部分）。
- **`1-30` B-roll（裁切真实视频段）**：仍缺「素材段合成层级」的拍板（ffmpeg 底 vs 引擎图层）。

---

## 5. 刻意没做的

| 没做 | 原因 |
|---|---|
| **不给现有 9 套 H 系风格加 `view`** | 那会让「已经按这套风格排好的片子」整体换介质 —— 属于观感拍板，不是工程判断。新介质由 `h-riso` / `h-vhs` 两套**新增**风格承担 |
| **不做逐词高亮 / karaoke 式划痕**（按帧随机划痕） | 逐帧随机会让「每帧是 t 的纯函数」破功；划痕必须是 t 的慢波哈希 |
| **不在 `scratch` 里做「脏点 / 灰尘」（dust）** | 灰尘是**逐帧变化**的（一帧有、下一帧没），用 t 哈希硬做会变成闪烁噪点，反而不像胶片。要做得先定「静止灰尘 + 偶尔跳」的模型 |
| **不加第 9、10 种成像模式** | 八种已覆盖素材包 B1 那批的绝大多数；加模式要动 `VIEW_NAMES` 顺序（= 着色器整数），风险不值 |

---

## 6. 复现

```sh
# 胶片磨损：四段各开一件
node scripts/anim.mjs still _wear-lab -t 2,6,10,14

# N 版套印：2 版 / 4 版
node scripts/anim.mjs still _view-lab -t 1.5,4.5 --only halftone2,halftone4

# 整片介质：CRT（style.view）
node scripts/anim.mjs still _style-view-lab -t 2.5
node scripts/anim.mjs still _style-sampler -t 2.4 --style h-riso

# 默认 off 的硬证据
node scripts/anim.mjs hashes demo --baseline
node scripts/anim.mjs hashes beat --baseline

# 全量验收
node tools/regress-all.mjs --ci             # 51/51
node tools/test-post-wear.mjs               # 23 项
```

---

## 7. 关联

| 文档 | 讲什么 |
|---|---|
| [HANDOFF-2026-10-30.md](HANDOFF-2026-10-30.md) | 上一轮（图元层 + 介质层第一批：填充面 / 八种成像 / 九套版式风格） |
| [BACKLOG.md](../BACKLOG.md) | 活待办。本轮收账：**1-63** / **1-64** / **1-65**，并记了三条拍板 |
| [COOKBOOK.md](../COOKBOOK.md) | **§16.1** N 版套印、**§16.2** style.view、**§16.3** 胶片磨损 |
| [STYLE.md](../STYLE.md) | **§3.1** 十一套版式风格、**§4** 字段表（新增 `view`）、**§4.2** 整片介质纪律 |
| [ENGINE.md](../ENGINE.md) | **§8** 后处理全表（新增 `weave` / `flicker` / `scratch`）与新的执行顺序 |
| [REFERENCE-style-pack.md](../REFERENCE-style-pack.md) | 素材包的我方使用判据（本轮 17 条磨损 + 18 条套印条目的出处） |

夹具：`tasks/_wear-lab/`、`tasks/_style-view-lab/`（都带 hashes 基线）；`_view-lab` 追加两段。