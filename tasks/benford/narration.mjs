// @ts-check
/** benford 旁白：本福特定律（唯一时间源）。核实见 FACTS.md。 */
export const VOICE = 'zh-CN-YunxiNeural';
export const RATE = '-2%';
export const TAIL = 1.2;
export const MAX_STRETCH = 1.8;
export const SCENES = [
  { id:'hook', internal:4, lines:[
    {cue:0.3, text:'你以为，一到九当开头的机会是一样的？'},
    {cue:2.0, text:'真实数据里，第一位是 1 的，占了三成。'},
  ]},
  { id:'bridge', internal:5, lines:[
    {cue:0.3, text:'换人口，换河流，换股价，'},
    {cue:2.5, text:'不管哪组真实数据，1 都最多。'},
  ]},
  { id:'mechanism', internal:8, lines:[
    {cue:0.3, text:'秘密在对数刻度上。'},
    {cue:2.5, text:'从 1 到 2 的区间，比 8 到 9 宽得多。'},
    {cue:5.0, text:'概率等于 log 十为底，一加 d 分之一。'},
  ]},
  { id:'data', internal:7, lines:[
    {cue:0.3, text:'人编的假数字，首位往往均匀。'},
    {cue:3.0, text:'真实数据偏爱 1，查账就靠这个识破造假。'},
  ]},
  { id:'close', internal:8, lines:[
    {cue:0.3, text:'一八八一年，纽科姆发现对数表前几页更脏。'},
    {cue:4.0, text:'如今，这条定律成了审计工具。'},
  ]},
];
