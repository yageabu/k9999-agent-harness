# 0080 — v2 启动：重建与新仓库

> 决定日期：2026-10-20。状态：**accepted**，其中路线一条在当天改判，见 §1 的修订记录。

## 1. 决定

| 项 | 选择 | 拒绝的选项 |
|---|---|---|
| 路线 | **从零重建**，Bun 运行时，不依赖 `pi` 的任何库。落在 `/home/abu/code/lokyu-agent-harness` | ~~B：Bun 优先但依赖 `pi-durable`/`pi-ai`/`pi-tui`~~ — 见修订记录 |
| 品牌 | **lokyu** | 沿用 K9999。已发布的 `k9999@0.6.0` 占着包名，且 MIT 已经发出去 |
| K9999 | 留在 Pi 线上，做最小化实验。只修缺陷，不加功能 | 把商业代码与已发布的 MIT 代码放进同一个仓库 |
| 套件 | 不在前 4 周内。只留两处缝 | 见 [0071](0071-suite-feasibility.md) |

**修订记录（2026-10-20，同日）**：本文初版记录路线 B —— Bun 优先、仍依赖 `pi-durable` / `pi-ai` / `pi-tui`，理由是可移植性核查通过、只差一个存储适配器。当天改判为从零重建。

改判的不是技术评估，是目的。B 回答的是"怎么分发"，从零重建回答的是"一个 harness 到底在做什么"。两个问题都值得回答，但不该在同一个仓库里回答：一个要尽快稳定，另一个要能随便拆。所以 B 的结论没有错，只是它服务的那个问题被换掉了。

## 2. v1 冻结条款

`k9999-agent-harness` 从此只修缺陷，不加功能。它继续持有的三样东西，重建时要用：

1. **测量数据**：ADR-0003 的启动时间表、SPEC 0011 的 `printenv` 前后对比、eval 的 replay 结果。
2. **specs 目录**：0001 到 0012 是不变量。新实现重新实现其中一部分，判断标准照抄。
3. **一个能跑的基线**：`npm run check` 与 `npm run eval -- --scripted --verify-replay` 必须永远绿。

跨仓库冲突的裁决规则只有一条：**答案在新实现里改，理由在这里记录。**

术语：K9999 今天是**依赖** `pi-agent-core` / `pi-durable`（ADR-0001 与 ADR-0017），不是 fork 应用。若确实要改成 fork `pi-coding-agent`，那是另一个决定，需要单独一条 ADR。

## 3. 实际执行（2026-10-20）

新仓库已建：`/home/abu/code/lokyu-agent-harness`，两次提交，47 个测试全绿。

代码规模约 1,900 行，九个模块：

| 模块 | 内容 |
|---|---|
| `loop.ts` | 一轮循环：调用 provider，收工具调用，执行，把失败转成消息，直到模型不再调用工具 |
| `provider/openai.ts` | chat completions 流式 HTTP，SSE 增量解析，工具调用按 index 拼装 |
| `tools/` | `read` / `write` / `edit` / `bash`，一张 `TOOL_FACTORIES` 表，环境 allowlist |
| `profile.ts` | `profile.json` + `system.md`，未知字段与未知工具名在加载期失败 |
| `prompt.ts` | 组装顺序：authored → 工具段 → cwd |
| `session.ts` | 追加写 JSONL，带版本头，恢复时逐行验 |
| `render/text.ts` | 答案走 stdout，过程走 stderr，一个逻辑光标跨两条流 |
| `main.ts` | `--version` / `--show` / `--print` / REPL |

## 4. 新测量

同机器，同一份源码：

| 调用方式 | 时间 | 体积 |
|---|---|---|
| `./dist/lokyu --version` | 34 ms | 87 MB |
| `bun run src/main.ts --version` | 44 ms | — |
| `node src/main.ts --version` | 140 ms | — |

87 MB 是 Bun 运行时，不是这份代码。ADR-0003 记的 `pi --version` 是 415 ms、`node dist/bundle/cli.js --version` 是 320 ms，但那是另一个规模的应用，两行数字不能直接相减。能直接比的只有 44 与 140：同一份代码，换运行时。

复现：`bun run build`，再 `./dist/lokyu --version` 跑十次取均值。没有 `hyperfine` 依赖。

## 5. 已知缺口（不写成待办，写成事实）

| | 状态 |
|---|---|
| 命令策略 | 有：工作目录内的递归删除放行，目录外拒绝，规则名写进错误信息。策略按方言分支，cmd 会话另有一套（`rd /s`、`del /s`、`format`）。不是沙箱，也还没有审批 |
| 环境告知 | 有：启动时解析 shell，平台/版本/WSL/shell/方言进 system prompt、进工具描述、进失败提示 |
| 压缩 | 没有。长会话无限增长 |
| MCP | 没有 |
| 第二个 provider | 没有。但接缝已经是事件流 + `finish{reason, usage}` + `Model` 描述符，参照 pi-ai 的词汇而不抄它的目录 |
| 重试 | 有：`withRetry` 作为包装器，只重试可重试的 `ProviderError`，且仅限尚未输出任何事件的尝试 |
| 截断 | 能报。`finish_reason: length` → `truncated`，`--print` 退出 3 |
| 上下文溢出 | 能报。每次调用前用上界估算，装不下就不上传，`--print` 退出 4；provider 的 `context_length_exceeded` 单独归类且不重试 |
| 多 Agent / subagent | 没有 |
| 评测与重放 | **有**。6 个任务、命令谓词、隐藏测试、transcript、`--verify` 重放 |
| 流式工具调用的中途可见性 | 没有。工具调用在参数拼装完后整条出现 |

前六行是 lokyu 的 README 里原样写着的，不是这一页的推测。

## 6. 评测（同日完成）

`deepseek-flash`，一次运行，无重试：

| 任务 | 结果 | 轮次 | 工具调用 | in / out | 墙钟 |
|---|---|---|---|---|---|
| 0001-sum | pass | 4 | 4 | 5486 / 327 | 3868 ms |
| 0002-port-bug | pass | 7 | 8 | 14875 / 1086 | 9130 ms |
| 0003-cli | pass | 4 | 3 | 4955 / 345 | 4531 ms |
| 0004-rename | pass | 11 | 16 | 26228 / 1490 | 12375 ms |
| 0005-ledger | pass | 9 | 11 | 26832 / 1136 | 10963 ms |
| 0006-slugify | pass | 8 | 10 | 27331 / 3481 | 21507 ms |
| 合计 | 6/6 | 43 | 52 | 105707 / 7865 | 62.4 s |

`--verify` 重放通过。**6/6 是地板，不是梯度。** 六个手写夹具没有一个失败，这本身就是结论：有用的任务集只能从真实工作里来，不能靠编。

### 三条预检规则，其中两条来自真实失败

1. **夹具必须过不了自己的 check。** 一过就说明任务什么也没测。
2. **`solution/` 必须过得去。** 第一次写的 `0004-rename` 在浮点数上做了 `assert.equal(total, 30.6)`，实测 `30.599999999999998`。模型重命名完全正确却永远过不了，14 轮后被判 breached。现在没有可过解的 task 在加载期就是 `invalid`。
3. **agent 不能看到 `hidden/`。** 隐藏测试在 agent 跑完后、判决前才拷进 workspace，用来判实现了规则而不是讨好了三个可见用例。落地时踩了两个坑：`cp` 对已存在目录是合并语义，隐藏文件落到了根目录，check 实际只跑了可见测试；而夹具预检又把隐藏测试拷进了 agent 要用的那个 workspace，等于提前交出答案。现在预检在自己的副本里跑，并有测试断言运行期 `read hidden/` 必须失败。

第 2、3 条都应回灌到 `packages/eval` 的约定里：k9999 只要求每个任务有确定性谓词，没有要求任务可解，也没有机制防止针对可见测试过拟合。

## 7. 前 4 周仍然不做

- 套件清单与加载器（只留 eval 条件里的配置 hash 槽与分节 prompt）
- 5 个角色 Worker
- 多 Agent 并行写同一仓库（契约与 worktree 先于并行）
- RAG
- 容器沙箱（只生成 Dockerfile，不执行 `docker`）
- 服务端与网页界面

下一步按优先级：**从真实工作里取任务**。手写夹具已经证明不产生失败；失败样本只能来自真有难度的活，比如 k9999 里一个真实的未修缺陷，或一次真实的迁移。
