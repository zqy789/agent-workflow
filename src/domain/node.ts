// ============================================================================
// domain · Node（树中唯一实体，结构不变式内聚于此）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §2 公理（一切皆节点 / 树即结构 / 相邻才交易）
// 不变式（全部在实体内部守护）：
//   1. 至多一个父（唯一父）；不可自环；不可成环（祖先不可挂到自己后代之下）；
//   2. 「自己」节点：初始入树后即固定（唯一父保证不可再移动），不可剪枝（Tree 层）；
//   3. 三态转移表（等待 → 运行 → 完成 → 等待，运行 → 等待）；
//   4. 可见性仅创建者可改；子节点默认继承父节点（可单独覆盖，不追溯级联）。
// ============================================================================

import {
  NodeId,
  NodeStatus,
  Visibility,
  type Position,
  type InputContract,
  type OutputContract,
  type NodeCapabilities,
} from './values.ts';

/** 三态转移表：状态只回答「在干什么」，原因一律入链（碎片） */
const TRANSITIONS: Readonly<Record<NodeStatus, readonly NodeStatus[]>> = {
  [NodeStatus.Waiting]: [NodeStatus.Running],
  [NodeStatus.Running]: [NodeStatus.Done, NodeStatus.Waiting],
  [NodeStatus.Done]: [NodeStatus.Waiting],
};

export interface NodeOptions {
  id: NodeId;
  name: string;
  description?: string;
  /** 创建者：自建节点的 owner 是自己；权限判断以此为锚 */
  ownerId: NodeId;
  /** 「自己」节点：账户的根身份，入树后不可移动、不可剪枝 */
  isSelf?: boolean;
  /** 必验位：根可对关键节点设置，禁用「跳过」（设计 §5 人机边界） */
  mustVerify?: boolean;
  visibility?: Visibility;
  capabilities?: NodeCapabilities;
  inputContract?: InputContract[];
  outputContract?: OutputContract[];
  position?: Position;
  /** 初始状态（仅快照恢复使用；常规创建一律 Waiting） */
  status?: NodeStatus;
}

/** 节点定义（配置 schema：声明式数据 → Node 的构建输入） */
export interface NodeDefinition {
  name: string;
  description?: string;
  /** 缺省时继承父节点的 owner */
  ownerId?: NodeId;
  /** 必验位：禁用「跳过」 */
  mustVerify?: boolean;
  visibility?: Visibility;
  capabilities?: NodeCapabilities;
  inputContract?: InputContract[];
  outputContract?: OutputContract[];
  position?: Position;
}

export class Node {
  readonly id: NodeId;
  readonly name: string;
  readonly description: string;
  readonly ownerId: NodeId;
  /** 「自己」节点：入树后不可移动、不可剪枝 */
  readonly isSelf: boolean;
  /** 必验位：禁用「跳过」（逐级验收时由 AcceptanceService 执行） */
  readonly mustVerify: boolean;
  private capsConfig: NodeCapabilities;
  readonly inputContract: readonly InputContract[];
  readonly outputContract: readonly OutputContract[];

  private parentNode: Node | null;
  private readonly childNodes = new Map<string, Node>();
  private visibility: Visibility;
  private status: NodeStatus;
  private position: Position | undefined;

  constructor(opts: NodeOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.description = opts.description ?? '';
    this.ownerId = opts.ownerId;
    this.isSelf = opts.isSelf ?? false;
    this.mustVerify = opts.mustVerify ?? false;
    this.parentNode = null;
    this.visibility = opts.visibility ?? Visibility.Private;
    this.capsConfig = opts.capabilities ?? {};
    this.inputContract = opts.inputContract ?? [];
    this.outputContract = opts.outputContract ?? [];
    this.status = opts.status ?? NodeStatus.Waiting;
    this.position = opts.position;
  }

  // ------------------------------------------------------------------ 结构
  get parent(): Node | null {
    return this.parentNode;
  }

  get childIds(): readonly string[] {
    return [...this.childNodes.keys()];
  }

  child(childId: NodeId): Node | undefined {
    return this.childNodes.get(childId.value);
  }

  hasChild(childId: NodeId): boolean {
    return this.childNodes.has(childId.value);
  }

  /** 是否与 other 相邻（父子关系）——相邻交易律的节点级裁判 */
  isAdjacentTo(other: Node): boolean {
    return this.parentNode?.id.equals(other.id) === true || other.parentNode?.id.equals(this.id) === true;
  }

  /** candidate 是否为本节点的祖先（含自身） */
  isAncestorOf(candidate: Node): boolean {
    let cur: Node | null = this;
    while (cur !== null) {
      if (cur.id.equals(candidate.id)) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  /** 收集本节点及其整棵子树（先序） */
  collectSubtree(): Node[] {
    const out: Node[] = [this];
    for (const child of this.childNodes.values()) out.push(...child.collectSubtree());
    return out;
  }

  /**
   * 挂子节点（结构操作的原语，Tree 编排时调用）。
   * 守护：不可自环、唯一父、不可成环（祖先不可挂到后代之下）。
   * 可见性：子节点默认继承父节点（设计决策 B），可随后单独覆盖；
   * 快照恢复时传 inheritVisibility=false 以保留落盘的可见性。
   * 「自己」节点经此方法加入上司节点（加入后唯一父保证其不可再移动）。
   */
  attachChild(child: Node, opts: { inheritVisibility?: boolean } = {}): void {
    if (child.id.equals(this.id)) throw new Error(`不可自环: ${this.id}`);
    if (child.parentNode !== null) throw new Error(`节点已有父，不可重复挂载: ${child.id}`);
    if (this.isAncestorOf(child)) throw new Error(`不可成环: ${child.id} 是本节点的祖先`);
    this.childNodes.set(child.id.value, child);
    child.parentNode = this;
    if (opts.inheritVisibility ?? true) child.visibility = this.visibility;
  }

  /** 摘除子节点（剪枝时使用；子节点的 parent 一并清空） */
  removeChild(child: Node): void {
    if (!this.childNodes.delete(child.id.value)) throw new Error(`不是本节点的子节点: ${child.id}`);
    child.parentNode = null;
  }

  // ------------------------------------------------------------------ 状态
  get currentStatus(): NodeStatus {
    return this.status;
  }

  /** 能力配置（Agent 内核 / SKILL / CI-CD 动作的挂载） */
  get capabilities(): NodeCapabilities {
    return this.capsConfig;
  }

  /** 三态转移（幂等：同态不抛错） */
  transition(to: NodeStatus): void {
    if (this.status === to) return;
    const allowed = TRANSITIONS[this.status];
    if (!allowed.includes(to)) {
      throw new Error(`非法状态转移: ${this.status} → ${to} (${this.id})`);
    }
    this.status = to;
  }

  // ------------------------------------------------------------------ 可见性
  get currentVisibility(): Visibility {
    return this.visibility;
  }

  /** 覆盖可见性：仅创建者可改 */
  changeVisibility(visibility: Visibility, actorId: NodeId): void {
    if (!actorId.equals(this.ownerId)) {
      throw new Error(`仅节点创建者可修改可见性: ${this.id}`);
    }
    this.visibility = visibility;
  }

  /** 更新能力配置（挂载/卸载 Agent 内核、SKILL、CI-CD 动作）：仅创建者可改 */
  changeCapabilities(capabilities: NodeCapabilities, actorId: NodeId): void {
    if (!actorId.equals(this.ownerId)) {
      throw new Error(`仅节点创建者可修改能力: ${this.id}`);
    }
    this.capsConfig = { ...capabilities };
  }

  // ------------------------------------------------------------------ 画布
  get currentPosition(): Position | undefined {
    return this.position;
  }

  /** 记录画布摆放位置（纯展示快照） */
  setPosition(position: Position): void {
    this.position = { ...position };
  }

  // ------------------------------------------------------------------ 快照
  /** 导出纯数据（快照持久化） */
  toPlain(): NodePlain {
    return {
      id: this.id.value,
      name: this.name,
      description: this.description,
      ownerId: this.ownerId.value,
      isSelf: this.isSelf,
      mustVerify: this.mustVerify,
      visibility: this.visibility,
      capabilities: this.capabilities,
      inputContract: [...this.inputContract],
      outputContract: [...this.outputContract],
      status: this.status,
      position: this.position,
      parentId: this.parentNode?.id.value ?? null,
    };
  }

  /** 由纯数据重建（快照恢复） */
  static fromPlain(p: NodePlain): Node {
    return new Node({
      id: NodeId.of(p.id),
      name: p.name,
      description: p.description,
      ownerId: NodeId.of(p.ownerId),
      isSelf: p.isSelf,
      mustVerify: p.mustVerify,
      visibility: p.visibility,
      capabilities: p.capabilities,
      inputContract: p.inputContract,
      outputContract: p.outputContract,
      position: p.position,
      status: p.status,
    });
  }
}

/** 节点纯数据快照（跨进程持久化格式） */
export interface NodePlain {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  isSelf: boolean;
  mustVerify: boolean;
  visibility: Visibility;
  capabilities: NodeCapabilities;
  inputContract: InputContract[];
  outputContract: OutputContract[];
  status: NodeStatus;
  position?: Position;
  parentId: string | null;
}
