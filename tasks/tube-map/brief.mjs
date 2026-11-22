// @ts-check
/**
 * tube-map —— 为什么地铁图不按真实距离画（拓扑变形科普）。
 * 导演指令：① 忽然放大/缩小（zoom punch）制造注意力冲击；② 不开场给答案，
 * 答案（拓扑变形揭示）放到后 1-2 个注意力峰值（compare/data）。前段只藏悬念铺困惑。
 */
export default {
  title: '地铁图是「错」的，但这样才对',
  logline: '乘客只关心坐几站在哪换乘，不关心两站实际多远',
  audience: '每天坐地铁、没想过线路图为什么长这样的中文短片观众',
  duration: 40,
  width: 1920, height: 1080, fps: 24,
  captions: true,
  style: {
    name: 'flat',
    signals: [
      '中性暗底托起彩色线路与白色站点，地理镜与拓扑镜共用同一套站点身份',
      '每条线路一个固定色相，换乘站用白环黑心，普通站用短刻线',
      '信号色只点亮正在被解释的那条线或那对站点',
    ],
    flipped: [
      '翻掉纯色底居中大字淡入的模板脸',
      '翻掉把地图当静态插图（用站点坐标连续变形 + zoom punch 承载主体）',
      '翻掉开场就揭示答案的平铺直叙（答案压到后段峰值）',
    ],
  },
  world: {
    background: 'flat 中性暗底 + 极淡坐标网格，地理镜与拓扑镜共用',
    camera: 'cameraPost(f.t) 全片呼吸推镜 + 关键峰值处突然 zoom punch（放大/缩小）',
    motif: '一组固定身份的站点（含一个换乘枢纽）贯穿悬念→困惑→揭示→应用',
  },
  segments: [
    {
      id: 'hook', role: 'hook', at: 0, dur: 4,
      hero: '一张「看起来正常」的地铁图，突然 zoom 进市中心挤成团的站点',
      metaphor: '先给熟悉清爽的图，再猛然放大暴露「这里其实挤得不合理」——只抛疑问不解释',
      motion: {
        primary: '0-1.5s 清爽线网全景；1.5s 突然 zoom punch 放大到市中心密团（3×），停住',
        secondary: '放大后两站几乎重叠，信号色框出这对站，打问号',
        ambient: 'zoom 前相机平稳，zoom 时快速推近（spring 回弹）',
      },
      peak: { at: 1.5, what: '突然放大：市中心两站几乎叠在一起（全片 1.5s，第一注意力峰·只问不答）' },
      stateDiff: '清爽全景突变为放大的拥挤局部，抛出「为什么这么挤」疑问',
      relayTo: '市中心那对站点',
      onscreen: ['？'],
      build: 'custom',
    },
    {
      id: 'bridge', role: 'bridge', at: 4, dur: 6,
      hero: 'zoom 拉远回全景，再 punch 到郊区被拉长的稀疏线段',
      metaphor: '市中心挤、郊区却空——同一张图两种极端，困惑加深仍不给答案',
      motion: {
        primary: '4-5s 快速 zoom out 回全景；5.5s 再 zoom punch 到郊区拉长段（2.5×）',
        secondary: '郊区两站隔半屏，信号色框出，与市中心对形成反差',
        ambient: '两次 zoom 之间相机短暂停稳',
      },
      peak: { at: 5.5, what: '突然缩小再放大：郊区两站隔半屏（全片 9.5s，困惑峰·仍不答）' },
      stateDiff: '从市中心密团切到郊区稀疏，矛盾并置',
      relayTo: '站点身份集合',
      onscreen: ['这里却这么空'],
      build: 'custom',
    },
    {
      id: 'mechanism', role: 'mechanism', at: 10, dur: 8,
      hero: '地理真实的扭曲坐标线网（答案的前置：原来图一直按真实距离画会这样）',
      metaphor: '把站点摆回真实地理位置，线网歪扭难读——铺垫「需要一种新画法」但不揭示拓扑',
      motion: {
        primary: '站点从规整位置 lerp 回真实地理坐标，线网变歪扭',
        secondary: '一条线点亮，沿线顺序闪烁，强调「顺序是对的但距离难看」',
        ambient: '坐标网格淡显，相机微推',
      },
      peak: { at: 4, what: '地理真实线网完全歪扭，市中心团/郊区长同时可见（全片 14s，铺垫峰）' },
      stateDiff: '规整图退化为地理真实扭曲图，暴露问题',
      relayTo: '站点身份集合',
      onscreen: ['按真实距离画'],
      build: 'custom',
    },
    {
      id: 'compare', role: 'compare', at: 18, dur: 10,
      hero: '【答案揭示·第一峰值】同一组站点从地理坐标连续变形到 45° 拓扑网格',
      metaphor: '站点像被磁铁吸到网格：市中心拉开、郊区压缩，线只走横竖 45°——这就是答案',
      motion: {
        primary: '18-22s 每个站点坐标从地理值 lerp 到拓扑值，线拉直成横/竖/45°；22s zoom punch 放大换乘枢纽确认连接不变',
        secondary: '变形中连线关系不变（枢纽始终多线交点），变形完突然 zoom in 到枢纽',
        ambient: '网格随变形淡入，zoom 时快速推近',
      },
      peak: { at: 4, what: '变形完成 + 突然放大换乘枢纽：所有线只剩横竖45°，连接不变（全片 22s，答案峰①）' },
      stateDiff: '地理扭曲坐标变成规整拓扑网格，连接关系不变——揭示拓扑变形',
      relayTo: '拓扑网格与换乘枢纽',
      onscreen: ['只留 横 · 竖 · 45°'],
      build: 'custom',
    },
    {
      id: 'data', role: 'data', at: 28, dur: 6,
      hero: '【答案深化·第二峰值】拓扑图上路径规划 + 站数/距离反差对照',
      metaphor: '拓扑让数站数找换乘一眼可读；市中心对与郊区对站数相同距离相反——答案的价值',
      motion: {
        primary: '起点终点亮起沿拓扑线逐站点亮，换乘枢纽换色；28-30s zoom punch 到站数计数器',
        secondary: '高亮两对站点「站数相同·距离不同」，突然放大计数器读数',
        ambient: '其余线网压暗，zoom 跟随',
      },
      peak: { at: 2, what: '突然放大站数计数器：两对站数相同但真实距离相反（全片 30s，答案峰②）' },
      stateDiff: '静态拓扑图变成可读路径规划 + 距离反差对照',
      relayTo: '换乘枢纽',
      onscreen: ['站数一样 · 距离不同'],
      build: 'custom',
    },
    {
      id: 'close', role: 'close', at: 34, dur: 6,
      hero: 'zoom out 拉远，拓扑图叠上电路图意象回溯贝克 1933',
      metaphor: '工程制图员把电路图思路搬到地图：连接比物理位置重要——收束',
      motion: {
        primary: '34-35s 快速 zoom out 回全景；拓扑图淡出叠电路图节点连线，再回当下线网',
        secondary: '1933 与 Harry Beck 标注显影',
        ambient: '相机停稳，线网低亮度呼吸',
      },
      peak: { at: 2, what: '缩小回全景，电路图与地铁图叠合同源（全片 36s，收束峰）' },
      stateDiff: '现代拓扑图回溯到电路图源头',
      relayTo: '',
      onscreen: ['1933 · Harry Beck'],
      build: 'custom',
    },
  ],
  antiList: [
    '开头只抛疑问不给答案，答案压到 compare/data 两个后段峰值',
    '用突然 zoom punch（放大/缩小）制造注意力冲击，取消匀速推拉',
    '变形用站点坐标连续 lerp，取消瞬切换图',
    '只用抽象线网站点，不搬真实伦敦地铁图版权图形',
  ],
};
