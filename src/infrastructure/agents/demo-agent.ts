// ============================================================================
// infrastructure · 演示 Agent 内核（离线确定性实现）
// ----------------------------------------------------------------------------
// 真实 LLM 内核（DeepSeek 等）按 AgentKernel 端口在后续接入步骤实现；
// 此处提供确定性实现，保证离线测试与兜底运行。
// ============================================================================

import type { AgentContext, AgentKernel, AgentResult } from '../../domain/ports.ts';

export class DemoAgentKernel implements AgentKernel {
  readonly id = 'demo';

  async act(ctx: AgentContext): Promise<AgentResult> {
    return {
      output: `${ctx.nodeName} 完成产出（输入 ${ctx.inputs.length} 项、分支产物 ${ctx.branchProducts.length} 项、技能 ${ctx.skills.length} 项）`,
      notes: [...ctx.goalAndScope],
    };
  }
}
