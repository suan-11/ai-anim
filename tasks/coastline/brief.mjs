// @ts-check
/** coastline —— 海岸线有多长：测量悖论/分形。zoom punch + 延迟答案（尺子越短越长）。 */
export default {
  title:'这条海岸线，量不准',
  logline:'尺子越短量出的海岸线越长，没有唯一答案',
  audience:'对反直觉数学与自然分形感兴趣的中文短片观众',
  duration:32, width:1920,height:1080,fps:24, captions:true,
  style:{name:'blueprint',signals:['深蓝坐标纸托起冷白海岸线','信号青只点亮当前尺子与测量段','递归细分用层级亮度区分'],flipped:['翻掉居中大字淡入模板脸','翻掉静态地图(用尺子缩短+细分动画)','翻掉开场就说分形']},
  world:{background:'blueprint 坐标纸暗底',camera:'cameraPost 呼吸 + 峰值 zoom punch',motif:'同一条海岸线贯穿 粗量→细量→无限→分形维'},
  segments:[
    {id:'hook',role:'hook',at:0,dur:4,hero:'一把大尺子量海岸线得一个数',metaphor:'看起来量准了',motion:{primary:'0-1.5s 大尺子沿海岸量，读数 L1；1.5s zoom punch 到尺子与海岸缝隙',secondary:'缝隙信号青高亮（尺子漏掉的弯）',ambient:'坐标网格'},peak:{at:1.5,what:'突然放大：尺子漏掉很多小弯（全片1.5s，只问不答）'},stateDiff:'看似准确变放大露缝隙',relayTo:'海岸线',onscreen:['量准了？'],build:'custom'},
    {id:'bridge',role:'bridge',at:4,dur:5,hero:'换小尺子，量出更长的数',metaphor:'尺子短了贴合更多弯，读数变大',motion:{primary:'尺子缩短，测量段变多，读数 L2>L1；zoom out 看全貌',secondary:'新旧读数对比',ambient:'相机微推'},peak:{at:3,what:'缩小看全貌：小尺子量更长（全片7s，困惑）'},stateDiff:'单一测量变两尺度对照',relayTo:'海岸线',onscreen:['更长了'],build:'custom'},
    {id:'mechanism',role:'mechanism',at:9,dur:8,hero:'【答案峰①】尺子继续缩短，海岸线递归细分越来越长',metaphor:'每次细分都多出长度，趋于无限',motion:{primary:'海岸线逐级递归细分（科赫式），读数累加；zoom punch 到一段细分',secondary:'长度计数器递增，层级亮度',ambient:'网格随细分'},peak:{at:5,what:'放大细分段：每级都多长度（全片14s，答案峰①）'},stateDiff:'有限测量变递归无限',relayTo:'细分段',onscreen:['越量越长'],build:'custom'},
    {id:'data',role:'data',at:17,dur:7,hero:'【答案峰②】长度 vs 尺子尺寸 log-log 直线=分形维',metaphor:'长度随尺子缩小幂律增长，斜率给出分形维度',motion:{primary:'log-log 坐标点连线成直线；zoom punch 到斜率',secondary:'分形维 D 读数显影',ambient:'相机跟随'},peak:{at:4,what:'放大斜率：log-log 直线=分形维（全片21s，答案峰②）'},stateDiff:'现象变成幂律/分形维',relayTo:'loglog',onscreen:['分形维 D'],build:'custom'},
    {id:'close',role:'close',at:24,dur:8,hero:'zoom out 回溯 Mandelbrot 1967 英国海岸线',metaphor:'「英国的海岸线有多长」开启分形几何',motion:{primary:'zoom out 回全景海岸线',secondary:'1967 Mandelbrot 标注',ambient:'相机停稳'},peak:{at:3,what:'缩小回全景海岸线（全片27s，收束）'},stateDiff:'回溯源头',relayTo:'',onscreen:['1967 · Mandelbrot'],build:'custom'},
  ],
  antiList:['开场只问不答，分形维压后段峰值','用尺子缩短+递归细分+zoom punch，取消静态图','抽象海岸线示意，不搬真实地图版权'],
};
