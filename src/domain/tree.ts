// ============================================================================
// domain · Tree（以「自己」节点为根的树；相邻律的唯一裁判）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §4 树规则
//   - 只能向下建（createChild 总在既有节点之下）
//   - 加入上司节点（join：把一棵子树挂到既有节点之下）
//   - 剪枝（prune：皇帝解死锁的结构动作；「自己」节点不可剪）
//   - 相邻交易律：isAdjacent 是全树「能否直接交互」的唯一裁判
// ============================================================================

import { Node, type NodeDefinition, type NodePlain } from './node.ts';
import { NodeId, NodeStatus, Visibility, type NodeCapabilities } from './values.ts';
import type { IdGenerator } from './ports.ts';

export interface TreeOptions {
  /** 本次流的目标（根提出：木头 → 椅子） */
  goal?: string;
  /** 验收条件（根按此判定） */
  acceptanceCriteria?: string[];
}

export class Tree {
  readonly root: Node;
  /** 目标由根提出（§3.1） */
  readonly goal: string;
  /** 验收条件（§5 完结判定） */
  readonly acceptanceCriteria: readonly string[];
  private readonly nodes = new Map<string, Node>();
  private readonly idGen: IdGenerator;

  constructor(root: Node, idGen: IdGenerator, opts: TreeOptions = {}) {
    if (!root.isSelf) throw new Error('树的根必须是「自己」节点');
    if (root.parent !== null) throw new Error('树的根不能已有父节点');
    this.root = root;
    this.idGen = idGen;
    this.goal = opts.goal ?? '未设定目标';
    this.acceptanceCriteria = opts.acceptanceCriteria ?? [];
    this.nodes.set(root.id.value, root);
  }

  // ------------------------------------------------------------------ 查询
  get size(): number {
    return this.nodes.size;
  }

  hasNode(nodeId: NodeId): boolean {
    return this.nodes.has(nodeId.value);
  }

  require(nodeId: NodeId): Node {
    const n = this.nodes.get(nodeId.value);
    if (!n) throw new Error(`节点不存在: ${nodeId}`);
    return n;
  }

  /** 树中全部节点（无特定顺序） */
  allNodes(): Node[] {
    return [...this.nodes.values()];
  }

  /** 相邻律的唯一裁判：全树任何交互必须先过这里 */
  isAdjacent(a: NodeId, b: NodeId): boolean {
    const na = this.nodes.get(a.value);
    const nb = this.nodes.get(b.value);
    if (!na || !nb) return false;
    return na.isAdjacentTo(nb);
  }

  /** candidate 是否是 nodeId 的祖先（含自身） */
  isAncestorOf(candidate: NodeId, nodeId: NodeId): boolean {
    const node = this.nodes.get(nodeId.value);
    const candidateNode = this.nodes.get(candidate.value);
    if (!node || !candidateNode) return false;
    return node.isAncestorOf(candidateNode);
  }

  /** 收集 node 及其整棵子树（先序） */
  collectSubtree(node: Node): Node[] {
    return node.collectSubtree();
  }

  // ------------------------------------------------------------------ 结构操作
  /**
   * 只能向下建：在既有节点之下创建新节点（开叉分支无限制）。
   * 子节点可见性默认继承父节点；owner 缺省继承父节点。
   */
  createChild(parentId: NodeId, def: NodeDefinition): Node {
    const parent = this.require(parentId);
    const child = new Node({
      id: this.idGen.next(),
      name: def.name,
      description: def.description,
      ownerId: def.ownerId ?? parent.ownerId,
      isSelf: false,
      mustVerify: def.mustVerify,
      visibility: def.visibility,
      capabilities: def.capabilities,
      inputContract: def.inputContract,
      outputContract: def.outputContract,
      position: def.position,
    });
    parent.attachChild(child, { inheritVisibility: def.visibility === undefined });
    this.nodes.set(child.id.value, child);
    return child;
  }

  /**
   * 加入上司节点：把一棵独立的子树（以其根为代表）挂到既有节点之下。
   * 守护（在 Node.attachChild 内）：子树根不得已挂载、不可自环、不可成环。
   * 子树根是「自己」节点时 = 账户加入组织树（入树后即固定）。
   */
  join(parentId: NodeId, subtreeRoot: Node): void {
    const parent = this.require(parentId);
    if (this.nodes.has(subtreeRoot.id.value)) throw new Error(`节点已在本树中: ${subtreeRoot.id}`);
    parent.attachChild(subtreeRoot);
    for (const n of subtreeRoot.collectSubtree()) this.nodes.set(n.id.value, n);
  }

  /** 剪枝：移除节点及其整棵子树；「自己」节点不可剪 */
  prune(nodeId: NodeId): void {
    const node = this.require(nodeId);
    if (node.isSelf) throw new Error('「自己」节点不可剪枝');
    const subtree = node.collectSubtree();
    const parent = node.parent;
    if (parent) parent.removeChild(node);
    for (const n of subtree) this.nodes.delete(n.id.value);
  }

  // ------------------------------------------------------------------ 状态与可见性（委托给对象自身守护）
  transition(nodeId: NodeId, to: NodeStatus): void {
    this.require(nodeId).transition(to);
  }

  changeVisibility(nodeId: NodeId, visibility: Visibility, actorId: NodeId): void {
    this.require(nodeId).changeVisibility(visibility, actorId);
  }

  changeCapabilities(nodeId: NodeId, capabilities: NodeCapabilities, actorId: NodeId): void {
    this.require(nodeId).changeCapabilities(capabilities, actorId);
  }

  // ------------------------------------------------------------------ 快照
  /** 导出纯数据（真相源是账本；快照只是性能缓存） */
  toPlain(): TreePlain {
    return {
      goal: this.goal,
      acceptanceCriteria: [...this.acceptanceCriteria],
      nodes: this.allNodes().map((n) => n.toPlain()),
    };
  }

  /** 由纯数据重建（快照恢复；父子挂接不触发可见性继承，保留落盘值） */
  static fromPlain(plain: TreePlain, idGen: IdGenerator): Tree {
    const rootPlain = plain.nodes.find((n) => n.isSelf && n.parentId === null);
    if (!rootPlain) throw new Error('快照缺少根节点（「自己」节点）');
    const tree = new Tree(Node.fromPlain(rootPlain), idGen, {
      goal: plain.goal,
      acceptanceCriteria: plain.acceptanceCriteria,
    });
    for (const np of plain.nodes) {
      if (np.id === rootPlain.id) continue;
      if (!np.parentId) throw new Error(`快照节点缺少父节点: ${np.id}`);
      const parent = tree.require(NodeId.of(np.parentId));
      const child = Node.fromPlain(np);
      parent.attachChild(child, { inheritVisibility: false });
      tree.registerNodeIn(child);
    }
    return tree;
  }

  /** 登记节点（join / 快照恢复共用，维护索引） */
  private registerNodeIn(node: Node): void {
    this.nodes.set(node.id.value, node);
  }
}

/** 树纯数据快照 */
export interface TreePlain {
  goal: string;
  acceptanceCriteria: string[];
  nodes: NodePlain[];
}
