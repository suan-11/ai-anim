---
name: ai-anim
description: 用代码做确定性动画/视频（WebGL2 + 无头 Chrome + ffmpeg）。写 JS 场景或时间线模板 → 出 PNG/mp4，预览与成片逐像素一致；带一整套机器判据（卡点 / 事件密度 / 版面 / 调色板 / 字幕重复 / 编造数字）。
---

# ai-anim

**写代码就是做动画。** 每一帧都是 `t` 的纯函数：可任意 seek、可多子帧求平均做真运动模糊、
预览与成片逐像素一致。没有素材依赖，也没有扩散模型。

## 先跑三条命令

```sh
npm install
node scripts/anim.mjs tasks            # 有哪些片子
node scripts/anim.mjs still demo -t 3  # 出一帧 PNG 看效果（agent 的主要验证手段）
node scripts/anim.mjs video demo       # 出成片（先用 --draft 审节奏，定稿再全渲染）
```

## 做一支新片子（零代码优先）

```js
// tasks/<任务>/task.config.mjs —— 唯一的文件，不需要任何 import
export default {
  title: '我的片子', width: 1920, height: 1080, fps: 60,
  style: 'paper',            // node scripts/anim.mjs styles 看全部
  captions: true,            // 有旁白时开，字幕交给引擎
  timeline: [
    { type: 'title', title: '我的片子', dur: 4 },
    { type: 'chart', values: [0.3, 0.7, 0.95], title: '成绩', dur: 5 },
    { type: 'outro', dur: 3 },
  ],
};
```

模板参数与默认值：`node scripts/anim.mjs shots [名字]`（唯一权威）。
要新视觉就写场景：`export default { id, setup(ctx), render(ctx) }`，见 `docs/ENGINE.md` §3。

## 交付前的门（机器判据，红了就改）

```sh
node scripts/anim.mjs check <任务>              # 静态 + 逐段试渲染 + 背景/版面/卡点/密度
node scripts/anim.mjs qa <任务>                 # 文件级：解码/黑场/静帧/音量
node scripts/anim.mjs report <任务>             # 一屏 5 项自检
node tools/lint-cut-beats.mjs <任务>            # 纯音乐片子的切点是否踩拍
node tools/lint-event-density.mjs <任务>        # 每一秒都有东西看
node tools/lint-narration-dup.mjs <任务>        # 画面文字不要复述旁白
node tools/lint-fabricated-numbers.mjs <任务>   # 画面上每个数字都要有出处
```

## 交付物

```sh
node scripts/anim.mjs video <任务> --segments 10   # 成片 mp4（>30s 必加 --segments）
node scripts/anim.mjs film-html <任务>             # 一个 HTML 文件，双击就能播（含音轨）
node scripts/anim.mjs cover <任务> -t 12 --title '…'  # 封面
node scripts/anim.mjs subs <任务>                  # 平台字幕 srt/ass
```
