// @ts-check
/**
 * 转场 shader 表（BACKLOG 1-13：wipe / iris / glitch / pixel / dissolve）。
 *
 * 为什么单独一个文件：这里只有 GLSL 字符串，改它**从不**需要动 `trans.js` 的逻辑；
 * 而 `trans.js` 里混着碰撞比例、摄影机曲线、转场套件三件事，已经够长了。
 *
 * 约定（改任何一支之前先读）：
 *   · 所有模式共用同一组 uniform：`under` / `k` / `dir` / `push` / `blur` / `fadeAt`；
 *   · `fragColor` 的 **alpha = "旧帧还剩多少"**（引擎那侧是 blitBack + 叠加合成）；
 *   · `'mix'` / `'none'` **不在**这张表里 —— 它们不走 Pass。
 *
 * ⚠ **`push` 的源码与 2026-10-30 之前 `trans.js` 内联的那一份逐字符相同。**
 *   `tools/test-transition-collision.mjs` 用 `src` 字符串钉着这一条：
 *   已交付片子的画面一个像素都不许动。
 */

export const TRANSITION_FRAG = {
  /** 甩镜：沿摄影机方向加速推出去 + 方向拖尾（**默认**，源码与老版逐字符相同） */
  push: /* glsl */ `    uniform sampler2D under;
    uniform float k;
    uniform vec2 dir;
    uniform float push, blur, fadeAt;
    void main() {
      vec2 uv = vUv;
      float kk = clamp(k, 0.0, 1.0);
      // 位移随 k 加速，拖尾同时变宽 = 速度感
      float p = push * kk * kk;
      float b = 0.018 + blur * kk;
      vec2 uv2 = clamp(uv - dir * p, vec2(0.001), vec2(0.999));
      vec3 acc = vec3(0.0);
      float wsum = 0.0;
      for (int i = 0; i < 10; i++) {
        float f = float(i) / 9.0;
        float w = 1.0 - abs(f - 0.5) * 0.9;
        acc += texture(under, clamp(uv2 + dir * (f - 0.5) * b, vec2(0.001), vec2(0.999))).rgb * w;
        wsum += w;
      }
      // 前半程就送走，别让两屏文字长时间叠着
      float a = 1.0 - smoothstep(0.0, max(0.02, fadeAt), kk);
      fragColor = vec4(acc / wsum, a);
    }`,
  /** 擦除：一条软边沿扫描轴推过去，前沿带一道暖光 */
  wipe: /* glsl */ `    uniform sampler2D under;
    uniform float k;
    uniform vec2 dir;
    uniform float push, blur, fadeAt;
    void main() {
      float kk = clamp(k, 0.0, 1.0);
      // 扫描轴：沿摄影机方向横着推过去
      vec2 ax = normalize(dir + vec2(1e-6, 0.0));
      float s = dot(vUv - 0.5, ax) + 0.5;          // 0..1 沿扫描轴的位置
      float edge = mix(0.055, 0.012, kk);          // 前面细、收尾稍软，但不糊成溶解
      float front = kk * (1.0 + edge * 2.0) - edge;
      // ⚠ 旧帧在**前沿之外**（m = 1 在 s > front 那一侧）：前沿扫过去，扫过的部分就是新画面。
      //   反过来写会让旧帧越擦越多，只在 alpha 归零时整体消失 —— 那不是擦除，是"渐显"。
      float m = smoothstep(front - edge, front + edge, s);
      // 前沿一条亮边 = "纸被掀起来"的那道光，只在擦除进行时可见
      float band = 1.0 - smoothstep(0.0, edge * 2.5, abs(s - front));
      float a = m;   // 掩码自己就收到 0（擦过的地方不该再有旧帧），再叠一层全局淡出只会让画面发灰
      vec3 col = texture(under, vUv).rgb;
      col += vec3(0.09, 0.085, 0.07) * band * (1.0 - kk);
      fragColor = vec4(col, a);
    }`,
  /** 光圈：圆形从中心张开（取 RES_LOGICAL 的长宽比，所以是正圆不是椭圆） */
  iris: /* glsl */ `    uniform sampler2D under;
    uniform float k;
    uniform vec2 dir;
    uniform float push, blur, fadeAt;
    void main() {
      float kk = clamp(k, 0.0, 1.0);
      vec2 d = vUv - 0.5;
      d.x *= RES_LOGICAL.x / RES_LOGICAL.y;      // 圆形而不是椭圆
      float r = length(d);
      float rad = kk * 0.86;                      // 中心张开到铺满（对角半径 ≈ 0.71）
      float aa = max(fwidth(r), 1e-4) * 1.5;
      // ⚠ 旧帧留在**圈外**、新画面从圆心长出来：m = 1 表示"旧帧还在"，
      //   所以必须随 r 递增（写成 1 - smoothstep 就是反的：光圈越开旧帧占得越多，
      //   只在 alpha 归零时突然消失 —— 出图一眼能看出来是"反着放"的）。
      float m = smoothstep(rad - aa, rad + aa, r);
      float a = m;   // 同上：光圈张开就是时间轴，不要额外的全局淡出
      vec3 col = texture(under, vUv).rgb;
      // 光圈边缘一圈暖光（是"光"，不是描边）
      float rim = (1.0 - smoothstep(0.0, aa * 6.0, abs(r - rad))) * (1.0 - kk);
      col += vec3(0.10, 0.09, 0.07) * rim;
      fragColor = vec4(col, a);
    }`,
  /**
   * 角度扫描（旋转转场族的第一支）：新画面从一个角度开始、绕中心扫一圈露出来。
   *
   * 只吃**共用 uniform**（不新增 anchor/turns）—— 中心固定画面中心，起始角由 `dir` 推出来，
   * 于是「扫描方向跟着摄影机走」，而且在竖屏里也不会反（`dir` 已经是屏幕空间的）。
   *
   * 与 `wipe`（横竖直线）/ `iris`（同心圆）的区别：圆环状露出，节奏是「转」而不是「推」。
   * ⚠ 圆心是 `atan` 的奇点：`fwidth(ang)` 在那里炸开 ⇒ 必须按半径把中心那一小块单独处理。
   */
  sweep: /* glsl */ `    uniform sampler2D under;
    uniform float k;
    uniform vec2 dir;
    uniform float push, blur, fadeAt;
    void main() {
      float kk = clamp(k, 0.0, 1.0);
      vec2 d = vUv - 0.5;
      d.x *= RES_LOGICAL.x / RES_LOGICAL.y;          // 角度要按圆算，不按矩形
      float r = length(d);
      float ang = atan(d.y, d.x) / 6.2831853 + 0.5;  // 0..1，0 在 +x
      // 起始角跟着摄影机方向走（dir 已是屏幕空间），于是扫描方向与甩镜一致
      float start = atan(dir.y, dir.x) / 6.2831853 + 0.5;
      float edge = fract(start + kk);                 // 扫到哪个角度了
      float dd = fract(ang - edge + 1.0);             // 还没扫到的角度差（环形）
      float aa = max(fwidth(dd), 1e-4) * 1.5;
      float m = 1.0 - smoothstep(0.0, aa, dd);        // 1 = 旧帧还没被扫到
      // 扫过的那道边给一圈暖光（是光，不是描边）
      float rim = (1.0 - smoothstep(0.0, aa * 5.0, dd)) * (1.0 - kk);
      // 圆心奇点：atan 无定义、fwidth 爆掉 ⇒ 半径 < 0.02 处直接按 kk 线性过渡，不给 rim
      float c = smoothstep(0.0, 0.02, r);
      vec3 col = texture(under, vUv).rgb + vec3(0.09, 0.08, 0.06) * rim * c;
      fragColor = vec4(col, mix(1.0 - kk, m, c));
    }`,
  /** 菱形扩散：中心先露出，四条斜边向外推开旧画面。 */
  diamond: /* glsl */ `    uniform sampler2D under;
    uniform float k; uniform vec2 dir; uniform float push, blur, fadeAt;
    void main() {
      float kk = clamp(k, 0.0, 1.0);
      if (kk <= 0.0) { fragColor = texture(under, vUv); return; }
      if (kk >= 1.0) { fragColor = vec4(0.0); return; }
      vec2 d = abs(vUv - 0.5);
      d.x *= RES_LOGICAL.x / RES_LOGICAL.y;
      float r = d.x + d.y;
      float rad = kk * 0.98;
      float aa = max(fwidth(r), 1e-4) * 1.5;
      float m = smoothstep(rad - aa, rad + aa, r);
      float rim = (1.0 - smoothstep(0.0, aa * 7.0, abs(r - rad))) * (1.0 - kk);
      vec3 col = texture(under, vUv).rgb + vec3(0.08, 0.07, 0.05) * rim;
      fragColor = vec4(col, m);
    }`,
  /** 方框扩散：四条边同时退开，适合网格与标题卡之间的切换。 */
  frame: /* glsl */ `    uniform sampler2D under;
    uniform float k; uniform vec2 dir; uniform float push, blur, fadeAt;
    void main() {
      float kk = clamp(k, 0.0, 1.0);
      if (kk <= 0.0) { fragColor = texture(under, vUv); return; }
      if (kk >= 1.0) { fragColor = vec4(0.0); return; }
      vec2 d = abs(vUv - 0.5);
      d.x *= RES_LOGICAL.x / RES_LOGICAL.y;
      float r = max(d.x, d.y);
      float rad = kk * 0.96;
      float aa = max(fwidth(r), 1e-4) * 1.5;
      float m = smoothstep(rad - aa, rad + aa, r);
      float rim = (1.0 - smoothstep(0.0, aa * 7.0, abs(r - rad))) * (1.0 - kk);
      vec3 col = texture(under, vUv).rgb + vec3(0.07, 0.065, 0.05) * rim;
      fragColor = vec4(col, m);
    }`,
  /** 四角退场：四个角先打开，旧画面向中心收紧。 */
  corners: /* glsl */ `    uniform sampler2D under;
    uniform float k; uniform vec2 dir; uniform float push, blur, fadeAt;
    void main() {
      float kk = clamp(k, 0.0, 1.0);
      if (kk <= 0.0) { fragColor = texture(under, vUv); return; }
      if (kk >= 1.0) { fragColor = vec4(0.0); return; }
      vec2 q = vUv - 0.5;
      q.x *= RES_LOGICAL.x / RES_LOGICAL.y;
      float d = min(min(length(q - vec2(-.889, -.5)), length(q - vec2(.889, -.5))),
                    min(length(q - vec2(-.889, .5)), length(q - vec2(.889, .5))));
      float rad = kk * .88;
      float aa = max(fwidth(d), 1e-4) * 1.5;
      float m = smoothstep(rad - aa, rad + aa, d);
      float rim = (1.0 - smoothstep(0.0, aa * 7.0, abs(d - rad))) * (1.0 - kk);
      vec3 col = texture(under, vUv).rgb + vec3(0.075, 0.067, 0.05) * rim;
      fragColor = vec4(col, m);
    }`,
  /** 对开：两个半幅向外移走，纹理保持原比例；缝隙直接露出下一帧。 */
  split: /* glsl */ `    uniform sampler2D under;
    uniform float k; uniform vec2 dir; uniform float push, blur, fadeAt;
    void main() {
      float kk = clamp(k, 0.0, 1.0);
      if (kk >= 1.0) { fragColor = vec4(0.0); return; }
      vec2 axis = abs(dir.x) >= abs(dir.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
      float s = dot(vUv, axis);
      float side = s < 0.5 ? -1.0 : 1.0;
      float move = kk*kk*kk*(kk*(kk*6.0-15.0)+10.0) * 0.5;
      vec2 uv = vUv - axis * side * move;
      float source = dot(uv, axis);
      // Each half only samples its own original half: no repeated edge pixels.
      float inside = step(0.0, source) * step(source, 1.0) * step(0.0, side*(source-0.5));
      fragColor = vec4(texture(under, clamp(uv,0.0,1.0)).rgb, inside);
    }`,
  /** 条带交错滑出：8 条独立平移，保留文字形状；竖向运动时自动转为竖条。 */
  slats: /* glsl */ `    uniform sampler2D under;
    uniform float k; uniform vec2 dir; uniform float push, blur, fadeAt;
    uniform float bands;                       // 条数（transitionOpts.bands，默认 8）
    void main() {
      float kk = clamp(k, 0.0, 1.0);
      if (kk >= 1.0) { fragColor = vec4(0.0); return; }
      vec2 axis = abs(dir.x) >= abs(dir.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
      vec2 crossAxis = vec2(axis.y, axis.x);
      float n = max(2.0, floor(bands));
      float lane = min(n - 1.0, floor(dot(vUv,crossAxis) * n));
      float p = clamp(kk*1.24 - lane/(n-1.0)*0.24,0.0,1.0);
      float move = p*p*p*(p*(p*6.0-15.0)+10.0);
      float signDir = dot(dir,axis) < 0.0 ? -1.0 : 1.0;
      float side = (mod(lane,2.0) < 1.0 ? 1.0 : -1.0) * signDir;
      vec2 uv = vUv - axis * side * move;
      float source = dot(uv,axis);
      float inside = step(0.0,source) * step(source,1.0);
      fragColor = vec4(texture(under,clamp(uv,0.0,1.0)).rgb,inside);
    }`,
  /**
   * 百叶翻面（`turn`）：把画面切成 N 条竖条，每条**各自绕自己的竖轴转**，逐条错峰合上。
   *
   * 为什么不做「整帧旋转」：那是把一张图拧一遍，用户原话是「旋转指画面切换」「拉伸特别笨」。
   * 竖条各自转的时候，每条都有**自己的轴与自己的遮挡**，观感是「一片片翻过去」而不是橡皮筋。
   *
   * 数学：第 i 条的进度 `kk_i = clamp(k*(1+stagger) - i/N*stagger)`，θ = kk_i·π/2，
   * 宽度因子 `w = |cosθ|`，采样 `u' = 0.5 + (u-0.5)/max(w, 1e-3)`，越界即透明（露出新画面）。
   * 侧向受光：`lit = 1 - 0.55·sinθ`（转过去的那一下变暗，像纸/玻璃的背光）。
   */
  turn: /* glsl */ `    uniform sampler2D under;
    uniform float k; uniform vec2 dir; uniform float push, blur, fadeAt;
    uniform float cols, stagger;
    void main() {
      float kk = clamp(k, 0.0, 1.0);
      float n = max(2.0, floor(cols));
      float u = vUv.x * n;
      float i = floor(u);
      float fu = fract(u);                       // 条内坐标 0..1
      // 错峰：第 i 条晚开始，方向由 dir.x 决定（跟摄影机一致）
      float order = dir.x < 0.0 ? (n - 1.0 - i) : i;
      float kkI = clamp(kk * (1.0 + stagger) - (order / n) * stagger, 0.0, 1.0);
      float th = kkI * 1.5707963;                // 0 → 90°
      float w = cos(th);                         // 投影后的宽度因子
      float lit = 1.0 - 0.55 * sin(th);           // 侧向受光
      vec2 p = vUv;
      p.x = (i + 0.5 + (fu - 0.5) / max(abs(w), 0.02)) / n;   // 反算采样位置
      float inside = step(abs(fu - 0.5), 0.5 * abs(w));       // 条宽收缩 ⇒ 两侧露出新画面
      vec3 col = texture(under, clamp(p, 0.0, 1.0)).rgb * lit;
      // 侧过去时给「背面」压暗：缝隙里别露出白底，否则中段整帧发灰
      col = mix(col, vec3(0.07, 0.065, 0.06), smoothstep(0.55, 0.05, abs(w)));
      // 条的边缘给一道极细的亮线（纸的侧面），只在「正在转」时出现
      float edge = smoothstep(0.5 * abs(w), 0.5 * abs(w) - 0.02, abs(fu - 0.5)) * (1.0 - kkI) * 0.5;
      col += vec3(0.06, 0.058, 0.05) * edge;
      fragColor = vec4(col, inside);
    }`,
  glitch: /* glsl */ `    uniform sampler2D under;
    uniform float k;
    uniform vec2 dir;
    uniform float push, blur, fadeAt;
    void main() {
      float kk = clamp(k, 0.0, 1.0);
      // 切片：按行分块，每块一个哈希出的横向错位；越靠近中段越猛（钟形）
      float env = sin(kk * PI);
      float band = floor(vUv.y * 26.0);
      float h = hash12(vec2(band, floor(t * 24.0)));
      float h2 = hash12(vec2(band + 71.0, floor(t * 24.0) + 13.0));
      float slice = (h - 0.5) * 0.14 * env * (0.35 + h2 * 0.65);
      float ca = 0.006 * env * (0.4 + h * 0.6);   // RGB 分离
      vec2 uv = vec2(vUv.x + slice, vUv.y);
      vec3 col;
      col.r = texture(under, clamp(uv + vec2(ca, 0.0), vec2(0.001), vec2(0.999))).r;
      col.g = texture(under, clamp(uv, vec2(0.001), vec2(0.999))).g;
      col.b = texture(under, clamp(uv - vec2(ca, 0.0), vec2(0.001), vec2(0.999))).b;
      // 极短的整帧闪白：只在 k≈0.5 那一小段
      float spike = smoothstep(0.42, 0.5, kk) * (1.0 - smoothstep(0.5, 0.58, kk));
      col += vec3(0.10) * spike * env;
      float a = 1.0 - smoothstep(0.0, max(0.02, fadeAt), kk);
      fragColor = vec4(col, a);
    }`,
  /** 像素块溶解：格子由密到疏，每格用自己的哈希门限消失 */
  pixel: /* glsl */ `    uniform sampler2D under;
    uniform float k;
    uniform vec2 dir;
    uniform float push, blur, fadeAt;
    void main() {
      float kk = clamp(k, 0.0, 1.0);
      // 格子从 240 个长到 34 个（块越散越大）；每格用自己的哈希决定何时消失
      float cells = mix(240.0, 34.0, kk);
      vec2 g = floor(vUv * cells);
      vec2 uvq = (g + 0.5) / cells;              // 取格中心 = 天然像素化
      float th = 0.55 + hash12(g) * 0.5;         // 门限错开：0.55..1.05
      float m = step(kk, th);
      vec3 col = texture(under, uvq).rgb;
      float a = m;   // 同上：逐格门限就是时间轴
      fragColor = vec4(col, a);
    }`,
  /** 噪声阈值溶解：多尺度哈希做门限，边缘微微发亮 */
  dissolve: /* glsl */ `    uniform sampler2D under;
    uniform float k;
    uniform vec2 dir;
    uniform float push, blur, fadeAt;
    void main() {
      float kk = clamp(k, 0.0, 1.0);
      // 多尺度噪声阈值：等比混合会把中间调糊成一块，阈值溶解是"一点点被吃掉"。
      // ⚠ 必须用**插值过的**值噪声（GLSL_COMMON 的 vnoise 就是）：每个像素各 hash 一个值
      //   得到的是白噪声 —— 画面会变成"电视雪花"而不是"被吃掉"（第一版就是这样，出图当场看出来）。
      //   尺度要粗（fbm 的 5 个八度已经到 16 格），越细越像噪点。
      vec2 np = vUv * vec2(RES_LOGICAL.x / RES_LOGICAL.y, 1.0) * 5.0;
      float n = sat(fbm(np) * 1.15);              // fbm 在 0..1 之间但集中在 0.5 附近，拉一下对比
      float edge = 0.055;
      // m = "旧帧还剩多少"：kk 越过这个像素的噪声值 ⇒ 它被吃掉。
      // ⚠ 写成 smoothstep(n-…, n+…, kk)（不带 1-）是**反的**：kk 越大旧帧越多，
      //   只在结尾整体消失 —— 出图是"新图先出来、旧图最后才盖回来"。
      float m = 1.0 - smoothstep(n - edge, n + edge, kk);
      vec3 col = texture(under, vUv).rgb;
      // 消融边缘微微发亮：像被光吃掉
      float burn = (1.0 - smoothstep(0.0, edge * 2.2, abs(kk - n))) * (1.0 - kk);
      col += vec3(0.07, 0.065, 0.055) * burn;
      fragColor = vec4(col, m);   // 同上：噪声门限就是时间轴
    }`,
};
