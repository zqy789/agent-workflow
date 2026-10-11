// ============================================================================
// domain · MessageFragment（消息碎片：不可变、链式哈希）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §6 消息机制（碎片成链）
//   - 一切相邻交易 = 一条碎片；prevHash 指向前一片，链式完整性；
//   - 不可变：全 readonly 字段，无 setter；篡改任何一片 → 后续整链可验失败。
// ============================================================================

import { createHash } from 'node:crypto';
import { NodeId, type FragmentKind } from './values.ts';

/** 链头哨兵：第一片的 prevHash */
export const GENESIS_HASH = 'genesis';

export interface FragmentOptions {
  id: NodeId;
  /** 前一片的哈希（链式完整性证明） */
  prevHash: string;
  kind: FragmentKind;
  /** 相邻交易双方（必为父子，由调用方守护） */
  fromId: NodeId;
  toId: NodeId;
  payload?: unknown;
  timestamp: number;
}

export class MessageFragment {
  readonly id: NodeId;
  readonly prevHash: string;
  readonly kind: FragmentKind;
  readonly fromId: NodeId;
  readonly toId: NodeId;
  readonly payload: unknown;
  readonly timestamp: number;

  constructor(opts: FragmentOptions) {
    if (!opts.prevHash || opts.prevHash.trim() === '') throw new Error('prevHash 不能为空');
    this.id = opts.id;
    this.prevHash = opts.prevHash;
    this.kind = opts.kind;
    this.fromId = opts.fromId;
    this.toId = opts.toId;
    this.payload = opts.payload;
    this.timestamp = opts.timestamp;
  }

  /** 本片内容哈希：下一片的 prevHash 引用它（链式完整性） */
  hash(): string {
    const payload = this.payload === undefined ? 'null' : JSON.stringify(this.payload);
    const canonical = [
      this.id.value,
      this.prevHash,
      this.kind,
      this.fromId.value,
      this.toId.value,
      payload,
      this.timestamp,
    ].join('|');
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  /** 由存储的纯数据重建碎片实例（供 infrastructure 层使用） */
  static fromPlain(opts: FragmentOptions): MessageFragment {
    return new MessageFragment(opts);
  }
}
