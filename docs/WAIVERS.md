# WAIVERS —— 豁免纪律（BACKLOG 1-80 / 1-82）

> **一句话：豁免不是骗过 check 的后门。** 一条豁免 = 判据 id（`judge`）+ 证据（`guard`）+ 关于**这支片子**的理由（`reason`），
> 记在 `tasks/<任务>/waivers.json`，由 `check` 逐条核对。同一判据被豁 ≥3 次不是例外，是 **house style**，该写进 design.md。
>
> 出处：对标 Nutlope/hallmark 的 waiver 三字段（[REFERENCE-hallmark.md](REFERENCE-hallmark.md) §3①）；
> 判据分层：`tools/lib/judge-tiers.mjs`（[REFERENCE-hallmark.md](REFERENCE-hallmark.md) §3③）。

---

## 1. 记录格式

`tasks/<任务>/waivers.json` 是一个数组，每项一条豁免：

```json
[
  {
    "judge": "background.coverage",
    "guard": "段 whip 自己画整帧底（audit：窗后亮度 0.037，模板设计值）",
    "reason": "这一段是甩镜夹具：把上一段成帧甩上来就是它的底，不铺共享背景",
    "segments": ["whip"],
    "at": "2026-11-20T11:46:47.705Z"
  }
]
```

| 字段 | 必填 | 规则（写错就当**豁免不成立**，不是静默忽略） |
|---|---|---|
| `judge` | 是 | 必须是 `scripts/lib/waivers.mjs` 的 `WAIVER_JUDGES` 里登记过的 id（见 §4）。拼错/未知 id 当场拒 —— 否则它会「看起来豁过了、其实什么都没豁」。 |
| `guard` | 是 | 非空的**证据 / 条件**：哪一段、哪一屏、读数是多少、为什么这不是事故。`"设计需要"` 这类空话不算证据。 |
| `reason` | 是 | ≥12 字，**关于这支片子**。与另一条逐字复用 = 样板豁免，**整条不成立**（两三条都一样时全部作废）。 |
| `segments` | 否 | 非空段名字符串数组。只对**按段豁免**的判据有意义（当前是 `background.coverage`）：写了就只覆盖列出的段；不写 = 覆盖该判据的全部对象。空数组/空串会静默变成「什么都没覆盖」，所以直接拒。 |
| `at` | 否 | `anim waivers --add` 自动写（ISO 时间）。手写也行，不参与判据。 |

## 2. `check` 怎么消费（已接线的判定点）

只有**真的减少了一条判据**的声明才要求留痕 —— 不制造无意义的豁免。

| 判定点 | 什么算「用了豁免」 | 没留痕时 `check` 说什么 |
|---|---|---|
| `layout.overlap` | ① 生效的 `layout.allowOverlap` 非空；或 ② 采样期**真的**压掉了字压字（`layoutVerdict().allowOverlap.exempted`） | `⚠ 无痕豁免（layout.allowOverlap）…` —— 列出声明了几个字符串、实际压掉几处，并给出 `anim waivers --add` 命令 |
| `background.coverage` | 与前一段**交叠**且声明了 `world: false` 的段（`worldAudit().selfBase`）—— 背景守门因此少判了它一次 | `⚠ 无痕豁免（world: false）…` —— 点名段名 + 给出带 `--segments` 的 `anim waivers --add` 命令 |

**不要求留痕**的情况（说清楚，免得被当成漏网）：

- 不与上一段交叠的 `world: false` —— 背景守门本来就不查它，没有豁免掉任何判据（`check` 会打一行说明）；
- 声明了 `allowOverlap` 但既没有实际压掉、也不可能压掉：仍然要求留痕（声明本身就是关掉了判据），只在记录**完全对不上任何判定点**时报 stale（见下）。

**其它结果**：

- 记录不成立（缺字段 / 未知 judge / segments 写错 / 逐字复用）⇒ `check` 报错（floor，退出码 1）；复用单独记一条 reflex（`--strict` 当门）。
- 同一判据豁 ≥3 次 ⇒ `house style`（finish，只报）：它不是错误，是这支片子的风格，**要写进 design.md 正视它**。
- 记录在、但判定点已经没了（`allowOverlap` 空了、也没有 `world: false` 交叠段）⇒ `waiver.stale`（finish）：可能已经不需要，删掉比留着诚实。

## 3. 判据分层（1-82 第二步）

`check` 收尾会打一行：

```
判据分层：Floor 0 FAIL · Reflex 2 (1 waived) · Finish 0
  reflex  layout.guard · waiver.unrecorded.background(waived)
  floor = 现在就会红（正确性，不可豁免）· reflex = 默认只报、--strict 才当门（可豁免，须在 waivers.json 留痕）· finish = 只报不拦
```

| 层 | 门（当前行为） | 能不能豁 | 例子 |
|---|---|---|---|
| `floor` | 现在就进 `errs`（退出码 1） | **不能** | 非有限值 / 几乎全黑 / 过曝 / 运动模糊路径不一致 / 背景守门没铺底 / 依赖 under 没交叠 / 场景抛异常 / 缺 audio / 豁免记录不成立 |
| `reflex` | 默认只报，`--strict` 才进 `errs` | **能，但必须留痕** | 卡点 / 色系 / 事件密度 / 版面超限 / 匀速漂移 / 运动人格 / 无痕豁免 |
| `finish` | 只报读数，**连 `--strict` 也不拦** | 不需要（不进判据） | 响度读数 / 字幕跨场景 / 锚点降级 / house style / stale 豁免 |

两条纪律：

1. **「0 FAIL 只对 Floor 成立」** —— Reflex/Finish 是 0 不代表片子经得起交付；交付前跑 `check --strict` 看 reflex 层。
2. **只改报告，不改门**：分层表（`CHECK_TIERS`）是描述性的，加一行分类不会让判据变红/变绿。改门要单独做，并同步这张表。

未登记的判据代码默认归 `reflex`（诚实：至少不冒充 floor）。新增判据时**必须**在 `CHECK_JUDGE_TABLE` 登记。

## 4. 命令

```sh
node scripts/anim.mjs waivers <任务>                                  # 列出记录 + 校验 + house style
node scripts/anim.mjs waivers <任务> --add \
  --judge background.coverage \
  --guard "段 whip 自己画整帧底（audit 亮度 0.037）" \
  --reason "甩镜夹具：上一段成帧就是它的底，不铺共享背景" \
  --segments whip
node scripts/anim.mjs waivers <任务> --json                           # 机器可读
node scripts/anim.mjs waivers <任务> --strict                         # house style 也算失败（退出码 1）
```

登记过的判据 id（`WAIVER_JUDGES`）：

| id | 含义 | 谁在消费 |
|---|---|---|
| `layout.overlap` | 版面允许字压字（`layout.allowOverlap`） | **check**（已接线） |
| `background.coverage` | 这一段刻意不铺底（`world: false`） | **check**（已接线） |
| `hashes.baseline` | 画面基线变更被接受（`anim hashes --accept`） | 未接线（见 §5） |
| `anti-ppt` | 反 PPT 某条判据豁免 | 未接线（见 §5） |

## 5. 欠账（还没接线的，别假装豁过了）

- `hashes.baseline`：`anim hashes --accept --note` 仍然只写 note，不读 `waivers.json`。
- `anti-ppt`：`lint-anti-ppt` 的 C1–C7 仍然只按 `--strict` 判，不读豁免记录。
- **其它 reflex 判据**（卡点 / 色系 / 事件密度 / 版面超限 ……）：在 `waivers.json` 里写一条**不会**让它们变成 `waived` —— 当前只有 §2 那两个判定点按记录放行。要豁免别的判据，先按判据本身改（或先把它接进 check 的判定点，再登记新的 judge id）。

这条纪律的理由：hallmark 的豁免是「gate + guard + reason」，**gate 必须先存在**。没有判定点的豁免记录只是给未来的自己挖坑。

## 6. 验证（离线，不需要 GPU）

```sh
node tools/test-judge-tiers.mjs       # 分层词表 / 汇总 / check 接线
node tools/test-waivers.mjs           # 三字段 / 段范围 / 复用 / house style / 两个判定点 / 接线
node tools/test-layout.mjs            # allowOverlap 的声明与「实际使用」记账
node tools/test-timeline-audit.mjs    # world:false 全量声明（含不交叠段）
node tools/regress-all.mjs --ci       # 全量 CI
```

端到端夹具：`tasks/_config-lab/waivers.json`（甩镜段 `world: false` 的 `background.coverage` 豁免，`segments: ["whip"]`）。
跑 `node scripts/anim.mjs check _config-lab --quick` 能看到 `Reflex … (1 waived)`。
