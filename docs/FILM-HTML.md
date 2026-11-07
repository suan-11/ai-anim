# 单文件播放器：`anim film-html`

> 来源：[openfilm/openfilm](https://github.com/openfilm/openfilm) 的核心主张 ——
> **「一个 HTML 文件就是一支片子」**：agent 写片、本地就能播、发给谁都能播。
> 我们这边原本只有 `out/<任务>/<任务>.mp4`（要编码、要大文件）和 `npm run dev`（要 Vite）。

## 用法

```sh
node scripts/anim.mjs film-html <任务>                 # → out/<任务>/film.html
node scripts/anim.mjs film-html <任务> --no-audio      # 不带音轨（文件更小）
node scripts/anim.mjs film-html <任务> --max-audio 8   # 内联音轨上限（MB，默认 20）
node tools/probe-film-html.mjs out/<任务>/film.html    # 量具：能不能播、是不是在动
```

产物是**一个自包含 HTML**：引擎、场景、时间线、音轨（base64）全在里面，
双击即在浏览器播放 —— 不需要 Node、不需要 Vite、不需要联网。

播放器操作：`空格` 播放/暂停 · `←→` 逐帧 ·  拖进度条 · **`P` 截当前帧**（评审时指出哪一秒有问题不用录屏）。

## 为什么它是可信的

播放器和成片走**同一条渲染路径**：

```js
engine.render(t, { preview: true, toScreen: true, samples: 1 });
```

而 `render(t)` 是 `t` 的纯函数（`docs/ENGINE.md` §0）。所以拖进度条、暂停、逐帧都不会和预览不一致 ——
唯一的差别是成片每个时间点用多子帧求平均（真运动模糊），播放器用 1 帧（实时）。

## 量具（`tools/probe-film-html.mjs`）

| 判据 | 为什么必须有 |
|---|---|
| 页面无 `pageerror` / `console.error` | 单文件最容易死在「打包后某个 import 找不到」 |
| `window.__film.total > 0` | 时间线没建起来时 total 是 0，页面看着正常但什么都不画 |
| 5 个时刻各截一张图，都不是纯黑/纯白 | 「能加载」≠「在画」 |
| `t` 与 `t + 1/60` 两帧不同 | 防止打包后时间被冻结成一张静帧 |

实测（KING PV，135s）：`total 134.94s · 5 个时刻都有画面 · 逐帧在动 · 7.3 MB（内联 5.1 MB 音轨）`。

## 它和 `video` 的分工

| 要什么 | 用哪个 |
|---|---|
| 上传 B站 / 剪进别的片子 | `anim video`（H.264 mp4，音画对齐，逐块复核） |
| 发给人看 / 嵌网页 / 评审 | `anim film-html`（一个文件，浏览器里实时播） |
| 审节奏（改起来快） | `anim video --draft`（960×540 + samples=1） |

## 没从 OpenFilm 拿的部分（以及为什么）

- **Studio 的元素拖拽编辑**（在页面里点一个元素改文字/颜色/位置）：我们的场景是**即时模式**画布，
  没有「元素」这层对象模型，要做就得先把渲染改成保留模式 —— 那是换地基，不是加功能。
  我们保留了工作台的**参数面板 + 精确帧 + 拖动快路径**这条「改代码 → 立刻看图」的回路。
- **真实视频轨（带裁剪/裁切）**：`<video>` 逐帧 seek + drawImage 在浏览器里可以做，但**不保证确定性**
  （不同浏览器解码抖动），会把「成片逐像素 = 预览」这条契约打破。要做需要先设计量具。
- **`npx skills add` 的安装流程**：我们按同一套 skill 目录格式补了 `skills/ai-anim/SKILL.md`，
  但引擎靠本仓库跑（`npm install` + `node scripts/anim.mjs`），不打包成 npm 包发布。
