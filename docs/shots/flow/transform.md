# `transform` · 同一条闭合轮廓从圆环拉成波带，再撑成方形，最后收回核心；点与材质刻线保持对应。

> 分类：**流程** · 能量 中

动作按段内进度缩放；共享舞台和核心物可硬切接力。文字随动作裁切揭示，不靠透明度入场。

## 什么时候用

结构变化、状态转换、同一对象的不同形态

## 什么时候别用

不同对象之间的淡入淡出；图表数据请用 morph

## 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `id` | string | `"transform"` | 段名 |
| `kicker` | string | `"TRANSFORM / 变形"` | 页眉标注 |
| `title` | string | `"同一个物体，换一种状态"` | 动作触发的主标题 |
| `label` | string | `"圆环 · 波带 · 方形"` | 主体旁的短标注 |
| `turns` | number | `2` | 波带弯折次数，1..4 |

## 最小示例

```js
export default shot('transform', { kicker: "TRANSFORM / 变形", title: "同一个物体，换一种状态", label: "圆环 · 波带 · 方形" });
```

## 看效果

```sh
node scripts/anim.mjs shots transform                        # 参数全表（唯一权威）
node scripts/anim.mjs still demo -t 2 --only transform      # 出图看
```

<!-- 生成物：改模板 meta 后跑 node tools/gen-shot-cards.mjs，别手改 -->
