# `placeholder` · 分镜占位卡：网格底 + 大字主体 + 屏上/运动/拟用三行小字 + 角标（段 id 与时长）。写场景前先对齐意图，不是成片画面。

> 分类：**分镜** · 能量 none

协作顺序：分镜表 → placeholder 时间线 → anim board 确认 → 逐段替换为真镜头（docs/SCENE-BRIEF-TEMPLATE.md §11）。check 遇到时间线仍含 placeholder 会 warn（--strict 进 errs）。energy=none、fits 恒 false ⇒ 选型永远抽不到它。

## 什么时候用

写场景前的分镜占位（对齐主体/屏上文字/运动/拟用模板）

## 什么时候别用

成片（这是占位卡，交付前必须全部换成真镜头）

## 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `id` | string | `"placeholder"` | 段名（HUD / --only / 报错里用它） |
| `subject` | string | `"主体"` | 画面主体名词（大字居中） |
| `onscreen` | string | `""` | 屏上文字（小字行；空则不画） |
| `motion` | string | `""` | 运动一句话（小字行；空则不画） |
| `ref` | string | `""` | 拟用模板或 kit（小字行；空则不画） |

## 最小示例

```js
export default shot('placeholder', { subject: "主体", onscreen: "", motion: "" });
```

## 看效果

```sh
node scripts/anim.mjs shots placeholder                        # 参数全表（唯一权威）
node scripts/anim.mjs still demo -t 2 --only placeholder      # 出图看
```

<!-- 生成物：改模板 meta 后跑 node tools/gen-shot-cards.mjs，别手改 -->
