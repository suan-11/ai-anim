// 小糯米 · 第十六支：《才不是想你呢》 —— 配置档 B（只有这一个文件）
// 人设来源：C:\Users\haoxu\Downloads\NekoHome\xiaonuomi\档案.md
// 纯代码动画，无图片/视频素材；数字是编的，尾巴是真的。
export default {
  title: '才不是想你呢',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,
  style: 'paper',
  palette: { signal: '#f59e0b' },

  timeline: [
    {
      type: 'title',
      id: 'hook',
      dur: 3.4,
      blur: 8,
      eyebrow: 'NUOMI / 今日份营业',
      title: '才不是想你呢',
      sub: '只是纸箱刚好在你旁边 · 喵~',
    },
    {
      type: 'bigtype',
      id: 'hmp',
      dur: 3.2,
      maxSamples: 16,
      kicker: 'NUOMI / 嘴硬现场',
      line1: '才不是想你',
      line2: '只是有点无聊',
      mark: '想你',
      footer: '尾巴已经出卖我了喵',
    },
    {
      type: 'bigtype',
      id: 'soft',
      dur: 3.6,
      maxSamples: 16,
      kicker: 'NUOMI / 摸头许可',
      line1: '摸头可以',
      line2: '别摸太久',
      mark: '别摸太久',
      footer: '再摸就咬你喵',
    },
    {
      type: 'lockup',
      id: 'end',
      dur: 3.2,
      maxSamples: 16,
      mark: 'diamond',
      kicker: 'LOCKUP / 定版',
      name: '小糯米',
      tagline: 'NUOMI / NEKOHOME',
      meta: '纸箱已占 · 请勿回收',
      footer: '喵~',
    },
  ],
};
