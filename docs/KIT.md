# 镜头工具全表（docs/KIT.md）

> 从 `AGENTS.md` §3.5 下沉（2026-11-08，PLAN A2）。§3.5 只留最常用的 7 条 + `makeShot` 示例。

> ⚠ 这张表里**写错不报错**最多的三条：`fillSector` 的角度方向（0=右、π/2=**下**）、
> `instrumented` 必须最后一步、`paperStack` 的撕边幅度（边长 × 1.5–3%，12px 在 2000px 的纸上就是直线）。

| 想要 | 用什么 |
|---|---|
| 完整镜头的骨架 | `makeShot(id, { setup, draw, post })` |
| **信息段的骨架**（标题/面板底/侧标注/出处/页脚/错峰全包，只写 `draw(ctx, rect)`） | `infoShot(id, { title, kicker, caption, source, draw })`（`src/kit/info.js`；版面与 focus 声明由骨架承担） |
| **Three.js 镜头**（真网格） | `makeThreeShot(id, { camera, setup, update, overlay, post })`（§5.5 ③ / `docs/THREE.md`） |
| 现成的整镜头（画面本身） | `shot('chart', { values: [...], title: '…' })`（`src/shots/`，也可直接写进时间线） |
| **动图表情包** | `stickerShot(id, { frame: (i) => url, count })`（`src/kit/sticker.js`）。⚠ **别直接播 GIF**：先 `ffmpeg -vf "fps=12,scale=320:-1"` 抽成 PNG 序列、按 `floor(lt*fps)%n` 取帧（`render(t)` 必须是 t 的纯函数）；`comp.draw` **没有旋转** |
| 只要背景 + 转场 | `makeWorldKit(ctx)` → `wk.openFrame(ctx)` |
| 按锚点写整行字 | `type.writeLine(text, x, y, { anchor })` ≡ `type.write(…, { align })`（`align` 自 2026-10-24 是整行对齐） |
| 整行淡入 | `fade(f.lt, delay)` → `{ alpha: [0,1], t, staggerDur }` |
| 面板 / 眉标 / 页脚 / 准星 / 标记 | `panel` `kicker` `footer` `reticle` `marker` |
| 填充矩形（一条批） | `lines.fillRect(x, y, w, h, [r,g,b,a])` |
| **填充面**（圆 / 多边形 / 扇环 / 带洞） | `lines.fillCircle` · `fillPoly(pts)` · `fillPoly([outer, inner])`（带洞）· `fillSector(cx,cy,r0,r1,a0,a1)`。⚠ 角度 0=右、π/2=**下**；先填充后描边（`COOKBOOK` §17）。**别为了「更平滑」把 `step` 压到 0.25** —— 竖向平滑由多子帧亚像素抖动负责（`ENGINE` §11.6），压小只换来一堆条数 |
| **换成像方式**（半调 / 字符画 / 1-bit / 热成像 / CRT / 雕版 / **多方向排线**） | `instrumented(ctx, { mode, cell }, (target) => {…})`（`src/kit/views.js`）。⚠ 整帧（含文字）先画进离屏目标再换，且必须最后一步（`COOKBOOK` §16）。**要真「刻痕」用 `woodcut`**（按明暗加方向；`engrave` 只有一个方向）—— 它的 `cell` 有 **22px 下限**，低于会被夹住并写 warning（§16.4） |
| **像素风**（调色板 / 块栅格 / 抖动 / 12fps 台阶） | `paletteOf` `pixelText` `drawSprite` `pixelGradient` `snapTime`（`src/kit/pixel.js`），整镜头用 `shot('pixel', {…})`。⚠ 三条写错不报错：抖动阈值按**块**坐标取；精灵 / 像素字落在整块上；台阶用 `f.t` 不用 `f.lt`（`COOKBOOK` §19） |
| **手绘笔迹** | `strokePath` / `strokeArc` / `inkOn`（`src/kit/stroke.js`），整镜头用 `shot('handwrite', {…})`。⚠ 轮廓法在**曲率半径 < 半宽**处必然自交（偶奇规则填成针孔）—— `drawStroke` 的 auto 会自动退到胶囊链；笔迹**不许半透明**（要用 `inkOn(P.c, 0.9, paper)`，§20.1） |
| **相机接力**（段间镜头飞过去、内容换手） | 时间线写 `transition: 'relay'`；camera3 场景 `camera3({ ...relayPose3(ctx, home), H })` 一行接入（写之前读 `docs/ENGINE.md` §3.7.7） |
| **零状态 GPU 粒子** | `makeParticles(ctx, { count, preset: 'sparks'|'orbit'|'drift' })`（`src/kit/particles.js`，1-14）。位置 = f(index, t) 的纯函数，无 CPU 上传；加法混合（信号色发光那档）。⚠ 不参与引擎亚像素抖动；预设名写错当场抛 |
| **整片换介质**（默认 off） | 风格包字段 `view: 'halftone'` 或 `{ mode, cell, passes, misreg }`（写错当场抛）；`passes: 2..4` = N 版套印，整片生效、字幕仍清晰（`COOKBOOK` §16.1–16.2） |
| **像「胶片放出来的」** | `return { weave: 0.5, flicker: 0.25, scratch: 0.2 }`（默认全 0 = 逐像素不变，全由 `t` 驱动；`COOKBOOK` §16.3） |
| **剪纸 / 纸艺层叠** | `paperShape({x,y,w,h,seed})` → `paperStack(lines, layers, { pan, parallax })`（`src/kit/paper.js`）。⚠ 三条**出图才看得见**的比例：撕边幅度 = **边长 × 1.5–3%**（12px 在 2000px 的纸上就是直线）；白芯只浅 **7%**（35% ⇒ 雪白高光带）；投影**不透明**（半透明会在扫描行之间出条纹）。撕边在 `setup` 里算一次（只吃 seed，不吃 t）。见 `docs/MOTION.md` §3.7 |
| "代码行"排版（分段着色、等宽） | `codeRow(type, [{ s: 'GET ', c: css(P.ash) }, { s: '/v1/items', c: css(P.signal) }], x, y)` |
| **带回弹的落位**（不用自己积分） | `spring(f.lt - t0)` → 0→1，指数弹簧解析解（`src/core/util.js`；更弹 `spring(dt, 1, 140, 12)`） |
| 有机漂移 / 呼吸 / 不规则抖动 | `noise1/2/3`、`fbm1/fbm2`（确定性） |
| 半透明 / 提亮到发光 | `withAlpha(P.signal, 0.18)`（`lines` 第 4 分量）、`mul(P.bone, 1.6)`（>1 才泛光） |
| 全片摄影机的方向 / 数值 | `cameraAt(t)` / `cameraDir(t)`（`kit/world.js`；`cameraPost(t, extra)`） |
