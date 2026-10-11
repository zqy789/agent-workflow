// ============================================================================
// infrastructure · 顺序 ID 生成器（IdGenerator 端口实现）
// ----------------------------------------------------------------------------
// 设计遗留 L1：ID 生成算法是可替换策略；本期先给确定性顺序实现。
// ============================================================================

import { NodeId } from '../domain/values.ts';
import type { IdGenerator } from '../domain/ports.ts';

export class SequentialIdGenerator implements IdGenerator {
  private seq: number;

  constructor(start = 0) {
    this.seq = start;
  }

  next(prefix = 'node'): NodeId {
    this.seq += 1;
    return NodeId.of(`${prefix}-${this.seq}`);
  }

  /** 恢复时抬升计数器，避免与历史 ID 冲突 */
  bump(maxSeq: number): void {
    this.seq = Math.max(this.seq, maxSeq);
  }
}
