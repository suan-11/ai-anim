// @ts-check
/**
 * `src/style/mg15.js` —— 15 种 MG 风格包，对应参考仓库
 * https://github.com/Vincentwei1021/mg-styles-15 （15 支 10 秒片，各一种动态设计风格）。
 *
 * 这一层能做的是：色板 / 字体 / 后处理基线 / 版面栅格 / 字幕样式 / 字号阶梯。
 * 背景母题仍用引擎现有的 6 个（grid / blueprint / paper / scan / noir / flat）。
 * 真正的骨（cel 线沸腾、等距、3D 渲染、拼贴、液体）需要新 Pass 或模板，
 * 记在 docs/STYLE-mg15.md 的「还差什么」里，不在这里假装做到。
 *
 * 用法： export default { style: 'mg-flat-vector', ... }
 */

const SONG = "'Songti SC', 'SimSun', 'Noto Serif SC', Georgia, serif";
const ENG = "'Bahnschrift', 'Segoe UI', 'Noto Sans SC', 'Microsoft YaHei', system-ui, sans-serif";
const UI = "'Segoe UI', 'Helvetica Neue', Arial, 'Microsoft YaHei', system-ui, sans-serif";
const MONO = "Consolas, 'Sarasa Mono SC', 'Courier New', monospace";
const SERIF = "'Cormorant Garamond', 'Noto Serif SC', 'Songti SC', serif";
const GEORGIA = "Georgia, 'Times New Roman', 'Songti SC', 'SimSun', 'Noto Serif SC', serif";

/** 字幕基线（与 src/style/index.js 的 CAPTIONS_BASE 同口径的最小集合） */
const CAPTIONS_BASE = { size: 42, weight: 500, bg: 0.24 };

const GRID = (o = {}) => ({ pad: 120, top: 92, footerLineY: 976, footerY: 1018, captionLineY: 930, captionY: 964, contentBottom: 900, ...o });

export const MG15 = {
  'mg-cel': {
    label: '逐帧手绘 · 线条沸腾',
    note: '暖纸底 + 墨线 + 番茄红，颗粒与轻微模糊模拟手绘；真线条沸腾要新 Pass。',
    palette: { ink: '#f4e7d0', ink2: '#efe0c6', graphite: '#7a6a55', ash: '#9c8b74', bone: '#1d1a16', signal: '#e63946', ember: '#f4a261' },
    fonts: { sans: SONG, serif: GEORGIA, mono: MONO },
    post: { bloom: 0.08, halation: 0, grain: 0.055, vignette: 0.14, ca: 0, shoulder: 0.96, contrast: 1.05, saturation: 1.05 },
    motif: 'paper',
    grid: GRID({ pad: 132 }),
    captions: { ...CAPTIONS_BASE, size: 42, bg: 0 },
    tokens: { type: { hero: 148 }, weight: { hero: 900 } },
  },
  'mg-isometric': {
    label: '等距 2.5D',
    note: '浅灰蓝底 + 青绿信号；栅格母题最接近等距网格，真体块要新模板。',
    palette: { ink: '#eef2f6', ink2: '#e3e9f0', graphite: '#8d9aab', ash: '#6b7a8d', bone: '#1b2733', signal: '#12b0a0' },
    fonts: { sans: ENG, mono: MONO },
    post: { bloom: 0.08, halation: 0, grain: 0.008, vignette: 0.10, ca: 0, shoulder: 0.97, contrast: 1.06 },
    motif: 'grid',
    grid: GRID(),
    captions: { ...CAPTIONS_BASE, size: 42, bg: 0 },
    tokens: {},
  },
  'mg-flat-vector': {
    label: '扁平矢量',
    note: '纯白底 + 饱和橙 + 无颗粒，最像广告海报的一套；适合一句话主张。',
    palette: { ink: '#ffffff', ink2: '#f6f6f6', graphite: '#b9b9b9', ash: '#6b6b6b', bone: '#111111', signal: '#ff6a2c' },
    fonts: { sans: UI, mono: MONO },
    post: { bloom: 0.04, halation: 0, grain: 0, vignette: 0, ca: 0, shoulder: 0.99, contrast: 1.06, saturation: 1.12 },
    motif: 'flat',
    grid: GRID({ pad: 140 }),
    captions: { ...CAPTIONS_BASE, size: 44, bg: 0 },
    tokens: { type: { hero: 152 } },
  },
  'mg-lineart': {
    label: '一笔线稿',
    note: '近白底 + 单一蓝，线条是唯一主体；适合流程 / 路径 / 生长。',
    palette: { ink: '#fbfbfd', ink2: '#f2f3f7', graphite: '#b6bccb', ash: '#5f6b82', bone: '#101828', signal: '#1f6feb' },
    fonts: { sans: UI, mono: MONO },
    post: { bloom: 0.04, halation: 0, grain: 0.006, vignette: 0.04, ca: 0, shoulder: 0.98, contrast: 1.08, saturation: 0.95 },
    motif: 'flat',
    grid: GRID({ pad: 150 }),
    captions: { ...CAPTIONS_BASE, size: 42, bg: 0 },
    tokens: { rule: { hair: 1, body: 3, hero: 7 } },
  },
  'mg-soft3d': {
    label: '3D 渲染 · soft',
    note: '奶油底 + 薄荷信号 + 大半径泛光晕染，最像产品动画的一套；真 3D 要 Blender/Three 模板。',
    palette: { ink: '#f7f3ec', ink2: '#efe9df', graphite: '#c9c1b4', ash: '#8a8175', bone: '#2b2620', signal: '#7fd1c1' },
    fonts: { sans: UI, serif: GEORGIA, mono: MONO },
    post: { bloom: 0.14, bloomRadius: 1.4, halation: 0, grain: 0.006, vignette: 0.14, ca: 0, shoulder: 0.97 },
    motif: 'paper',
    grid: GRID({ pad: 136 }),
    captions: { ...CAPTIONS_BASE, size: 42, bg: 0 },
    tokens: { type: { hero: 142 } },
  },
  'mg-morph': {
    label: '形状形变',
    note: '深紫底 + 紫信号 + 强泛光；morph 模板在这套皮上最像。',
    palette: { ink: '#120c1e', ink2: '#1a1229', graphite: '#4a3d63', ash: '#9a8fb5', bone: '#f3efff', signal: '#a86bff' },
    fonts: { sans: UI, mono: MONO },
    post: { bloom: 0.55, halation: 0, grain: 0.008, vignette: 0.42, ca: 0, shoulder: 0.92 },
    motif: 'noir',
    grid: GRID(),
    captions: { ...CAPTIONS_BASE, size: 42, bg: 0.3 },
    tokens: {},
  },
  'mg-sticker': {
    label: '贴纸说明',
    note: '奶油白底 + 高饱和黄；颗粒略高，像贴纸叠在纸上。',
    palette: { ink: '#fffdf5', ink2: '#f7f0dc', graphite: '#c9bfa2', ash: '#8a8064', bone: '#231f16', signal: '#ffd23f' },
    fonts: { sans: ENG, mono: MONO },
    post: { bloom: 0.06, halation: 0, grain: 0.012, vignette: 0.06, ca: 0, shoulder: 0.98, saturation: 1.15, contrast: 1.05 },
    motif: 'paper',
    grid: GRID({ pad: 124 }),
    captions: { ...CAPTIONS_BASE, size: 44, bg: 0 },
    tokens: { weight: { hero: 900 }, type: { hero: 150 } },
  },
  'mg-hud': {
    label: '赛博 HUD / FUI',
    note: '近黑蓝底 + 青信号 + 色差与强泛光；blueprint 母题当 HUD 网格用。',
    palette: { ink: '#04070d', ink2: '#0a1018', graphite: '#22303f', ash: '#7f95ad', bone: '#dff3ff', signal: '#00e5ff' },
    fonts: { sans: ENG, mono: MONO },
    post: { bloom: 0.55, halation: 0, ca: 0.05, grain: 0.025, vignette: 0.35, shoulder: 0.92, contrast: 1.10, tint: [0.88, 1.0, 1.12] },
    motif: 'blueprint',
    grid: GRID({ pad: 104, top: 84 }),
    captions: { ...CAPTIONS_BASE, size: 40, bg: 0.35 },
    tokens: { type: { label: 20, mono: 20 } },
  },
  'mg-collage': {
    label: '拼贴 / 剪纸',
    note: '牛皮纸底 + 褐红信号 + 高颗粒与暗角；真拼贴要真素材。',
    palette: { ink: '#efe6d6', ink2: '#e6dbc7', graphite: '#b3a48c', ash: '#7d6f59', bone: '#221d16', signal: '#c8553d' },
    fonts: { sans: SONG, serif: SERIF, mono: MONO },
    post: { bloom: 0.06, halation: 0, grain: 0.045, vignette: 0.16, ca: 0, shoulder: 0.96, saturation: 0.94, contrast: 1.05 },
    motif: 'paper',
    grid: GRID({ pad: 146 }),
    captions: { ...CAPTIONS_BASE, size: 42, bg: 0 },
    tokens: { weight: { hero: 800 } },
  },
  'mg-aurora': {
    label: '极光 · 玻璃拟态',
    note: '深海军底 + 冰青信号 + 大半径泛光；最像发布会的一套。',
    palette: { ink: '#060b18', ink2: '#0b1424', graphite: '#1b2b45', ash: '#8aa6c8', bone: '#eaf4ff', signal: '#4be1ff' },
    fonts: { sans: UI, mono: MONO },
    post: { bloom: 0.75, bloomRadius: 1.6, halation: 0, grain: 0.01, vignette: 0.30, ca: 0, shoulder: 0.92, saturation: 1.1 },
    motif: 'noir',
    grid: GRID(),
    captions: { ...CAPTIONS_BASE, size: 42, bg: 0.28 },
    tokens: { type: { hero: 146 } },
  },
  'mg-bauhaus': {
    label: '包豪斯几何',
    note: '米白底 + 正红 + 黑体，颜色只有三块；对比拉高、颗粒几乎为零。',
    palette: { ink: '#f2ece1', ink2: '#e8e0d1', graphite: '#b8ae9c', ash: '#5e564a', bone: '#161412', signal: '#e03c1f' },
    fonts: { sans: ENG, mono: MONO },
    post: { bloom: 0.05, halation: 0, grain: 0.004, vignette: 0.05, ca: 0, shoulder: 0.98, contrast: 1.10, saturation: 1.05 },
    motif: 'flat',
    grid: GRID({ pad: 150, top: 104 }),
    captions: { ...CAPTIONS_BASE, size: 42, bg: 0 },
    tokens: { type: { hero: 160, h1: 108 }, weight: { hero: 900 } },
  },
  'mg-vhs': {
    label: '80s Synthwave / VHS',
    note: '近黑紫底 + 品红信号 + 色差与扫描感；grid 母题压暗后像霓虹透视网。',
    palette: { ink: '#0a0512', ink2: '#150a26', graphite: '#3a1f5e', ash: '#b28ad6', bone: '#ffe9fb', signal: '#ff2d94' },
    fonts: { sans: UI, mono: MONO },
    post: { ca: 0.06, grain: 0.055, vignette: 0.42, shoulder: 0.90, saturation: 1.25, contrast: 1.1, bloom: 0.7, halation: 0.25 },
    motif: 'grid',
    grid: GRID(),
    captions: { ...CAPTIONS_BASE, size: 42, bg: 0.3 },
    tokens: { weight: { hero: 900 }, type: { hero: 150 } },
  },
  'mg-pixel': {
    label: '像素风',
    note: '深绿底 + 荧光绿信号 + 抖动模拟调色板限制；真像素化要降分辨率再放大。',
    palette: { ink: '#0b1410', ink2: '#10201a', graphite: '#28453a', ash: '#7fb99c', bone: '#d9ffe8', signal: '#8be04e' },
    fonts: { sans: MONO, serif: MONO, mono: MONO },
    post: { pixel: 6, dither: 'off', bloom: 0, halation: 0, grain: 0, vignette: 0.12, ca: 0, shoulder: 0.95, saturation: 1.20, contrast: 1.10 },
    motif: 'scan',
    grid: GRID({ pad: 96, top: 80 }),
    captions: { ...CAPTIONS_BASE, size: 38, bg: 0.3 },
    tokens: { type: { label: 20, mono: 20 } },
  },
  'mg-liquid': {
    label: '液体动态',
    note: '深青底 + 薄荷信号 + 大半径泛光；morph / radial 在这套皮上最像流体。',
    palette: { ink: '#04110f', ink2: '#08201c', graphite: '#155a4e', ash: '#7fd6c4', bone: '#e6fff9', signal: '#00c2a8' },
    fonts: { sans: UI, mono: MONO },
    post: { bloom: 0.65, bloomRadius: 1.4, halation: 0, grain: 0.012, vignette: 0.28, ca: 0, shoulder: 0.92, saturation: 1.1 },
    motif: 'scan',
    grid: GRID(),
    captions: { ...CAPTIONS_BASE, size: 42, bg: 0.3 },
    tokens: { type: { hero: 148 } },
  },
  'mg-variety': {
    label: '综艺花字 · 竖屏友好',
    note: '高饱和红 + 白字 + 强对比，字最大、留白最小；竖屏短视频的主力皮。',
    palette: { ink: '#141018', ink2: '#1e1822', graphite: '#4d4256', ash: '#c2b6cf', bone: '#ffffff', signal: '#ff3b5c' },
    fonts: { sans: ENG, mono: MONO },
    post: { bloom: 0.25, halation: 0, grain: 0.015, vignette: 0.22, ca: 0, shoulder: 0.94, saturation: 1.25, contrast: 1.10 },
    motif: 'noir',
    grid: GRID({ pad: 96, top: 80 }),
    captions: { ...CAPTIONS_BASE, size: 46, bg: 0.4 },
    tokens: { type: { hero: 170, h1: 120 }, weight: { hero: 900 } },
  },
};
