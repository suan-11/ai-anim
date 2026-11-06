# `cascade` · 核心蓄力出发，接触逐根触发翻倒与冲击环，末端重新聚拢为核心。

> 分类：**流程** · 能量 中高

动作按段内进度缩放；共享舞台和核心物可硬切接力。文字随动作裁切揭示，不靠透明度入场。

## 什么时候用

连锁反应、信号传递、前因后果

## 什么时候别用

节点名称很长的流程图；精确数据展示

## 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `id` | string | `"cascade"` | 段名 |
| `kicker` | string | `"CAUSE / 因果"` | 页眉标注 |
| `title` | string | `"一次触碰，层层传递"` | 动作触发的主标题 |
| `label` | string | `"传递完成"` | 主体旁的短标注 |
| `count` | number | `7` | 参与碰撞的叶片数，整数 3..12 |

## 最小示例

```js
export default shot('cascade', { kicker: "CAUSE / 因果", title: "一次触碰，层层传递", label: "传递完成" });
```

## 看效果

```sh
node scripts/anim.mjs shots cascade                        # 参数全表（唯一权威）
node scripts/anim.mjs still demo -t 2 --only cascade      # 出图看
```

<!-- 生成物：改模板 meta 后跑 node tools/gen-shot-cards.mjs，别手改 -->
