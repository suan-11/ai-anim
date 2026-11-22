# 预览工作台 & 15 种 MG 风格

> 两件事一起记：`npm run dev` 的 dev 页从「播放器」升级成**编辑反馈回路**；
> 并把 <https://github.com/Vincentwei1021/mg-styles-15> 的 15 种风格引入成引擎的风格包。

## 1. 预览工作台（`npm run dev`）

浏览器打开 dev 页，底部是一条工作台：

```
▶ 播放   ⟨ 段   段 ⟩   −1f   +1f   ⟲ 循环   ⦿ 精确帧        t 12.34 / 25.40s · 段 bigtype · 预览 1 子帧
├──────────────┬─────────────────┬──────────────┬──────────────────────────────┤
   hook           counter           bigtype        quote            lockup
```

| 能力 | 说明 |
|---|---|
| **scrub** | 拖时间轴任意位置立刻出帧（不依赖顺序播放） |
| **场景 / 节拍刻线** | 段边界是白线，长段带段名；有音乐时叠拍点细线 |
| **走带** | 播放/暂停、上/下一段、±1 帧、**循环当前段** |
| **精确帧** | 按**导出同一条路径**（`samples:'auto'` 多子帧）重渲当前帧，并报与 1 子帧预览的 **MAE / PSNR** |
| **错误 overlay** | GLSL 编译错误 / 时间线 problems / 空档 直接打在左上 HUD |

快捷键与以前一致：`空格` 播放、`←→` ±1s、`,` `.` 逐帧、`[` `]` 换段、`h` 隐藏 HUD。

### 给 agent 的接口（`window.__anim`）

```js
__anim.preview(t)                 // 单帧（1 子帧）→ { png, samples }
__anim.previewRange(t0, t1, 9, 3) // 9 帧缩略拼图（带时间码）→ dataURL
__anim.precise(t)                 // 精确帧：跑导出路径，返回 { mae, psnr }
```

`previewRange` 是 agent 自检的主力：**一眼看节奏**，比逐帧截图便宜得多。

### 为什么「精确帧 + 差异读数」是核心

预览默认 1 子帧（快），成片是自适应多子帧。这两条路径**必须同源、且差异可量化** ——
否则「预览好看、导出翻车」会毁掉确定性这个卖点。按钮按下就把 MAE/PSNR 打在读数区。

## 2. 15 种 MG 风格包（`src/style/mg15.js`）

对应参考仓库的 15 种风格，键名即 `style: 'mg-…'`。现有 6 套 + 新 15 套 = **21 套**。

| 键 | 参考风格 | 一眼特征 | 骨（还差什么） |
|---|---|---|---|
| `mg-cel` | 01 逐帧手绘·线条沸腾 | 暖纸 + 墨线 + 番茄红，颗粒/轻微模糊 | ✅ **已完成**：`src/kit/boil.js`（引擎级原语，确定性抖动）+ `src/shots/cel.js` |
| `mg-isometric` | 02 等距 2.5D | 浅灰蓝 + 青绿 | ✅ **已完成**：`src/shots/isometric.js`（等距体块，画家算法，纯代码几何） |
| `mg-flat-vector` | 03 扁平矢量 | 纯白 + 饱和橙，无颗粒 | — |
| `mg-lineart` | 04 一笔线稿 | 近白 + 单蓝，细线 | —（`lineart` 模板已有） |
| `mg-soft3d` | 05 3D 渲染 soft | 奶油 + 薄荷 + 大半径泛光 | ⛔ **不做**（材质/光照/角色是 Blender 的赛道，追它必输；刚性的几何走 `isometric` / `makeThreeShot`） |
| `mg-morph` | 06 形状形变 | 深紫 + 强泛光 | —（`morph` 模板已有） |
| `mg-sticker` | 07 贴纸说明 | 奶油白 + 高饱和黄 | 贴纸硬阴影 / 描边层 |
| `mg-hud` | 08 赛博 HUD/FUI | 近黑蓝 + 青 + 色差 | HUD 专用母题（现在借 blueprint） |
| `mg-collage` | 09 拼贴 / 剪纸 | 牛皮纸 + 褐红 + 高颗粒 | **真素材拼贴** |
| `mg-aurora` | 10 极光 + 玻璃 | 深海军 + 冰青 + 超强泛光 | 玻璃模糊层（backdrop blur） |
| `mg-bauhaus` | 11 包豪斯几何 | 米白 + 正红 + 黑体 | 几何构成模板 |
| `mg-vhs` | 12 Synthwave / VHS | 近黑紫 + 品红 + 色差 | 扫描线 / 磁带抖动 |
| `mg-pixel` | 13 像素风 | 深绿 + 荧光绿 + dither | **真像素化**（降分辨率再放大） |
| `mg-liquid` | 14 液体动态 | 深青 + 薄荷 + 大泛光 | ✅ **已完成**：`src/kit/liquid.js`（域扭曲 fbm + 涟漪）+ `src/shots/liquid.js` |
| `mg-variety` | 15 综艺花字 | 高饱和红 + 白字 + 大字 | 花字描边/贴纸层 |

### 曾经的已知问题（2026-10-29 已修）

同一帧用 `--style` 渲两套皮时，**背景色与强调色会串**（实测 `mg-bauhaus` 渲成近黑底、
`mg-vhs` 渲成粉白底）：色板解析是对的（`resolveStyle` 输出正确），问题在渲染期 ——
模板自带的整帧背景 Pass 在构造时把调色板常量注进 shader，而风格覆盖发生在它之后，
Pass 又被按 key 缓存复用，于是第二套皮拿到的还是第一套的颜色。

**修法（已落地）**：`worldPass` 的缓存 key 带上 `paletteFingerprint(P, accent)`，同时引擎层（`GL.palette` → `Pass` 默认调色板注入、`GL.program` 校验 `fragSrc`）与风格包 `post` 基线已清除初始 `pdoom` 默认污染（浅底/冷色风格不再串进黑橙底色、红晕 halation 与重暗角）。复验：
`node scripts/anim.mjs still <任务> -t 3 --style mg-bauhaus` 与 `--style mg-vhs` 各出一张，
底色应该一眼不同。**这份文档的「还没做」只以 §下表为准** —— 表里标 ✅ 的都已有实现。
