// ============================================================================
// domain · Ledger（全局单链账本：只追加、链式校验、可重放）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §6 / §11.1（账本 = 唯一真相源）
//   - seal()：记账 —— 构造碎片（prevHash 自动取链尾）并追加，绝不改写历史；
//   - verify()：链式完整性校验（篡改任何一片 → false）；
//   - load()：从存储恢复（先校验整链，失败拒绝装载）。
// ============================================================================

import { MessageFragment, GENESIS_HASH } from './fragment.ts';
import { NodeId, type FragmentKind } from './values.ts';
import type { IdGenerator } from './ports.ts';

export interface SealInput {
  kind: FragmentKind;
  fromId: NodeId;
  toId: NodeId;
  payload?: unknown;
  timestamp?: number;
}

/** 账本追加监听（Observer）：上帝等观察者订阅一切新碎片 */
export type FragmentListener = (fragment: MessageFragment) => void;

export class Ledger {
  private readonly chain: MessageFragment[] = [];
  private readonly idGen: IdGenerator;
  private readonly listeners = new Set<FragmentListener>();

  constructor(idGen: IdGenerator) {
    this.idGen = idGen;
  }

  /** 订阅新增碎片；返回退订函数（Observer 模式） */
  subscribe(listener: FragmentListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get size(): number {
    return this.chain.length;
  }

  get tail(): MessageFragment | undefined {
    return this.chain[this.chain.length - 1];
  }

  /** 链尾哈希（下一片的 prevHash） */
  tailHash(): string {
    return this.tail?.hash() ?? GENESIS_HASH;
  }

  /** 只读快照（按追加顺序） */
  fragments(): readonly MessageFragment[] {
    return [...this.chain];
  }

  /** 记账：构造碎片并追加到链尾；已落账的碎片不可修改 */
  seal(input: SealInput): MessageFragment {
    const fragment = new MessageFragment({
      id: this.idGen.next('fragment'),
      prevHash: this.tailHash(),
      kind: input.kind,
      fromId: input.fromId,
      toId: input.toId,
      payload: input.payload,
      timestamp: input.timestamp ?? Date.now(),
    });
    this.chain.push(fragment);
    for (const listener of this.listeners) listener(fragment);
    return fragment;
  }

  /** 链式完整性校验：每片 prevHash 必须等于前一片的 hash() */
  verify(): boolean {
    let prev = GENESIS_HASH;
    for (const f of this.chain) {
      if (f.prevHash !== prev) return false;
      prev = f.hash();
    }
    return true;
  }

  /** 重放：按追加顺序返回全部碎片（重建状态的唯一依据） */
  replay(): readonly MessageFragment[] {
    return this.chain;
  }

  /** 存储恢复：先整链校验，失败拒绝装载（不可篡改的最后防线） */
  load(fragments: readonly MessageFragment[]): void {
    if (fragments.length === 0) return;
    const candidate = new Ledger(this.idGen);
    candidate.chain.push(...fragments);
    if (!candidate.verify()) {
      throw new Error('账本链校验失败：历史碎片被篡改或损坏，拒绝装载');
    }
    this.chain.push(...fragments);
  }
}
