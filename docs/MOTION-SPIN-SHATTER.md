# 旋转式转场 × 镜碎（设计稿）

> 这两个是**同一族**：只对「整层像素」做几何变换，不碰内容。所以它们是 transition 的新模式
> （复用 transition-frag.js 的 under 纹理），**不要**写进场景里自己转 ctx.out —— 那会和全片共用背景/摄影机打架
> （AGENTS.md §4.5 的四条配方）。

## 0. 各自的用途（一句话）

| 效果 | 用在哪 | 已有模式为什么顶替不了 |
|---|---|---|
| 角度扫描 sweep | 同一画面里「换个视角继续说」 | wipe 只有横竖直线、iris 是同心圆；圆环露出的节奏不同 |
| 整层旋转 spin | 情绪翻转、段落级「转一圈」 | push 是平移，观感永远像翻页 |
| 旋转木马 carousel | 多段并列（几个方案/几个角色） | 需要圆筒透视：两侧压缩、中间展开 |
| 漩涡 swirl | 梦、眩晕、被吸进去 | 纯极坐标扭曲，属于「介质」不是「位移」 |
| 镜碎 shatter | 冲击、崩塌、破局 | **每片有自己的旋转与位移**，整层变换做不到 |

## 1. API（先定形状）

```js
cut(next, {
  dur: 6, overlap: 0.6, handlesTransition: true,
  transition: 'spin',            // 'sweep' | 'spin' | 'carousel' | 'swirl' | 'shatter'
  transitionOpts: {
    anchor: [0.5, 0.5],          // 旋转中心（uv）；sweep 的起始角也用它
    turns: 1,                    // 转几圈，可为负；sweep 用它当扫过的角度倍数
    scale: [1.0, 1.42],          // 起止缩放（1.42 = √2，转到 45° 不露边）
    seed: 7, shards: 7,          // shatter / swirl 的随机源与每边片数
    power: 1.0,                  // 碎片飞散强度
  },
});
```

transitionOpts 已经落在段上（TIMELINE_KEYS 里就有），**时间线不用改**。要动的是三处注册表 + 一份 shader：

```text
src/core/transition-frag.js      + TRANSITION_FRAG[mode] × 5
src/core/trans.js                TRANSITION_MODES / PASS_MODES / transitionFadeAt 各加一行
docs/ENGINE.md §3.7.6            模式表加五行（写错仍要当场抛并列可用值）
tools/test-transition-modes.mjs  每个模式一条：同 t 渲两次逐像素一致
```

## 2. 四个旋转转场

### 2.1 sweep —— 角度扫描（最便宜，建议先落地）

```glsl
uniform sampler2D under;
uniform float k; uniform vec2 dir;
uniform float push, blur, fadeAt;
uniform vec2 anchor;   // uv 0..1
uniform float turns;   // 1 = 扫一圈
void main() {
  float kk = clamp(k, 0.0, 1.0);
  vec2 d = vUv - anchor;
  d.x *= RES_LOGICAL.x / RES_LOGICAL.y;              // 角度按圆算，不按矩形
  float ang = atan(d.y, d.x) / 6.2831853 + 0.5;      // 0..1，0 在 +x
  float edge = fract(kk * turns);
  float dd = fract(ang - edge + 1.0);                // 已扫到的角度差（环形）
  float aa = max(fwidth(dd), 1e-4) * 1.5;
  float m = 1.0 - smoothstep(0.0, aa, dd);           // 1 = 旧帧还没被扫到
  float rim = (1.0 - smoothstep(0.0, aa * 5.0, dd)) * (1.0 - kk);
  float centre = smoothstep(0.0, 0.02, length(d));   // 圆心奇点：atan 无定义，fwidth 会爆
  vec3 col = texture(under, vUv).rgb + vec3(0.09, 0.08, 0.06) * rim * centre;
  fragColor = vec4(col, mix(1.0 - kk, m, centre));
}
```

- **坑：中心奇点**。atan 在 d≈0 处无定义，fwidth(ang) 在那里炸开 ⇒ 圆心一圈噪点。必须按 radius 把那一小块单独处理。
- **坑：环形接缝**。fract 的跳变会被抗锯齿画成一条硬线；抗锯齿宽度只用于 aa，可见性仍用单调量。
- turns: 1 配 0.6s overlap 刚好；turns: 2 会显得在赶。

### 2.2 spin —— 整层旋转

```glsl
vec2 r02(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }
void main() {
  float kk = clamp(k, 0.0, 1.0);
  float e = kk * kk * (3.0 - 2.0 * kk);            // 两端都停得下来
  float a = -turns * 6.2831853 * e;
  float sc = mix(1.0, 1.42, e);                     // 必须随 e 涨到 √2，否则 30° 就露黑角
  vec2 d = r02((vUv - anchor) * sc, a) + anchor;
  float inside = step(0.0, d.x) * step(d.x, 1.0) * step(0.0, d.y) * step(d.y, 1.0);
  vec3 col = texture(under, clamp(d, 0.0, 1.0)).rgb;
  fragColor = vec4(col, inside * (1.0 - smoothstep(1.0, 1.35, length((vUv - 0.5) * 2.0))));
}
```

- **坑：露边**。旋转必然采样到 [0,1] 外；clamp 只防 NaN，不防「边缘像素被拉成条纹」。缩放要同步放大到 √2。
- **坑：方向语义**。新帧由引擎铺底，这里只负责旧帧；a 的符号决定观感是「推着转」还是「被拧出去」，
  **不要跟 dir 联动**（否则竖屏会反过来）。

### 2.3 carousel —— 圆筒透视

```glsl
void main() {
  float kk = clamp(k, 0.0, 1.0);
  float th = kk * 1.5707963;                       // 0..90°
  float xc = vUv.x - 0.5;
  float xw = xc * cos(th);                         // 两侧压进来
  float shade = 1.0 - 0.55 * abs(sin(th)) * abs(xc); // 侧面变暗（受光衰减）
  vec3 col = texture(under, vec2(clamp(xw + 0.5, 0.0, 1.0), vUv.y)).rgb * shade;
  fragColor = vec4(col, smoothstep(0.5, 0.42, abs(xw)) * (1.0 - smoothstep(0.9, 1.0, kk)));
}
```

- 只该用在「并列的几段」；单段之间用会像换台。
- shade 别用 pow：侧面暗到 0.2 以下会发灰，0.55 是实测上限。

### 2.4 swirl —— 漩涡（介质感）

```glsl
void main() {
  float kk = clamp(k, 0.0, 1.0);
  vec2 d = vUv - 0.5;
  float r = max(length(d), 0.02);                  // 半径 < 0.02 别卷，否则变噪点
  float a = kk * 3.0 * (1.0 - smoothstep(0.0, 0.5, r));
  vec2 p = r02(d, a) + 0.5;
  float sc = mix(1.0, 1.25, kk);
  vec3 col = texture(under, clamp((p - 0.5) * sc + 0.5, 0.0, 1.0)).rgb;
  fragColor = vec4(col, 1.0 - smoothstep(0.35, 0.62, kk));
}
```

- 全场 alpha 的消失要比卷动**慢半拍**，否则像「突然关掉」。

## 3. 镜碎 shatter

### 3.1 三种做法

| 做法 | 形态 | 代价 | 结论 |
|---|---|---|---|
| 三角网格 | 最像真玻璃（长条 + 放射纹） | 顶点表要进 uniform 数组（48 片 = 144 个 vec2） | 好看但重 |
| Voronoi 碎片 | 多边形碎块，边缘自然 | 每像素 3×3 邻域 9 次查，纯 GLSL | **选这个**：无 uniform 数组、天然可 seek |
| 行列碎块 | 方块拼图，游戏感 | 最便宜 | 太规则，像马赛克不像玻璃 |

### 3.2 Voronoi 版（片段草稿）

```glsl
vec2 h2(vec2 c, float s) {   // 纯函数哈希：同 cell + 同 seed = 同结果（这是可 seek 的关键）
  return fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3))) + s) * 43758.5453);
}
void main() {
  float kk = clamp(k, 0.0, 1.0);
  vec2 g = vUv * shards, ci = floor(g), cf = fract(g);
  float best = 8.0, second = 8.0; vec2 bestCell = ci;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 cell = ci + vec2(x, y);
    vec2 off = vec2(x, y) + h2(cell, seed) * 0.8 + 0.1;
    float dist = length(cf - off);
    if (dist < best) { second = best; best = dist; bestCell = cell; }
    else if (dist < second) second = dist;
  }
  vec2 rnd = h2(bestCell, seed + 11.0);
  vec2 fly = (rnd - 0.5) * 2.0 * power * kk * kk;      // 二次加速 = 像炸开；匀速像图层被拉开
  float ang = (rnd.x - 0.5) * 6.0 * kk;                // 每片自转（转采样坐标，代价为零）
  vec2 c0 = (bestCell + 0.5) / shards;
  vec2 p = r02(vUv - c0, ang) + c0 + fly * 0.18;
  vec3 col = texture(under, clamp(p, 0.0, 1.0)).rgb;
  float rim = (1.0 - smoothstep(0.0, 0.06, second - best)) * (1.0 - kk);  // 到边界的距离 = 玻璃厚度
  fragColor = vec4(col + vec3(0.14, 0.13, 0.11) * rim, 1.0 - smoothstep(0.75, 1.0, kk));
}
```

- second - best 就是 Voronoi 里「到边界的距离」，天然给出厚度感，不用算梯度。
- 每片自转不能真的转几何（没有三角形），转的是**采样坐标** —— 观感等价。

### 3.3 第二种用法：镜头级（碎着出现 → 逐片吸合）

转场版是「旧帧碎掉」；更常用的是「画面自己碎着出现」。它不该做成转场，而是 post 之后的一层：

```js
import { shatterIn } from '../../../src/kit/shatter.js';
shatterIn(ctx, { seed: 7, shards: 7, t: f.lt, dur: 1.2, power: 0.8 });  // 在 comp.draw 之后
```

与转场版**共用同一个 hash**（同 seed = 同碎片形状），但 k 从 1 降到 0（飞回吸合），且只作用于当前层。
这样一条片子里「碎出去 / 碎回来」形状一致 —— 观众会觉得是同一块玻璃。**这是这套设计里最值钱的一条。**

## 4. 确定性检查清单（这几个效果最容易破 render(t)）

| 诱惑 | 为什么错 | 正确做法 |
|---|---|---|
| Math.random() 生成碎片 | 每子帧重算 ⇒ 运动模糊下碎片在抖 | h2(cell, seed) 纯函数哈希 |
| 累积旋转角（this.angle += …） | 子帧乱序 ⇒ 角度会跳 | 角度 = f(t)，如 turns·2π·smoothstep(kk) |
| 用上一帧 under 做拖尾 | under 是构图给的、不是历史；多子帧会双重曝光 | 要历史就写成 t 的显式函数（固定窗叠加） |
| 在有分支的地方用 fwidth | 非一致控制流下 fwidth 未定义（各 GPU 不同） | 先无分支算出量，再 smoothstep |

## 5. 落地顺序与验收

| 步 | 做什么 | 门 |
|---|---|---|
| 1 | sweep | test-transition-modes 加一条；同 t 渲两次逐像素一致 |
| 2 | spin | 同上 + 45° 时四角不露黑（抽帧看） |
| 3 | shatter（转场） | 同上 + 同 seed 两次产物 hash 相同 |
| 4 | shatterIn（镜头级） | 与转场版同 seed 碎片形状一致（抽帧叠图） |
| 5 | carousel / swirl | 同上 |
| 6 | 文档 | ENGINE §3.7.6 加五行；AGENTS §3.2 的 transition 行补一句 |

**验收口径**（缺一条都不算完成）：

1. 模式名写错仍**当场抛并列出可用值**（resolveTransitionMode 已有，加名时别破坏）；
2. transitionFadeAt 给新模式的默认：sweep 0.85 / spin 0.9 / carousel 0.8 / swirl 1.0 / **shatter 1.0**
   （碎片要飞到边缘才该结束，提前淡出像「没炸完」）；
3. 旧模式**逐像素不变**（push 的 shader 一个字符都不改）；
4. anim check 的「空档 / 交叠段没铺底」判据对新模式照常生效；
5. 性能：shatter 每像素 9 次邻域查，1080p60 下粗估比 push 慢约 1.8×；超预算就把 shards 上限收到 9、
   邻域降到 8 邻居（中心由 ci 自己给）。

## 6. 一句话

四个旋转转场是**同一条公式的四组参数**（绕锚点转 + 缩放 + 边缘衰减），做完 sweep 就有了架子；
镜碎是**唯一必须 per-cell 运动**的，Voronoi + 纯函数哈希能既不引 uniform 数组、又不破确定性；
转场版与镜头版共用同一份 hash，是这套设计里最值钱的一条。
