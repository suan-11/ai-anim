// @ts-check
/** paperfold —— 一张纸对折42次到月球：指数增长反直觉。zoom punch + 延迟答案。 */
export default {
  title:'对折 42 次，这张纸够到月球',
  logline:'每折一次厚度翻倍，42 次就是 44 万公里',
  audience:'对指数增长反直觉感兴趣的中文短片观众',
  duration:32, width:1920,height:1080,fps:24, captions:true,
  style:{name:'paper',signals:['米白横线纸托起墨黑纸层与番茄红厚度标','信号红只点亮当前厚度读数','纸层用堆叠矩形表示'],flipped:['翻掉居中大字淡入模板脸','翻掉静态数字(用厚度柱爆炸增长+zoom)','翻掉开场就给42次答案']},
  world:{background:'paper 米白横线纸',camera:'cameraPost 呼吸 + 峰值 zoom punch',motif:'同一张纸贯穿 对折→厚度爆炸→够到月球'},
  segments:[
    {id:'hook',role:'hook',at:0,dur:4,hero:'一张纸对折几次厚度还很小',metaphor:'前几次对折厚度不起眼',motion:{primary:'0-1.5s 纸对折1-3次厚度微增；1.5s zoom punch 到厚度读数',secondary:'厚度数字小（毫米级）',ambient:'横线纸'},peak:{at:1.5,what:'突然放大厚度：才几毫米（全片1.5s，铺垫不答）'},stateDiff:'平纸变微厚',relayTo:'thickness',onscreen:['才几毫米'],build:'custom'},
    {id:'bridge',role:'bridge',at:4,dur:5,hero:'继续对折厚度开始加速',metaphor:'第10次约10厘米，第20次约100米',motion:{primary:'对折次数递增厚度柱加速长高；zoom out 看柱',secondary:'10次/20次里程碑标注',ambient:'相机微推'},peak:{at:3,what:'缩小看柱：20次已到百米级（全片7s，困惑加速）'},stateDiff:'线性变加速',relayTo:'thickness',onscreen:['开始快了'],build:'custom'},
    {id:'mechanism',role:'mechanism',at:9,dur:8,hero:'【答案峰①】厚度=0.1mm×2^n 指数爆炸',metaphor:'每折翻倍，指数函数后期冲天',motion:{primary:'厚度柱按2^n长高冲破画面；zoom punch 到柱顶',secondary:'公式0.1mm×2^n显影',ambient:'网格'},peak:{at:5,what:'放大柱顶：指数冲天（全片14s，答案峰①）'},stateDiff:'经验变指数公式',relayTo:'thickness',onscreen:['×2 每次'],build:'custom'},
    {id:'data',role:'data',at:17,dur:7,hero:'【答案峰②】42次=44万公里>地月38万公里',metaphor:'第42次厚度超过地月距离',motion:{primary:'厚度柱与地月距离线对比，42次超越；zoom punch 到超越点',secondary:'38万/44万km标注',ambient:'相机跟随'},peak:{at:4,what:'放大超越点：42次>地月距离（全片21s，答案峰②）'},stateDiff:'抽象指数变地月对照',relayTo:'moon',onscreen:['够到月球'],build:'custom'},
    {id:'close',role:'close',at:24,dur:8,hero:'zoom out 指数增长的威力与局限',metaphor:'理论上42次，实际纸折不过7-8次',motion:{primary:'zoom out 回全景，标注实际极限',secondary:'「实际≤8次」诚实标注',ambient:'相机停稳'},peak:{at:3,what:'缩小回全景：理论vs实际（全片27s，收束）'},stateDiff:'回溯现实约束',relayTo:'',onscreen:['理论≠实际'],build:'custom'},
  ],
  antiList:['开场铺垫不答，42次答案压后段峰值','用厚度柱爆炸+zoom punch，取消静态数字','诚实标注实际折纸极限≤8次，不夸大'],
};
