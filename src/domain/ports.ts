// ============================================================================
// domain · 端口（Ports）：领域与外部能力的边界接口
// ----------------------------------------------------------------------------
// 依赖倒置：application / domain 只认识这些接口，不认识任何实现。
// 换存储、换模型、换通知渠道 = 换 infrastructure 里的一个实现类。
// ============================================================================

import type { NodeId, NodeStatus } from './values.ts';
import type { MessageFragment } from './fragment.ts';

/** ID 生成算法（设计遗留 L1 的注入点） */
export interface IdGenerator {
  next(prefix?: string): NodeId;
}

/** 账本存储：只追加、不可篡改的落盘实现（设计 §11.1） */
export interface LedgerStore {
  /** 追加一条碎片并落盘；已落盘的碎片不可修改 */
  append(fragment: MessageFragment): void;
  /** 读取全部碎片（按追加顺序；链完整性由 Ledger.load 校验） */
  load(): MessageFragment[];
}

/** 树快照存储：可变的树状态（性能缓存；真相源是账本） */
export interface TreeStore {
  save(snapshot: string): void;
  load(): string | null;
}

/** 示警（天象）：上帝对某节点状态异常的观察结论 */
export interface Alarm {
  nodeId: NodeId;
  reason: string;
  detail: string;
  /** 已经持续多久（ms） */
  sinceMs: number;
}

/** 示警评估上下文：上帝把节点的当前事实交给策略 */
export interface AlarmContext {
  nodeId: NodeId;
  status: NodeStatus;
  /** 是否已收到过输入（未开工不示警） */
  inputReceivedAt: number | null;
  /** 最近一次相关碎片时间 */
  lastActivityAt: number | null;
  now: number;
}

/** 示警策略（Strategy）：超时/异常等判定可配置、可替换 */
export interface AlarmPolicy {
  readonly id: string;
  evaluate(ctx: AlarmContext): Alarm | null;
}

// ---------------------------------------------------------------------------
// 能力端口（docs §8 能力体系：一切皆节点，能力由扩展点注入）
// ---------------------------------------------------------------------------

import type { Input } from './input.ts';
import type { Product } from './product.ts';
import type { Skill } from './skill.ts';

/** 交给节点 Agent 的上下文：内核只给「事实」，语义判断交给 Agent */
export interface AgentContext {
  nodeId: NodeId;
  nodeName: string;
  /** 树的目标与节点职责（来自根的 goal 与节点 description） */
  goalAndScope: readonly string[];
  /** 本节点收到的输入 I（自父而来） */
  inputs: readonly Input[];
  /** 子树回流的产物 O（分支成果） */
  branchProducts: readonly Product[];
  /** 组合进本节点的 SKILL（MD 内容） */
  skills: readonly Skill[];
}

export interface AgentResult {
  /** Agent 的产出（将作为 O 自动上行） */
  output: unknown;
  notes?: string[];
}

/** 节点智能内核（换模型 = 换实现） */
export interface AgentKernel {
  readonly id: string;
  act(ctx: AgentContext): Promise<AgentResult>;
}

/** 外部动作执行上下文（CI-CD 等） */
export interface ActionContext {
  actionId: string;
  nodeId: NodeId;
  input: unknown;
}

export interface ActionResult {
  ok: boolean;
  output?: unknown;
  error?: string;
}

/** 动作执行器（CI-CD / 代码检查 / 打包 … 保持抽象） */
export interface ActionExecutor {
  readonly id: string;
  execute(action: ActionContext): Promise<ActionResult>;
}

/** 通知（渠道触达的消息；待办为记录、通知为触达） */
export interface Notice {
  to: string;
  title: string;
  body: string;
  actionUrl?: string;
}

export interface SendResult {
  ok: boolean;
  sentAt: string;
  error?: string;
}

/** 通知渠道（Web 待办 / 钉钉 …） */
export interface NotifierChannel {
  readonly id: string;
  send(notice: Notice): Promise<SendResult>;
}
