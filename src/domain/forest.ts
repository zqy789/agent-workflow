// ============================================================================
// domain · Forest（多树共存：一个账户可存在于任意多棵树）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §4 树规则第 3 条（多树共存）
// 一棵树的根 = 某个账户的「自己」节点；根 ID 即树的唯一标识。
// ============================================================================

import { Tree } from './tree.ts';
import { NodeId } from './values.ts';

export class Forest {
  private readonly trees = new Map<string, Tree>();

  /** 种植一棵树；根 ID 全局唯一 */
  plant(tree: Tree): void {
    const key = tree.root.id.value;
    if (this.trees.has(key)) throw new Error(`树的根已存在: ${tree.root.id}`);
    this.trees.set(key, tree);
  }

  /** 树根被并入他树后，移除这棵空树 */
  remove(rootId: NodeId): void {
    if (!this.trees.delete(rootId.value)) throw new Error(`树不存在: ${rootId}`);
  }

  /** 全部树 */
  allTrees(): Tree[] {
    return [...this.trees.values()];
  }

  get treeCount(): number {
    return this.trees.size;
  }

  /** 定位节点所属的树 */
  treeOf(nodeId: NodeId): Tree | undefined {
    for (const t of this.trees.values()) {
      if (t.hasNode(nodeId)) return t;
    }
    return undefined;
  }
}
