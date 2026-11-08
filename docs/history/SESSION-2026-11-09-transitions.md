# 2026-11-08/09 会话：转场族 + 镜碎 + GPT 协作基础设施

> 这一轮的完整记录。代码在 `877b27b..8736868`，回归 76/76。
> 上游那三条线（PLAN A/B/C）没动；本轮改的是**转场与镜头效果**，以及**和 GPT 怎么协作**这套基础设施。

## 1. 交付了什么

### 1.1 转场族：四个旋转 + 一个镜碎（十一支 shader）

| 模式 | 一句话 | 关键实现 |
|---|---|---|
| `sweep` | 角度扫描，绕中心扫一圈露出新画面 | 起始角由 `dir` 推出（不新增 uniform）；`atan` 圆心奇点单独处理 |
| `spin` | 整层旋转 + 同步放大到 √2 | 不放大就露黑角；`turns` 可调 |
| `carousel` | 圆筒透视：两侧按 cos 压缩 + 侧面变暗 | `tilt` 可调；shade 上限 0.55（再暗发灰） |
| `swirl` | 极坐标漩涡 | 半径 < 0.02 不卷；`swirlAmount` 可调 |
| `shatter` | Voronoi 镜碎，每片自己飞 + 自转 | `second - best` = 玻璃厚度；`shards/seed/power` 可调 |

旋钮全部走同一条通路：段上写 `transitionOpts: { … }` → engine 透传 → `transitionPass` → uniform。
**默认值 = 现状**（turns 1 / tilt 1 / swirlAmount 1 / shards 7 / seed 7 / power 0.8）。

### 1.2 镜头级镜碎 `shatterIn`（`src/kit/shatter.js`）

两层：**计划层**纯函数（`fract` / `h2` / `shatterPlan`，离线可测）+ **绘制层**（离屏 RT → Pass → ctx.out）。
`h2` 与转场版 shatter **逐字等价** ⇒ 同一支片子里碎出去与碎回来是同一块玻璃。
夹具：`tasks/_shatter-lab`；看图：`still _shatter-lab -t 0.15,0.6,1.3`。

### 1.3 基础设施：和 GPT 交接这套

| 工具 | 作用 | 为什么要它 |
|---|---|---|
| `tools/agent-mail.mjs` | append-only JSONL 信箱（send/inbox/wait/thread） | codex 只有 shell，信箱是它唯一能「先开口」的通道 |
| `tools/gpt-turn.mjs` | 信箱新消息 → 一轮 Codex 会话（续 thread、带游标） | 信箱不会自己叫醒它，必须有人投递 |
| `wait --cursor` | 守望任务只看新消息 | 没有游标时会被历史消息反复叫醒（假警报） |
| `gpt-turn --base` | 底稿按话题取 | 写死 5B 时，trans 会话拿到 5B 工作单、回了 5B 的报告 |
| writer 守卫 | 同 thread 只允许一个会话写 | 并发派发导致纠正消息**静默丢失**（already has an active writer） |

## 2. 这一轮踩到并修掉的坑

| 坑 | 症状 | 修法 |
|---|---|---|
| `outTex = this._x = …` | 纹理变量被赋成对象，下一句拿不到纹理 | 只记 opts，不动 outTex |
| Pass 按 mode 缓存 | shards/seed/power 是创建时烘进 uniform 的，逐段改不生效 | 缓存键带上这三个值 |
| 新旋钮默认值 ≠ 现状 | turns 0.9 把已提交画面改成转 324° | 默认一律 1/1/1，**加旋钮不是改画面** |
| 边缘光方向照抄转场版 | 静止帧上留一层永久裂缝 | 转场版 1-kk、镜头版 smoothstep(0,0.15,kk) |
| GBK 写文件 | 中文报错变 U+FFFD，测试不红 | 写完自查 includes('\uFFFD') |
| 删了 function die 只留 import | help 正常、任何错误分支崩 die is not defined | 四份对拍抓不到；补一条**错误路径门** |

## 3. 复核流水线（每轮照这个跑）

```sh
git diff --stat                              # ① 越界检查：push / AGENTS / tasks 红线
node tools/regress-all.mjs --ci              # ② 门：76/76
node scripts/anim.mjs still nosuch-task      # ② 错误路径：要打印 ✗ 且退出 1
node scripts/anim.mjs still <夹具> -t <中点> # ③ 涉及画面必须出图看（Read 打开 PNG）
```

## 4. 欠账

1. **拆 `scripts/anim.mjs`（PLAN A1-5B）**：做完 args.mjs / log.mjs 两个叶子模块后暂停 —— 
   剩下的 pickTask / session 牵 taskNames / Vite 生命周期，耦合太高，不适合交给看不见运行时的 agent；
2. **pv-kattachi 尾段**：词表已被另一 agent 按人声起音重排（未提交），但**还没重渲**；
3. 转场族的 fadeAt 默认值只在 sweep 上验过观感，spin/carousel/swirl/shatter 待在真实片子里试；
4. `shatterIn` 逐帧重拷整帧 ≈ 一次全屏 Pass，长片里连用要量（anim perf）。
