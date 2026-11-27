// @ts-check
/** 统一 zoom punch：对准主体包围盒中心，倍率自适应不裁切主体。
 * bbox=[x,y,w,h] 主体包围盒（逻辑像素）。zoomTarget 目标倍率。
 * 返回实际安全 zoom（保证主体放大后仍在画面内，留 margin）。 */
export function safeZoom(W, H, bbox, zoomTarget, margin=0.85) {
  const [bx,by,bw,bh]=bbox;
  const cx=bx+bw/2, cy=by+bh/2;
  // 主体放大后宽高须 ≤ 画面×margin → zoom ≤ min(W*margin/bw, H*margin/bh)
  const maxZ=Math.min(W*margin/Math.max(1,bw), H*margin/Math.max(1,bh));
  const z=Math.min(zoomTarget, Math.max(1, maxZ));
  return { zoom:z, anchor:[cx,cy] };
}
