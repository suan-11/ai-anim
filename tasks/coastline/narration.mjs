// @ts-check
export const VOICE='zh-CN-YunxiNeural'; export const RATE='-2%'; export const TAIL=1.2; export const MAX_STRETCH=1.8;
export const SCENES=[
  {id:'hook',internal:4,lines:[{cue:0.3,text:'用一把大尺子量海岸线，得到一个数。'},{cue:2.6,text:'可尺子漏掉了那么多小弯，真的准吗？'}]},
  {id:'bridge',internal:5,lines:[{cue:0.3,text:'换一把更短的尺子，贴合更多弯曲。'},{cue:3.0,text:'量出来的长度，反而更长了。'}]},
  {id:'mechanism',internal:8,lines:[{cue:0.3,text:'尺子越短，细节越多。'},{cue:3.0,text:'每一级细分，都多出新的长度。'},{cue:6.0,text:'这样下去，海岸线没有确定的长度。'}]},
  {id:'data',internal:7,lines:[{cue:0.3,text:'长度和尺子尺寸，在对数坐标下成一条直线。'},{cue:4.6,text:'这条直线的斜率，就是分形维。'}]},
  {id:'close',internal:8,lines:[{cue:0.3,text:'一九六七年，芒德博罗问：英国海岸线有多长？'},{cue:4.8,text:'这个问题，开启了分形几何。'}]},
];
