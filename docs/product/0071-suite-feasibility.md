# 0071 — 定制化套件（suite）可行性

> 输入：把定制 Agent 做成可插拔套件，按团队定制 MCP 列表、插件、Hooks、Skill、RAG、Memory、AGENT.md、DESIGN.md。
> 结论：**可行，而且比 [0001](0001-proposal.md) 的"闭源多 Agent 内核"更值得做。但前提是这七样东西不能被装进同一个配置对象。**

## 1. 判断

这七样不是同一类东西。它们的信任级别、生命周期、失效方式全部不同。装进一个 `suite.json` 而不分层，三周后它会变成一个谁都不敢改的上帝对象，而每一处失效都要在整个文件里找。

按"能不能跑代码"和"是不是状态"切成三层：

| 层 | 内容 | 性质 | 信任 | 生命周期 |
|---|---|---|---|---|
| **A 声明** | `agent.md`、`design.md`、skills、tool 白名单、MCP 服务器列表、模型与 thinking level | 数据 | 加载时不执行代码，可 diff，可放进客户仓库评审 | 跟套件版本走 |
| **B 代码** | plugins、hooks、自定义工具 | 代码 | 需要版本化接口、能力声明、失败隔离 | 跟套件版本走 |
| **C 状态** | memory、RAG 索引 | 派生数据 | 不可信内容，需证据与失效 | **跟项目走，不跟套件走** |

**最重要的一条：套件必须无状态。** memory 与 RAG 只能以"怎么建、召回多少"的形式出现在套件里，索引本身不能打包分发。理由在 SPEC 0010 已经写过：memory 跟 agent 走，wiki 跟项目走。一个装在套件里的索引，是把别人的旧事实装进你的新项目，而且它看起来像事实。

## 2. 七样东西各自的位置

| 诉求 | 层 | 现状 | 判断 |
|---|---|---|---|
| AGENT.md | A | 有等价物：`profiles/<id>/system.md` + ADR-0005 的组装顺序 | 直接扩，成本接近零 |
| DESIGN.md | A | 无 | 上下文注入 + 按需加载，小 |
| Skill | A | 已实现：`skills/<name>/SKILL.md`，prompt 里只广告名字与路径，按需读 | 已付费，直接复用 |
| 工具白名单 | A | 已实现：`TOOL_FACTORIES`，未知名字在加载期报错 | 已付费 |
| MCP 列表 | A + B | ADR-0008 明确"暂不支持" | **有硬成本，见 §4** |
| Hooks | B | 无 | 契约要现在定，见 §5 |
| 插件 | B | 无。ADR-0002 拒绝了 Cordis，所以没有插件容器 | 中，接口自己定 |
| Memory | C | SPEC 0010 / 0012，`accepted`，未实现 | 独立子系统，不是配置项 |
| RAG | C | 无 | **大**。切分、嵌入、存储、失效、权限，是另一个项目 |

## 3. 上下文预算：套件最容易崩的地方

ADR-0005 说 prompt 组装顺序是契约。套件加进来以后，有七个来源同时想进上下文窗口。没有显式优先级和硬预算，结果就是"继续追加文本，直到模型看不懂"。

优先级栈，从高到低，且每层有配额：

```text
1  profile system.md            固定
2  suite agent.md               固定，硬上限
3  suite design.md              按需注入，或 always（由套件声明）
4  skills                      只进名字与一行描述，正文按需读
5  memory                      召回 top-k，条数与 token 双限
6  RAG                          召回 top-k，条数与 token 双限
7  cwd 与工具清单               生成，不由套件写
```

三条规则：

1. **总和封顶。** 超出时截断最低优先级的来源，并把截断事实报给用户。静默追加是这里唯一的致命错误。
2. **`k9999 suite show` 必须能打印本次调用实际注入了哪些段落、各占多少 token。** 否则"它为什么不遵守我们的规范"永远无法回答。这是 positioning.md 里 observability 那一条的直接延伸。
3. **套件不能自己往 prompt 里写工具清单。** 生成段永远在 authored 文本之后，这是 ADR-0005 的既有决定。

## 4. MCP：唯一有供应链风险的字段

ADR-0008 决定"暂不支持 MCP"，理由有两条，现在都不能不管：

**上下文成本。** 每个 server 的工具 schema 都要进上下文。10 个 server × 20 个工具，开局就烧掉几千 token，而且模型选错工具的概率随清单长度上升。所以套件里必须能声明暴露策略，而不是"连上就全暴露"：

- `expose: "declared"`：所有工具直接声明，适合 2 到 3 个 server。
- `expose: "on-demand"`：工具按需发现。这是 ADR-0008 说的"目录发现层本身是一个项目"，先不做，但要留字段。
- `tools: []`：每个 server 的暴露白名单。省略即不暴露任何工具。

**信任。** 套件从客户仓库拉下来，`mcp.json` 里写一行 `npx @someone/server` 就是用你的凭据跑任意代码。这和 ADR-0001 更正里那条"一个被要求检查的仓库能重定向你的 agent"是同一个问题，也是 SPEC 0011 覆盖的范围。应对：

- 版本必须精确，拒绝 `latest` 与 `*`。
- 首次安装打印将要 spawn 的命令，需要显式批准。
- MCP 子进程走同一个 `guardedEnv`，不是 `process.env`。
- 套件声明的能力与其实际调用对不上时，加载期失败。

## 5. Hooks：最容易设计坏的一层

```ts
type Hook = {
  stage: "before-turn" | "after-turn" | "before-tool" | "after-tool";
  priority: number;                              // 显式；同 priority 之间禁止依赖
  effect: "observe" | "annotate" | "gate" | "rewrite";
  module: string;
  onError: "deny" | "allow";                     // 默认 deny
};
```

四条约束，每条都对应一个已知的失败：

1. **顺序显式。** 隐式注册顺序让同一套件在不同机器上行为不同，回放就失效了。
2. **能力分级。** `observe` 与 `annotate` 默认允许。`gate` 与 `rewrite` 需要套件显式声明，且出现在审计里。`rewrite` 能改工具参数，它实质上就是策略引擎，与 SPEC 0011 的权限门是同一个东西，不能另开一条路。
3. **失败策略显式，默认 fail-closed。** hook 抛异常时放行，是让安全组件在崩溃时静默失效。
4. **hook 里不许 await 人类。** 那会退回阻塞，而阻塞是 SPEC 0001 与 ADR-0009 花大力气消掉的东西。需要人工批准的 hook 只能把请求排进收件箱，不能等。

## 6. 套件是一个依赖，不是一个文件夹

```ts
// suite/suite.json —— A 层声明。加载时不执行任何代码。
type SuiteManifest = {
  id: string;
  version: string;
  extends?: string;                 // 继承一层，向上合并
  agent: { file: string };
  design?: { file: string; inject: "always" | "on-demand" };
  tools: readonly string[];         // 只能是 TOOL_FACTORIES 里已有的名字
  skills?: readonly string[];
  mcp?: readonly McpServer[];
  hooks?: readonly Hook[];
  memory?: { recall: number; scopes: readonly ("agent" | "project")[] };
  rag?: { sources: readonly RagSource[]; recall: number };
  budget: { promptTokens: number };
  evals?: { dir: string };
};
```

配套三件：

- **`suite.lock`**：套件版本、每个 MCP server 的精确版本、skills 内容 hash。
- **这个 hash 必须进 eval 的条件记录。** `buildReport` 已经拒绝跨不同条件的 delta。套件变了而条件没记，报告就会静默撒谎，这比没有报告更糟。
- **`k9999 suite validate`**：未知工具名、未知字段、hook 引用不存在的阶段、MCP 版本写成 `latest`，全部在加载期响亮失败，不静默跳过。

## 7. 套件自带验收任务

这是我认为最值得做、也几乎没人做的一条：`suite/evals/*.json`，每个任务带确定性 `check`，完全复用 `packages/eval` 的谓词、transcript、重放。

于是客户装完套件能跑：

```bash
k9999 suite verify    # 这套定制在此项目上是否仍满足它自己声明的 12 条约束
```

没有这一步，定制套件就是一堆没人验证过的提示词。三个月后没人知道它还有效，而客户付的钱买的是"有效"，不是"存在"。

## 8. 与多 Agent 的关系：套件是项目级的，角色只继承

反直觉但重要：**套件越多，多 Agent 越难**。5 个角色各带一套定制，就是 5 个不一致的世界观，接口契约会漂。

所以：

- 套件挂在**项目**上，5 个角色共享。
- 角色只允许在少数白名单字段上覆盖（模型、thinking level、工具子集）。
- 架构 Agent 的 `design.md` 是跨角色的唯一契约来源。

这正好接上 [0070](0070-review.md) 第 2 节的结论：契约是壁垒，套件是契约的载体。

## 9. 成本，按已付与新债分开

| 能力 | 状态 | 量级 |
|---|---|---|
| profile 机制 | 已实现 | 零 |
| skills 索引与按需加载 | 已实现 | 零 |
| prompt 组装契约 | 已实现，需扩展 | 小 |
| 工具白名单与加载期失败 | 已实现 | 零 |
| eval 谓词、transcript、重放 | 已实现 | 零 |
| suite 清单、加载、校验、`show` | 新 | 小到中 |
| 上下文预算与截断报告 | 新 | 小 |
| MCP 客户端（declared 暴露） | 新 | 中 |
| MCP 按需发现 | 新 | **大**，ADR-0008 已判定 |
| hooks 运行时 | 新 | 中 |
| plugins | 新 | 中，接口要从零定 |
| memory | SPEC 已有 | 中 |
| RAG | 新 | **大**，独立项目 |

**结论：A 层两周能交付 80% 的"定制感"。** hooks 与 MCP 是第二批。RAG 不要塞进 12 周。

## 10. 商业上为什么这个更好

| | 闭源多 Agent 内核（0001） | 定制套件（本文） |
|---|---|---|
| 卖的是什么 | 推理能力 | 规格与验收 |
| 破解价值 | 高，且技术挡不住 | 低，价值在内容与持续维护 |
| 收入形态 | 一次性 99 元，卖断支持义务 | 套件订阅 + 定制咨询，天然 recurring |
| 何时能有收入 | 12 周后 | 第 3 周（给第一个团队做套件） |
| 与开源的冲突 | 直接冲突，已发 MIT | 无冲突，运行时全开源 |

最后一行是关键。仓库今天已经是 MIT，`k9999@0.6.0` 已经在 npm 上。[0070 §4](0070-review.md) 说的"收不回来"在这里不再是个问题：**运行时全开源，卖套件与验证服务**，破解运行时没有意义。

## 11. 建议的落地顺序

**第 1–2 周（A 层，零新子系统）**

1. `SuiteManifest` 类型 + 加载器 + `suite validate`，未知字段与未知工具名在加载期失败。
2. 优先级栈与 token 预算，超出时截断并报告。
3. `k9999 suite show`：打印实际注入的段落与 token 数。
4. `suite/evals/` 接 `packages/eval`，`k9999 suite verify` 跑通一个真实团队的三条约束。

**第 3–4 周（MCP，declared 暴露）**：精确版本、白名单、`guardedEnv`、首次安装显式批准。

**之后**：hooks（先只放 `observe` 与 `annotate`）、plugins、memory。RAG 单独排期。

**明确拒绝的四件事**

- 套件里带 RAG 索引或 memory 快照。
- `latest` 版本的 MCP server。
- 能 await 人类的 hook。
- hooks 隐式顺序。
