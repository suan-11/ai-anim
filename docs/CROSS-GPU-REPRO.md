# R5 跨 GPU / 驱动环境复现对照指南

本指南说明如何在基准机（Machine A）打包固定帧与代表性草稿对照包，并在第二台机器（Machine B，不同 GPU / 驱动 / ANGLE 后端）一键复跑对比、回传验收结果。

## 1. 对照包覆盖范围

工具入口为 `tools/cross-gpu-repro.mjs`，默认对照包目录为 `out/_remotion-migration/acceptance/cross-gpu-bundle/`（已 gitignore，可整体拷贝或压缩传输至 Machine B）。

覆盖 3 条 Remotion 渲染路径（共 5 组固定帧用例 + 3 支代表性草稿 MP4）：

1. **Native（`example-config-only` / `ExampleConfigOnly`）**
   - 固定帧：`[60, 209, 210, 474, 684, 708, 739, 810]`（覆盖切点与 R1 `outro` `11.40s / 11.80s / 12.32s`）。
   - 草稿：`example-config-only-draft`（`960x540`、`60fps`、`834` 帧、`13.90s`，无音轨）。
2. **Complex Bridge（`paperfold` / `PaperfoldBridgeMB`）**
   - `samples=1` 固定帧序列：`[48, 200, 204, 228, 384, 204, 48]`（含跨交叠窗与乱序重复帧 `204, 48` 同会话确定性校验）。
   - `samples=4` 固定帧序列：`[48, 200, 204, 228, 384]`（多子帧运动模糊）。
   - 草稿：`paperfold-overlap-draft`（`8.0s–9.5s`、`--draft --samples 1 --noaudio`，`960x540`、`24fps`、`36` 帧、无音轨；因 R2 真实 `paperfold-vo.mp3` / `paperfold-mix.mp3` 仍缺失，本用例始终固定 `--noaudio` 仅验视觉路径）。
3. **Three.js Bridge（`_three-lab` / `Task-three-lab`）**
   - `samples=1` 与 `samples=4` 固定帧序列：`[120, 339, 450, 537, 720, 339, 120]`（含 `InstancedMesh`、线框快门平均与乱序重复帧 `339, 120` 校验）。
   - 草稿：`three-lab-draft`（`960x540`、`60fps`、`876` 帧、`14.60s`，无音轨）。

## 2. 在 Machine A 生成基线与自检

在工作区根目录执行（Windows 下脚本会自动设置工作区内 `TEMP` / `TMP` 到 `out/_remotion-migration/acceptance/tmp`）：

```sh
node tools/cross-gpu-repro.mjs --init-baseline
```

产物位于 `out/_remotion-migration/acceptance/cross-gpu-bundle/`：
- `manifest.json`（`cross-gpu-bundle/1`，含 Machine A 环境快照、各帧 SHA-256、各 MP4 流规格与相对路径）
- `README.md`（Machine B 随包快速说明）
- `baseline/frames/<caseId>/f_<frame>.png`
- `baseline/videos/<videoId>.mp4`

随后在同一机器跑一次隔离自检（结果写入 `runs/<run-id>/`，绝不修改 `baseline/` 或 `manifest.json`）：

```sh
node tools/cross-gpu-repro.mjs
```

## 3. 在 Machine B 一键复跑与回传

1. **准备环境**：
   - 检出与 Machine A 相同的仓库提交并执行 `npm install`。
   - 确认本机已有可用 Chrome / Edge 与 `ffmpeg` / `ffprobe`（Windows 若不在系统 `PATH` 中，可设置 `ANIM_FFMPEG` 与 `ANIM_FFPROBE`）。
2. **放入对照包**：
   - 将 Machine A 的 `cross-gpu-bundle/` 目录拷贝到 Machine B 仓库的 `out/_remotion-migration/acceptance/cross-gpu-bundle/`（或放任意目录并通过 `--bundle <路径>` 指定）。
3. **执行复跑**：
   ```sh
   node tools/cross-gpu-repro.mjs
   ```
   常用选项：
   - `--skip-video`：只跑固定帧 PNG 对照，跳过代表性草稿 MP4 渲染（视频条目在报告中记为 `SKIPPED`）。
   - `--out-dir <目录>`：指定独立输出目录（脚本会显式拒绝指向 `baseline/` 或对照包根目录）。
   - `--verify-only --out-dir <已有运行目录>`：不重渲，仅对已有产物重算像素与流规格对比。
4. **回传文件**：
   - 将生成的 `runs/<run-id>/repro-report.json` 与 `runs/<run-id>/repro-report.md` 回传即可；当前尚未回传前，验收总表将该项标记为 **待第二环境回传**。

## 4. 判定规则与容差说明

- **为什么不能只看跨机 SHA-256**：不同 GPU / ANGLE / 驱动（如 AMD D3D11 vs NVIDIA / Intel / SwiftShader）在纹理采样、抗锯齿或字体光栅化上可能出现 1–2 个色阶的四舍五入差异。跨机 SHA-256 不同**不直接判失败**。
- **两层真正判据**：
  1. **同会话乱序同帧确定性**：Machine B 同一会话内重复渲染的同一帧（`paperfold` `204, 48`；`_three-lab` `339, 120`）必须 **SHA-256 逐字节完全一致**。
  2. **跨驱动像素与媒体规格容差**：
     - 固定帧 PNG：若 SHA-256 一致为 `exact`；否则要求 RGBA 平均绝对差 `mean <= 3.0` 且单通道差值 `> 8` 的像素占比 `<= 2.0%`（可用 `--tol` / `--png-mean-tol` / `--png-over-tol` 调整）。
     - 草稿 MP4：要求 `ffprobe` 宽/高/fps/总帧数/时长/音轨数/编码器一致，且抽取的关键帧 RGBA `mean <= 6.0`、`d > 16` 占比 `<= 5.0%`（可用 `--video-mean-tol` / `--video-over16-tol` 调整）。
