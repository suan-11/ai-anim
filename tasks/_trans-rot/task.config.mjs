// 旋转转场族的看图夹具：四段各用一种新模式，交叠 1s，取交叠中点出图。
//   node scripts/anim.mjs still _trans-rot -t 2,5,8,11
export default {
  title: '旋转转场',
  width: 1920, height: 1080, fps: 60,
  style: 'print',
  timeline: [
    { type: 'title', title: 'SPIN', dur: 3, id: 'a' },
    // turns: 2 = 转两圈（默认 1 是原来那支）；改这里能看出段级 opts 真的落到 shader
    { type: 'title', title: 'SWIRL', dur: 3, overlap: 1, transition: 'spin', transitionOpts: { turns: 2 }, handlesTransition: true, id: 'b' },
    { type: 'title', title: 'CAROUSEL', dur: 3, overlap: 1, transition: 'swirl', handlesTransition: true, id: 'c' },
    { type: 'title', title: 'SHATTER', dur: 3, overlap: 1, transition: 'carousel', handlesTransition: true, id: 'd' },
    // 段级 transitionOpts 透传的活证据：碎片变粗（4 片/边）、种子换成 3、飞得更猛
    { type: 'outro', dur: 3, overlap: 1, transition: 'shatter', transitionOpts: { shards: 4, seed: 3, power: 1.4 }, handlesTransition: true, id: 'e' },
  ],
};
