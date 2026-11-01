# HANDOFF 2026-11-01 —— 相机接力 relay（BACKLOG 1-12）

> 状态：**已完成并销账**（实现 + 夹具 + 文档 + 验收全绿，同日）。本文只留交接价值的信息：
> 设计取舍的"为什么"、验收读数、以及下一轮可能接手的边界。
> 现行规格以 [docs/ENGINE.md](../ENGINE.md) §3.7.7 为准；待办以 [docs/BACKLOG.md](../BACKLOG.md) 为准。

## 1. 交付了什么

段与段交叠时不再是"甩镜"（push），而是**一台相机从上一段位姿飞向本段位姿、内容在交叠窗内换手**：

- 时间线声明：`cut(scene, { overlap: 1.2, transition: 'relay', transitionOpts: { move: 'glide'|'whip', handover: [a,b] } })`
  （配置档节点同字段；`transitionOpts` 已四接：TIMELINE_KEYS / configToCut / cut() / build()）。
- 场景接入三种写法（ENGINE §3.7.7）：
  ① 手写 camera3 场景：场景对象声明 `relayPose(ctx)`（返回 camera3 形状 `{pos,target,fov,roll}`、**t 的纯函数**），
     render 里 `camera3({ ...relayPose3(ctx, home), H })` 一行；
  ② makeThreeShot：`spec.cameraPose(ctx)`（同形状）；不写则引擎回读相机当前状态（静态相机零声明可用）；
  ③ 引擎侧：每子帧**现探现算**两侧位姿 → `blendPose` → 两段相机各自 drive 到同一混合位姿 →
     交叠窗内 `mixTo(under, outTex, relayHandover(tin), mixRT)` 换手。

## 2. 关键设计取舍（下一轮改这里之前先读）

- **独立分支，不进 push/mix guard**。引擎里 push/mix 挂在 `!scene.handlesTransition` 之下，而
  makeShot / makeThreeShot 默认 `handlesTransition: true` —— relay 若放进那条 guard，3D 接力对会
  **静默变成"相机在飞、内容在切点硬跳"**，不报错、check 照绿。relay 分支在 guard 之前，
  成立时绝不进老分支（否则甩一遍 + 混一遍 = 双重转场；world.js openFrame 的 relay 跳甩配合这条）。
- **探针禁止记忆化**。relayPose 是 t 的纯函数且位姿随 t 漂移——探一次缓存住，整个交叠窗就变成
  "两台静态相机之间的插值"（活镜头飞向死目标，不报错）。test-relay 有静态断言钉着。
- **形状契约是 camera3 形状，不是 Pose**。场景报 `{pos,target,fov,roll}`；引擎内部才换算成
  Pose `{look,dist,yaw,pitch,fov,roll}`（yaw/pitch/fov 度、roll 弧度、yaw=0 朝 −z）参与混合。
  夹具第一版直接返回 Pose，camera3 读 `pos[0]` 崩、引擎探针 `poseFromCamera3` 拒收崩页——
  **两种崩法 check 都当场抓到**（这正是夹具的价值）。
- **端点精确还原特判**。±180° 平局处最短路径插值会让 e=1 落到等价角（190°≠−170°），
  链式接力会逐缝漂移——端点直接取原值。
- **blendPose 的插值口径**：look 直线；dist 与 tan(fov/2) 都走 exp(lerp(log,log))（与 cam.js 的
  zoomLerp 同构，推近手感匀速）；yaw 最短路径恒定角速度；pitch/roll 线性。
- **没有做成"抛 Symbol 中断"的通用探针协议**（参考项目 rig.js 那种 off/probe/drive/dress 状态机）。
  v1 用场景对象纯函数接口，成本低、可测性好；真要做 probe（"只跑到相机那一步"）另立项。
- **"文字整段交接"降级为 v1 边界**：文字随所属段在换手窗 crossfade。要"文字跟着相机飞、
  不溶解"得把文字层从段 RT 里拆出来单独合成（双层 RT），另立项。

## 3. 验收读数（2026-11-01 实测）

- `node tools/test-relay.mjs` **37/37**（roundtrip ≤1e-9 / 几何插值中点 / yaw 环绕 / 非有限抛 /
  防御真调 Engine.prototype / timeline 双写法落位 / 无 memo 静态 / 零依赖静态）。
- `node tools/regress-all.mjs --ci` **66/66**（unit:relay 已登记，verify.yml 未动）。
- `node scripts/anim.mjs check _relay-lab` 全绿（36 帧双路径；两条 skipped 是夹具属性：无音轨、
  makeThreeShot 读不到场景级 focus）。
- 出图（`out/_relay-lab/stills` + `cuts`）：接力缝（t=4.8 组）网格背景逐像素连续、塔阵在两机位间
  **滑移**；push 对照缝（t=14.6 组）同机位出现拖影甩动——对比成立；whip 缝交叠帧（t=25.15）
  自适应采样自动吃到 72 子帧（快运动被正确识别）。

## 4. 夹具与文档

- 夹具 `tasks/_relay-lab/`：6 段三组——relay2d→relay2d-b（camera3 + glide）、
  push2d→push2d-b（对照组）、relay3d→relay3d-b（makeThreeShot + whip）。程序化塔阵 rng(11)/rng(47)。
- 文档：ENGINE §3.7.7（新锚点；原 §3.8 原号原位）、MOTION §3.6（第九种模式 + 数值口径）、
  CONFIG-ONLY（键表 16 键 + transitionOpts 行）、COOKBOOK §8 指针、AGENTS §3.2/§3.5（58835/65536 B）。
- 红线复核：`src/core/transition-frag.js` 未动（push shader 源码逐字符不变）；push/mix/none 老分支一行未改。

## 5. 过程里顺手修的与记下的

- 引擎回落警告的分类 bug（主会话审出并修）：三段重叠时 `relayPose` 被 k===1 守卫置空，
  原三元 `relayPose ? '三段重叠' : '缺位姿'` 永远说"缺位姿"——改判 `k > 1`。
- 夹具两坑（已记 procedures/_inbox.md）：relayPose 返回 Pose 会让 camera3 与探针两头崩；
  `wk.openFrame(ctx, null)` 把背景压成守门看不见（要自己铺就 `openFrame(ctx)` 不传第二参）。
- lint-doc-facts 的单引号提取器会把源码注释里带引号的词吸进键表（TIMELINE_KEYS 注释踩过，
  16→19 假键）——键表注释用无引号写法（已记 inbox）。
- 过程中 DSH 宿主重启一次，两个子代理靠"盘点磁盘断点 + 全量任务书重发"续接，零返工。
