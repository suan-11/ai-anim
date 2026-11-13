// 转场样片（config-only）：用真实内容看转场，而不是在色块上。
//   node scripts/anim.mjs check trans-showcase
//   node scripts/anim.mjs video trans-showcase --draft
// 只用**遮挡 / 滑出 / 百叶**这一族 —— 它们是把新画面「露出来」或「滑出去」，不是把整张图拧一遍：
//   旋转/镜碎那一族已撤（见 docs/MOTION-SPIN-SHATTER.md §7 的复盘）。
import { worldPass } from '../../src/kit/index.js';

export const world = (ctx) => worldPass(ctx, { grid: 64, accent: ctx.P.signal });

export default {
  title: '转场样片',
  width: 1920, height: 1080, fps: 60,
  style: 'print',
  timeline: [
    { type: 'title', id: 'a', dur: 4, world: 'auto',
      title: '五种转场', sub: '遮挡 / 滑出 / 百叶 —— 都不拧画面' },

    { type: 'chart', id: 'b', dur: 5, overlap: 0.8, transition: 'diamond', handlesTransition: true, world: 'auto',
      values: [0.32, 0.61, 0.88, 0.47], title: '菱形张开，数字进来' },

    { type: 'quote', id: 'c', dur: 5, overlap: 0.8, transition: 'split', handlesTransition: true, world: 'auto',
      text: '两半对开，像推门', cite: 'split' },

    { type: 'bigtype', id: 'd', dur: 4, overlap: 0.8, transition: 'slats', transitionOpts: { bands: 10 }, handlesTransition: true, world: 'auto',
      line1: '十条', line2: '交错滑出' },

    { type: 'quote', id: 'e', dur: 5, overlap: 0.8, transition: 'turn', transitionOpts: { cols: 12, stagger: 0.3 }, handlesTransition: true, world: 'auto',
      text: '百叶翻面：每条绕自己的轴转过去', cite: 'turn' },

    { type: 'title', id: 'f', dur: 4, overlap: 0.8, transition: 'sweep', handlesTransition: true, world: 'auto',
      title: '收尾', sub: '角度扫描扫出去' },
  ],
};
