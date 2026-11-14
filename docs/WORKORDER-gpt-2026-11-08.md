# 工作单（给执行 agent）—— PLAN A 线五个阶段

> 这份文件是**指令**，不是建议。执行者按阶段顺序做，**每个阶段跑完自己的门（gate）才算完成**；
> 门不绿就停在原地，把原始输出贴回来，不要「顺手修一下」继续往下走。
>
> 仓库：`C:/Users/haoxu/Downloads/NekoHome/ai-anim`（分支 `master`，起点 `2081e81`）
> 依据：`docs/PLAN-2026-11-08.md` §3（A 线）；状态基线见 `docs/HANDOVER.md`。

## 0. 铁律（违反任何一条，这一轮作废）

1. **不 push**。远端 `origin` 是只读上游（`suan-11/ai-anim`），`qyac` 是本人 fork —— 两个都不许推。
2. **每阶段一个本地 commit**（便于回滚），commit 信息用 `A5: …` 这种前缀；**不 amend 别人的提交**。
3. **只改工作单点名的文件**。`tasks/**`、`out/**`、`assets/**`、`src/**` 一律不动（A1 例外，且只许搬移）。
4. **AGENTS.md 的章节号一个都不许删改**（`§4`、`§10.11.56` 等是外部锚点，221 处引用）。
5. **不许顺手改行为**：任何「反正这里写得不好」的重构都不在范围内。拆分/归档只做搬运与形式整理。
6. **每阶段结束必须贴出**：`git diff --stat`、门命令的原始输出（末 5 行即可）、以及是否出现 `skipped`。
7. 遇到「测试本来就红」的情况：先跑一次基线，**证明它在改动前就红**，再决定是否跳过；不许悄悄改测试断言让它变绿。

## 1. 开工前的环境自检 + 基线快照（必须先做）

```sh
cd C:/Users/haoxu/Downloads/NekoHome/ai-anim
node -v                                   # 期望 v20+
ffmpeg -version | head -1                 # 没有就记下来，A5 要用
git status --short                        # 期望为空（干净）
git log --oneline -1                     # 期望 2081e81 或更新
node tools/regress-all.mjs --ci           # 期望「通过 75/75 ✅ 没有真失败」
```

然后把**拆分/改造前的对拍基准**存下来（A1 阶段要用；先存下来，后面才有得比）：

```sh
mkdir -p out/_baseline
node scripts/anim.mjs help            > out/_baseline/help.txt
node scripts/anim.mjs tasks --json    > out/_baseline/tasks.json
node scripts/anim.mjs shots --json    > out/_baseline/shots.json
node scripts/anim.mjs styles          > out/_baseline/styles.txt
node scripts/anim.mjs rows --json     > out/_baseline/rows.json   # 若该命令不存在，跳过并记一笔
node tools/regress-all.mjs --ci       > out/_baseline/ci.txt 2>&1
git rev-parse HEAD                    > out/_baseline/head.txt
```

> 基线里出现的**断言条数**（`test-shots` 243 项、`test-block-sig` 34 项…）逐个记下来，A1 验收要逐条对比。

**Stage 0 的门**：`git status` 干净 + `regress-all --ci` 75/75 + `out/_baseline/` 有上面 6 个文件。
不满足就停下来报告，不要开始改。

---

## Stage 1 —— A5：`regress-all` 前置依赖体检

**为什么**：现在缺 `ffmpeg` 时，测试各自打出一屏 `ENOENT` 堆栈，看不出是**环境问题**。

**改哪里**：`tools/regress-all.mjs`、`tools/test-ci-coverage.mjs`。

**步骤**

1. 在 `ITEMS` 的 `Item` 类型上加可选字段 `needs?: string[]`（取值：`'ffmpeg'` / `'ffprobe'` / `'chrome'`）。
2. 给现有条目补 `needs`：凡是 `cmd` 里跑 `anim video|shot|still|check|verify|qa|mix|cover|film-html|analyze`、
   或直接 spawn `ffmpeg/ffprobe` 的，标 `['ffmpeg']`（需要探测时长的再加 `'ffprobe'`）；
   `harness:*` / `probe:*` / `smoke:*` 这类起浏览器的标 `['chrome']`。
3. 在**执行之前**统一探测一次（尊重 `ANIM_FFMPEG` / `ANIM_FFPROBE`）：
   - `ffmpeg -version` 退出码 0 才算有；`chrome` 用现有的 `playwright-core` 检查方式（若已有 helper 就复用，别新写一套）；
   - 探测结果缓存成 `{ ffmpeg: bool, ffprobe: bool, chrome: bool }`。
4. 缺项时的行为：
   - 该条目记为 **`skipped(env)`**（与本仓库已有的 `skipped` 语义一致），**不**执行对应 `cmd`，因此**不再产生 ENOENT 堆栈**；
   - 汇总里单独一行：`⚠ 环境问题，不是代码问题：缺 ffmpeg（在 PATH 找不到；常见原因：安装在独立目录 / 改了 User PATH 但本 shell 未生效。修法：重开 shell，或设 ANIM_FFMPEG）`；
   - **整体退出码非零**（有 skip 就要让人看见）。
5. `tools/test-ci-coverage.mjs`：加一条静态守门 —— **任何 `cmd` 里出现 `ffmpeg`/`ffprobe`/`playwright` 的条目，必须声明对应 `needs`**，否则红。

**Stage 1 的门**

```sh
node tools/regress-all.mjs --ci            # 期望 75/75 全绿（本机有 ffmpeg 时）
node tools/regress-all.mjs --only smoke    # 只跑一部分，确认 needs 过滤没误伤
PATH=/usr/bin node tools/regress-all.mjs --only unit   # 模拟缺 ffmpeg：应出现 skipped(env) + 非零退出，且没有 ENOENT 堆栈
```

> 第 3 条在 Windows 上不好模拟就**跳过**，改为手工把探测函数临时强制返回 `false` 跑一次、跑完改回来（并在回报里说明）。

---

## Stage 2 —— A6：清理 7 个孤儿工具

**改哪里**：`tools/nuomi-*.mjs`（5 个）、`tools/probe-app-scale.mjs`、`tools/probe-text-alpha.mjs`、`tasks/nuomi/tools/`（新建）。

**步骤**

1. 建目录 `tasks/nuomi/tools/`，把下面 5 个**整文件搬**过去：
   `tools/nuomi-shuffle.mjs`、`nuomi-skins.mjs`、`nuomi-vary.mjs`、`nuomi-vo-ja.mjs`、`nuomi-vo.mjs`。
   搬完修两处：① 文件头注释里的用法路径；② 计算 `ROOT` 的相对层级（原来在 `tools/` 是 `../`，现在在 `tasks/nuomi/tools/` 是 `../../../`）。
2. 用 `git grep -n "nuomi-shuffle\|nuomi-skins\|nuomi-vary\|nuomi-vo"` 确认**没有别处引用旧路径**；有引用就一并改成新路径。
3. 逐个跑一次，确认搬完还能用（跑不了就记录原因，不要为了跑通改逻辑）：`node tasks/nuomi/tools/nuomi-skins.mjs --help`（或它自己的用法示例）。
4. 两个 probe 按「还有没有诊断价值」二选一，**必须给理由**：
   - 仍有价值 ⇒ 在 `docs/DIAGNOSIS.md` 加一行：「症状 → 跑 `tools/probe-app-scale.mjs`」，保留文件；
   - 已无价值 ⇒ `git rm` 掉，并在 commit 信息里列出删除清单与理由。

**Stage 2 的门**

```sh
node tools/regress-all.mjs --ci           # 75/75
git status --short                        # 只有预期的改动/删除
git grep -n "tools/nuomi-" || echo '旧路径已无引用 ✓'
```

---

## Stage 3 —— A3：`BACKLOG.md` 归档瘦身

**目标**：主文件 **≤ 25 KB**；已完成的 53 条迁入 `docs/history/BACKLOG-done-2026-10.md`。

**步骤**

1. 新建 `docs/history/BACKLOG-done-2026-10.md`，文件头写：来源、迁移日期、迁移规则（**逐字迁移，改写只发生在主文件的指针上**）。
2. 把主文件里**所有已完成（带 `~~删除线~~` 或明确写「已完成」）**的条目**原样**搬过去，含顶部按日期堆叠的批次说明。
3. 主文件保留：`§0` 拍板区、仍在开放的条目、磁盘清理现状、维护规则；每条被迁走的**外部仍在引用的编号**（至少 `1-19`、`1-45`、`1-53`）保留一行指针，形如：
   `| ~~1-19~~ | 已归档 → [history/BACKLOG-done-2026-10.md](history/BACKLOG-done-2026-10.md#1-19) |`
4. 修正两条**失实**记录（PLAN 点名）：`1-7ⓑ` 改为「等待 B0 实测数据后再定」；`1-49` 删掉「仓库里并不存在的私有任务抽取」描述。
5. 交叉校验：`git grep -n "BACKLOG"` 里指向旧编号的链接，逐个确认新位置能解析（锚点大小写要与标题一致）。

**Stage 3 的门**

```sh
(Get-Item docs/BACKLOG.md).Length          # 期望 ≤ 25*1024
node tools/regress-all.mjs --ci            # 75/75（BACKLOG 被 lint-doc-facts 之类读过就不要让它红）
node tools/lint-doc-facts.mjs              # 绿
```

---

## Stage 4 —— A2：`AGENTS.md` 瘦身（目标 ≤ 50 KB）

**这是最容易翻车的一步**：`AGENTS.md` 的章节号是 221 处外部引用的锚点。

**步骤**

1. 先量：`node tools/lint-agents-size.mjs`，记下当前体积（**61,934 B / 94.5%**）与最肥的 5 节。
2. 下沉四块查表内容到 `docs/`（**正文缩为一行指针，标题保留**）：
   - `§10`（交付自检的清单细节）→ `docs/DELIVERY.md`（新建）；
   - `§5`（工具参数表）→ `docs/ENGINE.md` 对应节；
   - `§7`（渲染导出长清单）→ `docs/DELIVERY.md`；
   - `§6`（音乐/旁白那段的长示例）→ `docs/NARRATION.md`。
   ⚠ 子节编号（`§10.11.56` 之类）**一个不删**，只把正文缩成「一行结论 + 指针」。
3. 在 `§0` 之后插入 `§0.5 前置必读摘要`（**≤ 3 KB**）：
   - `§4` 铁律**一行一条**（8 条）；
   - 三条交付门（`check` / `qa` / `verify` 各一句）；
   - 后半部分最常踩且不报错的 5 条（`maxSamples` 只往下压、`fade` 是黑掉的量、`shake` 单位是物理像素、漏铺底不报错、`prog` 的 `b` 是结束时间）。
4. 扩展 `tools/lint-agents-size.mjs`：新增判据 —— **`§4` 铁律表末尾的字节偏移 ≤ `AGENTS_INJECT_BUDGET`（默认 24000）**，超了给明确警告（因为部分宿主只注入前 24 KB）。
5. 全文自查：`node tools/lint-agents-refs.mjs` 必须仍然**全部可解析**（它会检查 221 处引用）。

**Stage 4 的门**

```sh
node tools/lint-agents-size.mjs    # 体积 ≤ 50 KB，且新判据通过（§4 末尾偏移 ≤ 24 KB）
node tools/lint-agents-refs.mjs    # ✓ 全部可解析
node tools/lint-doc-facts.mjs      # 绿（键表没被带坏）
node tools/regress-all.mjs --ci    # 75/75
```

---

## Stage 5 —— A1：拆 `scripts/anim.mjs`（8025 行 → 目标 < 400 行）

> **只在前四个阶段全绿之后开始。** 这一步分两半，**第一半做完就必须单独跑一次全量门**，不许一口气做完。

### 5A. 先接 `readCliSource()`（不改结构，只让测试不再依赖单文件）

1. 新建 `tools/lib/cli-source.mjs`，导出 `readCliSource()`：按**确定顺序**拼接 `scripts/anim.mjs` + `scripts/cmd/*.mjs` + `scripts/lib/cli/*.mjs`（排序用文件名的字典序，保证可复现）。
2. 把下面这些**读 `scripts/anim.mjs` 源码文本做接线自检**的测试切到 `readCliSource()`：
   `test-carry` `test-layout` `test-motion-assert` `test-motion-caps` `test-segment-cuts` `test-shots`（两处）
   `test-tasks-meta` `test-tier-estimate` `test-timeline-audit` `test-variants` `test-media-qa`。
   另有 `test-notes` / `test-subs` 是**直接 import 导出**的，不动它们（拆分后靠 re-export 保活）。
3. 此时 `scripts/cmd/`、`scripts/lib/cli/` 还不存在 ⇒ `readCliSource()` 要允许它们不存在（只有 `anim.mjs` 时行为与旧版等价）。

**5A 的门**

```sh
node tools/regress-all.mjs --ci     # 75/75，且每个测试的断言条数与基线**逐条相同**
```

### 5B. 机械搬移

1. 建 `scripts/cmd/` 与 `scripts/lib/cli/`；按**引用图**搬：
   - 只被单个命令用的 helper ⇒ 跟着进 `scripts/cmd/<命令>.mjs`；
   - 跨命令共用的 ⇒ `scripts/lib/cli/`（`args.mjs` / `log.mjs` / `session.mjs` / `paths.mjs` / `sheet.mjs`，按实际引用再增减）；
   - 模块级可变状态（`session`）收口在 `session.mjs`，**只导出 getter**。
2. **函数体逐字不改**，只补 `import` / `export`；`anim.mjs` 保留：参数解析 / 命令表 / 分发 / `IS_MAIN` / 对外 re-export（`assText` `assTime` 及 `test-notes` 依赖项）。
3. 新增 `tools/test-cli-layout.mjs` 并挂进 `regress-all --ci`：
   - `scripts/cmd/*.mjs` 与命令表**双向覆盖**（命令表里每个都有文件、每个文件都在表里）；
   - `scripts/anim.mjs` 行数 **< 400**。
4. 同步文档：`docs/DIAGNOSIS.md` 里指向 `scripts/anim.mjs:行号` 的条目，改到新文件（保持「文件:行号」可点）。

**5B 的门（全部要过）**

```sh
node tools/regress-all.mjs --ci                                   # 75/75，断言条数不变
node scripts/anim.mjs help            | diff - out/_baseline/help.txt   # 逐字节一致
node scripts/anim.mjs tasks --json    | diff - out/_baseline/tasks.json # 逐字节一致
node scripts/anim.mjs shots --json    | diff - out/_baseline/shots.json # 逐字节一致
node scripts/anim.mjs styles          | diff - out/_baseline/styles.txt # 逐字节一致
node scripts/anim.mjs still demo -t 1,6                          # 产物路径与退出码不变
node scripts/anim.mjs check demo --quick                         # 结论不变（允许耗时变化）
node scripts/anim.mjs video demo --draft --from 0 --to 2         # 产物路径与退出码不变
wc -l scripts/anim.mjs                                           # < 400
```

> 最后两行在 Windows 上用 `(Get-Content scripts/anim.mjs).Count` 与 `Compare-Object` 代替 `diff`。

---

## 6. 回报格式（每个阶段都按这个回）

```
阶段：A5 / A6 / A3 / A2 / A1（5A / 5B）
改了什么：<一句话>
diff --stat：
  <粘贴>
门：
  $ <命令>
  <原始输出末 5 行>
  exit=<码>
有没有 skipped：<有的话贴那一行>
没做成 / 与工作单不一致的地方：<老实写，别美化>
```

## 7. 出问题怎么办

| 情况 | 动作 |
|---|---|
| 门红了，但**改动前就是红的** | 贴出「改动前」与「改动后」两次输出，标记为既有问题，**不要**为它改测试 |
| 断言条数变了 | 立即停，把变了的那个测试名 + 差多少条贴出来（多半是搬漏了某个函数） |
| 逐字节对拍不一致 | 停，贴 `diff` 的前 20 行；**不要**去改基线文件 |
| 需要改 `tasks/**` 或 `src/**` 才能过门 | 停 —— 说明工作单这一阶段的边界画错了，把情况写清楚 |
| 想顺手优化某段代码 | 不做，记进回报的「建议」栏 |

## 8. 回滚（每阶段都能单独退）

```sh
git log --oneline -6                  # 找到阶段前的 SHA
git reset --hard <阶段前SHA>          # 只回滚本地提交（都没 push，安全）
```

> 回滚后重跑一次 `node tools/regress-all.mjs --ci`，确认回到 75/75 再继续别的阶段。
