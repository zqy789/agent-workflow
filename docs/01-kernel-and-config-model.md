# 框架内核与配置模型设计

| 项目 | 内容 |
| --- | --- |
| 版本 | v0.1 · 设计稿 |
| 日期 | 2026-10-10 |
| 上游依据 | `PRD_v0.1.md`（研发协作与上下文流转平台） |
| 文档目的 | 把 PRD 的抽象对象与规则，落成可实现的**内核模型 + 配置 Schema + 扩展点接口** |
| 当前阶段 | 概念设计，尚未编码；技术栈与实现语言在本文不预设 |

---

## 0. 设计的第一性原理

本产品**不是一个固定工作流工具，而是一个可配置框架**。这是它的灵魂，也是所有设计决策的判据。

一句话概括：

> **内核极简且领域无关；领域能力全部由配置表达；外部能力全部由扩展点注入。**

由此得到一条贯穿始终的**可扩展性测试**：

> 新增一种节点类型、接入一个新工具、换一个通知渠道、换一个 Agent 内核，
> **应当只改配置或新增插件，不改内核代码**。做不到，就说明抽象漏了或边界错了。

这套框架之所以"简洁"，是因为内核只保留最小、稳定、领域无关的东西；之所以"扩展性强"，是因为抽象边界清晰、配置与插件机制稳定。

---

## 1. 三层架构

```
┌─────────────────────────────────────────────────────────┐
│  第 3 层  扩展点（可插拔，接口稳定，内核不认识实现）          │
│  AgentKernel · ToolProvider(MCP) · Notifier ·            │
│  PipelineStepExecutor · IdentityProvider · Permission    │
├─────────────────────────────────────────────────────────┤
│  第 2 层  配置（灵魂，用户可改，声明式数据）                  │
│  节点定义 · 输入要求 · 策略 · 流水线 · 权限 · 通知 · Agent   │
├─────────────────────────────────────────────────────────┤
│  第 1 层  内核（极简、领域无关、几乎不变）                    │
│  抽象对象模型 · 状态机 · 事件/产物回传 · 上下文组织 · 规则引擎 │
└─────────────────────────────────────────────────────────┘
```

**第 1 层**是"唯一硬的东西"，但它刻意不包含任何业务概念：没有"产品节点""研发节点""钉钉""某个 MCP 工具"。它只回答：

- 一个工作单元如何依赖另一个工作单元？
- 交付了什么**事实**（事件）与什么**成果**（产物）？
- 有效上下文如何从事实中组织出来？
- 状态如何合法地流转？

**第 2 层**是领域能力的载体。节点叫什么、需要什么输入、产出什么、谁参与、遇到缺信息怎么办、流水线怎么走、通知发给谁——**全部是数据**，不是代码。

**第 3 层**是外部能力。内核只依赖接口，不认识任何具体实现。换模型、换工具、换渠道，都是"新增一个插件实现"。

> 结论：**FR01–FR12 的业务功能，绝大多数不是"开发"出来的，而是"配置"出来的。**

---

## 2. 内核：抽象对象模型

以下对象模型是概念层面的实体与关系，不是数据库表设计。字段是"最小必要信息"，实现时可扩展。

### 2.1 实体清单

| 对象 | 含义 | 最小必要字段 |
| --- | --- | --- |
| **Organization 组织** | 协作边界，包含成员与职责 | `id`、`name`、`members[]`、`roles[]`、`permissions[]` |
| **Project 项目** | 一组相关需求与协作工作的容器 | `id`、`orgId`、`name`、`requirements[]` |
| **Requirement 需求** | 目标、创造者、交付对象、范围、验收条件 | `id`、`projectId`、`goal`、`creatorId`、`deliveryTarget`、`scope`、`acceptanceCriteria[]`、`finalArtifactRef?` |
| **Node 节点** | 可配置的抽象工作单元（核心可配置对象） | `id`、`projectId`、`name`、`description`、`participants[]`、`inputRequirements[]`、`expectedOutputs[]`、`agentConfig`、`processingRules`、`pipeline[]`、`status` |
| **Relation 关系** | 需求分解 / 成果交付 / 物料依赖 | `id`、`projectId`、`type`、`fromNodeId`、`toNodeId`、`semantic?` |
| **InputRequirement 输入要求** | 本节点需要的参数、规则、资料及满足条件 | `id`、`nodeId`、`description`、`necessity`、`expectedForm`、`satisfyCondition`、`basis?` |
| **Artifact 产物** | 可引用、可验收的实际交付 | `id`、`nodeId`、`version`、`submitterId`、`description`、`accessRef`、`createdAt` |
| **Event 事件** | 已发生的事实 | `id`、`type`、`requirementId`、`nodeId`、`artifactId?`、`payload`、`timestamp` |
| **EffectiveContext 有效上下文** | 与当前节点相关且仍有效的事实集合（派生，非单一存储） | 见 §2.3 |
| **HumanInterventionItem 人工介入项** | 一个待人处理的问题 | `id`、`type`、`knownInfo`、`gap`、`basis`、`impact`、`targetRole?`、`status` |
| **AcceptanceRecord 验收记录** | 谁基于什么要求、对哪个版本作出什么结论 | `id`、`artifactId+version`、`acceptorId`、`requirements[]`、`verdict`、`timestamp` |

### 2.2 关系分类（关键抽象）

PRD 强调"分别表达『我需要谁的产物』和『我的成果交给谁』"，避免一条无语义的线承担所有含义。因此 `Relation.type` 至少区分：

| 类型 | 方向语义 | 用途 |
| --- | --- | --- |
| `dependency` 输入依赖 | A → B 表示 B 需要 A 的产物 | 决定 B 的"输入适配" |
| `delivery` 成果交付 | A → B 表示 A 的成果交给 B | 决定"事件/产物回传"的汇聚方向 |
| `decomposition` 需求分解 | 需求 → 子节点 | 表达"谁承接需求的哪部分" |
| （待决）`grouping` 分组 | 结构化分组，非执行依赖 | 见 PRD D01 |

> 同一份产物可被多个消费者引用，各消费者**分别**判断是否满足自己的要求（每个 `(产物, 消费者)` 是独立的验收记录）。

### 2.3 有效上下文（派生，而非单一大对象）

"统一事实"是业务上一致的记录，**不要求物理上一个大状态对象**，也不要求全部原始信息进每个 Agent 上下文。有效上下文按节点从事实中组织：

| 内容 | 必须回答 |
| --- | --- |
| 目标与范围 | 为什么做、本节点要完成什么、边界 |
| 已确认输入 | 哪些材料与约定可直接用、来源 |
| 历史决策 | 已确定什么、为何有当前约束 |
| 当前进展 | 相关节点在做什么、哪里阻塞 |
| 未决事项 | 缺什么、谁回答、影响 |
| 变化与失效 | 哪些旧信息已变、需复查什么 |
| 验收条件 | 怎样算本节点及最终需求满足 |

派生原则：

- 每个上下文条目**标注来源与性质**：`原始材料` / `人工确认` / `AI 分析` / `待确认` / `已失效`。
- 保留**来源引用与版本**，支持从总结定位原始依据。
- 全局 Agent 的**推测不自动成为其他节点的既定要求**。

---

## 3. 内核：状态机

正式名称可调整，核心是区分"执行过程 / 输入就绪 / 产物是否被接受"三个维度。

| 维度 | 状态 | 说明 |
| --- | --- | --- |
| **节点本轮执行** | `待开始 / 处理中 / 等待人工 / 受阻 / 暂停 / 执行异常 / 本轮结束 / 已取消` | "本轮结束"≠交付通过 |
| **输入适配** | `未满足 / 待确认 / 满足 / 需复验` | 定位到具体依赖、要求、产物、原因 |
| **接收方验收** | `待验收 / 已接受 / 需修订 / 需复验` | 针对"指定产物版本 + 指定接收方"，不用全局标记覆盖 |
| **需求交付** | `草稿 / 进行中 / 待最终验收 / 需修订 / 已完结 / 已取消` | 完结必须关联最终产物 + 验收记录 |
| **人工介入项** | `待处理 / 已补充 / 复查中 / 已解决 / 已取消` | 回复后仍需检查是否真正补齐 |

### 关键推进规则

1. 哪些输入必须满足才能开始/继续，由**节点规则（配置）**定义；默认关键缺口阻塞受影响工作。
2. **Agent 运行错误 ≠ 业务验收失败**。工具超时不直接判定产物不合格。
3. 人工回答与审批**关联原事项**，处理后更新上下文并触发复查。
4. 输入或图关系变化后**重新判断适用性**；旧分析不覆盖新状态。沿产物来源识别直接/间接影响，受影响结论标 `需复验`，直到复查通过或确认不受影响。
5. 一次提交可生成多项后续检查，但**相同输入版本不因自身分析事件无限触发**。
6. **未经批准的退回不对外显示为正式退回**（见 §5.4）。

---

## 4. 内核：事件与产物并行回传

- **事件**回答"发生了什么"，**产物**回答"实际交付了什么"，二者关联同一 `requirementId + nodeId + 版本`。
- "向上"指成果向委派方及需求创造者汇聚，**不代表行政汇报**。
- 提交完成事件时，应能定位相关产物，或**明确说明本节点为何无独立文件产物**。
- 最终需求完结必须关联**可访问成果 + 验收结果**，不能只由所有节点结束标记推导。

---

## 5. 配置模型（灵魂的载体）

### 5.1 节点定义（核心配置对象）

```yaml
node:
  id: node-render
  name: "渲染节点"            # 含义完全由用户定义
  description: "…"
  participants:
    - role: owner
      memberId: user-123
  inputRequirements:            # §5.2
    - id: ir-01
      necessity: required       # required | optional
      description: "需要后端提供的接口契约"
      expectedForm: "文档 / 链接"
      satisfyCondition: "包含字段与错误码定义"
      basis: "与后端节点确认"
  expectedOutputs:
    - "可渲染页面资源"
  agent:                        # §5.5
    kernel: "provider:anthropic-claude"
    rolePrompt: "…"
    tools: [ "mcp:material-reader" ]
    contextScope: "本节点 + 直接依赖产物"
    uncertaintyStrategy: "strategy-default"   # §5.3
  pipeline:                     # §5.6
    - step: check_input
    - step: agent_analyze
    - step: human_confirm
    - step: submit_artifact
  processingRules:              # §5.3 / §5.4
    requireInputsBeforeStart: true
    onMissingCriticalInput: notify_human
```

**要点**：`name`、`expectedOutputs`、`pipeline`、`agent` 全部是数据。内核不认识"渲染节点"是什么，只知道它是一张图上、带着输入要求与流水线的一个工作单元。

### 5.2 输入要求

| 字段 | 含义 |
| --- | --- |
| `necessity` | `required`（必要）/ `optional`（可选） |
| `description` | 自然语言描述 |
| `expectedForm` | 预期形式（文本 / 文件 / 链接 / 能力） |
| `satisfyCondition` | 满足条件（可由 Agent 辅助整理，责任人确认） |
| `basis` | 依据（这条要求为什么存在） |

> 避免把接收方临时偏好默认为上游既定责任——每条输入要求都要有 `basis` 锚定来源。

### 5.3 不确定性策略（C07 / D04）

默认策略：**缺少关键信息 → 通知人工**。但策略可配置，且不依赖模型自报置信度：

```yaml
strategy:
  id: strategy-default
  defaultAction: notify_human          # notify_human | wait | continue_with_assumption
  cases:
    required_input_missing: notify_human
    source_conflict:        notify_human
    key_rule_undefined:     notify_human
    tool_unreadable:        notify_human
    out_of_authorization:   notify_human
  # "带明确假设继续非阻塞工作"仅当该 case 显式配置为 continue_with_assumption
```

> 原则：**正式退回始终先经人工审批**；"带假设继续"只在显式允许的 case 下发生，且假设要可追溯。

### 5.4 退回与验收语义（C06）

Agent 生成退回**草稿**，人工逐项接受/编辑/忽略/要求重新分析。正式退回 = 人工批准后的版本。

必须区分三类，避免直接归责上游：

| 类别 | 处理 |
| --- | --- |
| 既定要求未满足 | 进入退回流程 |
| 需求尚未明确 | 进入澄清流程 |
| 新增要求 | 进入变更确认流程 |

退回针对"当前接收方对**指定产物版本**"的验收，不撤销其他接收方的验收结论。

### 5.5 Agent 配置

```yaml
agent:
  kernel: "provider:…"        # 扩展点 §6.1，换内核不动业务
  rolePrompt: "…"            # 节点职责，随节点配置
  tools: [ "mcp:…" ]         # 扩展点 §6.2
  contextScope: "…"          # 上下文范围（本节点 / +依赖产物 / …）
  uncertaintyStrategy: "…"   # 引用 §5.3
```

配置分三层：**连接层**（内核/模型）、**节点职责层**（角色要求）、**权限层**（工具集合、上下文范围、不确定性策略）——对应 PRD FR09。

### 5.6 流水线步骤

任意节点可挂载步骤，产物类型不限代码。步骤类型是**可组合的固定基元**，不是任意脚本：

| 步骤类型 | 含义 |
| --- | --- |
| `check_input` | 检查输入就绪 |
| `agent_analyze` | Agent 适配分析 |
| `tool_call` | 调用已授权工具（扩展点） |
| `human_confirm` | 人工确认 |
| `submit_artifact` | 提交产物 |
| `emit_event` | 发出交付事件 |

每个步骤展示执行结果、产物、阻塞原因，支持从等待点继续。任意脚本/复杂并行/通用 CI 属扩展深度（D10），不在首期。

### 5.7 通知渠道配置

```yaml
notification:
  channels:
    - channel: dingtalk           # 扩展点 §6.3
      recipientRules: "角色=节点责任人"
      filters: [ "需要补充", "需要审批", "被退回", "最终成果待验收" ]
    - channel: web
  mergeWindowSeconds: 60          # 合并短时间重复提醒
```

> 通知失败**不丢待办**；消息送达 ≠ 用户已批准。待办（Web）是记录，通知是触达（FR08）。

---

## 6. 扩展点接口（可插拔）

内核只依赖以下接口，不认识任何实现。新增能力 = 新增一个 provider 实现 + 配置里引用。

| 接口 | 职责 | 关键方法 |
| --- | --- | --- |
| `AgentKernel` | 分析、生成退回草稿、汇总 | `analyze(ctx) → Analysis`、`draftReturn(...)`、`summarize(...)` |
| `ToolProvider` | 读取/操作外部能力（MCP 为一种实现） | `listTools()`、`call(tool, args) → Result`、`readMaterial(ref) → Material` |
| `Notifier` | 渠道发送 | `send(msg) → SendResult`、`retry()` |
| `PipelineStepExecutor` | 执行一个流水线步骤 | `execute(step, ctx) → StepResult` |
| `IdentityProvider` | 成员身份与组织同步 | `resolveMember(id)`、`syncOrg()` |
| `PermissionEvaluator` | 权限判断 | `can(actor, action, resource) → bool` |

**关键约束（来自 PRD FR09）**：

- "支持 MCP" ≠ 能读所有外部页面。工具可用性、内容获取成功、来源版本、调用失败**必须显式可见**。
- 外部**写操作**遵循项目授权与审批规则。
- Agent 运行时完整插件化、内核热替换、本地 CLI 执行均**不在首期承诺**。

---

## 7. FR01–FR12 映射：内核 vs 配置 vs 扩展

这是"一切皆配置"的直接证据——业务功能落在哪一层：

| 功能 | 内核 | 配置 | 扩展点 |
| --- | --- | --- | --- |
| FR01 组织/项目/需求 | Organization/Project/Requirement 实体 | 成员职责、权限、验收要求 | IdentityProvider、PermissionEvaluator |
| FR02 自定义节点图 | Node/Relation 实体、图校验（循环等待） | 节点定义、依赖增删改 | — |
| FR03 输入与产物 | Artifact 版本化、Event | 输入要求、预期形式、满足条件 | ToolProvider（外部引用） |
| FR04 节点 Agent 分析 | 上下文组织、分析结果落库 | Agent 职责、contextScope | **AgentKernel** |
| FR05 人工介入 | HumanInterventionItem 状态机 | 不确定性策略 | Notifier |
| FR06 退回与验收 | AcceptanceRecord、事件回传 | 退回语义、审批规则 | AgentKernel（草稿生成） |
| FR07 全局理解 | 统一事实、宏观看板数据 | 全局 Agent 权限、动作白名单 | AgentKernel |
| FR08 通知 | 待办（Web）为记录 | 渠道、收件人规则、合并窗口 | **Notifier** |
| FR09 MCP/Agent 配置 | 工具调用授权 | 内核/角色/权限三层配置 | **ToolProvider / AgentKernel** |
| FR10 节点流水线 | 步骤调度、等待点恢复 | 步骤组合 | **PipelineStepExecutor** |
| FR11 最终成果 | 需求完结校验（必须关联产物+验收） | 验收人、验收条件 | — |
| FR12 记录与恢复 | 持久化、幂等、重启恢复 | 重试/升级策略 | — |

> 观察：**真正写进内核的只有对象模型、状态机、事件/产物回传、上下文组织、规则引擎与幂等/恢复**。其余全是配置与插件。这就是"简洁 + 可扩展"的来源。

---

## 8. 可扩展性测试（验收这个设计）

设计通过与否，用以下用例验证（对应 PRD AT 用例的"框架"维度）：

1. **新增节点类型**：加"测试节点"——只新增一份节点配置，内核零改动。
2. **接入新工具**：加一个 MCP/自定义 `ToolProvider` 实现 + 配置引用，内核零改动。
3. **换 Agent 内核**：新增 `AgentKernel` 实现，配置改 `kernel` 字段，业务配置零改动。
4. **换通知渠道**：新增 `Notifier` 实现，配置加渠道，待办/事件模型零改动。
5. **加一个流水线步骤**：新增 `PipelineStepExecutor` 实现，节点 `pipeline` 里引用，内核调度器零改动。

**若任何一个需要改内核，就回到 §2/§5/§6 检查抽象边界。**

---

## 9. 边界与非目标（首期）

- 不预设技术栈/语言/框架——本文是模型与配置设计，实现选型在后续"接入与技术方案"阶段（PRD D05–D10）。
- 不承诺任意脚本、复杂并行调度、通用 CI/CD 托管、完整插件市场、计费体系。
- 不预设固定节点类型（产品/研发/后端/设计只是举例）。
- 全局 Agent 的**自动执行范围**与**审批界线**是待决项 D11，本文只留配置位（`全局 Agent 权限与动作白名单`）。

---

## 10. 下一步

1. 评审本文的**对象模型、配置 Schema、扩展点接口**是否够用。
2. 用 §8 的 5 条可扩展性测试逐条过一遍，补漏。
3. 确认后进入**代码骨架**：按"内核 / 配置 / 扩展点"三层拆分目录，先搭结构 + 最小可运行内核（建图、挂依赖、记录事件/产物、组织上下文）。
