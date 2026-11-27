// @ts-check
/** manhole —— 井盖为什么是圆的：定宽图形。zoom punch + 延迟答案（勒洛三角反转）。 */
export default {
  title:'井盖为什么非得是圆的',
  logline:'圆任意方向一样宽，怎么转都掉不下去；方的对角线更长会掉',
  audience:'每天踩过井盖没想过为什么的中文短片观众',
  duration:30, width:1920,height:1080,fps:24, captions:true,
  style:{name:'blueprint',signals:['深蓝坐标纸托起冷白井盖轮廓','信号青只点亮正在被解释的宽度方向','井口用暗色方/圆框'],flipped:['翻掉居中大字淡入模板脸','翻掉静态示意图(用旋转掉落动画)','翻掉开场就说圆最好']},
  world:{background:'blueprint 坐标纸暗底',camera:'cameraPost 呼吸 + 峰值 zoom punch',motif:'同一个井口贯穿 方掉→圆不掉→勒洛反转'},
  segments:[
    {id:'hook',role:'hook',at:0,dur:4,hero:'方井盖旋转着掉进井口',metaphor:'方的转一下对角线竖起来就掉下去',motion:{primary:'0-1.5s 方盖平放井口；1.5s 旋转竖起对角线掉入；zoom punch 到掉落瞬间',secondary:'对角线信号青高亮比井口宽',ambient:'坐标网格'},peak:{at:1.5,what:'突然放大：方盖对角线竖起掉进井（全片1.5s，冲击）'},stateDiff:'平放安全态变旋转掉落',relayTo:'井口',onscreen:['会掉'],build:'custom'},
    {id:'bridge',role:'bridge',at:4,dur:5,hero:'圆井盖怎么转都不掉',metaphor:'圆任意方向直径相同，永远卡住',motion:{primary:'圆盖旋转任意角度，宽度始终=井口；zoom out 看全貌',secondary:'多方向直径线等长',ambient:'相机微推'},peak:{at:3,what:'缩小看全貌：圆转任意角度都卡住（全片7s，对比）'},stateDiff:'方掉变圆不掉',relayTo:'井口',onscreen:['怎么转都不掉'],build:'custom'},
    {id:'mechanism',role:'mechanism',at:9,dur:8,hero:'【答案峰①】定宽定义：任意方向宽度相等',metaphor:'圆是定宽图形，宽度=直径恒定',motion:{primary:'旋转卡尺测圆各方向宽度，读数恒定；zoom punch 到宽度读数',secondary:'宽度数值锁定',ambient:'网格随旋转'},peak:{at:5,what:'放大宽度读数：所有方向同宽（全片14s，答案峰①）'},stateDiff:'现象变成定宽定义',relayTo:'定宽',onscreen:['定宽图形'],build:'custom'},
    {id:'data',role:'data',at:17,dur:6,hero:'【答案峰②】勒洛三角也定宽——反转',metaphor:'不止圆！勒洛三角任意方向也等宽，也能当井盖',motion:{primary:'勒洛三角旋转卡尺测宽恒定；zoom punch 到三角',secondary:'与圆并置同宽',ambient:'相机跟随'},peak:{at:3,what:'放大勒洛三角：非圆也定宽（全片20s，答案峰②反转）'},stateDiff:'圆唯一变勒洛三角也行',relayTo:'勒洛三角',onscreen:['它也行'],build:'custom'},
    {id:'close',role:'close',at:23,dur:7,hero:'zoom out 圆最简——造起来最容易',metaphor:'定宽图形里圆最好造，所以井盖是圆的',motion:{primary:'zoom out 圆+勒洛并置，圆高亮',secondary:'「圆最易加工」标注',ambient:'相机停稳'},peak:{at:3,what:'缩小回全景：圆最简胜出（全片26s，收束）'},stateDiff:'回溯工程选择',relayTo:'',onscreen:['圆最好造'],build:'custom'},
  ],
  antiList:['开场用掉落冲击抓视线，答案压后段','用旋转掉落+zoom punch，取消静态图','抽象几何不搬真实井盖照片'],
};
