# `deconstruct` · 真实三维爆炸视图：模块错峰拆开、露出核心、侧向观察，最后按原拓扑重新组装。

> 分类：**流程** · 能量 中高

27 个真实网格、圆角材质与深度遮挡、阴影、投影标签。位置与旋转是时间的纯函数；首尾回到同一结构。需要 Chrome WebGL2。

## 什么时候用

结构拆解、产品爆炸图、模块组成与重新组装

## 什么时候别用

纯文字讲解；不需要三维遮挡时

## 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `id` | string | `"deconstruct"` | 段名 |
| `kicker` | string | `"DECONSTRUCT / 解构"` | 页眉标注 |
| `title` | string | `"拆开，才看见结构"` | 动作触发的主标题 |
| `label` | string | `"分离 · 观察 · 重组"` | 主体旁的短标注 |
| `spread` | number | `2.15` | 展开间距倍数，1.4..2.8 |

## 最小示例

```js
export default shot('deconstruct', { kicker: "DECONSTRUCT / 解构", title: "拆开，才看见结构", label: "分离 · 观察 · 重组" });
```

## 看效果

```sh
node scripts/anim.mjs shots deconstruct                        # 参数全表（唯一权威）
node scripts/anim.mjs still demo -t 2 --only deconstruct      # 出图看
```

<!-- 生成物：改模板 meta 后跑 node tools/gen-shot-cards.mjs，别手改 -->
