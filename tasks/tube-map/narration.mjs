// @ts-check
/** tube-map 旁白：地铁图拓扑。核实见 FACTS.md。 */
export const VOICE='zh-CN-YunxiNeural'; export const RATE='-2%'; export const TAIL=1.2; export const MAX_STRETCH=1.8;
export const SCENES=[
  {id:'hook',internal:4,lines:[{cue:0.3,text:'这张地铁图，看着挺正常。'},{cue:2.0,text:'可市中心这两站，怎么挤成这样？'}]},
  {id:'bridge',internal:6,lines:[{cue:0.3,text:'再看郊区，两站之间却空荡荡。'},{cue:3.0,text:'同一张图，一边挤一边空，不奇怪吗？'}]},
  {id:'mechanism',internal:8,lines:[{cue:0.3,text:'如果按真实距离画，地铁图就是这样歪歪扭扭。'},{cue:4.0,text:'市中心挤成一团，郊区拉得老长。'}]},
  {id:'compare',internal:10,lines:[{cue:0.3,text:'于是有人想了个办法：把站点吸到网格上。'},{cue:4.0,text:'只留横、竖、四十五度，站距拉均匀。'},{cue:7.5,text:'连接关系不变，换乘照样找得到。'}]},
  {id:'data',internal:6,lines:[{cue:0.3,text:'乘客只关心坐几站、在哪换乘。'},{cue:3.0,text:'谁在乎两站实际多远呢？'}]},
  {id:'close',internal:6,lines:[{cue:0.3,text:'一九三三年，贝克把电路图的思路搬到了地图上。'},{cue:3.5,text:'从此，地铁图故意画错，反而更好用。'}]},
];
