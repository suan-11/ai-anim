# Agent 信箱：让 GPT 能主动找我（`tools/agent-mail.mjs`）

> 目标：**两个方向的对话**，而不是「我发一条 brief、它跑完一次性回报」。
> 手段：一个 append-only 的 JSONL 信箱，两边都能写。不引服务、不占端口、不要登录 ——
> codex 那边只有 shell，这是它唯一能「主动」的通道。

## 1. 协议

信箱文件：`out/_mail/mail.jsonl`（`out/` 已 gitignore，不进仓库）。每行一条：

```json
{ "id": "mw7wp9f5-phra", "at": "2026-11-08T14:07:14.000Z",
  "from": "gpt", "to": "orchestrator", "thread": "5b",
  "text": "拆到 cmdCheck：它 1130 行，我建议先抽 sheet 层，再拆 check", "replyTo": "mw7wp9f5-phra" }
```

| 字段 | 说明 |
|---|---|
| `from` / `to` | 身份：`orchestrator`（我）/ `gpt`（Codex）/ 其它都行 |
| `thread` | 话题（`5b`、`trans-spin`…），两边都按它过滤 |
| `replyTo` | 回哪一条（可选） |
| `id` | 自增时间戳 + 随机，用来做 `--after` 游标 |

## 2. 四个命令

```sh
node tools/agent-mail.mjs send  --from gpt --to orchestrator --text "…" [--thread 5b] [--reply-to <id>]
node tools/agent-mail.mjs inbox --for gpt [--thread 5b] [--after <id>]
node tools/agent-mail.mjs wait  --for gpt --timeout 600 [--after <id>]   # 阻塞等新消息
node tools/agent-mail.mjs thread --name 5b                              # 只看某个话题
```

退出码：`inbox` 有消息 0 / 空 1；`wait` 等到 0 / 超时 **2**（超时不算错 —— 写循环时靠它继续）。

## 3. GPT 那一侧怎么写（贴进 brief 就行）

```text
## 沟通协议（重要）
你不是只交一次报告就结束。每完成一个可验证的小步、或者遇到需要我决定的事，**主动**写一条消息：

  node tools/agent-mail.mjs send --from gpt --to orchestrator --thread <话题> --text "<一句话>"

- 小步完成 → 写「做完了什么 + 门的结果」；
- 卡住 / 有歧义 → 写「我打算这么处理，除非你说不行」并**先继续往下做别的**；
- 需要我做决定（改测试、动别的目录、行为取舍）→ 写「等你一句话」，然后 `wait`：

  node tools/agent-mail.mjs wait --for gpt --thread <话题> --timeout 900

我的回复会出现在同一个信箱里（`inbox --for gpt`），**id 我带回**，你可以 `--reply-to` 继续这条线。
```

## 4. 我这一侧的循环

```sh
# 等它说话（我这边轮询，不占 CPU）
node tools/agent-mail.mjs wait --for orchestrator --timeout 900

# 回它：带上它在等的 id，续同一个话题
node tools/agent-mail.mjs send --from orchestrator --to gpt --thread 5b \
  --reply-to <它的 id> --text "可以，先抽 sheet 层；测试别改"
```

## 5. 为什么不用别的方案

| 备选 | 为什么没选 |
|---|---|
| 反向 MCP 服务 | codex 的 MCP 是**它连出去**，不是连进来；要写一个端口 + 握手，收益不值 |
| 共享文件随手写 | 没有游标就不知道哪条读过；JSONL + `--after` 是最小的可用解 |
| 让 codex 一直挂着交互式会话 | `codex exec` 是非交互的；`relay.mjs --session <threadId>` 已经能续会话，信箱补的是「它先开口」 |

## 6. 与 `relay.mjs` 的关系

- `relay.mjs --brief <file> --cd <repo>`：**开一个会话**（一次性任务）；
- `relay.mjs --session <threadId> --brief <delta>`：**续同一个会话**（它记得上下文，只发改动部分）；
- 信箱负责**它先说话**：它写完消息可以继续干活，我这边 `wait` 一到就回；
- 会话 id 在 `result.json` 里（`threadId` 字段），每次续会话都要带上。

## 7. 已知边界

1. 信箱在 `out/` 下 ⇒ **不进版本库**。要留档就 `cp out/_mail/mail.jsonl docs/history/`；
2. 两条 `send` 同时写可能留半行 —— 读取端**跳过坏行**（已实现），不会崩；
3. `wait` 是轮询（1s），不是 inotify：沙箱里文件事件不可靠，轮询更稳；
4. 它不替你判断「该不该继续」—— 那条判断仍在人（或我）这边。
