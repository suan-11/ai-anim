// @ts-check
/** zipf —— 齐普夫定律：排名第r的词频∝1/r。数据驱动冷门，benford姊妹篇。zoom+延迟答案。 */
export default {
  title:'第二名只有第一名的一半',
  logline:'词频、城市人口、网站流量，排名反比惊人一致',
  audience:'对数据规律反直觉感兴趣的中文短片观众',
  duration:32, width:1920,height:1080,fps:24, captions:true,
  style:{name:'paper',signals:['米白横线纸托起墨黑排名柱','信号红只点亮第1名与1/r曲线','对数坐标揭示直线'],flipped:['翻掉居中大字淡入','翻掉静态排名表(用柱衰减+zoom)','翻掉开场就给公式']},
  world:{background:'paper 米白横线纸',camera:'cameraPost 呼吸 + zoom punch',motif:'排名柱贯穿 词频→城市→1/r直线'},
  segments:[
    {id:'hook',role:'hook',at:0,dur:4,hero:'英文词频排名柱：the第一，of第二只有它一半',metaphor:'第二名恰好是第一名的一半，太整齐了',motion:{primary:'0-1.5s 词频柱the/of/and排开；1.5s zoom punch到第1第2柱对比',secondary:'1/2比例信号红高亮',ambient:'横线纸'},peak:{at:1.5,what:'突然放大：第2名恰是第1名一半（全片1.5s，只问不答）'},stateDiff:'普通排名变精确比例',relayTo:'rank-bars',onscreen:['一半？'],build:'custom'},
    {id:'bridge',role:'bridge',at:4,dur:5,hero:'换城市人口/网站流量，同样1/r衰减',metaphor:'不同数据同一规律',motion:{primary:'数据集切换柱形同衰减；zoom out看全貌',secondary:'第3名1/3第4名1/4标注',ambient:'相机微推'},peak:{at:3,what:'缩小看：换数据都1/r（全片7s，困惑）'},stateDiff:'单数据集变多组',relayTo:'rank-bars',onscreen:['都这样'],build:'custom'},
    {id:'mechanism',role:'mechanism',at:9,dur:8,hero:'【答案峰①】log-log坐标下排名vs频率成直线斜率-1',metaphor:'幂律1/r在对数坐标是直线',motion:{primary:'线性轴lerp到log-log，柱顶连成斜率-1直线；zoom punch到直线',secondary:'公式f∝1/r显影',ambient:'网格'},peak:{at:5,what:'放大log-log直线：斜率-1（全片14s，答案峰①）'},stateDiff:'经验排名变幂律直线',relayTo:'loglog',onscreen:['f ∝ 1/r'],build:'custom'},
    {id:'data',role:'data',at:17,dur:7,hero:'【答案峰②】齐普夫定律适用边界与偏差',metaphor:'不是所有数据都服从，受限范围会偏离',motion:{primary:'真实词频点vs理想1/r线，尾部偏离高亮；zoom到偏差点',secondary:'适用条件标注',ambient:'相机跟随'},peak:{at:4,what:'放大尾部偏差：定律有边界（全片21s，答案峰②）'},stateDiff:'理想定律变现实偏差',relayTo:'deviation',onscreen:['有边界'],build:'custom'},
    {id:'close',role:'close',at:24,dur:8,hero:'zoom out 回溯Zipf 1949与普遍性',metaphor:'语言学家发现的城市/词频/流量共同规律',motion:{primary:'zoom out回全景排名柱',secondary:'1949 Zipf标注',ambient:'相机停稳'},peak:{at:3,what:'缩小回全景（全片27s，收束）'},stateDiff:'回溯源头',relayTo:'',onscreen:['1949 · Zipf'],build:'custom'},
  ],
  antiList:['开场只问不答，公式压后段峰值','用排名柱衰减+zoom punch','诚实标注适用边界不夸大普遍性'],
};
