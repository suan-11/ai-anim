// @ts-check
/** paperfold 旁白：纸对折指数。核实见 FACTS.md。 */
export const VOICE='zh-CN-YunxiNeural'; export const RATE='-2%'; export const TAIL=1.2; export const MAX_STRETCH=1.8;
export const SCENES=[
  {id:'hook',internal:4,lines:[{cue:0.3,text:'一张纸对折三次，厚度还不到一毫米。'},{cue:3.2,text:'看起来，没什么了不起。'}]},
  {id:'bridge',internal:5,lines:[{cue:0.3,text:'可对折十次，就有十厘米了。'},{cue:3.0,text:'二十次，超过一百米。'}]},
  {id:'mechanism',internal:8,lines:[{cue:0.3,text:'每折一次，厚度翻一倍。'},{cue:3.0,text:'这是指数增长，后期会冲天。'},{cue:6.0,text:'零点一毫米，乘以二的n次方。'}]},
  {id:'data',internal:7,lines:[{cue:0.3,text:'对折四十二次，厚度四十四万公里。'},{cue:4.0,text:'而地球到月球，才三十八万公里。'}]},
  {id:'close',internal:8,lines:[{cue:0.3,text:'当然，这是理论。'},{cue:3.5,text:'实际的纸，折不过七八次。'},{cue:6.0,text:'但指数的威力，你感受到了。'}]},
];
