# BRIEF · 节奏双轨制（rhythm dual-track）v0.1

> 来源：用户提示词（2026-11-22）。性质：**引擎能力设计 brief**（不是单片分镜）。
> 关联：BACKLOG §1.J `1-86`（文案/剧作层叙事节奏与前 3 秒钩子）/ `1-87`（C4/C5 与 anim rhythm 门禁收口）；
> 现有判据 `tools/lint-anti-ppt.mjs` C4（时长 CoV）/C5（钩子）、`docs/MOTION.md`、`src/core/trans.js`。
> 状态：**设计待落地**。本文把提示词整理成可执行规格 + 硬规则 + 落地顺序。

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

- `intensity` / `info_density` 的量纲与阈值（1–5？高低分界？）——手工填表时定。
- `motion_grammar` / `sound_density` 的枚举词表（对齐 MOTION.md / SFX.md）。
- 复杂度 / 重复度指标（v0.2）。
- 注意力曲线从代理指标升级为真实测量（v0.2+）。
- 与 `anim cues`（词点/切点归零线）的关系：cues 给切点坐标，节奏表给块级呼吸——两者如何叠加。

---

## 7. 验收（本 brief 落地完成的定义）

- [ ] 2–3 条片子的手工 `rhythm.json` 存在且能表达真实节奏。
- [ ] `src/core/rhythm.js` 纯函数 + R1–R5 离线单测全绿。
- [ ] `anim rhythm` / `lint-rhythm` 接入 regress。
- [ ] 至少一支片的 render(t) 由节奏表驱动（intensity/resistance/info_density 真的影响画面）。
- [ ] 旧 beat 卡点逻辑降级为网格，BPM 坐标系保留。
