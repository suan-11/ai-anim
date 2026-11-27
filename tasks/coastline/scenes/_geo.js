// @ts-check
/** coastline 共享：科赫式递归细分海岸线。 */
// 基线段两端，递归 n 级（每段中点凸起等边三角）
export function koch(p0, p1, depth) {
  if (depth <= 0) return [p0, p1];
  const dx=p1[0]-p0[0], dy=p1[1]-p0[1];
  const a=[p0[0]+dx/3, p0[1]+dy/3];
  const b=[p0[0]+dx*2/3, p0[1]+dy*2/3];
  // 凸起顶点（向左法向旋转60°）
  const ang=Math.atan2(dy,dx)-Math.PI/3;
  const len=Math.hypot(dx,dy)/3;
  const peak=[a[0]+Math.cos(ang)*len, a[1]+Math.sin(ang)*len];
  const segs=[[p0,a],[a,peak],[peak,b],[b,p1]];
  let out=[];
  for(const [s,e] of segs){ const sub=koch(s,e,depth-1); out=out.concat(sub.slice(0,-1)); }
  out.push(p1);
  return out;
}
// 一条海岸线：多段基线拼接 + 递归
export function coastline(W, H, depth) {
  const base=[[180,H*0.55],[W*0.35,H*0.45],[W*0.55,H*0.6],[W*0.75,H*0.42],[W-180,H*0.5]];
  let pts=[];
  for(let i=1;i<base.length;i++){ const sub=koch(base[i-1],base[i],depth); pts=pts.concat(sub.slice(0,-1)); }
  pts.push(base[base.length-1]);
  return pts;
}
export function pathLen(pts){ let L=0; for(let i=1;i<pts.length;i++) L+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]); return L; }
