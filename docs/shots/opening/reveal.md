# `reveal` · 双遮挡板蓄力退开，核心从缝隙中显露，边缘与文字共用动作进度。

> 分类：**开场** · 能量 中

动作按段内进度缩放；共享舞台和核心物可硬切接力。文字随动作裁切揭示，不靠透明度入场。

## 什么时候用

揭晓、打开、从遮挡中发现主体

## 什么时候别用

持续长时间静置；长段落文字

## 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `id` | string | `"reveal"` | 段名 |
| `kicker` | string | `"REVEAL / 揭示"` | 页眉标注 |
| `title` | string | `"让遮挡退开"` | 动作触发的主标题 |
| `label` | string | `"看见核心"` | 主体旁的短标注 |
| `aperture` | number | `0.72` | 遮挡开口范围，0.35..1 |

## 最小示例

```js
export default shot('reveal', { kicker: "REVEAL / 揭示", title: "让遮挡退开", label: "看见核心" });
```

## 看效果

```sh
node scripts/anim.mjs shots reveal                        # 参数全表（唯一权威）
node scripts/anim.mjs still demo -t 2 --only reveal      # 出图看
```

<!-- 生成物：改模板 meta 后跑 node tools/gen-shot-cards.mjs，别手改 -->
