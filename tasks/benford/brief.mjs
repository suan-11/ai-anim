// @ts-check
/** benford —— 本福特定律：真实数据首位数字 1 占 30%，抓造假。zoom punch + 延迟答案。 */
export default {
  title: '第一位是 1 的数字，凭什么这么多',
  logline: '真实数据的首位数字不均匀，1 占三成，造假者不知道',
  audience: '对数据反直觉与抓造假感兴趣的中文短片观众',
  duration: 34, width: 1920, height: 1080, fps: 24, captions: true,
  style: { name:'flat', signals:['中性暗底托起九根首位数字柱','信号橙只点亮正在被解释的那根柱或那条公式','数据流用冷白小字滚动'], flipped:['翻掉居中大字淡入模板脸','翻掉静态柱状图(用数据流喂柱+zoom punch)','翻掉开场就给公式'] },
  world: { background:'flat 中性暗底 + 极淡网格', camera:'cameraPost 呼吸 + 峰值 zoom punch', motif:'九根首位数字柱贯穿 直觉→真实→公式→抓造假' },
  segments: [
    { id:'hook', role:'hook', at:0, dur:4, hero:'九根「以为均匀」的首位数字柱突然被真实数据砸歪', metaphor:'你以为 1-9 各 11%，真实数据砸下来 1 冲到 30%', motion:{primary:'0-1.5s 九根等高柱(直觉11%)；1.5s 数据流砸下柱高突变；zoom punch 到 1 号柱',secondary:'1 号柱信号橙高亮冲顶',ambient:'数据流冷白小字滚'}, peak:{at:1.5,what:'突然放大 1 号柱：冲到 30% 远超其他（全片1.5s，只问不答）'}, stateDiff:'均匀柱突变为 1 号独高', relayTo:'1号柱', onscreen:['？'], build:'custom' },
    { id:'bridge', role:'bridge', at:4, dur:5, hero:'换三组真实数据（人口/河流/股价）柱形都一样', metaphor:'换什么真实数据，1 都是三成——不是巧合', motion:{primary:'数据集标签切换，柱形微抖但 1 号始终独高；zoom out 看全貌',secondary:'三组数据流交替喂柱',ambient:'相机微移'}, peak:{at:3,what:'缩小看全貌：三组数据同一分布（全片7s，困惑加深）'}, stateDiff:'单数据集变三组对照', relayTo:'九柱分布', onscreen:['换数据也一样'], build:'custom' },
    { id:'mechanism', role:'mechanism', at:9, dur:8, hero:'【答案峰①】对数刻度揭示 P(d)=log10(1+1/d)', metaphor:'数字在对数轴上等距，1 到 2 的区间最宽所以首位 1 最多', motion:{primary:'线性轴 lerp 到对数轴，九柱高度对齐 log 公式；zoom punch 到 1-2 区间',secondary:'公式显影，1-2 区间信号橙框出最宽',ambient:'网格随轴变形'}, peak:{at:5,what:'对数轴变形完+放大 1-2 区间：最宽区间=最多首位1（全片14s，答案峰①）'}, stateDiff:'经验柱状图变成对数公式解释', relayTo:'对数轴', onscreen:['log₁₀(1+1/d)'], build:'custom' },
    { id:'data', role:'data', at:17, dur:8, hero:'【答案峰②】造假数据 vs 真实数据分布对照', metaphor:'人编的随机数首位均匀，真实数据偏 1——查账一眼识破', motion:{primary:'左右两图：造假(均匀)vs真实(本福特)，逐柱对比；zoom punch 到偏差最大的 1 号',secondary:'偏差条高亮，造假图标红',ambient:'两图共用柱身份'}, peak:{at:5,what:'放大 1 号柱偏差：造假 11% vs 真实 30%（全片22s，答案峰②）'}, stateDiff:'单一分布分裂为造假/真实对照', relayTo:'1号柱偏差', onscreen:['造假露馅'], build:'custom' },
    { id:'close', role:'close', at:25, dur:9, hero:'zoom out 回溯本福特 1881 与审计应用', metaphor:'天文学家发现对数表前几页更脏，如今用来查账', motion:{primary:'zoom out 回全景九柱，叠对数表意象',secondary:'1881 Newcomb / 1938 Benford 标注',ambient:'相机停稳柱呼吸'}, peak:{at:3,what:'缩小回全景，对数表与柱状图叠合（全片28s，收束）'}, stateDiff:'回溯源头与应用', relayTo:'', onscreen:['1881 · 查账用'], build:'custom' },
  ],
  antiList: ['开场只问不答，公式压到 mechanism 后段峰值','用 zoom punch + 数据流喂柱，取消静态图表','抽象数据示意，不编造具体国家精确数值'],
};
