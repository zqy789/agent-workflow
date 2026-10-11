# agent-workflow · v0.2 —— 树 · 流 · 账本

> **一切皆节点；相邻才交易；流即 IO；I 可变 O 不变；碎片成链；全局 Agent 观察、根节点决策。**

以「我」为根的层级协作树：输入 I 自上而下逐级改写，产物 O 自下而上不可篡改、逐级验收；每次相邻交易都作为消息碎片进入**全局单链账本**；**全局 Agent** 观察一切、统计时间、只提醒不干预，**根节点**（每个账户的「自己」节点）是唯一决策位。

> 术语注：「苍天/皇帝」是设计推导阶段的隐喻，产品与实现统一使用 **全局 Agent** 与 **根节点**。

## 运行（Node ≥ 24，零依赖零构建）

```bash
node examples/full-chain.ts        # 全链路演练：建树→流→验收→打回→提醒→改写→重启重放（每步日志）
node tests/tree-kernel.test.ts     # 树内核：相邻律/三态/可见性/剪枝/join
node tests/flow.test.ts            # 流：I 下传/O 上行/全等汇合
node tests/ledger.test.ts          # 账本：链式哈希/篡改检测/分段存储
node tests/global-agent.test.ts    # 全局 Agent 与根节点：订阅/时间统计/提醒/改写/剪枝
node tests/capability.test.ts      # 能力：Agent/SKILL/CI-CD 动作/待办
node tests/acceptance.test.ts      # 验收：通过/跳过/打回/版本绑定/必验位
node tests/integrations.test.ts    # 连接：DeepSeek 内核/钉钉渠道
node tests/server.test.ts          # 端到端：九个闭环场景 + 重启恢复 + 篡改拒绝
node server.ts                     # 启动 HTTP 服务（默认 :8787）
```

## 服务端

```bash
node server.ts    # http://localhost:8787
```

数据目录（`DATA_DIR`，默认 `data/`）为**两份存储**：`ledger/`（账本追加日志 + 分段，链式哈希）与 `forest.json`（树快照）。恢复顺序：账本验链 → 快照装载 → 以日志为输入全量重放流状态。

主要端点：`GET /health` · `GET /integrations` · `GET /trees` · `POST /trees` · `GET /trees/:rootId` · `POST /trees/:rootId/nodes|join|inputs|products|run|verdicts|council|position` · `POST /trees/:rootId/nodes/:nodeId/capabilities|visibility` · `GET /trees/:rootId/todos|ledger` · `GET /trees/:rootId/global-agent/stats` · `POST /trees/:rootId/global-agent/check`。

## 连接配置（环境变量，见 `.env.example`）

```bash
DEEPSEEK_API_KEY=sk-xxx        # 真实 LLM 内核（节点配置 agentKernel:'deepseek' 启用）
DEEPSEEK_BASE_URL=...          # 可选，默认 https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat   # 可选
DINGTALK_WEBHOOK=...           # 可选：钉钉自定义机器人 webhook（渠道触达）
```

未配置时各扩展点**明确降级或失败，不伪造结果**。

## 结构

```
src/
├── domain/            # 领域（零依赖）：Node/Tree/Forest · Input/Product/Skill/Verdict · Fragment/Ledger · ports
├── application/       # 服务：FlowService · AcceptanceService · RootController · GlobalAgent · CapabilityService · Rebuild · 策略
├── infrastructure/    # 实现：账本/快照存储 · ID 生成 · Demo/DeepSeek 内核 · 待办/钉钉渠道 · SKILL 加载
└── interfaces/http/   # 组合根 + HTTP API
web/                   # 前端（静态 mockup：节点房间范式 · 深空主题三档光效，评审中）
```

设计模式：Composite（树）· Chain of Responsibility（消息/验收逐级）· Observer（全局 Agent 订阅账本）· Command（动作入账可重放）· Strategy（提醒策略/ID 生成）· Builder（节点配置）· Memento（快照）· Repository（两份存储）· Template Method（动作骨架）。

## 设计文档

- 第一性原理设计：[docs/04-v02-design.md](docs/04-v02-design.md)
- 技术架构（OOP + 模式）：[docs/05-v02-architecture.md](docs/05-v02-architecture.md)
- 房间 ↔ API 映射（接线规范）：[docs/06-web-room-mapping.md](docs/06-web-room-mapping.md)
- UML 与流程图：[docs/diagrams/](docs/diagrams/)
- 概念图：[product-concept-v02.png](product-concept-v02.png)
