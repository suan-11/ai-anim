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
  /** 故障：横向切片错位 + RGB 分离 + 极短闪白（全由 t 哈希，可 seek） */
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
  spin: /* glsl */ `    uniform sampler2D under; uniform float k; uniform vec2 dir; uniform float push, blur, fadeAt;
    vec2 r02(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);}
    void main(){float kk=clamp(k,0.0,1.0),e=kk*kk*(3.0-2.0*kk); float a=-6.2831853*e; float sc=mix(1.0,1.42,e);
      vec2 d=r02((vUv-0.5)*sc,a)+0.5; float inside=step(0.0,d.x)*step(d.x,1.0)*step(0.0,d.y)*step(d.y,1.0);
      vec3 col=texture(under,clamp(d,0.0,1.0)).rgb; fragColor=vec4(col,inside*(1.0-smoothstep(1.0,1.35,length((vUv-0.5)*2.0))));}
  `,
  carousel: /* glsl */ `    uniform sampler2D under; uniform float k; uniform vec2 dir; uniform float push, blur, fadeAt;
    void main(){float kk=clamp(k,0.0,1.0),th=kk*1.5707963,xc=vUv.x-0.5,xw=xc*cos(th); float shade=1.0-0.55*abs(sin(th))*abs(xc);
      vec3 col=texture(under,vec2(clamp(xw+0.5,0.0,1.0),vUv.y)).rgb*shade; float a=smoothstep(0.5,0.42,abs(xw))*(1.0-smoothstep(0.9,1.0,kk)); fragColor=vec4(col,a);}
  `,
  swirl: /* glsl */ `    uniform sampler2D under; uniform float k; uniform vec2 dir; uniform float push, blur, fadeAt;
    vec2 r02(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);}
    void main(){float kk=clamp(k,0.0,1.0); vec2 d=vUv-0.5; float r=max(length(d),0.02); float a=kk*3.0*(1.0-smoothstep(0.0,0.5,r)); vec2 q=r02(d,a)+0.5; float sc=mix(1.0,1.25,kk); vec3 col=texture(under,clamp((q-0.5)*sc+0.5,0.0,1.0)).rgb; fragColor=vec4(col,1.0-smoothstep(0.35,0.62,kk));}
  `,
  shatter: /* glsl */ `    uniform sampler2D under; uniform float k; uniform vec2 dir; uniform float push, blur, fadeAt;
    // 只有这一支用（共用 uniform 对象里带着默认 7 / 7 / 0.8）；别的 shader 里不许出现这三个名字
    uniform float shards, seed, power;
    vec2 h2(vec2 c,float s){return fract(sin(vec2(dot(c,vec2(127.1,311.7)),dot(c,vec2(269.5,183.3)))+s)*43758.5453);} vec2 r02(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);}
    void main(){float kk=clamp(k,0.0,1.0); vec2 g=vUv*shards,ci=floor(g),cf=fract(g); float best=8.0,second=8.0; vec2 bc=ci;
      for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 cell=ci+vec2(x,y),off=vec2(x,y)+h2(cell,seed)*0.8+0.1; float dist=length(cf-off); if(dist<best){second=best;best=dist;bc=cell;}else if(dist<second)second=dist;}
      vec2 rnd=h2(bc,seed+11.0),fly=(rnd-0.5)*2.0*power*kk*kk,c0=(bc+0.5)/shards,p=r02(vUv-c0,(rnd.x-0.5)*6.0*kk)+c0+fly*0.18; vec3 col=texture(under,clamp(p,0.0,1.0)).rgb; float rim=(1.0-smoothstep(0.0,0.06,second-best))*(1.0-kk); fragColor=vec4(col+vec3(0.14,0.13,0.11)*rim,1.0-smoothstep(0.75,1.0,kk));}
  `,
};
