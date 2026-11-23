# BRIEF · 节奏双轨制（rhythm dual-track）v0.1

> 来源：用户提示词（2026-11-22）。性质：**引擎能力设计 brief**（不是单片分镜）。
> 关联：BACKLOG §1.J `1-86`（文案/剧作层叙事节奏与前 3 秒钩子）/ `1-87`（C4/C5 与 anim rhythm 门禁收口）；
> 现有判据 `tools/lint-anti-ppt.mjs` C4（时长 CoV）/C5（钩子）、`docs/MOTION.md`、`src/core/trans.js`。
> 状态：v0.1 已实现，运行口径见 §8。
> 各字段填表、评分和复核方式见 [节奏双轨数据评估标准](RHYTHM-EVALUATION.md)。

---

## 0. 核心判断（一句话）

**beat 负责网格，节奏表负责呼吸。**

节奏不能只靠 beat 卡点。beat 解决「**什么时候切**」，节奏表解决「**该压还是该放**」。
双轨制把这两件事拆开——不是加一套 beat，而是**把 beat 降级成网格，把节奏升级成可计算的呼吸规则**。

---

## 1. 双轨制

### 轨 A · 底层 beat 轨（时间网格）
- 保留 BPM，**只作参考网格**。
- **不要求每个点都卡**：允许拖拍、抢拍、留空拍。
- beat 从「卡点命令」**降级为「时间坐标系」**。

### 轨 B · 上层事件轨（节奏呼吸）
- 用四类事件标记真正的节奏：`pressure` / `hold` / `release` / `residue`。
- **关键运动、转场、声音变化对齐事件轨**，而不是对齐每个鼓点。
- 四类**必须循环出现**，不能全程 release。

| 事件 | 含义 | 画面/声音倾向 |
|---|---|---|
| `pressure` | 压（蓄势/收紧） | 阻力升高、信息聚拢、运动收紧 |
| `hold` | 持（悬停/维持张力） | 张力保持、微动不停、不释放 |
| `release` | 放（释放/爆点） | 阻力骤降、能量释放、主锚点爆发 |
| `residue` | 余（残留/回味） | 释放后的余韵、低密度呼吸、过渡 |

---

## 2. 节奏表 v0.1（数据结构）

按 **3–8 秒切块**，每块填一条：

```json
{
  "t_start": 0,
  "t_end": 3,
  "intensity": 2,
  "info_density": 1,
  "resistance": 0.7,
  "attention_target": "single_anchor",
  "motion_grammar": "slow_push",
  "sound_density": 0.3,
  "beat_role": "pressure"
}
```

### 字段说明
| 字段 | 类型 | 含义 | v0.1 |
|---|---|---|---|
| `t_start` / `t_end` | number(s) | 块起止时刻（块长 3–8s） | ✅ |
| `intensity` | int | **强度曲线**（能量等级，如 1–5） | ✅ 核心 |
| `info_density` | int | **信息密度**（同屏信息量等级） | ✅ 核心 |
| `resistance` | float 0–1 | **阻力系数**（运动/释放的受阻程度） | ✅ 核心 |
| `attention_target` | enum | 注意力目标（v0.1 用代理指标 `single_anchor`） | 🟡 代理 |
| `motion_grammar` | enum | 运动语法（如 slow_push / whip / drift） | 🟡 |
| `sound_density` | float 0–1 | 声音密度 | 🟡 |
| `beat_role` | enum | 四类事件之一 pressure/hold/release/residue | ✅ |

> **v0.1 只抓三个核心指标**：强度曲线 `intensity`、信息密度 `info_density`、阻力系数 `resistance`。
> 复杂度 / 重复度 **第二版再加**；注意力曲线先用代理指标（`attention_target: single_anchor`）跑。

---

## 3. 硬规则（可机器校验）

| # | 规则 | 校验口径 |
|---|---|---|
| R1 | **不允许连续 3 块 intensity 相同** | 滑窗 3，三者相等 ⇒ FAIL |
| R2 | **高信息密度块后必须接低密度呼吸块** | info_density≥阈值 的下一块必须更低 |
| R3 | **释放块前 1–2 块 resistance 必须升高** | release 块前 1–2 块 resistance 单调升 |
| R4 | **每块只能有一个主视觉锚点** | attention_target == single_anchor（一屏一主体，呼应 LAYOUT.md） |
| R5 | **beat_role 必须四类循环，不能全压或全放** | 序列须含 ≥3 类且非单一；不能全程 release |

> 这五条是 v0.1 的门禁候选，落进 `anim rhythm` / lint（见 §5）。R4 与现有「一屏一主体」版面守门同源。

---

## 4. 落地顺序（四步）

1. **手工填 2–3 条片子的节奏表**（先验证数据结构够不够表达真实节奏）。
2. **跑通「强度—密度—阻力」三项规则**（R1/R2/R3 先机器化，R4/R5 随后）。
3. **再写进 ai-anim 的 `render(t)`**（节奏表驱动画面：intensity→运动幅度/bloom，resistance→缓动阻尼，info_density→同屏元素数）。
4. **最后替换旧 beat 逻辑，保留底层 BPM 网格**（beat 降级为坐标系，事件轨接管节奏）。

---

## 5. 与现有引擎的接线点（落地时核对）

- **BPM 网格保留**：`f.beat` / `f.beatPhase` / `music.timeOfBeat` 继续作时间坐标系（AGENTS.md §6），**不再强制切点对齐每个鼓点**。
- **现有 C4/C5 判据**：`lint-anti-ppt.mjs` C4（时长 CoV≥0.25）/C5（钩子密度）是「反 PPT」下界；节奏表是**上层的呼吸编排**，二者互补不冲突（1-87 收口）。
- **新增纯函数层**（建议）：`src/core/rhythm.js` —— 节奏表解析 + R1–R5 校验 + `rhythmAt(t)` 返回当前块的 {intensity,info_density,resistance,beat_role}，供 render(t) 消费（确定性，零 GPU，可离线单测）。
- **新增量具**（建议）：`tools/lint-rhythm.mjs` + `anim rhythm <任务>` —— 读 `tasks/<任务>/rhythm.json`，跑 R1–R5，报读数（默认）/`--strict` 当门。
- **数据落点**：`tasks/<任务>/rhythm.json`（块数组）。
- **render 消费**：场景 `const r = rhythmAt(f.t)` → 用 r.intensity/resistance 调运动与缓动；**仍是 t 的纯函数**（铁律不破）。

---

## 6. 待决 / 第二版

- `intensity`、`info_density`、`resistance` 与声音密度已有[评分及复核口径](RHYTHM-EVALUATION.md)。运动语法的封闭词表仍待定。
- 复杂度 / 重复度指标（v0.2）：已实现，见 §10。
- 注意力曲线的画面显著性测量已接线，见 §9。
- 与 `anim cues`（词点/切点归零线）的关系：cues 给切点坐标，节奏表给块级呼吸——两者如何叠加。

---

## 7. 验收（本 brief 落地完成的定义）

- [x] `beat` 和 `demo` 有手工 `rhythm.json`。
- [x] `src/core/rhythm.js` 纯函数与 R1–R5 离线单测。
- [x] `anim rhythm` / `lint-rhythm` 接入 regress。
- [x] `beat` 的波形、同心圆和频谱由节奏表驱动。
- [x] 已声明节奏表的任务用 BPM 作参考网格，`beat` 的两处切点取自 `release`。

## 8. v0.1 运行口径

块长 3–8 秒，从 0 秒开始首尾相接。`intensity` 和 `info_density` 取 1–5，密度 ≥4 的块后须接更低密度的块。`release` 前最近一块的阻力须高于 `release`。若还有更早一块，它的阻力须低于最近一块。R5 采用 §3 的至少三类门槛，两份样片均含四类。`motion_grammar` 与 `sound_density` 可选，当前用于描述编排。引擎装载时还会核对全片覆盖时长。

```sh
node scripts/anim.mjs rhythm beat --strict
node tools/lint-rhythm.mjs demo --strict --json
node scripts/anim.mjs rhythm beat --motion
node tools/lint-cut-beats.mjs beat
node tools/regress-all.mjs --ci
```

无节奏表的任务执行 `anim rhythm` 时仍使用静动量具。`--table` 可显式检查有无节奏表。`check` 汇报事件轨及全片 C4/C5，`--strict` 将命中视为失败。`review` 将读数写入评审包，`--only` 时仅附全片事件表读数。

场景读取 `f.rhythm`，其中 `elapsed` 和 `progress` 按事件块计算。块区间左闭右开。`--only` 平移片段后仍从原片时间取事件。`f.beat`、`f.beatPhase` 与 `music.timeOfBeat()` 可继续读网格。样片 `beat` 用强度调幅度和辉光、阻力调扩散耗时、密度调可见几何数量。其两次释放在 10.7s 和 25.1s。`demo` 标注现有片头、图表、甩镜和收尾，用于检查节奏表能否描述已有画面。

## 9. v0.2 注意力曲线

```sh
node scripts/anim.mjs rhythm beat --attention --video out/beat/rhythm-visual-hook.mp4
node scripts/anim.mjs rhythm beat --attention --only pulse --step 0.5
node scripts/anim.mjs review beat --attention
```

`rhythm --attention` 输出 `out/<任务>/attention/attention.html` 和 `attention.json`，选段报告写入该目录的 `only-*` 子目录。默认每 0.25 秒取一帧，并在镜头、节奏块边界加采。报表可拖动时间轴对照缩略帧、热图、显著中心和节奏事件。`review --attention` 将同一份报告放入评审包，步长可通过 `--attention-step` 指定。

曲线可切换到热点的横纵坐标，镜头切换处断线。节奏块读数按采样点汇总平均集中度、平均主体内显著性占比和热点落框次数，并链接到每块占比最低的采样帧。JSON 的 `blocks` 字段提供同一组读数。热点落框次数以有有效主体框与显著性信号的帧为分母。

报告可直接播放。`--video` 指向与报告同起点、同时长的样片，播放时视频、游标和热图共用时间轴。全片报告也会查找默认成片 `out/<任务>/<任务>.mp4`。视频不可用时，报告依采样时间连续播放内嵌帧。

输入为渲染后的显示空间像素。读数结合局部明暗与色差、向前回看 0.15 秒的变化量。镜头切换或交叠边界仅使用空间信号。集中度表示约 10% 面积内最显著区域占全画面显著性总量的比例。中心取该区域内显著性加权位置。主体内占比使用既有 `focus` 矩形，覆盖面积同时显示，方便判断大框造成的偏高读数。无主体声明、交叠帧或平坦画面以空读数显示。

这是可重复计算的画面显著性估计。观众实际注视和语义理解需另行采集。R4 保留为作者声明校验，曲线只提供评审读数。热图颜色按当前帧归一化，跨时刻比较使用曲线和 JSON 数值。

报告的「注意力节奏」展示实测曲线与目标曲线，按加权残差方差计分，并单独检查前 3 秒和各次释放后的回落。计分、逐项判读和完播率验证见 [节奏评估标准](RHYTHM-EVALUATION.md)。

---

## 10. v0.2 复杂度 / 重复度评分

```sh
node scripts/anim.mjs rhythm <任务> --complexity --step 0.5
```

复用注意力曲线的采样帧（`collectAttention`），离线纯函数计算（`scripts/lib/rhythm-complexity.mjs`），输出 `out/<任务>/attention/complexity.json`。与注意力曲线（§9，加权方差 0-100）同一次采样三指标一起出。

### 复杂度 complexity（0-100，高=多锚点/多变）
- **显著分散度**（0.5 权）：`1 - concentration`。concentration 是 10% 面积峰值占全画面显著性比例——高=单锚点=简单，低=分散=复杂。
- **热点多样性**（0.3 权）：相邻采样热点位移均值（归一化坐标 /0.3）。视线被多处牵引=复杂。
- **信息密度**（0.2 权）：节奏块 `info_density` 均值 /5。

### 重复度 repetition（0-100，高=单调重复）
- **帧重复**（0.6 权）：相邻帧 strength/concentration/hotspot 变化越小越重复（`1 - change`）。
- **序列循环**（0.4 权）：节奏块 intensity+info_density 序列**去线性趋势后**的自相关峰值。单调递增/递减不算循环（去趋势），只有波动循环才算重复。

### 读数判读
- 复杂度高 + 重复度低 = 信息丰富且多变（理想科普片应适中，过高=杂乱）。
- 复杂度低 + 重复度高 = 单调（PPT 味，需加变化）。
- 注意力曲线独立计分（§9），三指标互补：复杂度看「画面多丰富」，重复度看「多单调」，注意力看「视线引导是否按节奏起伏」。

### 校准样本（2026-11-23，step 0.5）
| 片 | 复杂度 | 重复度 | 解读 |
|---|---|---|---|
| benford | 43 | 56 | 多柱分散最复杂，帧静态重复高 |
| paperfold | 37 | 52 | 指数柱变化稍多 |
| coastline | 27 | 57 | 单海岸线集中，帧重复最高 |
| manhole | 26 | 56 | 单圆最简 |
| tube-map | 26 | 54 | 线网集中 |

> 科普片帧重复普遍偏高（0.86-0.95）因画面以静态图表为主——这是题材特性，非缺陷；靠 zoom punch + 运镜 + 旁白节奏制造事件起伏（注意力曲线衡量）。序列循环全 0 因节奏表无循环模式（一次性叙事）。
