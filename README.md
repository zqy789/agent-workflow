# agent-workflow-platform

研发协作与上下文流转平台 —— **可配置框架**（对应 `agent-workflow` 仓库中的 `PRD_v0.1.md`）。

## 灵魂

> **内核极简且领域无关；领域能力全部由配置表达；外部能力全部由扩展点注入。**

一句可扩展性测试：新增节点类型 / 接新工具 / 换 Agent 内核 / 换通知渠道 / 加流水线步骤，**只改配置或加插件，不改内核**。

## 三层结构

```
src/
├── model/        # 第 1 层 内核：抽象对象模型 + 状态机 + 事件/产物 + 上下文（领域无关）
├── config/       # 第 2 层 配置：默认策略 + 示例节点定义（灵魂的载体，声明式数据）
├── extensions/   # 第 3 层 扩展点：6 个稳定接口（AgentKernel / ToolProvider / Notifier / ...）
└── engine/       # 内核运行时：Store / 状态机 / 上下文组织 / Kernel 门面
```

## 运行

需要 **Node ≥ 24**（原生运行 TypeScript，零依赖、零构建）：

```bash
node examples/basic-flow.ts        # 演示：建图 → 适配 → 补充 → 上下文 → 状态推进
node tests/kernel-rules.test.ts    # 内核业务规则测试
node tests/pipeline-notify.test.ts # 流水线 + 通知测试
node tests/server.test.ts          # 服务端端到端 + 持久化测试
node tests/tool.test.ts            # 工具接入（联网读取）测试
node server.ts                     # 启动 HTTP API 服务（默认 :8787）
```

## 服务端（Node + TypeScript，零依赖）

```bash
node server.ts          # 监听 http://localhost:8787，状态落盘到 data/state.json
```

主要端点：`GET /health` · `GET /llm/status` · `GET /integrations/status` · `GET /state` · `GET /snapshot` · `GET /context/:nodeId` · `GET /project/:id/summary` · `GET /permissions/check` ·
`POST /orgs` · `/members` · `/projects` · `/requirements` · `/nodes` · `/relations` · `/artifacts` · `/analyze` · `/pipeline/run`。

启动时从 `data/state.json` 恢复状态，每次写操作后持久化（FR12）。

## Web 前端（工作入口）

浏览器打开 `http://localhost:8787` —— 深空主题的节点图，而非传统 OA：

- 依赖图按「上游在左、下游在右」分层渲染，节点按执行状态发光（处理中=青色脉冲、等待人工=琥珀、完成=绿色）。
- 依赖边上流动的能量粒子表示上下文流转；交付关系用紫色区分。
- 点击节点侧滑出玻璃面板，展示该节点的**有效上下文**（目标/已确认输入/未决事项/进展/验收条件，按来源性质标注）。
- 右下角 `+` 一键生成示例协作流；顶栏实时显示 LLM 配置状态与在线状态。

## 连接配置（环境变量，见 `.env.example`）

配置点全部通过环境变量提供，不硬编码：

```bash
DEEPSEEK_API_KEY=sk-xxx        # LLM：必填，填了即启用真实分析
DEEPSEEK_BASE_URL=...          # 可选，默认 https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat   # 可选，reasoner 模型为 deepseek-reasoner

MCP_ENDPOINT=...               # 可选：MCP 工具服务器地址（Streamable HTTP）
DINGTALK_WEBHOOK=...           # 可选：钉钉自定义机器人 webhook
```

- `GET /llm/status`、`GET /integrations/status` 查看各连接配置状态。
- 未配置时各扩展点**明确提示「未配置」而非伪造结果**。
- 节点配置 `agentConfig.kernel: 'deepseek'` 用真实 LLM，`'demo-agent'` 为离线兜底。

## 已实现的内核能力

| 能力 | 对应 | 说明 |
| --- | --- | --- |
| 抽象对象模型 + 状态机 | FR01–FR03 | 11 个领域无关对象；节点/需求合法转移校验 |
| 事件与产物并行回传 | FR03/FR11 | 提交产物形成新版本 + `submitted` 事件 |
| 结构适配检查 | FR04 | 内核只报「哪些依赖尚无产物」这一事实 |
| 有效上下文组织 | FR04/FR07 | 从统一事实派生，条目标注来源性质 |
| 人工介入 | FR05 | 缺口 → 补充 → 复查 → 解决，幂等生成 |
| 退回与验收 | FR06 | 草稿 → 人工批准 → 正式退回；按「版本+验收人」幂等验收 |
| 节点流水线 | FR10 | 内置步骤 + 自定义步骤扩展点，支持等待点恢复 |
| 通知触达 | FR08 | Notifier 扩展点，内置待办/控制台/钉钉，待办为记录、通知为触达 |
| 工具接入 | FR09 | ToolProvider 扩展点 + `tool_call` 步骤，内置 HTTP 工具 + MCP 客户端 |
| 最终交付 | FR11 | 完结必须关联最终产物 + 已接受验收记录 |
| 记录与恢复 | FR12 | `snapshot()`/`restore()` + 文件持久化，重启不丢状态 |

## 设计文档

- [框架内核与配置模型设计](docs/01-kernel-and-config-model.md)

## 说明

- 语言选型：**Node.js + TypeScript 全栈单一语言**（服务端 + 内核 + Web 前端）；设计文档保持语言无关。
- 已就绪的扩展点：`AgentKernel`（内置 DeepSeek）、`ToolProvider`（内置 HTTP 工具 + MCP 客户端）、`Notifier`（内置控制台/待办/钉钉）、`PipelineStepExecutor`、`IdentityProvider` / `PermissionEvaluator`（内置组织隔离实现）。
