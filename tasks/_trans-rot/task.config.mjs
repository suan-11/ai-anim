// 转场看图夹具：三种「遮挡型」转场（wipe / iris / sweep）——
// 旋转与镜碎那一族已经从转场层删掉（整帧 UV 变形做不出玻璃，见 docs/MOTION-SPIN-SHATTER.md 的复盘）。
//   node scripts/anim.mjs still _trans-rot -t 2.5,5.5,8.5
export default {
  title: '转场夹具',
  width: 1920, height: 1080, fps: 60,
  style: 'print',
  timeline: [
    { type: 'title', title: 'WIPE', dur: 3, id: 'a' },
    { type: 'title', title: 'IRIS', dur: 3, overlap: 1, transition: 'wipe', handlesTransition: true, id: 'b' },
    { type: 'title', title: 'SWEEP', dur: 3, overlap: 1, transition: 'iris', handlesTransition: true, id: 'c' },
    { type: 'title', title: 'END', dur: 3, overlap: 1, transition: 'sweep', handlesTransition: true, id: 'd' },
  ],
};
