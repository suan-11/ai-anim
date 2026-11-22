// @ts-check
/**
 * 版式风格包 —— 从**风格素材包**的 H 系列（12 套「配色 + 字体」整套搭配）转译而来。
 *
 * 素材包原文只给了一句话的配方（底色 / 强调色 / 标题字族 / 点缀），
 * 这里把它换成引擎的字段：`palette` / `fonts` / `post` / `motif` / `grid` / `captions` / `tokens`。
 *
 * ## 为什么值得进引擎（而不是某个任务的私有配置）
 *
 * 现有 21 套里，**浅底纸面只有 paper 一套**（米白 + 宋体）。散文 / 杂志 / 说明类内容一旦
 * 连续做两支，就一定会撞脸。H 系列补的正是这一格：暖羊皮纸、奶油糖果色、钴蓝网格、
 * 工业报纸 —— 它们都是「浅底 + 一两个强调色 + 一套衬线/无衬线」的组合，代价只有 20 行一套。
 *
 * ## 三条纪律（与 `src/style/index.js` 其余部分一致）
 *
 * 1. **风格包按视觉效果优先迭代** —— 需要优化观感时直接改进 `print` 与既有风格；
 * 2. **每套必须一眼看得出不同**：底色明暗、字体介质、背景母题至少差两项；
 * 3. **字体栈只挑本机真的有的**（缺了按顺序回退，不会报错 —— 但两套就会长得一样）。
 *    Windows 上确定存在且差异明显的：宋体 / 楷体 / 黑体 / Bahnschrift / Georgia / Consolas。
 *
 * 素材包出处与许可见 `docs/REFERENCE-style-pack.md`（**代码与素材无关，只借配色与版式思路**）。
 */

const SONG = "'Songti SC', 'SimSun', 'Noto Serif SC', Georgia, serif";
const ENG = "'Bahnschrift', 'Segoe UI', 'Noto Sans SC', 'Microsoft YaHei', system-ui, sans-serif";
const UI = "'Segoe UI', 'Helvetica Neue', Arial, 'Microsoft YaHei', system-ui, sans-serif";
const GEORGIA = "Georgia, 'Times New Roman', 'Songti SC', 'SimSun', 'Noto Serif SC', serif";
const MONO = "Consolas, 'Sarasa Mono SC', 'Courier New', monospace";

/** 字幕基线（与其余风格包同一份，见 src/style/index.js 的 CAPTIONS_BASE） */
const CAPS = { size: 44, weight: 500, bg: 0.16, dim: 0.5 };

/** 版面栅格（1920×1080 基准；只覆盖与基准不同的项） */
const G = (o = {}) => ({ pad: 132, top: 96, ...o });

export const PANELS = {
  /* ---------------------------------------------------------------- 暖羊皮纸 + 太阳黄 */
  'h-biennale': {
    label: '版式 · 双年展黄',
    note: '暖羊皮纸底 + 太阳黄光晕 + 衬线大标题 + 靛蓝墨色。适合展览 / 文化 / 年度回顾这类'
      + '「要体面」的内容 —— 它比 paper 更暖、更有印刷品的重量。',
    palette: {
      ink: '#f2e7cf', ink2: '#e9dcc0', graphite: '#c2b191', ash: '#8a7a5e',
      bone: '#20263f', signal: '#e8a33d', ember: '#f2c14e', blood: '#7a4a12',
      acid: '#2f6f5a', cyan: '#2b4a7a',
    },
    fonts: { sans: SONG, serif: SONG, mono: MONO },
    // 浅底最怕泛光：bloom 压到 0.1 以下，颗粒给足（纸的质感全靠它）
    post: { bloom: 0.09, halation: 0, grain: 0.05, vignette: 0.12, ca: 0, contrast: 1.04, shoulder: 0.96 },
    motif: 'paper',
    grid: G({ pad: 140 }),
    captions: { ...CAPS, size: 46, bg: 0.0 },
    tokens: { type: { hero: 132, h1: 92, h2: 54, body: 42, label: 26 }, weight: { hero: 700 } },
  },

  /* ---------------------------------------------------------------- 新粗野主义 */
  'h-blockframe': {
    label: '版式 · 粗黑框',
    note: '新粗野主义：粗黑边框、硬投影、糖果色点缀。适合「有态度」的说明段 —— '
      + '它靠边框和硬投影撑版面，不靠泛光。',
    palette: {
      ink: '#f7f4ec', ink2: '#efeade', graphite: '#1a1a1a', ash: '#5a5a5a',
      bone: '#111111', signal: '#ff5a36', ember: '#ffd23f', blood: '#111111',
      acid: '#2ec4b6', cyan: '#3a86ff',
    },
    fonts: { sans: ENG, serif: GEORGIA, mono: MONO },
    post: { bloom: 0.10, halation: 0, grain: 0.018, vignette: 0.06, ca: 0, contrast: 1.12, shoulder: 0.98 },
    motif: 'flat',
    grid: G({ pad: 128 }),
    captions: { ...CAPS, size: 44, bg: 0.0 },
    tokens: { type: { hero: 148, h1: 96 }, weight: { hero: 900 } },
  },

  /* ---------------------------------------------------------------- 钴蓝专业 */
  'h-blue': {
    label: '版式 · 钴蓝',
    note: '羊皮纸底 + 钴蓝主色 + 无衬线标题。最"可信"的一套 —— 适合讲方案、讲结论、'
      + '给合作方看的说明片。',
    palette: {
      ink: '#f4f1e8', ink2: '#eae6da', graphite: '#c3bfb2', ash: '#6d6a62',
      bone: '#152238', signal: '#1f4fd8', ember: '#4a7bff', blood: '#0d2a63',
      acid: '#0f766e', cyan: '#0e7490',
    },
    fonts: { sans: UI, serif: SONG, mono: MONO },
    post: { bloom: 0.08, halation: 0, grain: 0.02, vignette: 0.10, ca: 0, contrast: 1.06, shoulder: 0.97 },
    motif: 'blueprint',
    grid: G({ pad: 136 }),
    captions: { ...CAPS, size: 44, bg: 0.06 },
    tokens: { type: { hero: 126, h1: 86, h2: 50, body: 40, label: 25 } },
  },

  /* ---------------------------------------------------------------- 奶油 + 珊瑚 */
  'h-coral': {
    label: '版式 · 珊瑚',
    note: '奶油底 + 珊瑚色 + 全大写标题。轻快、好读，适合入门科普与产品说明。',
    palette: {
      ink: '#fdf6ec', ink2: '#f7ecdc', graphite: '#ded0bc', ash: '#7d6f60',
      bone: '#2a2118', signal: '#ff6b5a', ember: '#ffa07a', blood: '#9c3b2e',
      acid: '#3f8f6f', cyan: '#2f7fa8',
    },
    fonts: { sans: ENG, serif: GEORGIA, mono: MONO },
    post: { bloom: 0.10, halation: 0, grain: 0.022, vignette: 0.08, ca: 0, contrast: 1.05, shoulder: 0.97 },
    motif: 'flat',
    grid: G({ pad: 130 }),
    captions: { ...CAPS, size: 44, bg: 0.0 },
    tokens: { type: { hero: 140, h1: 92 }, weight: { hero: 800 } },
  },

  /* ---------------------------------------------------------------- 编辑森林 */
  'h-forest': {
    label: '版式 · 森林编辑',
    note: '绿 + 粉 + 奶油的杂志配色，衬线标题与细线。最像"一本杂志摊开"的一套 —— '
      + '适合有引文、有出处、有旁白的长段。',
    palette: {
      ink: '#f3f1e6', ink2: '#e9e6d8', graphite: '#c7c3b2', ash: '#6b6a5e',
      bone: '#1b2b21', signal: '#c94f6d', ember: '#e08aa0', blood: '#4a2418',
      acid: '#2d6a4f', cyan: '#1f6f7a',
    },
    fonts: { sans: SONG, serif: SONG, mono: MONO },
    post: { bloom: 0.07, halation: 0, grain: 0.04, vignette: 0.14, ca: 0, contrast: 1.03, shoulder: 0.97 },
    motif: 'paper',
    grid: G({ pad: 148 }),
    captions: { ...CAPS, size: 46, bg: 0.0 },
    tokens: { type: { hero: 128, h1: 90, h2: 52, body: 42, label: 26 } },
  },

  /* ---------------------------------------------------------------- 工业报纸 */
  'h-broadside': {
    label: '版式 · 工业报纸',
    note: '奶油色 + 墨色 + 火橙点缀，粗标题与重分隔线。适合"通告 / 声明 / 数字很强"的段落。',
    palette: {
      ink: '#efe8d8', ink2: '#e4dcc9', graphite: '#b9b09c', ash: '#6a6455',
      bone: '#181613', signal: '#e2571f', ember: '#ff8a3d', blood: '#5a1e0a',
      acid: '#3a6b35', cyan: '#1f5f7a',
    },
    fonts: { sans: ENG, serif: SONG, mono: MONO },
    post: { bloom: 0.09, halation: 0, grain: 0.045, vignette: 0.16, ca: 0, contrast: 1.06, shoulder: 0.96 },
    motif: 'paper',
    grid: G({ pad: 120, top: 84 }),
    captions: { ...CAPS, size: 44, bg: 0.0 },
    tokens: { type: { hero: 152, h1: 100 }, weight: { hero: 900 } },
  },

  /* ---------------------------------------------------------------- 极简留白 */
  'h-cartesian': {
    label: '版式 · 极简留白',
    note: '暖白 + 墨色标题 + 灰褐细线，几乎没有装饰。适合"内容本身要占满注意力"的讲解段。',
    palette: {
      ink: '#fbf9f3', ink2: '#f3f0e7', graphite: '#d8d3c6', ash: '#7a756b',
      bone: '#14130f', signal: '#8a6a3a', ember: '#b08a55', blood: '#4a3a20',
      acid: '#4a6b4a', cyan: '#3a6b7a',
    },
    fonts: { sans: UI, serif: GEORGIA, mono: MONO },
    // 留白的片子最怕颗粒把白面弄脏：颗粒压到 0.012
    post: { bloom: 0.05, halation: 0, grain: 0.012, vignette: 0.05, ca: 0, contrast: 1.02, shoulder: 0.98 },
    motif: 'flat',
    grid: G({ pad: 160, top: 110 }),
    captions: { ...CAPS, size: 46, bg: 0.0 },
    tokens: { type: { hero: 136, h1: 88, h2: 50, body: 40, label: 24 } },
  },

  /* ---------------------------------------------------------------- 胶囊糖果 */
  'h-capsule': {
    label: '版式 · 胶囊糖果',
    note: '奶油纸 + 糖果配色 + Bodoni 式衬线标题，圆角胶囊是最显著的一眼特征。'
      + '适合轻松的产品说明与清单。',
    palette: {
      ink: '#fffaf1', ink2: '#f7f0e3', graphite: '#e0d6c4', ash: '#877a66',
      bone: '#231b14', signal: '#ff4f8b', ember: '#ffb3c9', blood: '#8a1f42',
      acid: '#2f9e8f', cyan: '#2b7fd4',
    },
    fonts: { sans: SONG, serif: GEORGIA, mono: MONO },
    post: { bloom: 0.12, halation: 0, grain: 0.018, vignette: 0.06, ca: 0, contrast: 1.05, shoulder: 0.98 },
    motif: 'flat',
    grid: G({ pad: 138 }),
    captions: { ...CAPS, size: 44, bg: 0.0 },
    tokens: { type: { hero: 138, h1: 90 }, weight: { hero: 700 } },
  },

  /* ---------------------------------------------------------------- 波普大字 */
  'h-poster': {
    label: '版式 · 大字海报',
    note: '倾斜的花体大字 + 奶油底 + 红色强调，杂志封面感。适合一句话主张与封面帧 —— '
      + '**不适合信息密集的说明段**（它一屏只放得下一件事）。',
    palette: {
      ink: '#fdf3e6', ink2: '#f6e9d6', graphite: '#dccdb6', ash: '#7a6c58',
      bone: '#1c1610', signal: '#e01f28', ember: '#ff5a3c', blood: '#7a1010',
      acid: '#1f6f4a', cyan: '#1f5f9c',
    },
    fonts: { sans: GEORGIA, serif: GEORGIA, mono: MONO },
    post: { bloom: 0.11, halation: 0, grain: 0.03, vignette: 0.18, ca: 0, contrast: 1.08, shoulder: 0.97 },
    motif: 'paper',
    grid: G({ pad: 118 }),
    captions: { ...CAPS, size: 46, bg: 0.0 },
    tokens: { type: { hero: 168, h1: 104 }, weight: { hero: 900 } },
  },

  /* ---------------------------------------------------------------- 双版套印（style.view） */
  'h-riso': {
    label: '版式 · 双版套印',
    note: '奶油纸 + 双色网点套印（view.halftone，passes 2）：深蓝墨 + 朱红强调，套准故意'
      + '偏 2.2px —— 印刷厂没对准的那种彩色边。适合「这是一本印出来的册子」的说明段；'
      + '字多的段落要小心（网点会吃掉小字）。整片介质由 style.view 决定，场景一行不用改。',
    palette: {
      ink: '#f4ecda', ink2: '#ece2ca', graphite: '#d8cbb2', ash: '#8a7c66',
      bone: '#1b2a4a', signal: '#d0472a', ember: '#e06a3a', blood: '#7a1f12',
      acid: '#2e6b52', cyan: '#1f5f7a',
    },
    fonts: { sans: UI, serif: SONG, mono: MONO },
    post: { bloom: 0.08, halation: 0, grain: 0.03, vignette: 0.10, ca: 0, contrast: 1.05, shoulder: 0.97 },
    motif: 'paper',
    /**
     * 整片介质（BACKLOG 1-11 / 2026-10-30 用户拍板）：双版套印。
     * ⚠ 浅底风格里 paper/ink 的角色与默认调色板相反（ink 是纸色、bone 是墨色），
     *   所以这里**显式点名**三色 —— 不写就让网点整屏反相（黑纸白点）。
     */
    view: {
      mode: 'halftone', cell: 6, passes: 2, misreg: 2.2,
      paper: '#f3ecd8', ink: '#1b2a4a', accent: '#d0472a',
    },
    grid: G({ pad: 136 }),
    captions: { ...CAPS, size: 44, bg: 0.0 },
    tokens: { type: { hero: 136, h1: 92, h2: 52, body: 42, label: 25 } },
  },

  /* ---------------------------------------------------------------- 录像带（view + 磨损） */
  'h-vhs': {
    label: '版式 · 录像带',
    note: '深底 + 冷白字 + CRT 荫罩（view.crt）+ 胶片磨损三件套（片门晃动 / 闪烁 / 划痕）。'
      + '整片像一盘放了二十年的带子 —— 适合「记录 / 回放 / 旧档案」这类内容；'
      + '信息密度高的段落要少上（扫描线会压掉小字）。',
    palette: {
      ink: '#0d1418', ink2: '#131c22', graphite: '#22303a', ash: '#6f8f9f',
      bone: '#e8f2f4', signal: '#ffb454', ember: '#ff7a3c', blood: '#a33a1f',
      acid: '#5cffd0', cyan: '#4fd0ff',
    },
    fonts: { sans: ENG, serif: GEORGIA, mono: MONO },
    /**
     * 磨损三件套（2026-10-30，BACKLOG 1-64）：片门晃 0.55 / 闪烁 0.35 / 划痕 0.25。
     * 数值是出图校准过的：0.55 的晃动在 1080p 是 ±2.2px（看得见「老机器」但还能读字）；
     * 再大就变成「地震」（与 §4 铁律第 5 条同一个教训：幅度给足是效果、给过头是事故）。
     */
    post: {
      bloom: 0.22, halation: 0.18, grain: 0.045, vignette: 0.28, ca: 0, contrast: 1.04, shoulder: 0.92,
      weave: 0.55, flicker: 0.35, scratch: 0.25,
    },
    motif: 'scan',
    /** Deep 底 + 冷白字 ⇒ 走 SCREEN_POLARITY（crt 默认：纸=ink 暗、墨=bone 亮），不用显式配色 */
    view: { mode: 'crt', cell: 3, scanline: 0.7 },
    grid: G({ pad: 128 }),
    captions: { ...CAPS, size: 46, bg: 0.22 },
    tokens: { type: { hero: 140, h1: 94, h2: 52 }, weight: { hero: 800 } },
  },
};
