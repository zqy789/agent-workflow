// ============================================================================
// application · FlowService（流引擎：I 下传 / O 上行 / 全等汇合）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §5 流的规则
//   - I 自上而下，仅父可传子（相邻律 + 方向守卫），内容由给出方决定（可改写）；
//   - O 自下而上，根不产生产物；版本化追加、不可篡改（Product 自身守护）；
//   - 全等汇合：节点收到 I 且全部分支在本轮回流后，等待 → 运行（事实驱动）；
//   - 新 I 到达 = 新一轮：完成 → 等待（旧轮产物不再满足本轮汇合）；
//   - 账本 = 真相源：每次相邻交易 = 一条碎片（含重放所需的完整事实）。
// ============================================================================

import { Tree } from '../domain/tree.ts';
import { Node, type NodeId } from '../domain/node.ts';
import { NodeId as NodeIdValue, NodeStatus, FragmentKind } from '../domain/values.ts';
import { Input } from '../domain/input.ts';
import { Product } from '../domain/product.ts';
import { Ledger } from '../domain/ledger.ts';
import type { MessageFragment } from '../domain/fragment.ts';
import type { IdGenerator } from '../domain/ports.ts';

export class FlowService {
  private readonly tree: Tree;
  private readonly idGen: IdGenerator;
  private readonly ledger: Ledger;
  private readonly inputs = new Map<string, Input[]>();
  private readonly products = new Map<string, Product[]>();
  /** nodeId → 本轮起始 tick（新 I = 新一轮） */
  private readonly roundTicks = new Map<string, number>();
  private tick = 0;

  constructor(tree: Tree, idGen: IdGenerator, ledger: Ledger) {
    this.tree = tree;
    this.idGen = idGen;
    this.ledger = ledger;
  }

  // ------------------------------------------------------------------ I 下传
  /**
   * I 只能由父传给子（相邻 + 方向守卫）。
   * 内容由给出方决定——每级可基于自己的理解加工改写后下传（守恒律：I 可篡改）。
   */
  giveInput(fromNodeId: NodeId, toNodeId: NodeId, content: unknown): Input {
    const from = this.tree.require(fromNodeId);
    const to = this.tree.require(toNodeId);
    if (to.parent === null || !to.parent.id.equals(fromNodeId)) {
      throw new Error(`I 只能由父传给子: ${fromNodeId} → ${toNodeId}`);
    }
    this.tick += 1;
    const input = this.applyInput(to, content, fromNodeId, this.tick, true);
    // 每次相邻交易 = 一条消息碎片（账本只追加；payload 含重放所需全部事实）
    this.ledger.seal({
      kind: FragmentKind.GiveInput,
      fromId: fromNodeId,
      toId: toNodeId,
      payload: { content, tick: this.tick },
    });
    return input;
  }

  // ------------------------------------------------------------------ O 上行
  /** O 由节点产出（版本化追加）；根不产生产物——根提出目标、收回成果 */
  submitProduct(nodeId: NodeId, content: unknown): Product {
    const node = this.tree.require(nodeId);
    if (node.parent === null) throw new Error('根不产生产物：根提出目标并收回成果');
    this.tick += 1;
    const list = this.products.get(nodeId.value) ?? [];
    const latest = list[list.length - 1];
    const now = new Date().toISOString();
    const product = latest
      ? latest.nextVersion(this.idGen.next('product'), content, now, this.tick)
      : Product.first(this.idGen.next('product'), nodeId, content, now, this.tick);
    this.applyProduct(node, product, true);
    // 每次相邻交易 = 一条消息碎片（payload 含内容：账本是唯一真相源，可重放重建）
    this.ledger.seal({
      kind: FragmentKind.SubmitProduct,
      fromId: nodeId,
      toId: node.parent.id,
      payload: {
        productId: product.id.value,
        version: product.version,
        content,
        tick: this.tick,
      },
    });
    return product;
  }

  // ------------------------------------------------------------------ 查询
  inputsOf(nodeId: NodeId): readonly Input[] {
    return [...(this.inputs.get(nodeId.value) ?? [])];
  }

  productsOf(nodeId: NodeId): readonly Product[] {
    return [...(this.products.get(nodeId.value) ?? [])];
  }

  latestProductOf(nodeId: NodeId): Product | undefined {
    const list = this.products.get(nodeId.value) ?? [];
    return list[list.length - 1];
  }

  /** 全树查找产物（验收 / 跨树引用用） */
  findProduct(productId: NodeId, version?: number): Product | undefined {
    for (const node of this.tree.allNodes()) {
      const list = this.products.get(node.id.value) ?? [];
      for (const p of list) {
        if (p.id.equals(productId) && (version === undefined || p.version === version)) return p;
      }
    }
    return undefined;
  }

  /**
   * 全等汇合：节点已收到 I（有本轮），且所有子节点都已在本轮回流产物。
   * 叶子节点无子，收到 I 即满足。
   */
  isJoinSatisfied(nodeId: NodeId): boolean {
    const node = this.tree.require(nodeId);
    const roundStart = this.roundTicks.get(nodeId.value);
    if (roundStart === undefined) return false; // 尚无输入
    for (const childId of node.childIds) {
      const childProducts = this.products.get(childId) ?? [];
      const latest = childProducts[childProducts.length - 1];
      if (!latest || latest.tick < roundStart) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ 重放（账本差额恢复）
  /** 重放 GiveInput 碎片（只重建事实表，不再入账、不驱动状态——快照状态是权威） */
  replayGiveInput(fragment: MessageFragment): void {
    if (fragment.kind !== FragmentKind.GiveInput) return;
    if (!this.tree.hasNode(fragment.toId)) return; // 其他树的碎片
    const payload = fragment.payload as { content?: unknown; tick?: number } | undefined;
    const tick = typeof payload?.tick === 'number' ? payload.tick : this.tick + 1;
    this.tick = Math.max(this.tick, tick);
    const to = this.tree.require(fragment.toId);
    this.applyInput(to, payload?.content, fragment.fromId, tick, false);
  }

  /** 重放 SubmitProduct 碎片（按落盘 id/version/tick 精确重建） */
  replaySubmitProduct(fragment: MessageFragment): void {
    if (fragment.kind !== FragmentKind.SubmitProduct) return;
    if (!this.tree.hasNode(fragment.fromId)) return; // 其他树的碎片
    const payload = fragment.payload as {
      productId?: string; version?: number; content?: unknown; tick?: number;
    } | undefined;
    const tick = typeof payload?.tick === 'number' ? payload.tick : this.tick + 1;
    this.tick = Math.max(this.tick, tick);
    const node = this.tree.require(fragment.fromId);
    const product = Product.restore(
      NodeIdValue.of(payload?.productId ?? ''),
      node.id,
      payload?.version ?? 1,
      payload?.content,
      new Date(fragment.timestamp).toISOString(),
      tick,
    );
    this.applyProduct(node, product, false);
  }

  // ------------------------------------------------------------------ 内部
  /** 应用输入（live 驱动状态；重放只建事实表，不驱动） */
  private applyInput(to: Node, content: unknown, givenBy: NodeId, tick: number, drive: boolean): Input {
    const input = new Input({ content, givenBy, tick });
    const list = this.inputs.get(to.id.value) ?? [];
    list.push(input);
    this.inputs.set(to.id.value, list);
    this.roundTicks.set(to.id.value, tick);
    if (drive) {
      if (to.currentStatus === NodeStatus.Done) to.transition(NodeStatus.Waiting);
      this.maybeStart(to);
    }
    return input;
  }

  /** 应用产物（live 驱动父节点汇合判断；重放不驱动） */
  private applyProduct(node: Node, product: Product, drive: boolean): void {
    const list = this.products.get(node.id.value) ?? [];
    list.push(product);
    this.products.set(node.id.value, list);
    if (drive && node.parent) this.maybeStart(node.parent);
  }

  /** 事实驱动：等待 → 运行（全等汇合满足） */
  private maybeStart(node: Node): void {
    if (node.currentStatus === NodeStatus.Waiting && this.isJoinSatisfied(node.id)) {
      node.transition(NodeStatus.Running);
    }
  }
}
