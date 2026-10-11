// ============================================================================
// application · AcceptanceService（自下而上逐级验收）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §5 规则 5/8/10（验收、版本绑定、人机边界）
//   - 逐级：判定者必为产物回流路径上的一级（生产者的严格祖先）；
//   - 三选一：通过 / 跳过（放行留痕；必验位禁用）/ 打回（该版本上行终止）；
//   - 版本绑定：结论只对指定版本生效；修订 = 新版本，重新走全程；
//   - 全程通过 → 生产者 运行 → 完成（事实驱动）。
// ============================================================================

import { Tree } from '../domain/tree.ts';
import { Verdict } from '../domain/verdict.ts';
import type { Product } from '../domain/product.ts';
import { NodeId, VerdictKind, FragmentKind, NodeStatus } from '../domain/values.ts';
import { Ledger } from '../domain/ledger.ts';
import type { MessageFragment } from '../domain/fragment.ts';
import type { FlowService } from './flow-service.ts';

const KIND_TO_FRAGMENT: Record<VerdictKind, FragmentKind> = {
  [VerdictKind.Pass]: FragmentKind.Pass,
  [VerdictKind.Skip]: FragmentKind.Skip,
  [VerdictKind.Return]: FragmentKind.Return,
};

const FRAGMENT_TO_KIND: Partial<Record<FragmentKind, VerdictKind>> = {
  [FragmentKind.Pass]: VerdictKind.Pass,
  [FragmentKind.Skip]: VerdictKind.Skip,
  [FragmentKind.Return]: VerdictKind.Return,
};

export class AcceptanceService {
  private readonly tree: Tree;
  private readonly flow: FlowService;
  private readonly ledger: Ledger;
  /** `${验收位id}::${productId}::${version}` → 结论列表（最新生效，历史留链） */
  private readonly verdicts = new Map<string, Verdict[]>();

  constructor(tree: Tree, flow: FlowService, ledger: Ledger) {
    this.tree = tree;
    this.flow = flow;
    this.ledger = ledger;
  }

  /** 通过 */
  accept(nodeId: NodeId, product: Product, reason = ''): Verdict {
    return this.judge(nodeId, product, VerdictKind.Pass, reason);
  }

  /** 跳过：放行留痕；必验位禁用 */
  skip(nodeId: NodeId, product: Product, reason = '放行'): Verdict {
    return this.judge(nodeId, product, VerdictKind.Skip, reason);
  }

  /** 打回：该版本上行终止，沿路退回生产者 */
  returnProduct(nodeId: NodeId, product: Product, reason: string): Verdict {
    return this.judge(nodeId, product, VerdictKind.Return, reason);
  }

  /** 某验收位对某产物的全部结论（按时间序） */
  verdictsOf(nodeId: NodeId, product: Product): readonly Verdict[] {
    return [...(this.verdicts.get(this.key(nodeId, product)) ?? [])];
  }

  /** 某验收位的最新结论 */
  latestVerdictOf(nodeId: NodeId, product: Product): Verdict | undefined {
    const list = this.verdicts.get(this.key(nodeId, product)) ?? [];
    return list[list.length - 1];
  }

  /** 该版本是否已被打回（任一验收位最新结论为打回 → 上行终止） */
  isReturned(product: Product): boolean {
    return this.pathOf(product).some((nodeId) => this.latestVerdictOf(nodeId, product)?.kind === VerdictKind.Return);
  }

  /** 是否通过全部验收位：回流路径每一级的结论均为 通过/跳过，且无打回 */
  acceptedThrough(product: Product): boolean {
    if (this.isReturned(product)) return false;
    const path = this.pathOf(product);
    if (path.length === 0) return false;
    for (const nodeId of path) {
      const latest = this.latestVerdictOf(nodeId, product);
      if (!latest || latest.kind === VerdictKind.Return) return false;
    }
    return true;
  }

  /** 重放验收碎片（账本差额恢复：只重建结论，不再入账、不驱动状态） */
  replayVerdict(fragment: MessageFragment): void {
    const kind = FRAGMENT_TO_KIND[fragment.kind];
    if (!kind) return;
    if (!this.tree.hasNode(fragment.fromId)) return; // 其他树的碎片
    const payload = fragment.payload as { productId?: string; version?: number; reason?: string } | undefined;
    const verdict = new Verdict({
      nodeId: fragment.fromId,
      productId: NodeId.of(payload?.productId ?? ''),
      productVersion: payload?.version ?? 0,
      kind,
      reason: payload?.reason ?? '',
      at: fragment.timestamp,
    });
    const key = `${fragment.fromId.value}::${payload?.productId ?? ''}::${payload?.version ?? 0}`;
    const list = this.verdicts.get(key) ?? [];
    list.push(verdict);
    this.verdicts.set(key, list);
  }

  // ------------------------------------------------------------------ 内部
  /** 逐级验收的统一入口：校验 + 留痕（结论入账）+ 事实驱动状态 */
  private judge(nodeId: NodeId, product: Product, kind: VerdictKind, reason: string): Verdict {
    const node = this.tree.require(nodeId);
    const producer = this.tree.require(product.producerId);
    if (nodeId.equals(product.producerId)) throw new Error('生产者不可验收自己的产物');
    if (!producer.isAncestorOf(node)) throw new Error('验收位必须是产物回流路径上的一级（严格祖先）');
    if (kind === VerdictKind.Skip && node.mustVerify) throw new Error(`本节点为必验位，不可跳过: ${nodeId}`);
    if (this.isReturned(product)) throw new Error(`该版本已被打回，上行终止: ${product.id}@v${product.version}`);

    const verdict = new Verdict({
      nodeId,
      productId: product.id,
      productVersion: product.version,
      kind,
      reason,
      at: Date.now(),
    });
    const key = this.key(nodeId, product);
    const list = this.verdicts.get(key) ?? [];
    list.push(verdict);
    this.verdicts.set(key, list);

    // 留痕：每次验收 = 一条碎片（回执给生产者）
    this.ledger.seal({
      kind: KIND_TO_FRAGMENT[kind],
      fromId: nodeId,
      toId: product.producerId,
      payload: { productId: product.id.value, version: product.version, reason },
    });

    // 事实驱动：全程通过 → 生产者 运行 → 完成
    if (producer.currentStatus === NodeStatus.Running && this.acceptedThrough(product)) {
      producer.transition(NodeStatus.Done);
    }
    return verdict;
  }

  /** 回流路径：生产者的严格祖先（父 → … → 根） */
  private pathOf(product: Product): NodeId[] {
    const producer = this.tree.require(product.producerId);
    const path: NodeId[] = [];
    let cur = producer.parent;
    while (cur !== null) {
      path.push(cur.id);
      cur = cur.parent;
    }
    return path;
  }

  private key(nodeId: NodeId, product: Product): string {
    return `${nodeId.value}::${product.id.value}::${product.version}`;
  }
}
