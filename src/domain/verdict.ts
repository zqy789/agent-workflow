// ============================================================================
// domain · Verdict（验收结论：逐级三选一，绑定具体产物版本）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §5 规则 8（验收结论与版本绑定）
//   结论针对「谁 × 哪个产物的哪个版本」；旧结论留链不撤销，只对新版本不生效。
// ============================================================================

import { NodeId, type VerdictKind } from './values.ts';

export interface VerdictOptions {
  /** 验收位（判定者，必为产物的严格祖先） */
  nodeId: NodeId;
  productId: NodeId;
  productVersion: number;
  kind: VerdictKind;
  reason: string;
  at: number;
}

export class Verdict {
  readonly nodeId: NodeId;
  readonly productId: NodeId;
  readonly productVersion: number;
  readonly kind: VerdictKind;
  readonly reason: string;
  readonly at: number;

  constructor(opts: VerdictOptions) {
    this.nodeId = opts.nodeId;
    this.productId = opts.productId;
    this.productVersion = opts.productVersion;
    this.kind = opts.kind;
    this.reason = opts.reason;
    this.at = opts.at;
  }
}
