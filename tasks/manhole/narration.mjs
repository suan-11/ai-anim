// @ts-check
export const VOICE='zh-CN-YunxiNeural'; export const RATE='-2%'; export const TAIL=1.2; export const MAX_STRETCH=1.8;
export const SCENES=[
  {id:'hook',internal:3,lines:[{cue:0.3,text:'方形井盖转一下，对角线竖起来，就掉进去了。'}]},
  {id:'bridge',internal:5,lines:[{cue:0.3,text:'圆的井盖呢？怎么转，都卡得住。'},{cue:3.0,text:'因为圆任意方向，宽度都一样。'}]},
  {id:'mechanism',internal:8,lines:[{cue:0.3,text:'这叫定宽图形。'},{cue:2.8,text:'用卡尺量，每个方向的宽度都等于直径。'},{cue:6.0,text:'所以它永远掉不下去。'}]},
  {id:'data',internal:6,lines:[{cue:0.3,text:'但不止圆哦。'},{cue:2.8,text:'勒洛三角，任意方向也等宽，也能当井盖。'}]},
  {id:'close',internal:7,lines:[{cue:0.3,text:'那为什么井盖大多是圆的？'},{cue:4.0,text:'因为定宽图形里，圆最好加工。'}]},
];
