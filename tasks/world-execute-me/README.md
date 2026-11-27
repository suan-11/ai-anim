# world.execute(me); — MV 任务

Mili《world.execute(me);》。**代码美学 · 程序之爱**：暗底终端 + 几何变形 + 故障美学，
歌词关键词作为画面元素冲出，不烧字幕。

| 项 | 值 |
|---|---|
| 时长 | 207.5s（24fps / 4980 帧） |
| 段数 | 9（hook / verse1 / chorus1 / verse2 / chorus2 / bridge / breakdown / chorus3 / close） |
| 底色 | `#1d2633` 终端屏 + 网格 48 + 扫描线 |
| 强调色 | signal 红 `#ff3344` 只给 EXECUTION 与 LOVE |

## ⚠ 原曲不入仓库

`audio/track.mp3` 是 Mili 的原曲，版权属原作者/唱片方，**已从 git 历史中剥离并写进 `.gitignore`**。
要在本地出片，先自行取得该文件并放回：

```
tasks/world-execute-me/audio/track.mp3
```

没有它时：Remotion 的 `WemBridge` / `WemBridgeMB` 仍可渲染画面（不挂 `<Audio>`，音轨由 CLI
用 `--muted` + ffmpeg 单独封装）；旧引擎的 `anim video world-execute-me` 会在缺音轨时报错，
`anim still` / `check` 不受影响。

`audio/track.analysis.json`（拍号 / 包络）是**本仓库自己的产物**，随仓库分发，缺原曲也能跑场景。

## 相关文档

- `brief.mjs` — 分镜与峰值时刻
- `lyrics.json` — 逐句时间戳（真实 LRC + 词级校准）
- `rhythm.json` — 40 块节奏表
- `HANDOVER.md` — 这一支的交接说明
