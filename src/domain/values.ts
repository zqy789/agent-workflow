// ============================================================================
// domain · 值对象与枚举（不可变基础类型）
// ----------------------------------------------------------------------------
// 本层零依赖：只回答「对象是什么」，不含 IO、不含框架。
// ============================================================================

/** 全局唯一节点 ID（值对象：相等性按值比较，生成算法由 IdGenerator 端口注入） */
export class NodeId {
  readonly value: string;

  private constructor(value: string) {
    if (!value || value.trim() === '') throw new Error('NodeId 不能为空');
    this.value = value;
  }

  static of(value: string): NodeId {
    return new NodeId(value);
  }

  equals(other: NodeId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  /** JSON 序列化：输出为纯字符串（HTTP 响应 / 快照通用） */
  toJSON(): string {
    return this.value;
  }
}

/** 可见性：默认私有；公有向全系统暴露（跨树引用唯一通道） */
export const Visibility = {
  Private: 'private',
  Public: 'public',
} as const;
export type Visibility = (typeof Visibility)[keyof typeof Visibility];

/** 三态：状态只回答「此刻这个节点在干什么」；为什么等 = 链上最新事实 */
export const NodeStatus = {
  /** 等着：等输入 / 等分支回流 / 等验收结果 / 等人工处置 */
  Waiting: 'waiting',
  /** 动着：输入满足，能力在运转 */
  Running: 'running',
  /** 本轮 O 已通过全部验收位并到达根 */
  Done: 'done',
} as const;
export type NodeStatus = (typeof NodeStatus)[keyof typeof NodeStatus];

/** 消息碎片类型（通知的产物）——链上事实的分类 */
export const FragmentKind = {
  /** 给输入（I 下传） */
  GiveInput: 'give_input',
  /** 交产物（O 上行） */
  SubmitProduct: 'submit_product',
  /** 验收通过 */
  Pass: 'pass',
  /** 验收跳过（放行留痕） */
  Skip: 'skip',
  /** 打回（沿路退回下游） */
  Return: 'return',
  /** 超时示警（上帝的天象） */
  TimeoutAlarm: 'timeout_alarm',
  /** 根改写的新 I（皇帝的主动行为） */
  NewInput: 'new_input',
  /** 剪枝（皇帝解死锁的结构动作） */
  Prune: 'prune',
} as const;
export type FragmentKind = (typeof FragmentKind)[keyof typeof FragmentKind];

/** 验收结论类型：逐级三选一，绑定具体产物版本 */
export const VerdictKind = {
  Pass: 'pass',
  Skip: 'skip',
  Return: 'return',
} as const;
export type VerdictKind = (typeof VerdictKind)[keyof typeof VerdictKind];

/** 画布摆放位置（纯展示快照，非业务领域） */
export interface Position {
  x: number;
  y: number;
}

/** 输入契约：本节点声明需要的输入（I） */
export interface InputContract {
  description: string;
  required: boolean;
}

/** 产出契约：本节点声明的产出约定（O） */
export interface OutputContract {
  description: string;
}

/** 节点能力：Agent / SKILL / CI-CD 的配置位（后续步骤展开，先占位） */
export interface NodeCapabilities {
  /** Agent 内核引用（扩展点） */
  agentKernel?: string;
  /** 组合进节点的 SKILL（MD 文件引用） */
  skills?: string[];
  /** 挂载的动作（CI-CD 等扩展点引用） */
  actions?: string[];
}
