// C3「被拍摄感」预设标定夹具：同一段内容 × off / filmed / filmed-doc / filmed-super8 四档。
// 出接触表人工审片定数值：node scripts/anim.mjs sheet _filmed-lab --from 0 --to 12 -n 12
// flicker 是否误刷事件密度：node tools/lint-event-density.mjs _filmed-lab（先 video 出片）
const HEAD = ['每一帧', '都是时间的函数'];
const seg = (id, preset) => ({
  type: 'kinetic', id, dur: 3, headline: HEAD, sub: 'FILMED / PRESET / CALIBRATION',
  ...(preset ? { post: { preset } } : {}),
});
export default {
  title: '被拍摄感预设标定',
  width: 1280, height: 720, fps: 30, style: 'print',
  timeline: [
    seg('off', null),
    seg('filmed', 'filmed'),
    seg('doc', 'filmed-doc'),
    seg('super8', 'filmed-super8'),
  ],
};
