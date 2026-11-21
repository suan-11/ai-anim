// @ts-check
/**
 * oklab —— 旁白脚本（唯一时间源）。
 * 核实底稿见 tasks/oklab/FACTS.md。
 */

export const VOICE = 'zh-CN-YunyangNeural';
export const RATE = '-2%';
/** 每段最后一句说完后留给画面定格与转场呼吸的时间（秒） */
export const TAIL = 2.0;
export const MAX_STRETCH = 1.9;
export const BPM = 120;

export const SCENES = [
  {
    id: 'hook',
    internal: 14.5,
    lines: [
      { cue: 0.5, text: '把纯红和纯绿直接平均，电脑算出来的不是亮黄，是一块发暗发脏的橄榄色。' },
      { cue: 5.8, text: '同一个中点，数值正好是 128，物理上却只发出了百分之二十一的光。' },
      { cue: 11.5, text: '颜色存成什么数，和眼睛怎么看，根本不是一回事。' },
    ],
  },
  {
    id: 'gamma_trap',
    internal: 9.5,
    lines: [
      { cue: 0.8, text: '问题出在 sRGB 编码。' },
      { cue: 2.8, text: '人眼对暗部远比亮部敏感，文件把亮度弯过约 2.2 次方才存下来，128 根本不是一半光强。' },
    ],
  },
  {
    id: 'linear_limit',
    internal: 8.5,
    lines: [
      { cue: 0.8, text: '解回线性光再平均，物理光强到了一半，编码变成 188。' },
      { cue: 5.3, text: '可在人眼里，亮度和色相变化依然不够均匀。' },
    ],
  },
  {
    id: 'oklab_mech',
    internal: 21.0,
    lines: [
      { cue: 0.8, text: '2020 年，Björn Ottosson 提出了 Oklab。' },
      { cue: 4.2, text: '先将线性 RGB 乘进视锥响应，再开一次立方根。' },
      { cue: 9.0, text: '最后旋进感知亮度 L，以及两根颜色轴。' },
      { cue: 14.0, text: '红绿中点的感知亮度落在 0.747，色带平稳过渡，不会中途塌陷。' },
    ],
  },
  {
    id: 'css_bridge',
    internal: 6.5,
    lines: [
      { cue: 0.8, text: '连 CIELAB 在蓝白渐变上都会偏紫，Oklab 却沿着色相直走，已经写进 CSS Color 4。' },
    ],
  },
  {
    id: 'close',
    internal: 11.0,
    lines: [
      { cue: 0.8, text: '回到最开始那条红绿渐变。' },
      { cue: 3.0, text: '在 Oklab 空间重算一遍，中间的灰暗凹陷彻底抹平。' },
      { cue: 7.2, text: '算得对，看着也顺，这两件事终于对上了。' },
    ],
  },
];
