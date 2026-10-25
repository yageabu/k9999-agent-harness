# 0005 — 核心伪代码（Bun + TypeScript）

> 状态：proposal。这段代码没有运行过。评审见 [0070 §1](0070-review.md)。

## 5.1 项目结构

```text
src/
├── harness/                    # 自研 Agent 运行内核（闭源核心）
│   ├── agent-loop.ts           # 基础思考循环
│   ├── ptc-engine.ts           # PTC 批量脚本解释器（王牌能力）
│   ├── master-orchestrator.ts  # Master 主控 DAG 任务调度器
│   └── session-tree.ts         # 会话树分支管理
├── workers/                    # 5 个领域子 Agent（开源）
│   ├── architect.ts
│   ├── backend-dev.ts
│   ├── frontend-dev.ts
│   ├── tester.ts
│   └── devops.ts
├── tools/                      # MCP 工具加沙箱
├── tui/                        # 终端交互界面
└── main.ts                     # 入口 CLI
```

> 评审注：`workers/` 在现有仓库里应当是一组 profile（`profile.json` + `system.md`），不是一个类目录。见 ADR-0004。

## 5.2 Master 主控调度器（master-orchestrator.ts）

```typescript
// K9999 Master Orchestrator
// 任务节点结构
interface TaskNode {
  id: string;
  title: string;
  worker: "architect" | "backend" | "frontend" | "tester" | "devops";
  dependsOn: string[]; // 前置依赖任务 ID
  status: "pending" | "running" | "done";
  result?: string;
}

// Master 主控调度器
export class MasterOrchestrator {
  private taskGraph: TaskNode[];
  private workers: Record<string, BaseWorker>;

  // 1. 把用户需求拆解为 DAG 任务列表
  async decomposeRequirement(userPrompt: string, projectContext: string) {
    const plan = await this.llm.structuredOutput({
      prompt: `拆解 Web 开发任务，输出带依赖关系的任务 DAG，严格分配给对应 Worker`,
      schema: TaskNodeSchema,
    });
    this.taskGraph = plan.tasks;
  }

  // 2. 循环执行任务，自动并行无依赖任务
  async runDAG() {
    while (this.hasPendingTasks()) {
      // 筛选所有前置任务已完成的节点（可并行执行）
      const runnableTasks = this.taskGraph.filter((node) => {
        if (node.status !== "pending") return false;
        return node.dependsOn.every(
          (depId) => this.taskGraph.find((t) => t.id === depId)?.status === "done",
        );
      });

      // 并行批量执行可运行任务
      await Promise.all(
        runnableTasks.map(async (task) => {
          task.status = "running";
          const worker = this.workers[task.worker];
          task.result = await worker.execute(task.title, projectContext);
          task.status = "done";
        }),
      );
    }

    // 3. 合并所有输出，代码冲突校验
    return this.mergeAllResults();
  }
}
```

## 5.3 PTC 批量脚本引擎（ptc-engine.ts）

```typescript
// K9999 PTC 批量脚本引擎
// 原版 Pi：单次只能调用 1 个 functionCall。本引擎支持批量执行脚本
export class PTCEngine {
  // 解析 LLM 输出的微型脚本，批量执行多条工具动作
  async runScript(script: string, tools: MCPToolSet) {
    const actions = this.parseScript(script);
    for (const action of actions) {
      // 文件读写、shell 命令、git 操作一次性顺序执行
      await tools.invoke(action.name, action.args);
      // 每一步执行都弹出人工审批弹窗（继承 v1 交互）
      await this.confirmUserApproval(action);
    }
  }

  // 支持循环、条件分支，实现批量重构
  parseScript(scriptText: string): ToolAction[] {
    // 简易脚本解析，把自然语言脚本转为结构化工具调用数组
    return structuredParse(scriptText);
  }
}
```

## 5.4 主入口（main.ts）

```typescript
// main.ts CLI 入口 K9999
const master = new MasterOrchestrator();
// 1. 接收用户需求
const userReq = await promptUser("请输入 Web 项目开发需求：");
// 2. 自动拆解 DAG 任务
await master.decomposeRequirement(userReq, readProjectFiles());
// 3. 并行执行多 Agent 任务
const finalCode = await master.runDAG();
// 4. 写入本地文件
await writeProjectCode(finalCode);
```
