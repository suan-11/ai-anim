// @ts-check
/** penrose —— 不可能图形：看着合理却造不出来。zoom punch + 延迟答案（旋转揭示断开）。 */
export default {
  title: '这个三角形，造不出来',
  logline: '二维投影骗过眼睛，三维里它根本接不上',
  audience: '喜欢视错觉与几何悖论的中文短片观众',
  duration: 32, width: 1920, height: 1080, fps: 24, captions: true,
  style: { name:'blueprint', signals:['深蓝坐标纸托起冷白梁线稿','信号青只点亮正在被解释的接缝','等距投影网格承载不可能感'], flipped:['翻掉居中大字淡入模板脸','翻掉静态插图(用旋转揭示断开)','翻掉开场就说破不可能'] },
  world: { background:'blueprint 坐标纸暗底', camera:'cameraPost 呼吸 + 峰值 zoom punch', motif:'同一个三角贯穿 看似闭合→旋转→断开→不可能阶梯' },
  segments: [
    { id:'hook', role:'hook', at:0, dur:4, hero:'看似闭合的彭罗斯三角', metaphor:'三根梁首尾相接看着合理', motion:{primary:'0-1.5s 静态闭合三角；1.5s zoom punch 放大一个接缝',secondary:'接缝处信号色框出',ambient:'坐标网格淡显'}, peak:{at:1.5,what:'突然放大接缝：看着接上了（全片1.5s，只问不答）'}, stateDiff:'全景突变为放大接缝', relayTo:'三角接缝', onscreen:['？'], build:'custom' },
    { id:'bridge', role:'bridge', at:4, dur:5, hero:'三角缓慢旋转', metaphor:'转一点就开始不对劲', motion:{primary:'三角绕竖轴微旋，接缝错位渐显',secondary:'信号色追接缝',ambient:'相机微推'}, peak:{at:3,what:'旋转中接缝开始错开（全片7s，困惑）'}, stateDiff:'闭合态转向错位', relayTo:'三角接缝', onscreen:['转一下试试'], build:'custom' },
    { id:'mechanism', role:'mechanism', at:9, dur:8, hero:'【答案峰①】旋转到侧面揭示三梁实际断开', metaphor:'换个角度，首尾根本不在一处', motion:{primary:'旋转到侧视，三梁断口暴露；zoom punch 到断口',secondary:'断口信号色高亮+距离标注',ambient:'网格随旋转'}, peak:{at:5,what:'侧视断口暴露+放大：首尾相差一段（全片14s，答案峰①）'}, stateDiff:'错觉闭合变成真实断开', relayTo:'断口', onscreen:['其实没接上'], build:'custom' },
    { id:'data', role:'data', at:17, dur:7, hero:'【答案峰②】不可能阶梯（彭罗斯阶梯）循环上升', metaphor:'每一步都在上行却回到原点', motion:{primary:'阶梯逐阶点亮上行，绕一圈回起点；zoom punch 到起点终点重合',secondary:'高度计数器累加却归零',ambient:'相机跟随'}, peak:{at:4,what:'绕一圈回原点+放大重合点：一直上行却回原地（全片21s，答案峰②）'}, stateDiff:'单三角扩展到不可能阶梯族', relayTo:'阶梯起点', onscreen:['一直上 · 回原点'], build:'custom' },
    { id:'close', role:'close', at:24, dur:8, hero:'zoom out 回溯彭罗斯父子与埃舍尔', metaphor:'数学家与艺术家把不可能画成可能', motion:{primary:'zoom out 回全景，三角+阶梯并置',secondary:'1958 Penrose / Escher 标注显影',ambient:'相机停稳'}, peak:{at:3,what:'缩小回全景，不可能图形族并置（全片27s，收束）'}, stateDiff:'回溯源头', relayTo:'', onscreen:['1958 · Penrose'], build:'custom' },
  ],
  antiList: ['开场只问不答，答案压到 mechanism/data 后段峰值','用 zoom punch + 旋转揭示，取消匀速推拉','抽象线稿不搬埃舍尔版权画作'],
};
