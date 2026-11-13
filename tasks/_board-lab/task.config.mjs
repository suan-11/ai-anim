// C2 分镜三件套夹具：placeholder 占位时间线（check 应 warn「还有占位」）。
export default {
  title: '分镜占位夹具',
  width: 1280, height: 720, fps: 30, style: 'print',
  timeline: [
    { type: 'placeholder', id: 'p1', dur: 3, subject: '镜组', onscreen: '穿过镜头', motion: '摄影机向前穿', ref: 'makeThreeShot' },
    { type: 'placeholder', id: 'p2', dur: 3, subject: '成像面', onscreen: '山与落日', motion: '减速抵达', ref: 'makeThreeShot' },
    { type: 'title', id: 'real', dur: 3, title: '这一段是真镜头' },
  ],
};
