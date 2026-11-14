// @ts-check
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { positional } from "../lib/cli/args.mjs";
import { die, log } from "../lib/cli/log.mjs";
import { ROOT } from "../lib/cli/paths.mjs";
/* ------------------------------------------------------------------ 命令：new */

function cmdNew() {
  const name = positional(0);
  if (!name) die('用法：node scripts/anim.mjs new <任务名>');
  if (!/^[\w.-]+$/.test(name)) die('任务名只能用字母数字下划线短横线点');
  const dir = path.join(ROOT, 'tasks', name);
  if (existsSync(dir)) die(`${dir} 已经存在`);
  mkdirSync(path.join(dir, 'scenes'), { recursive: true });
  mkdirSync(path.join(dir, 'audio'), { recursive: true });

  writeFileSync(path.join(dir, 'task.config.mjs'), `// 任务：${name}
// 一个任务 = 一支片子（或一段小动画）。改这里就够了，引擎不用动。
//
// 想要「零代码出片」（推荐先试）：把下面的 timeline 换成**配置档** —— 时间线里直接写镜头模板，
// 连 scenes/ 都不需要：
//   timeline: [ { type: 'title', title: '标题', sub: '副标题', dur: 4 },
//               { type: 'chart', values: [0.3, 0.7, 0.95], title: '成绩', dur: 5 } ]
// 11 个模板与它们的参数：node scripts/anim.mjs shots [名字]    ·    说明：docs/CONFIG-ONLY.md
import { seq, cut } from '../../src/timeline.js';
import title from './scenes/title.js';
import shapes from './scenes/shapes.js';
// 可选：全片共用的背景（时间线里写 { world: 'auto' } 的段由引擎每帧先铺它）。
// import { worldPass } from '../../src/kit/index.js';
// export const world = (ctx) => worldPass(ctx, { grid: 60 });

export default {
  title: '${name}',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,              // 1..4；2 = 真 4K（矢量/文字/后处理在 4K 下都验过）
  palette: {},           // 覆盖调色板，例如 { signal: '#00e0ff' }
  // audio: './audio/track.mp3',   // 有音乐就打开，画面就能踩拍子
  // lyrics: './lyrics.json',      // 词级时间戳（可选）
  // fonts: './fonts/brand.css',   // 任务自带字体（不必去改全局 public/fonts/）

  timeline: seq([
    cut(title, { dur: 4 }),
    cut(shapes, { dur: 6, params: { variant: 'grid' } }),
  ], { start: 0 }),
};
`);

  writeFileSync(path.join(dir, 'scenes', 'title.js'), `// 一段最简单的场景：标题 + 逐字入场 + 生长的矢量线。
// 场景 = { id, setup(ctx), render(ctx) }，render 必须把整帧画进 ctx.out。
// 想要现成的整镜头（标题 / 图表 / 大字 / 甩镜 / 片尾 / 波形 / 网格）就先别写这些：
//   node scripts/anim.mjs shots            ← 列出模板与参数
//   import { shot } from '../../../src/shots/index.js';
//   export default shot('title', { title: '我的片子', sub: '副标题' });
// 下面这份手写场景留着当“从零写一个镜头”的样板，两者可以混在同一条时间线里。
import { css } from '../../../src/core/util.js';

export default {
  id: 'title',

  setup(ctx) {
    // 只调用一次：着色器、几何、预计算都放这里
  },

  render(ctx) {
    const { f, gl, P, text, type, comp, lines } = ctx;
    const { W, H } = gl;

    // 1) 背景：清一层底色（要更复杂的底就上 shader Pass，见 docs/COOKBOOK.md）
    gl.clear(ctx.out, [P.ink[0] * 0.6, P.ink[1] * 0.6, P.ink[2] * 0.6]);

    // 2) 一条从左到右生长的细线，带刻度
    lines.begin();
    const y = H * 0.58;
    const grow = Math.min(1, f.lt / 1.6);
    const x0 = W * 0.18, x1 = W * 0.82;
    lines.seg(x0, y, x0 + (x1 - x0) * grow, y, 3, P.signal);
    for (let i = 0; i < 16; i++) {
      const x = x0 + ((x1 - x0) * i) / 15;
      const on = i / 15 <= grow;
      lines.seg(x, y - (on ? 16 : 8), x, y + (on ? 16 : 8), on ? 2 : 1.2, on ? P.bone : P.graphite);
    }
    lines.flush(ctx.out);

    // 3) 文字：逐字入场
    text.clear();
    type.write('动画，是代码', W * 0.18, H * 0.42, {
      size: 132, weight: 800, family: 'sans', color: css(P.bone),
      stagger: 0.07, from: 'up', dist: 60, t: f.lt,
    });
    // 按锚点写整行：writeLine 会先量宽度再偏移（type.write 的 align 是逐字生效的，
    // 直接写 align:'center' 会让每个字各自居中，整行反而跑偏）
    type.writeLine('ANIMATION IS CODE', W * 0.82, H * 0.42 + 62, {
      anchor: 'right', size: 30, weight: 400, family: 'mono', tracking: 8,
      color: css(P.signal, 0.9), stagger: 0.02, t: f.lt,
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.3, grain: 0.03 };
  },
};
`);

  writeFileSync(path.join(dir, 'scenes', 'shapes.js'), `// 第二段：网格 + 粒子，演示「一切位置都是时间的函数」的写法。
import { css, rng } from '../../../src/core/util.js';

export default {
  id: 'shapes',

  setup(ctx) {
    // 预计算：确定性随机（永远不要用 Math.random）
    const r = rng(7);
    this.dots = Array.from({ length: 260 }, () => ({ x: r(), y: r(), s: 0.3 + r() * 1.4, ph: r() }));
  },

  render(ctx) {
    const { f, gl, P, text, type, comp, lines, params } = ctx;
    const { W, H } = gl;
    const local = f.lt;

    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);

    lines.begin();
    // 网格：每格一条线，按到中心的距离依次点亮
    const cols = 24, rows = 14;
    const cw = W / cols, ch = H / rows;
    for (let i = 0; i <= cols; i++) {
      const k = i / cols;
      const d = Math.abs(k - 0.5) * 2;
      const lit = Math.max(0, 1 - Math.abs(local * 1.4 - d * 2.2));
      lines.seg(i * cw, 0, i * cw, H, 1, [P.graphite[0] * (0.25 + lit), P.graphite[1] * (0.25 + lit), P.graphite[2] * (0.25 + lit)]);
    }
    for (let j = 0; j <= rows; j++) lines.seg(0, j * ch, W, j * ch, 1, P.graphite.map((c) => c * 0.25));

    // 粒子：每个点有自己的相位，位置是时间的纯函数（可以随便 seek / 多子帧采样）
    for (const d of this.dots) {
      const px = d.x * W + Math.sin(local * (0.6 + d.s) + d.ph * 6.28) * 40;
      const py = d.y * H + Math.cos(local * (0.4 + d.s * 0.7) + d.ph * 6.28) * 30;
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(local * 1.2 + d.ph * 9));
      lines.seg(px, py, px + 0.01, py, 2 + d.s * 3, [P.signal[0] * tw, P.signal[1] * tw, P.signal[2] * tw]);
    }
    lines.flush(ctx.out);

    text.clear();
    type.write(String(params.variant ?? '').toUpperCase(), 60, 90, {
      size: 34, family: 'mono', color: css(P.ash), tracking: 6,
    });
    // 整行淡入：写了 alpha 就会随 t 动画（不需要再塞个极小的 stagger 去骗引擎）
    type.writeLine('每一帧都是 t 的函数', W / 2, H - 110, {
      anchor: 'center', size: 54, weight: 600, family: 'sans', color: css(P.bone),
      alpha: [0, 1], t: local - 0.4, staggerDur: 0.6,
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.4, ca: Math.abs(Math.sin(local)) * 0.3, grain: 0.04 };
  },
};
`);

  log(`✓ 建好了 tasks/${name}/`);
  log('  下一步：');
  log(`    npm run still -- ${name} -t 1,2.5        出几帧看看`);
  log(`    npm run dev                              浏览器里实时预览`);
  log(`    npm run video -- ${name}                 渲染成片`);
}
export { cmdNew as run };
