// @ts-check
/**
 * tube-map 共享线网模型：站点身份 + 地理坐标(geo) + 拓扑坐标(topo)。
 * 抽象线网（非真实伦敦图），3 条线 + 1 换乘枢纽。坐标归一化 [0,1]。
 * 市中心站 geo 挤 topo 拉开；郊区站 geo 远 topo 压缩——拓扑保序牺牲距离。
 */
// 站点：id, line, geo:[x,y], topo:[x,y], hub(换乘), name
export const STATIONS = [
  // 红线（横贯）：西郊 → 市中心密团 → 东郊
  { id:'w2', line:0, geo:[0.04,0.42], topo:[0.10,0.50] },
  { id:'w1', line:0, geo:[0.10,0.44], topo:[0.22,0.50] },
  { id:'c1', line:0, geo:[0.46,0.48], topo:[0.38,0.50] },  // 市中心密团
  { id:'hub',line:0, geo:[0.49,0.50], topo:[0.50,0.50], hub:true }, // 换乘枢纽
  { id:'c2', line:0, geo:[0.52,0.51], topo:[0.62,0.50] },  // 市中心密团
  { id:'e1', line:0, geo:[0.80,0.55], topo:[0.78,0.50] },  // 东郊（geo 远）
  { id:'e2', line:0, geo:[0.95,0.58], topo:[0.90,0.50] },
  // 蓝线（纵贯，过枢纽）
  { id:'n2', line:1, geo:[0.47,0.08], topo:[0.50,0.12] },
  { id:'n1', line:1, geo:[0.48,0.22], topo:[0.50,0.28] },
  { id:'s1', line:1, geo:[0.51,0.72], topo:[0.50,0.72] },
  { id:'s2', line:1, geo:[0.53,0.92], topo:[0.50,0.88] },
  // 绿线（45° 斜，过枢纽）
  { id:'g1', line:2, geo:[0.20,0.18], topo:[0.26,0.26] },
  { id:'g2', line:2, geo:[0.34,0.34], topo:[0.38,0.38] },
  { id:'g3', line:2, geo:[0.66,0.68], topo:[0.62,0.62] },
  { id:'g4', line:2, geo:[0.82,0.86], topo:[0.74,0.74] },
];
// 线路色相（flat 风格信号色族）
export const LINE_COLORS = ['#ff5a5f','#3aa0ff','#3ad07a']; // 红/蓝/绿
// 每条线的站点顺序（连线用）
export const LINES = [
  ['w2','w1','c1','hub','c2','e1','e2'],
  ['n2','n1','hub','s1','s2'],
  ['g1','g2','hub','g3','g4'],
];
export const byId = (id) => STATIONS.find(s => s.id === id);
// 坐标插值：k=0 地理, k=1 拓扑
export function pos(st, k, W, H, pad=160) {
  const x = st.geo[0] + (st.topo[0]-st.geo[0])*k;
  const y = st.geo[1] + (st.topo[1]-st.geo[1])*k;
  return [pad + x*(W-2*pad), pad + y*(H-2*pad)];
}
