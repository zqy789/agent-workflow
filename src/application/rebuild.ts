// ============================================================================
// application · RebuildService（账本全量重放：重建流与验收的事实表）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §11.1（账本 = 唯一真相源）
//   树结构由快照恢复（性能缓存）；流状态（输入/产物/结论）只存在于账本，
//   因此恢复时对整链重放：按追加顺序把碎片重建为事实表。
//   状态（三态）不在此重放——快照中的节点状态是权威。
// ============================================================================

import type { MessageFragment } from '../domain/fragment.ts';
import type { FlowService } from './flow-service.ts';
import type { AcceptanceService } from './acceptance-service.ts';

export class RebuildService {
  /** 把账本碎片重放到流与验收的事实表（各服务按树过滤，跨树碎片自动跳过） */
  static rebuild(
    flow: FlowService,
    acceptance: AcceptanceService,
    fragments: readonly MessageFragment[],
  ): void {
    for (const fragment of fragments) {
      flow.replayGiveInput(fragment);
      flow.replaySubmitProduct(fragment);
      acceptance.replayVerdict(fragment);
    }
  }
}
