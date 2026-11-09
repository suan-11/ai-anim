// 转场样片（config-only）：用真实内容看转场，而不是在色块上。
//   node scripts/anim.mjs check trans-showcase
//   node scripts/anim.mjs video trans-showcase --draft
// 现在只用**遮挡型**转场（iris / wipe / sweep）：它们是把新画面「露出来」，不是把整张图拧一遍。
import { worldPass } from '../../src/kit/index.js';

export const world = (ctx) => worldPass(ctx, { grid: 64, accent: ctx.P.signal });

export default {
  title: '转场样片',
  width: 1920, height: 1080, fps: 60,
  style: 'print',
  timeline: [
    { type: 'title', id: 'a', dur: 4, world: 'auto',
      title: '三种转场', sub: '光圈 / 擦除 / 角度扫描' },

    { type: 'chart', id: 'b', dur: 5, overlap: 0.8, transition: 'iris', handlesTransition: true, world: 'auto',
      values: [0.32, 0.61, 0.88, 0.47], title: '光圈张开，换一件事讲' },

    { type: 'quote', id: 'c', dur: 5, overlap: 0.8, transition: 'wipe', handlesTransition: true, world: 'auto',
      text: '擦过去，像翻一页', cite: 'wipe' },

    { type: 'title', id: 'd', dur: 4, overlap: 0.8, transition: 'sweep', handlesTransition: true, world: 'auto',
      title: '收尾', sub: '角度扫描扫出去' },
  ],
};
