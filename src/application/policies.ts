// ============================================================================
// application · 示警策略实现（Strategy 模式）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §7（超时处置默认 C：上帝只示警）
// 策略可配置、可替换：换超时口径 / 加异常检测 = 新增一个 AlarmPolicy 实现。
// ============================================================================

import { NodeStatus } from '../domain/values.ts';
import type { Alarm, AlarmContext, AlarmPolicy } from '../domain/ports.ts';

/** 等待超时示警：节点已开工（收到过 I）、处于等待且超过时限 → 天象示警 */
export class TimeoutAlarmPolicy implements AlarmPolicy {
  readonly id = 'timeout';

  private readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  evaluate(ctx: AlarmContext): Alarm | null {
    if (ctx.status !== NodeStatus.Waiting) return null; // 只盯「等着的」
    if (ctx.inputReceivedAt === null) return null; // 未开工不示警
    if (ctx.lastActivityAt === null) return null;
    const elapsed = ctx.now - ctx.lastActivityAt;
    if (elapsed < this.timeoutMs) return null;
    return {
      nodeId: ctx.nodeId,
      reason: 'timeout',
      detail: `等待超时：已 ${elapsed}ms 无进展（等输入 / 等分支回流）`,
      sinceMs: elapsed,
    };
  }
}
