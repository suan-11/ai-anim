// PV：Cotton 翻唱「KING」（Kanaria feat. GUMI）· 歌词 PV（纯字体，不画人物）
//
// 时间轴 = QQ音乐官方逐行 LRC（songmid 003AOeZg1ZzFEl），再按本曲做一次**线性伸缩 + 起音吸附**：
// 这条 cover 比原曲慢约 1%（拟合斜率 0.9997），直接套原曲时间会在结尾差 1 秒。
// 量具：node tools/lint-cut-beats.mjs pv-king
import { seq, cut } from '../../src/timeline.js';
import lyric from './scenes/lyric.js';

const T = [
  [4.2, 'mask', "KING", "Kanaria feat. GUMI · Cotton 翻唱"],
  [4.8, 'vertical', "キング", ""],
  [5.44, 'glitch', "KING", "Kanaria · GUMI · Cotton 翻唱"],
  [2.96, 'karaoke', "幽閉利口 逝く前に", ""],
  [2.8, 'glitch', "ユーヘイじゃ利口に難儀ダーリン", ""],
  [3.3, 'karaoke', "幽閉 ストップ 知ってないし", ""],
  [3.06, 'mask', "勘弁にしといてなんて惨忍", ""],
  [2.93, 'ticker', "人様願う欠片のアイロニ", ""],
  [3.06, 'karaoke', "だれもが願う無機質なような", ""],
  [2.88, 'karaoke', "一足先に始めてたいような", ""],
  [1.07, 'vertical', "先が見えない", ""],
  [5.06, 'karaoke', "ヴァージンハッピーショー", ""],
  [2.6, 'mask', "無いの新たにお願い1つ", ""],
  [1.72, 'ticker', "愛も変わらずおまけに", ""],
  [1.12, 'karaoke', "ワーニング ワーニング", ""],
  [2.92, 'karaoke', "無いのあなたにお願い1つ", ""],
  [2.32, 'glitch', "張り詰めた思い込め", ""],
  [1.91, 'karaoke', "レフトサイド ライトサイド", ""],
  [2.88, 'mask', "歯をむき出してパッパッパ", ""],
  [1.16, 'stack', "照れくさいね", ""],
  [1.76, 'karaoke', "レフトサイド ライトサイド", ""],
  [3.3, 'karaoke', "歯を突き出してパッパッパッハハ", ""],
  [3.04, 'glitch', "You are KING", ""],
  [7, 'karaoke', "You are KING", ""],
  [5.33, 'interlude', "♪", "", { label: "KATTACHI · GUMI" }],
  [1.35, 'vertical', "無邪気に遊ぶ", ""],
  [1.72, 'ticker', "期待期待のダーリン", ""],
  [1.14, 'vertical', "健気に笑う", ""],
  [1.41, 'karaoke', "痛い痛いの消える", ""],
  [1.53, 'vertical', "無様に〇ねる", ""],
  [1.49, 'karaoke', "苦い思いも無くなって", ""],
  [1.39, 'mask', "ラララブウ ラッタッタ", ""],
  [1.77, 'ticker', "嫌い嫌いの最低泣いてダウン", ""],
  [2.88, 'karaoke', "毎度新たにお願い1つ", ""],
  [1.83, 'karaoke', "愛も変わらずピックアップの", ""],
  [1, 'glitch', "ワーニング ワーニング", ""],
  [2.97, 'karaoke', "無いのあなたにお願い1つ", ""],
  [2.46, 'mask', "張り詰めた思い込め", ""],
  [1.72, 'ticker', "レフトサイド ライトサイド", ""],
  [2.88, 'karaoke', "歯をむき出して パッパッパ", ""],
  [1.21, 'stack', "邪魔くさいね", ""],
  [1.62, 'glitch', "レフトサイド ライトサイド", ""],
  [3.44, 'karaoke', "歯を突き出して パッパッパッハハ", ""],
  [2.69, 'mask', "You are KING", ""],
  [7, 'ticker', "You are KING", ""],
  [12.82, 'interlude', "♪", "", { label: "KATTACHI · GUMI" }],
];

const total = T.reduce((a, r) => a + r[0], 0);
if (Math.abs(total - 134.94) > 0.06) throw new Error("时间线总和 " + total + " ≠ 134.94");

export default {
  title: 'KING · 歌词 PV',
  width: 1920, height: 1080, fps: 60, scale: 1,
  style: 'mg-bauhaus',
  palette: { signal: '#e8ff26' },
  audio: { music: './audio/song.mp3' },
  timeline: seq(T.map(([dur, mode, text, sub, extra], i) => cut(lyric, {
    id: 'k' + String(i + 1).padStart(2, '0'),
    dur, world: false, handlesTransition: false,
    params: { mode, text, sub, ...(extra ?? {}) },
  }))),
};
