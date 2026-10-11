// ============================================================================
// application · RootController（根节点：唯一的决策位）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §4.1 / §7（消息上行归根；根可改写为新 I）
//   - 消息逐跳上行，根节点是全树唯一的监听者（deliver 受理）；
//   - 根节点主动：把消息改写为新 I，下达给直接子节点（留痕 + 流转）；
//   - 根节点不作为：消息止步于此，不向下传递（不产生新交易）；
//   - 剪枝：全树唯一的死锁解除者（结构性动作 + 入账）。
//   （注：设计推导中的「皇帝/天子」仅为隐喻，产品与实现统一称「根节点」。）
// ============================================================================

import { Tree } from '../domain/tree.ts';
import { Ledger } from '../domain/ledger.ts';
import type { MessageFragment } from '../domain/fragment.ts';
import { NodeId, FragmentKind } from '../domain/values.ts';
import type { Input } from '../domain/input.ts';
import type { FlowService } from './flow-service.ts';

export class RootController {
  private readonly tree: Tree;
  private readonly flow: FlowService;
  private readonly ledger: Ledger;
  /** 已送达根节点的待决消息（唯一监听者收件箱） */
  private readonly pending = new Map<string, MessageFragment>();

  constructor(tree: Tree, flow: FlowService, ledger: Ledger) {
    this.tree = tree;
    this.flow = flow;
    this.ledger = ledger;
  }

  get rootId(): NodeId {
    return this.tree.root.id;
  }

  /** 待决消息（尚未处理的上行消息） */
  pendingMessages(): readonly MessageFragment[] {
    return [...this.pending.values()];
  }

  /** 消息送达根节点：受理为待决消息 */
  deliver(fragment: MessageFragment): void {
    this.pending.set(fragment.id.value, fragment);
  }

  /**
   * 根节点主动：根据理解把消息改写为新 I，向下流转给直接子节点。
   * 留痕：NewInput 碎片（引用原消息）→ GiveInput 碎片（实际下传）。
   */
  rewriteToNewInput(fragment: MessageFragment, targetNodeId: NodeId, content: unknown): Input {
    if (!this.pending.has(fragment.id.value)) throw new Error(`消息尚未送达根节点: ${fragment.id}`);
    const target = this.tree.require(targetNodeId);
    if (target.parent?.id.equals(this.rootId) !== true) {
      throw new Error('新 I 只能下达给根节点的直接子节点');
    }
    this.ledger.seal({
      kind: FragmentKind.NewInput,
      fromId: this.rootId,
      toId: targetNodeId,
      payload: { rewrittenFrom: fragment.id.value, content },
    });
    const input = this.flow.giveInput(this.rootId, targetNodeId, content);
    this.pending.delete(fragment.id.value);
    return input;
  }

  /** 根节点不作为：消息止步于此（不广播、不扩散、不产生新交易） */
  letStop(fragment: MessageFragment): void {
    this.pending.delete(fragment.id.value);
  }

  /** 剪枝（死锁唯一出口）：结构性动作 + 入账 */
  pruneBranch(nodeId: NodeId): void {
    this.tree.prune(nodeId);
    this.ledger.seal({ kind: FragmentKind.Prune, fromId: this.rootId, toId: nodeId });
  }
}
