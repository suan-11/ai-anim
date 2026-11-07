// Three action families share a stage and the same orange core. No overlap or dissolve:
// the last pose of a shot hands the core directly to the next one.
export default {
  title: '动作实验 · 揭示 / 因果 / 变形',
  width: 1920, height: 1080, fps: 60, captions: false,
  // Style post is applied after a scene's return. Disable film grain here, where it takes effect.
  style: { name: 'noir', post: { grain: 0, vignette: .18, ca: 0, contrast: 1.03, saturation: 1 } },
  palette: { signal: '#fa783d', ember: '#ffb47c', blood: '#763b20', acid: '#ffa470' },
  timeline: [
    { type: 'reveal', dur: 4.2, world: false,
      title: '从缝隙里，看见核心', label: '发现',
      state: { from:['closed-shutters'],to:['core'],diff:['visibility','light'] }, relayTo:'core' },
    { type: 'cascade', dur: 8.4, world: false,
      title: '触碰之后，世界开始响应', label: '连锁反应',
      state: { from:['core'],to:['core','fallen-vanes'],diff:['position','state'] }, relayTo:'core' },
    { type: 'transform', dur: 5.4, world: false,
      title: '形态改变，它还是它', label: '同一个轮廓',
      state: { from:['core'],to:['core'],diff:['shape','material'] } },
  ],
};
