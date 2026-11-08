# 交付长清单（`docs/DELIVERY.md`）

> `AGENTS.md` §7 / §10 只保留**门**（要跑什么、红了怎么办）；这里放**为什么**、完整命令块、以及每条门的判定细节。
> 下沉时间：2026-11-08（PLAN A2：`AGENTS.md` 从 61.9 KB 压到 ≤ 50 KB，查表内容不进 agent 常驻上下文）。

## 1. 每条交付门的判定细节（对应 `AGENTS.md` §10 的编号）

### §10.1 体检 / 背景守门

`node scripts/anim.mjs check <任务>` 判的是**三点采样**（段内 15% / 50% / 85%）× **单/多子帧两条路径**：

- 过曝（三点平均亮度接近 1）⇒ 报；
- 两条路径不一致（单子帧与多子帧同一时刻差得离谱）⇒ 报；
- **段内亮度不均**（同一段三个点差太多）⇒ 报，通常意味着某处元素只在半个段里存在；
- **交叠段没铺整帧背景** ⇒ 报，底是纯黑且只有 grain（`cut(..., { world: 'auto' })` 能修）；
- 「空档」= 时间线有缝（上一段结束早于下一段开始）。

### §10.2 抽查单帧

```sh
node scripts/anim.mjs still <任务> -t 1.5,6,9.5
node scripts/anim.mjs still <任务> -t 6 --only chart,title   # ⚠ --only 会把这几段**平移到时间轴开头**，此时 -t 是段内时间
```

**必须用 Read 打开 PNG 看**。配置档任务的段名 = 模板名或你写的 `id`。

### §10.4 产物验收

```sh
node scripts/anim.mjs verify <任务>   # 成片抽帧 vs 同 t 重渲，逐像素（拼接错位/帧数/色彩/旧版本一次查完）
node scripts/anim.mjs qa <任务>       # 纯 ffmpeg 读数：解码 / 黑场 / 静帧 / 音量（--strict 才当门）
```

`video` 收尾自己会用 ffprobe 复核产物（帧数不符就删废文件），所以「只渲染了 N/M 帧」是**渲染期写了仓库文件**导致的，不是编码器问题。

### §10.10 版面守门的两个前提

- 判据只在你**声明了主体**之后才跑：场景对象上写 `focus: 'center'` 或 `{ x, y, w, h }`；
- 不声明 ⇒ 进 `skipped`（**没跑 ≠ 通过**）；交付自检加 `--strict` 才把 warn 当门。

### §10.11 数字出处的边界

- 只扫**显示位**：`type.write` 的字符串、`chart` 的 `values`、`codeRow`、模板的 `title`/`sub`/`footer`、旁白与字幕；
- 坐标 / 字号 / 时长 / 阈值 / 颜色分量**不算**数字；
- **算出来的数**（模板串插值 / `.toFixed()` / `values` 里的变量）单列「没验」—— 要么登记口径，要么写占位符 `— figure —`；
- 它**不进退出码**，所以「零命中」只能靠人看输出。

### §10.11.5 / 11.5b 卡点的两种口径

| 片子类型 | 判据 | 命令 |
|---|---|---|
| 有旁白表（`audio/timing.json`） | 切点落在拍的 ±30ms 内（`--strict` 要求 ≥90%） | `check` 的「卡点」行 / `tools/lint-beat-align.mjs` |
| 纯音乐片子（无 `timing.json`） | 段首到**实测拍**的距离 | `tools/lint-cut-beats.mjs <任务> [--bar]` |
| 歌词片 | 句首到**人声起音**（中位 ≤150ms / p90 ≤400ms） | `tools/lint-lyric-sync.mjs <任务>` |

⚠ 拍点对齐只是**下界**：歌词还要对得上人声（有官方 LRC 就用 `audio/lrc-*.json`，别按字数均摊）。

### §10.11.6 事件密度的两个数

读的是**成片**帧间差（`tools/lint-event-density.mjs`）：`最长静止 ≤ 3.5s`、`稀薄窗口 ≤ 25%`（低于均值一半的 2 秒窗口）。
补运动要补**大面积持续运动**（推近 / 扫线 / 逐条落位），2px 游标与 0.09 alpha 的水印检测器和人眼都看不见。

### §10.11.7 提交前钩子

`node tools/install-git-hooks.mjs` 装一次；之后 `git commit` 会对**你改到的任务**跑 `anim report`，判据红就拦住。
绕过用 `--no-verify`。

### §10.12 三轮不过就交人

原文与理由见 [`REFERENCE-video-use.md`](REFERENCE-video-use.md) §3.3。交付前派一个**只挑毛病不夸**的审查者，
交回**按时间码排序的问题清单 + 证据**（哪一秒、哪张图、什么问题）；切点优先看 `anim cuts`。

## 2. 出问题时按这个顺序查（完整命令块）

> 症状 → 原因只有一张表：`AGENTS.md` §8。下面按**从便宜到贵**排。

```sh
# ① 体检（三点采样 + 多子帧 + 背景守门/版面/卡点/事件密度）
node scripts/anim.mjs check <任务> [--quick | --strict]

# ② 画面不对 → 出图看，别猜
node scripts/anim.mjs still <任务> -t …   # 单帧
node scripts/anim.mjs cuts  <任务>        # 切点两侧 ±1.5s 接触表
node scripts/anim.mjs audit <任务>        # 交叠段在交叠期到底画了什么

# ③ 引擎层 / 确定性 / 像素级量具
node scripts/anim.mjs determinism <任务> --from 0 --frames 40   # 跨帧依赖定位（分叉即退出码 1）
node scripts/anim.mjs probe-alpha <任务>    # 整行淡入到底生效没有
node scripts/anim.mjs dumpframe <任务> -t 0.5 --run-up          # 裸帧 + 引擎内部量
node scripts/anim.mjs dumppx <任务> --times 1.5 --out x.raw     # 浏览器那一帧的裸像素
node scripts/anim.mjs probe <任务> --times 4,12   # 渲染顺序会不会改变结果
node scripts/anim.mjs diff <任务> --times 12      # 同一时刻渲两次差多少
node scripts/anim.mjs gpu [<任务>]                # 浮点纹理缺失 = 这台机器不能跑 HDR
node tools/probe-raymarch.mjs / probe-three.mjs / probe-colorspace.mjs / png-rows.mjs
node tools/test-cam-math.mjs / test-say.mjs / test-karaoke.mjs / test-timeline-guard.mjs  # 纯 JS

# ④ 出片之后
node scripts/anim.mjs verify <任务>             # 抽帧 vs 重渲
node scripts/anim.mjs hashes <任务> --baseline  # 变更探测器（变了 ⇒ 对比图 + 退出码 1）
node tools/regress-all.mjs [--only smoke]       # 整份回归（日志 out/_regress/）
node tools/regress-all.mjs --ci                 # CI 那批（unit:/meta:/harness:/say:）
```

> 输出里出现不认识的诊断词 → [`DIAGNOSIS.md`](DIAGNOSIS.md)：三列（输出词 / 含义 / 修法），每条带 `文件:行号` 证据。

## 3. 渲染与导出的长说明（对应 `AGENTS.md` §7）

### 分块渲染的判断粒度

切点只落在段边界、避开转场。**块级判断**（BACKLOG 1-45）：

| 改了什么 | 重渲范围 |
|---|---|
| 只改 `tasks/` 下的场景 | 只重渲它所在那块 |
| 改 `src/core` `src/style` `src/app.js` `src/timeline.js` `public/` | 整批 |
| 改 `src/kit` `src/shots` | 只重渲**真正 import 到它**的块（按 import 图收窄） |
| 渲染参数变了 | 整批 |

> ⚠ 这条管的是**正在渲的那一支**，不是已交付的成片 —— 见 `anim stamp`（`engine-drift` 不需要重渲）。

### 为什么渲染期间一个文件都不能写

CLI 起私有 Vite，文件一改就 HMR 重载 → WebSocket 断流。`watch.ignored` 挡不住编辑器的**原子写**
（会留下 `.xxx.tmpdir/…tmp`，不以 `.md` 结尾），Vite 撞 `EBUSY` 直接崩。唯一被实测挡住的是 `out/**`。

### 出片速度与运动模糊

本机实测 1080p60 / `samples=1`：**7.5 fps**；raymarch 类加 `--gpu high` 再翻倍；传输 NV12（3.11MB/帧）。
运动模糊逐帧自适应：静止帧 8 子帧、普通运镜 24、甩镜/砸字 72 或 216（`--samples 1` 关掉、`--shutter 0.2` 调窄）。
读数与瓶颈见 [`PERF.md`](PERF.md) §5.3–§5.4。

### 4K / 竖屏

`--scale 2` 出真 4K（shader 里别拿物理像素当逻辑像素）；`width: 1080, height: 1920` 即竖屏（引擎自动换栅格 + 字号 ×1.35，
字幕抬到 61%–70% 避开 B 站 UI）。写竖屏前读 [`LAYOUT.md`](LAYOUT.md) §6.5。
