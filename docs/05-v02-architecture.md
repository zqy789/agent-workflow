# Agent WorkFlow v0.2 · 技术架构设计（严格 OOP · 设计模式）

| 项目 | 内容 |
| --- | --- |
| 版本 | v0.2 架构稿（待评审） |
| 依据 | `docs/04-v02-design.md`（第一性原理设计） |
| 目标 | 把「树 / 流 / 账本 / 全局 Agent 与根节点」落成**严格面向对象、模式化、可测试**的代码结构 |
| 评审通过前 | 不写实现代码 |

---

## 0. 工程标准（不可妥协）

1. **TypeScript 严格模式**：`strict: true`、无 `any`（确需处显式 `unknown` + 收窄）、优先 `readonly` 与不可变对象。
2. **零依赖、零构建**：Node ≥ 24 原生运行 TS，延续项目灵魂。
3. **严格 OOP**：数据与行为封装在对象内，不变式由对象方法守护；禁止散落的函数式工具集；领域对象不允许外部直接改字段。
4. **依赖单向**：`domain` 零依赖；`application` 只依赖 `domain` 与端口接口；`infrastructure` 实现端口；`interfaces` 组装一切。
5. **测试先行**：领域规则（守恒律、三态转移、相邻校验、链完整性、验收与版本绑定）先写测试。

---

## 1. 分层与依赖方向

```
interfaces/     HTTP API、Web 静态资源
    │ 调用
application/    用例与领域服务（FlowService / AcceptanceService / GlobalAgent …）
    │ 依赖（接口）
domain/         领域模型（纯对象，零 IO、零框架）◄── 一切的根基
    ▲ 实现端口
infrastructure/ 存储（账本日志/树快照）、Agent/动作/通知实现
config/         节点定义、策略配置（声明式数据）
```

- **依赖倒置**：application 只认识端口接口（`AgentKernel`、`ActionExecutor`、`NotifierChannel`、`TreeStore`、`LedgerStore`），不认识任何实现。
- **换实现不改内核**：换存储后端 / 换模型 / 换通知渠道 = 换 infrastructure 里的一个实现类。

---

## 2. 领域模型（类设计）

### 2.1 值对象（不可变、相等性比较）

| 类 | 说明 |
| --- | --- |
| `NodeId` | 全局唯一 ID（生成算法由 `IdGenerator` 端口注入，对应 L1） |
| `Visibility` | `private` / `public`，默认 private |
| `NodeStatus` | 三态：`waiting` / `running` / `done` |
| `FragmentKind` | `给输入 / 交产物 / 通过 / 跳过 / 打回 / 超时警示 / 新I / 剪枝 …` |
| `VerdictKind` | `通过 / 跳过 / 打回` |
| `InputContract` / `OutputContract` | 节点声明的输入要求与产出约定 |
| `Hash` | 链式哈希值（账本完整性） |

### 2.2 实体（聚合根持不变式）

```ts
/** 节点：树中唯一实体，自身守护结构不变式 */
class Node {
  readonly id: NodeId;
  private parentId: NodeId | null;          // 至多一个父
  private readonly children = new Set<NodeId>();
  private visibility: Visibility;
  readonly ownerId: NodeId;                 // 创建者（自己节点不可动）
  readonly capabilities: NodeCapabilities;  // agent / skills / actions
  private status: NodeStatus;

  attachChild(child: Node): void;   // 守卫：不可自环、唯一父、可见性继承
  detachChild(childId: NodeId): void;
  changeVisibility(v: Visibility): void;    // 覆盖继承，需创建者权限
  transition(to: NodeStatus): void;         // 三态转移表内聚于此
}
```

```ts
/** 树：一棵以「根」为顶的结构；多树由 Forest 管理 */
class Tree {
  readonly root: Node;
  createChild(parentId: NodeId, def: NodeDefinition): Node;  // 只能向下建
  prune(nodeId: NodeId): void;              // 剪枝 = 皇帝解死锁的结构动作
  isAdjacent(a: NodeId, b: NodeId): boolean; // 相邻交易律的唯一裁判
}

class Forest {
  trees(): Tree[];                          // 一个账户可属于任意多棵树
  byRoot(rootId: NodeId): Tree | undefined;
}
```

```ts
/** 产物 O：不可变、版本化——修改 = 新实例（旧实例永存） */
class Product {
  readonly producerId: NodeId;
  readonly version: number;
  readonly content: ProductContent;         // 含「剩余木头」等未消耗输入
  nextVersion(content: ProductContent): Product;  // 追加式，绝不原地改
}

/** 消息碎片：不可变，链式哈希——账本的基本单位 */
class MessageFragment {
  readonly id: NodeId;
  readonly prevHash: Hash;                  // 链式完整性
  readonly fromId: NodeId; readonly toId: NodeId;   // 必为相邻
  readonly kind: FragmentKind;
  readonly payload: unknown;
  readonly timestamp: number;
}

/** 验收结论：绑定具体产物版本 */
class Verdict {
  readonly nodeId: NodeId;                  // 验收位
  readonly productVersion: number;
  readonly kind: VerdictKind;               // 通过 / 跳过 / 打回
  readonly reason: string;
}
```

### 2.3 领域服务（用例层，编排对象）

| 服务 | 职责 | 关键方法 |
| --- | --- | --- |
| `FlowService` | I 下传、O 上行、全等汇合判断 | `giveInput(parent, child, input)`、`submitProduct(node, product)`、`isJoinSatisfied(node)` |
| `AcceptanceService` | 逐级验收、版本绑定、打回路径 | `accept(node, product)`、`return(node, product, reason)` |
| `RootController` | 皇帝决策位：监听、改写、剪枝 | `listen(fragment)`、`rewriteToNewInput(fragment, input)`、`letStop(fragment)`、`pruneBranch(nodeId)` |
| `GlobalAgent` | 全局 Agent：观察、统计、提醒 | `onFragmentAppended(f)`（订阅）、`timeStats()`、`alarms()` |

> **守恒律与相邻律的落点**：`Tree.isAdjacent` 是相邻律的唯一裁判（所有交互先过它）；`Product` 的不可变性 + `Verdict` 的版本绑定是守恒律的代码化身；`MessageFragment` 的 `prevHash` 是「碎片成链」的代码化身。

---

## 3. 设计模式映射（诚实映射，不堆砌）

| 模式 | 用在 | 为什么它是「正确」的，而非装饰 |
| --- | --- | --- |
| **Composite** | `Node` 递归持有子节点 | 树结构本身就是组合模式；「对节点操作 = 对子树操作」天然成立 |
| **Chain of Responsibility** | 消息逐跳上行（每级 parent 转发）；验收逐级上行 | 「每级只处理自己的部分、否则传给上一级」正是责任链语义；打回 = 链上某级拒绝 |
| **Observer** | `GlobalAgent` 订阅 `Ledger` 追加事件；`NotifierChannel` 订阅示警 | 全局 Agent「观察一切、不干预」——观察者与被观察者解耦，正是设计意图 |
| **Command** | 流的动作（给输入/交产物/通过/跳过/打回/改写新I/剪枝）统一为命令对象 | 每个动作都要入账（碎片）；命令对象可序列化、可重放、可审计 |
| **Strategy** | 超时/示警策略、ID 生成算法（L1）、验收策略 | 设计稿明言「策略可配置」；策略模式是其标准落地 |
| **Factory Method / Builder** | 节点创建：`NodeDefinition`（配置）→ `Node` | 节点定义是声明式数据，构建过程有默认值填充与校验，Builder 分步构建 |
| **Memento** | 树快照 `TreeSnapshot` / 恢复 | 快照与恢复（对应账本重放之外的状态缓存） |
| **Repository** | `TreeStore`、`LedgerStore` 端口 | 隔离领域与存储，实现「两份存储」可替换（文件 / 未来数据库） |
| **Template Method** | `ActionExecutor` 的执行骨架（准备→执行→结果入账） | 外部动作（CI-CD 等）的固定流程由骨架保证，差异步骤留给子类/实现 |

---

## 4. 账本与事件溯源

- **账本 = 唯一真相源**：`Ledger.append(fragment)` 只追加；`Ledger.verify()` 全链校验（`prevHash`）。
- **树状态可由账本重放重建**：每个命令产生的碎片 = 事件；重放 = 重建。
- **树快照 = 性能缓存**：定期整写；恢复时**先验账本完整 → 载快照 → 重放快照之后的碎片**。
- 存储落地（对应设计稿 §11.1）：`FileLedgerStore`（追加日志 + 分段 + 校验和）与 `FileTreeStore`（快照）分离。

---

## 5. 端口接口（application 只认识这些）

```ts
interface AgentKernel {
  readonly id: string;
  act(ctx: AgentContext): Promise<AgentResult>;      // 节点智能（产出 O 建议）
}
interface ActionExecutor {
  readonly id: string;                               // CI-CD 等抽象动作
  execute(action: NodeAction, ctx: ActionContext): Promise<ActionResult>;
}
interface NotifierChannel {
  readonly id: string;                               // Web 待办 / 钉钉 …
  send(notice: Notice): Promise<SendResult>;
}
interface IdGenerator { next(): NodeId; }            // L1 注入点
interface AlarmPolicy {                              // 超时/示警策略（Strategy）
  evaluate(stats: TimeStats, ctx: AlarmContext): Alarm[];
}
interface TreeStore { load(): TreeSnapshot; save(s: TreeSnapshot): void; }
interface LedgerStore { append(f: MessageFragment): void; tail(): Hash; replay(from: Hash): MessageFragment[]; }
```

> 未来的「AI 渲染视图」也走同一套：`GlobalAgent` 的 O = 视图描述，渲染器 = 消费节点——**扩展点已就位，首期不实现**。

---

## 6. 目录结构

```
src/
├── domain/            # 纯领域（零 IO 依赖）
│   ├── node.ts  tree.ts  forest.ts
│   ├── product.ts  fragment.ts  verdict.ts
│   ├── values.ts        # NodeId / Visibility / NodeStatus / Hash / 契约
│   └── ports.ts         # AgentKernel / ActionExecutor / NotifierChannel / Store …
├── application/
│   ├── flow-service.ts  acceptance-service.ts
│   ├── root-controller.ts  global-agent.ts
│   └── commands.ts      # Command 模式：流动作对象
├── infrastructure/
│   ├── file-ledger-store.ts  file-tree-store.ts
│   ├── agents/  actions/  notifiers/
│   └── id-generator.ts
├── interfaces/
│   └── http/  (API + 静态资源)
├── config/             # 节点定义、策略（声明式数据）
└── index.ts            # 组装（组合根）
web/                    # 前端（内核验收后进入 mockup 阶段）
tests/                  # 单元 / 集成 / 端到端
```

---

## 7. 测试策略

| 层 | 内容 | 工具 |
| --- | --- | --- |
| 单元 | 三态转移表、相邻律（含非法跨级交互）、守恒律（O 不可变、改=新版本）、链式哈希校验、验收与版本绑定、可见性继承 | Node 原生 test/assert（零依赖） |
| 集成 | 账本恢复与重放、快照+重放一致性、分段与归档、跨树引用 | 同上 + 临时文件 |
| 端到端 | 设计稿 §14.1 六个最小闭环场景（经 HTTP API 驱动） | 同上 + 起真实服务 |

---

## 8. 实施顺序（每步出测试 + 过 §10 可扩展性测试）

1. **树内核**：`Node` / `Tree` / `Forest` / 三态 / 相邻律 / 可见性继承。
2. **流**：`FlowService`（I 下传可改写、O 上行不可变、全等汇合）+ `Product`。
3. **账本**：`MessageFragment` / `Ledger` / 文件分段存储 / 快照重放。
4. **全局 Agent 与根节点**：`RootController`（监听/改写/剪枝）+ `GlobalAgent`（订阅/统计/示警）。
5. **能力**：`AgentKernel` / `ActionExecutor` / `SKILL` 组合（配置化）。
6. **验收**：`AcceptanceService`（通过/跳过/打回、版本绑定）。
7. **HTTP 接口 + 前端**：接口先行，前端进入静态 mockup 评审循环。

> 架构评审点：分层是否认可、模式映射是否恰当、目录结构是否接受、测试策略是否达标。确认后从第 1 步开工。
