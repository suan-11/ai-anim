// @ts-check
/**
 * 镜头模板：`pixel` —— **像素风**：调色板 + 块栅格 + 有序抖动 + 12fps 台阶（BACKLOG 1-67）。
 *
 * 画面是「一台 198X 年的机器算出来的」：天空是一块块抖出来的渐变，标题是 5x7 点阵字，
 * 一串精灵（机器人 / 硬币 / 心）在画面上按**台阶**跳着走，边框是纯色的两道。
 *
 * ## 与 `post.pixel`（后处理像素化）的区别 —— 这是这一层存在的全部理由
 *
 * `post.pixel` 是**事后的**像素化：把一张普通画面降采样再放大。它有三个天花板：
 *   · 颜色不受控（原图有多少色就留多少色，只是变糊了）；
 *   · **没有抖动**（相邻两档直接台阶，色彩过渡处是硬边色带，不像老机器）；
 *   · 文字也被拖去同一个栅格（中文小字直接糊成一团）。
 * 这里的四件事是**按像素画的**：色表只有 4–8 色、每个块自己决定属于哪一档
 * （Bayer 抖动）、中文标题走引擎的文字层（**最后**再跟 `post.pixel` 对齐到同一栅格）——
 * 于是中文和像素图落在同一个块上，而不互相毁掉。
 *
 * ```js
 * export default shot('pixel', { title: '像素机', sub: '四色 · 抖出来的渐变' });
 * ```
 *
 * ⚠ 三条**写错不报错、只出错画面**的（都在 `src/kit/pixel.js` 里钉着单测）：
 *   ① 抖动阈值按**块**坐标取（按像素取 ⇒ 同一块被撕成噪点，像"加了噪点"而不是游戏机）；
 *   ② 精灵与像素字落在整块上（差半块 ⇒ 抗锯齿把边缘抹成灰，缩略图看不出来、全屏就是"脏"）；
 *   ③ 台阶由**整片时间** `f.t` 算（用 `f.lt` 的话每次切段动作会卡一下）。
 */

import { Pass, RT } from '../core/gl.js';
import {
  paletteOf, pixelGradient, pixelText, drawSprite, spriteOf, snapTime, nearestIndex,
  DEFAULT_PALETTE,
} from '../kit/pixel.js';
import { css, prog, sat, mixColor, linearToSrgb } from '../core/util.js';
import { resolveTypeSize } from '../style/tokens.js';
import { contentOk } from './pick.js';

/** 全部参数 = "什么都不传时的画面"。`crawl` 是地面上那一串精灵。 */
const DEFAULTS = {
  id: 'pixel',
  kicker: 'PIXEL / 像素机',
  title: '像素机',
  sub: '四色 · 抖出来的渐变 · 12fps 的台阶',
  footer: '颜色只有四档 —— 中间那些明暗是抖出来的',
  palette: DEFAULT_PALETTE,
  cell: 8,
  crawl: 'bot',
  rows: 6,
  style: 'auto',
};

/**
 * @param {{ id?: string, kicker?: string, title?: string, sub?: string, footer?: string,
 *           palette?: string | string[], cell?: number, crawl?: string, rows?: number,
 *           style?: 'auto'|'terminal'|'bitmap' }} [opts]
 * @returns {any} 场景对象
 */
export function pixelShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    id: o.id,

    setup(ctx) {
      // 调色板在 setup 里解析一次（名字写错**当场抛**，并列出可用的）
      this.pal = paletteOf(o.palette);
      // 精灵也只解析一次：一整段里反复用，不该每帧再做一遍查表
      this.crawl = spriteOf(o.crawl ?? DEFAULTS.crawl);
      // 整帧打底用的背景 Pass：最深一档 + 一层极淡的扫描线（介质感，不是内容）
      const Q = ctx.P;
      this.bg = new Pass(ctx.gl, /* glsl */ `
        uniform vec3 cDeep, cScan;
        void main() {
          vec2 p = FRAG_PX / RES_LOGICAL;
          vec3 col = cDeep;
          float line = abs(fract(FRAG_PX.y / 8.0) - 0.5) * 2.0;
          col += cScan * (1.0 - smoothstep(0.0, 1.0, line)) * 0.06;
          fragColor = vec4(col, 1.0);
        }`, {
        cDeep: this.pal.linear[0],
        cScan: mixColor(Q.bone, Q.ink, 0.5),
      }, { key: 'shot_pixel_bg', blend: false });
    },

    render(ctx) {
      const { f, gl, text, type, comp, lines, W, H } = ctx;
      const pal = this.pal;
      const n = pal.linear.length;
      const cell = Math.max(4, Math.round(o.cell ?? 8));
      const mode = o.style ?? 'auto';

      // ⚠ **台阶用整片时间**（不是 f.lt）：切段不会把节奏重置到 0
      const step = snapTime(f.t, 12);
      const k = sat(prog(f.lt, 0.1, 1.1));            // 一次性入场（连续没关系：入场不是"动作"）

      this.bg.render(gl, ctx.out, step, f.dt);

      const cols = Math.ceil(W / cell);
      const rowsN = Math.ceil(H / cell);
      const grid = (v) => Math.round(v / cell) * cell;
      const tagY = grid(cell * 3);
      const skyBottom = grid(H * (mode === 'terminal' ? 0.40 : 0.56));

      // 调色板只有两级时，"亮的那一档"就是最亮的那一档 —— 否则 n-2 会落回**最暗**的那一档
      // （bit1 只有黑白：n-2 = 0 = 黑，地面画成黑的，深色标题直接消失。出图才发现。）
      const floorIdx = n >= 3 ? n - 2 : n - 1;
      const inkIdx = 0;
      const brightIdx = n - 1;

      // ─────────────────── 第一层：画面（会被 ⑨ 压成"一格一色"）
      lines.begin();

      // ① 天空：**只跨两档**（最深 → 第二档），中间全靠抖动。
      //    ⚠ 第一版让它跨了 3/4 张色表，于是天空变成一道彩虹 —— 像素游戏的天空
      //   几乎永远是「两个颜色 + 抖动」，跨得越多越像渐变滤镜，越不像像素画。
      pixelGradient(lines, { x: 0, y: tagY, w: W, h: skyBottom - tagY }, pal, {
        cell, from: inkIdx, to: Math.min(n - 1, 1), dither: 4, ramp: (u) => Math.pow(u, 1.5),
      });

      // ② 天上的一颗日/月 + 几点星（像素圆永远是台阶，不是弧）
      const sunR = Math.max(cell * 2, Math.round(cell * 4.5));
      const sunCx = grid(W * 0.78);
      const sunCy = grid(tagY + (skyBottom - tagY) * 0.40);
      lines.fillCircle(sunCx, sunCy, sunR, pal.linear[brightIdx], cell);
      lines.fillCircle(sunCx, sunCy, sunR * 0.55, pal.linear[floorIdx], cell);
      for (let i = 0; i < 16; i++) {
        if (Math.sin(step * 3.1 + i * 1.7) < 0.1) continue;      // 闪烁也走台阶
        const sx = grid(W * (0.03 + 0.92 * ((i * 0.618) % 1)));
        const sy = grid(tagY + (skyBottom - tagY) * (0.06 + 0.80 * ((i * 0.377) % 1)));
        if (Math.abs(sx - sunCx) < sunR * 2 && Math.abs(sy - sunCy) < sunR * 2) continue;
        lines.seg(sx + cell * 0.5, sy + cell * 0.5, sx + cell * 0.5, sy + cell * 0.5,
          cell * 0.9, pal.linear[brightIdx]);
      }

      // ③ 地平线上一条亮带（"屏幕发光"的那一圈，也是天与地的接缝）
      lines.fillRect(0, skyBottom - cell * 2, W, cell * 2, pal.linear[brightIdx], cell);

      // ④ 地面：亮的一档铺到画面底（文字要压在它上面，所以必须整块纯色）
      lines.fillRect(0, skyBottom, W, H - skyBottom, pal.linear[floorIdx], cell);

      // ⑤ 地面纹理：每两格一个暗点，随台阶往右滚（滚的是 t 的函数，不是累积）
      const scroll = Math.round(step * 6);
      const dark = pal.linear[Math.max(0, floorIdx - 1)];
      const dotC = [dark[0], dark[1], dark[2], 0.8];
      for (let j = skyBottom / cell + 1; j < rowsN - 1; j++) {
        for (let i = 0; i < cols; i += 2) {
          const ii = ((i + scroll + (j % 2)) % cols + cols) % cols;
          lines.seg(ii * cell + cell * 0.5, j * cell + cell * 0.5,
            ii * cell + cell * 0.5, j * cell + cell * 0.5, cell * 0.45, dotC);
        }
      }

      // ⑥ 地上走的一串精灵：按台阶跳着走（不是平滑移动）
      //    ⚠ 尺寸用 cell*3：8 格时的 8x8 精灵只有 64px，画幅里小得读不出是台机器
      const sprScale = Math.min(cell * 3, Math.max(cell, Math.round((H * 0.16) / 8)));
      const slots = Math.max(2, Math.min(Math.max(1, Math.round(o.rows ?? 6)),
        Math.round(W / (sprScale * 9))));
      const stepPx = Math.round(W / slots);
      //    ⚠ 位移必须是**每个台阶都换**的（`step * 每秒格数`），不能是 `step % 4`：
      //      取模之后整队精灵每 4 个台阶回到原位，看起来像原地抖（接触表实测：12 格里
      //      精灵位置几乎不变，事件密度直接不合格）。
      for (let s = 0; s < slots; s++) {
        // 每只精灵的相位不同 ⇒ 不是整齐列队前进，而是一串各自溜达
        const phase = (step * (s % 2 === 0 ? 5 : -3) + s * 37) * cell;
        const span = W - sprScale * this.crawl.w - cell * 2;
        const x = grid(((phase % span) + span) % span + cell);
        const bob = Math.sin(step * 2.1 + s * 1.3) > 0 ? cell * 2 : 0;   // 台阶上的两段式跳动
        const y = grid(H - sprScale * this.crawl.h - cell * (14 + (s % 2) * 3) - bob);
        const col = s % 2 === 0 ? pal.linear[inkIdx] : pal.linear[Math.max(0, floorIdx - 1)];
        drawSprite(lines, this.crawl, x, y, { scale: sprScale, color: col, alpha: 0.5 + 0.5 * k });
      }

      // ⑦ 边框：两道纯色（"硬件感"全在这两道里）
      lines.seg(0, cell * 0.5, W, cell * 0.5, cell, pal.linear[brightIdx]);
      lines.seg(0, H - cell * 1.5, W, H - cell * 1.5, cell, pal.linear[brightIdx]);
      lines.seg(cell * 0.5, 0, cell * 0.5, H, cell, pal.linear[brightIdx]);
      lines.seg(W - cell * 1.5, 0, W - cell * 1.5, H, cell, pal.linear[brightIdx]);
      lines.flush(ctx.out);

      // ─────────────────── 第二层：把画面压成"一格一色"（像素感的真正来源）
      this.squash(ctx, { cell, cols, rows: rowsN });

      // ⚠ 文字画在**压栅格之后**：先画再压的话，笔画会被块平均抹掉
      //   （第一版就是这样：中文标题碎成一地、副标彻底消失。只有出图才看得见。）

      // ⑧ 眉标：5x7 像素字。scale = cell ⇒ 一个点正好一格，压栅格时逐格保留
      //    （给 cell*0.5 那种"半格"会被点采样丢掉一半笔画）
      lines.begin();
      pixelText(lines, String(o.kicker ?? ''), grid(W * 0.045), tagY, {
        scale: cell,
        color: pal.linear[brightIdx],
        reveal: sat(prog(f.lt, 0.15, 0.85)),
      });
      lines.flush(ctx.out);

      // ⑨ 中文标题走引擎文字层（5x7 的表装不下汉字），字号 ≥ 10 格：
      //    CJK 的笔画宽约 = 字号/10，小于一格就会被最后的压栅格吃掉。
      text.clear();
      const tokens = ctx.style?.tokens ?? {};
      const h1 = Math.max(cell * 10, resolveTypeSize('h1', tokens) ?? 96);
      // 版面分区（出图定的，别随手改）：天空 → 地平线 → 标题 → 副标 → 精灵 → 页脚
      // ⚠ 精灵那一行会**压过副标**（第一版就这样：副标被机器人穿过去）。所以三层的
      //   纵坐标是**算出来**的，不是各写各的百分比。
      const titleY = grid(H * (mode === 'terminal' ? 0.58 : 0.62));
      type.writeLine(String(o.title ?? ''), Math.round(W * 0.5), titleY, {
        anchor: 'center', size: h1, weight: 800, family: 'sans',
        color: css(pal.linear[inkIdx]), t: f.lt - 0.2,
        stagger: 0.05, staggerDur: 0.4, from: 'up', dist: Math.round(h1 * 0.45),
      });
      type.writeLine(String(o.sub ?? ''), Math.round(W * 0.5), titleY + Math.round(h1 * 0.78), {
        size: Math.max(cell * 7, 56), family: 'mono', color: css(pal.linear[inkIdx], 0.95),
        anchor: 'center', alpha: [0, 1], t: f.lt - 0.65,
      });
      // 页脚压在**边框带里**（最下面那条深色），这是像素画里放状态行的传统位置，
      // 也避开了精灵那一行 —— 出图实测：放在精灵下方时被机器人的腿穿过去。
      // 页脚那一带的几何是**算出来**的（出图定的）：底带高 8 格，文字基线在带内偏下 2 格。
      // ⚠ 底带是压完栅格之后画的，所以必须是整格高的纯色块（不是渐变、不是半透明）——
      //   否则会和 squash 的瓦片再打一次架，出细密横纹。
      const bandH = cell * 8;
      const footY = grid(H) - bandH + Math.round(cell * 5.2);
      lines.begin();
      lines.fillRect(0, grid(H) - bandH, W, bandH, pal.linear[inkIdx], cell);
      lines.flush(ctx.out);
      type.writeLine(String(o.footer ?? ''), Math.round(W * 0.5), footY, {
        size: Math.max(cell * 4, 34), family: 'mono', color: css(pal.linear[brightIdx], 0.95),
        anchor: 'center', alpha: [0, 1], t: f.lt - 1.1,
      });
      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });

      // ⑩ 最后一步：整帧再**点采样**一次到同一栅格 —— 文字于是也变成方块字。
      //    ⚠ 必须与 squash 的瓦片尺寸**完全相等**，不能取一半：两个栅格相位不同就出摩尔纹
      //      （第一版写 0.5×，整屏浮着一层斜纹）。
      //    `post.pixel` 的单位是**物理**像素，所以乘 gl.scale 才对得上逻辑栅格。
      //    ⚠ 取**半格**（不是整格）：CJK 的笔画宽 ≈ 字号/10，56px 的副标只有 5–6px，
      //      整格（8px）的点采样会把笔画整根丢掉 —— 出图看到的就是"副标碎成一团"。
      //      半格时美术仍是整格（squash 已经压好，2×2 个半格同色），文字则保住笔画。
      const tilePhys = Math.max(2, Math.round(cell * gl.scale));
      return {
        pixel: mode === 'bitmap' ? 0 : Math.max(2, Math.round(tilePhys * 0.5)),
        bloom: 0.06,
        bloomThreshold: 1.35,
        halation: 0.03,
        grain: 0.015,
        vignette: 0.28,
        saturation: 1.05,
      };
    },
    /**
     * **分屏压缩**：把已经画好的整帧按瓦片重采样成纯色方片（像素感的真正来源）。
     *
     * 三步：**GPU 上降到"一格 S 个采样点"** → 读回 → 在 CPU 上做 S×S 方框平均 +
     * 量化到调色板 → 每行把同色的连续格并成一条横带画回去。
     *
     * ⚠ 三个坑，全都是"出图才看得见"的：
     *
     *   ① **不能直接降到一格一像素**。`texture(src, vUv)` 在 8:1 的比例下是**点采样**，
     *      一格只取一个像素 ⇒ 块与块之间随机跳变，中文标题被打成碎片（第一版实测如此）。
     *      所以先降到 `cols × S`（S = 4），在 JS 里做 4×4 方框平均 —— 那才是"这一格的平均颜色"。
     *   ② **读回是自下而上的**（`readPixels` 的 y 从下往上），而 `lines` 的 y 从上往下。
     *      不翻的话整块画面会**上下颠倒**（第一版就是：机器人跑到天花板上了）。
     *   ③ **必须合并同色**。240×90 格 = 21600 块，逐块画会顶满 LineBatch 的容量（6 万条）；
     *      而一屏同色块极多 —— 合并之后通常只剩几百条。
     *
     * ⚠ 读回失败时**不抛**：记一条 ctx.warnings 并跳过压栅格，画面退化成"没压过"但照样出得来。
     */
    squash(ctx, opts) {
      const { gl, lines } = ctx;
      const { cell, cols, rows } = opts;
      const pal = this.pal;
      const S = 4;                                   // 每格几个采样点（见 ①）
      const sw = cols * S;
      const sh = rows * S;
      let buf;
      try {
        const small = new RT(gl, sw, sh, { nearest: false });
        const pass = this.down || (this.down = new Pass(gl, /* glsl */ `
          uniform sampler2D src;
          void main() { fragColor = vec4(texture(src, vUv).rgb, 1.0); }`,
        { src: { value: null } }, { key: 'shot_pixel_down', blend: false, jitter: false }));
        pass.u.src.value = ctx.out;
        pass.render(gl, small, 0, 1 / 60);
        buf = gl.readPixels(small, 'srgb', { copy: true });
        small.dispose();
      } catch (err) {
        ctx.warnings.push('pixel.squash 降采样/读回失败，跳过压栅格：' + (err && err.message ? err.message : err));
        return;
      }
      if (!buf) return;
      const idx = new Uint16Array(cols * rows);
      const inv = 1 / (S * S * 255);
      for (let ry = 0; ry < rows; ry++) {
        // ② 翻 y：读回的第 0 行是画面最下面那一行
        const srcRow0 = (rows - 1 - ry) * S;
        for (let rx = 0; rx < cols; rx++) {
          let r = 0; let g = 0; let b = 0;
          for (let sy = 0; sy < S; sy++) {
            let o = ((srcRow0 + sy) * sw + rx * S) * 4;
            for (let sx = 0; sx < S; sx++) {
              r += buf[o]; g += buf[o + 1]; b += buf[o + 2];
              o += 4;
            }
          }
          idx[ry * cols + rx] = nearestIndex([r * inv, g * inv, b * inv], pal.srgb);
        }
      }
      lines.begin();
      for (let y = 0; y < rows; y++) {
        let runStart = 0;
        let runColor = idx[y * cols];
        for (let x = 1; x <= cols; x++) {
          const c = x < cols ? idx[y * cols + x] : 65535;
          if (c !== runColor) {
            const col = pal.linear[runColor];
            lines.seg(runStart * cell + cell * 0.5, y * cell + cell * 0.5,
              x * cell - cell * 0.5, y * cell + cell * 0.5, cell, col);
            runStart = x;
            runColor = c;
          }
        }
      }
      lines.flush(ctx.out);
    },  };
}

pixelShot.defaults = DEFAULTS;
pixelShot.meta = {
  name: 'pixel',
  summary: '像素风：一张 4–8 色的调色板 + 整块栅格 + Bayer 抖出来的渐变 + 按 12fps 台阶跳的精灵队列；中文标题走引擎文字层，最后与图一起压进同一个栅格。',
  notes: '不需要时间线的 world（整帧由本段自己铺：最深一档 + 抖出来的天空 + 地面 + 边框）。'
    + '`palette` 见下方参数说明，也可以直接给色表（2–32 色）。'
    + '**与 `post.pixel` 的区别**：后处理像素化保留原图所有颜色、没有抖动、文字一起糊；'
    + '这里的四件事（调色板 / 块 / 抖动 / 12fps 台阶）是按像素画的，所以才有"老机器"的味道。'
    + '中文**不要**用 5x7 像素字（一个汉字要 12x12 以上），所以标题走 `type.write`。',
  use: '讲"这台机器算出来的"：游戏 / 复古 / 低分辨率 / 8-bit / 记忆里的那块屏幕',
  energy: '中低',
  avoid: '需要读出精确数值或小字（像素化会吃掉）；要做"印刷品"用风格包的 view: halftone',
  params: [
    { name: 'id', type: 'string', desc: '段名（HUD / --only / 报错里用它）' },
    { name: 'kicker', type: 'string', desc: '左上眉标（用 5x7 像素字画，建议英文 / 数字）' },
    { name: 'title', type: 'string', desc: '主标题（走引擎文字层，中文可用）' },
    { name: 'sub', type: 'string', desc: '副标题' },
    { name: 'footer', type: 'string', desc: '底部一行（页脚带里，最后淡入；空串则不画）' },
    { name: 'palette', type: 'string | string[]', desc: '调色板名（gameboy / nes / amber / pico / bit1）或直接给色表' },
    { name: 'cell', type: 'number', desc: '一个像素格占多少逻辑像素（默认 8；越小越精细、越不像 8-bit）' },
    { name: 'crawl', type: 'string', desc: '地面上那串精灵用哪个（bot / coin / heart / star / skull / ghost …）' },
    { name: 'rows', type: 'number', desc: '保留参数：精灵队列最多几只（默认 6，实际按画幅自动定）' },
    { name: 'style', type: 'string', desc: 'auto（默认）/ terminal（地平线更高，像终端）/ bitmap（最后不做半格压栅格）' },
  ],
};

/**
 * 声明式 spec（docs/ENGINE.md §14.9）。
 *
 * requires: [] —— 只读 f.t / f.lt / 参数与 `ctx.P`；背景由本段自己的 Pass + `lines` 铺满。
 * outputs.visual = 'full-frame' —— 整帧覆盖（背景 Pass 打底 + 天空/地面/边框铺满）。
 */
pixelShot.spec = {
  params: {
    id: 'string', kicker: 'string', title: 'string', sub: 'string', footer: 'string',
    palette: 'string | string[]', cell: 'number', crawl: 'string', rows: 'number', style: 'string',
  },
  requires: [],
  outputs: { visual: 'full-frame', handlesTransition: false },
};
/* 选型元数据（BACKLOG 1-62）：tags / w / fits 的契约在 ./pick.js 头注释；brief 缺省字段 = 不设限。
   改这里不改模板画面，只改 anim shots --pick 会抽到谁。 */
pixelShot.tags = ['graphic', 'pop', 'handmade'];
pixelShot.w = 0.7;
pixelShot.fits = contentOk;
pixelShot.fitsNote = '讲「这台机器算出来的」；正文位可抽（收尾/转场位抽不到），无字数硬条件';
