// 转场样片（config-only）：四段四种转场，用来在真实内容里看转场，而不是在色块上。
//   node scripts/anim.mjs check trans-showcase
//   node scripts/anim.mjs video trans-showcase --draft
// 用法要点：transition 写在**新进来**那一段上；overlap 决定转场时长；
//           全片共用一层背景（world: 'auto'）—— 转场时「世界不跳」，只有前景在换。
import { worldPass } from '../../src/kit/index.js';

export const world = (ctx) => worldPass(ctx, { grid: 64, accent: ctx.P.signal });

export default {
  title: '转场样片',
  width: 1920, height: 1080, fps: 60,
  style: 'print',
  timeline: [
    { type: 'title', id: 'a', dur: 4, world: 'auto',
      title: '五种转场', sub: '同一套画面语言里的节奏切换' },

    // ① 旋转：情绪翻转，转一整圈（turns 缺省 1）
    { type: 'chart', id: 'b', dur: 5, overlap: 0.8, transition: 'spin', handlesTransition: true, world: 'auto',
      values: [0.32, 0.61, 0.88, 0.47], title: '旋转之后，坐标系变了' },

    // ② 圆筒：并列的几件事，横向压过去
    { type: 'quote', id: 'c', dur: 5, overlap: 0.8, transition: 'carousel', handlesTransition: true, world: 'auto',
      text: '圆筒适合并列：三件事压过去，一件一件看', cite: 'carousel' },

    // ③ 镜碎：冲击 —— 碎片多一点、飞得猛一点
    { type: 'bigtype', id: 'd', dur: 4, overlap: 0.8, transition: 'shatter', world: 'auto',
      transitionOpts: { shards: 9, seed: 12, power: 1.2 }, handlesTransition: true,
      line1: '碎', line2: '冲击用它' },

    // ④ 角度扫描：收尾，绕中心扫出去
    { type: 'title', id: 'e', dur: 4, overlap: 0.8, transition: 'sweep', handlesTransition: true, world: 'auto', title: '收尾', sub: '角度扫描扫出去' },
  ],
};

