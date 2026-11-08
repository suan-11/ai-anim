// 旋转转场族的看图夹具：四段各用一种新模式，交叠 1s，取交叠中点出图。
//   node scripts/anim.mjs still _trans-rot -t 2,5,8,11
export default {
  title: '旋转转场',
  width: 1920, height: 1080, fps: 60,
  style: 'print',
  timeline: [
    { type: 'title', title: 'SPIN', dur: 3, id: 'a' },
    { type: 'title', title: 'SWIRL', dur: 3, overlap: 1, transition: 'spin', handlesTransition: true, id: 'b' },
    { type: 'title', title: 'CAROUSEL', dur: 3, overlap: 1, transition: 'swirl', handlesTransition: true, id: 'c' },
    { type: 'title', title: 'SHATTER', dur: 3, overlap: 1, transition: 'carousel', handlesTransition: true, id: 'd' },
    { type: 'outro', dur: 3, overlap: 1, transition: 'shatter', handlesTransition: true, id: 'e' },
  ],
};
