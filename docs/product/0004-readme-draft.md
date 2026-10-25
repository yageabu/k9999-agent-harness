# K9999

> Master Orchestrator · 多 Agent Web 工程 CLI | 面向小微团队的全链路开发助手
>
> 【释义：Master Orchestrator = 主控编排器。如同乐团总指挥，负责拆解需求、编排与调度多个专家 Agent 协同完成 Web 工程项目】

[![License](https://img.shields.io/badge/license-MIT-blue.svg)]()
[![Bun](https://img.shields.io/badge/runtime-Bun-orange)]()
[![Stars](https://img.shields.io/github/stars/xxx/k9999)]()

**一句话定位：自研 Bun 多 Agent 调度内核，DAG 任务并行加 PTC 批量调用。K9999（主控编排器）调度多专家 Agent，一站式完成 Web 项目：需求 → 架构 → 前后端 → 测试 → Docker 部署，专为独立开发者与 3–10 人小团队打造。**

> 版本说明：
> K9999 v1：基于 Pi Fork，原型验证仓库（`k9999-agent-harness`），验证 MCP、沙箱、TUI 交互。
> **K9999 v2（当前项目）：完全另起炉灶，Bun + TS 从零自研 Harness，不再复用 Pi 内核。新增 Master Orchestrator 主控编排器、DAG 多 Agent 任务调度加 PTC 批量工具执行，解决 v1 同质化痛点。**

> 区别于 Pi 单 Agent 串行、CrewAI 自由对话扯皮，K9999 采用中心化主控编排器加任务依赖 DAG，严格约束 Agent 分工。内置 Web 垂直工程范式，开箱即用。

## ✨ 核心亮点（差异化壁垒）

1. **Master 主控内核：DAG 多 Agent 调度**
   主控器自动拆解项目任务，识别依赖关系，无依赖任务自动并行执行，告别串行等待。
2. **原生 PTC 批量工具脚本（王牌特性）**
   一轮思考执行多条文件读写加 Shell 命令，LLM 交互轮次直接减少一半，大项目重构效率大幅提升。
3. **Web 全链路角色分工（5 个固化专家 Agent）**
   架构师 / 后端开发 / 前端开发 / 自动化测试 / DevOps 运维，各司其职，不会越界闲聊。
4. **项目级长期记忆**
   跨会话自动记住数据库表结构、项目目录、技术栈，不用反复重复说明项目规则。
5. **纯本地 CLI 加单二进制分发**
   Bun 编译为独立 exe 二进制，无 Node 依赖。文件与命令沙箱隔离，代码全程留在本机，不上云端。

## 📦 功能清单

### 免费开源版

- 单 Agent 串行模式，前后端双角色，基础文件加 Shell 工具，会话树加人工审批。

### 个人付费版（永久授权）

- ✅ 全部 5 个专家角色加 DAG 并行任务调度
- ✅ PTC 批量脚本执行引擎（核心商业模块）
- ✅ 项目级跨会话长期记忆
- ✅ SpringBoot / Vue3、React + Node 全套 Web 脚手架
- ✅ 临时 Docker 容器沙箱，执行命令零污染本机
- ✅ 多分支会话、历史回溯、会话导出

### 团队订阅版

- ✅ 多人权限管控加全操作审计日志
- ✅ 团队共享工程模板库
- ✅ 统一模型密钥管理

## 🎬 Demo 演示用例（复制即可复现）

### 用例 1：从零搭建电商 Web 项目（主 Demo）

1. 新建空文件夹，执行命令：

```bash
k9999 start
```

2. 输入需求：

> 开发一套电商管理系统，后端 SpringBoot + MySQL，前端 Vue3 + ElementPlus。包含用户、商品、订单 3 个模块。写完接口自动生成单元测试，最后输出 Dockerfile 与 docker-compose 部署脚本。

3. 执行流程：
   1. 架构 Agent 先行输出数据库设计加项目目录结构
   2. 后端、前端 Agent 并行开发业务代码
   3. 测试 Agent 自动生成单元测试
   4. DevOps Agent 输出容器部署配置
   5. Master 调度器自动合并全部代码，检查文件冲突

### 用例 2：大型代码库重构（PTC 能力演示）

> 把老 SSM 项目升级为 SpringBoot3，批量迁移接口、修改包路径、批量重构实体类。
>
> 效果：PTC 一次性执行批量文件修改加全局替换加编译校验，仅需 3 轮 LLM 交互。普通单 Agent 串行需要 7–9 轮。

### 用例 3：会话分支迭代

基于当前项目创建会话分支，在分支内做架构改版。不满意一键切回主干会话，不破坏原有代码。

## 🚀 快速安装

```bash
# Mac/Linux
curl -fsSL https://release.k9999.dev/install.sh | bash

# Windows（PowerShell）
irm https://release.k9999.dev/install.ps1 | iex

# 启动
k9999 start
```

## 🧱 技术架构

- 运行时：Bun + TypeScript（自研 Harness，无 Pi 内核依赖）
- 调度层：中心化 Master Orchestrator 加 DAG 任务图调度器
- 核心引擎：PTC 批量脚本解释器
- 交互层：TUI 交互式终端加会话树分支管理
- 工具层：MCP 协议对接文件、Git、Shell、Docker
- 安全层：命令白名单加交互式审批加一次性容器沙箱

## 📊 商业化路线

1. 开源引流：上层工程能力保持 MIT 开源，获取 GitHub 流量
2. 个人变现：永久许可 99 元，解锁多 Agent 并行加 PTC 核心引擎
3. 团队变现：按月订阅加私有化部署授权
4. 增值收入：云部署模板、E2E 测试扩展包

## 📝 开发计划

- 第 1 阶段（MVP）：Master 调度器加架构加后端 Agent 加 PTC 批量调用
- 第 2 阶段（正式版）：补齐前端 / 测试 / DevOps 角色加 DAG 并行调度加项目记忆
- 第 3 阶段（商业化）：权限审计、容器沙箱、授权系统、二进制打包分发

## 🤝 开源说明

- 上层业务 Agent、Web 工程模板、TUI 交互代码：MIT 开源
- 内核 Master 调度器加 PTC 批量执行引擎：闭源商业模块，仅在付费版本中启用
- v1 原型仓库：`k9999-agent-harness`（仅做交互原型验证，不再迭代内核）

---

> 本文件是 [0004](0004-readme-draft.md) 草稿。它**不**替换仓库根目录的 `README.md`，后者描述的是今天能跑的代码。
