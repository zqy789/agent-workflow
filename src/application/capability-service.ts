// ============================================================================
// application · CapabilityService（节点能力编排：Agent → 动作 → 产出 O）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §8 能力体系（一切皆节点）
//   - 内核可配置：节点配置引用哪个 AgentKernel（换模型不改内核）；
//   - SKILL 组合：节点引用的 SKILL 内容注入 Agent 上下文；
//   - 动作抽象：CI-CD 等由 ActionExecutor 扩展点执行；
//   - 产出自动上行：运行态节点完成能力后，O 由 FlowService 版本化提交。
// ============================================================================

import { Tree } from '../domain/tree.ts';
import { NodeId, NodeStatus } from '../domain/values.ts';
import type { Product } from '../domain/product.ts';
import type { Skill } from '../domain/skill.ts';
import type {
  AgentContext, AgentKernel, ActionExecutor, NotifierChannel, Notice, SendResult,
} from '../domain/ports.ts';
import type { FlowService } from './flow-service.ts';

export class CapabilityService {
  private readonly tree: Tree;
  private readonly flow: FlowService;
  private readonly agents = new Map<string, AgentKernel>();
  private readonly executors = new Map<string, ActionExecutor>();
  private readonly notifiers = new Map<string, NotifierChannel>();
  private readonly skills = new Map<string, Skill>();

  constructor(tree: Tree, flow: FlowService) {
    this.tree = tree;
    this.flow = flow;
  }

  registerAgent(kernel: AgentKernel): void {
    this.agents.set(kernel.id, kernel);
  }

  registerExecutor(executor: ActionExecutor): void {
    this.executors.set(executor.id, executor);
  }

  registerNotifier(channel: NotifierChannel): void {
    this.notifiers.set(channel.id, channel);
  }

  registerSkill(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  /** 执行节点能力（运行态）：Agent 智能 → 已挂载动作 → 产出 O 自动上行 */
  async runNode(nodeId: NodeId): Promise<Product> {
    const node = this.tree.require(nodeId);
    if (node.currentStatus !== NodeStatus.Running) {
      throw new Error(`节点不在运行态，不可执行能力: ${nodeId}（当前 ${node.currentStatus}）`);
    }

    // 1) Agent 智能（内核可配置，换模型 = 改配置引用）
    const kernelId = node.capabilities.agentKernel ?? 'demo';
    const kernel = this.agents.get(kernelId);
    if (!kernel) throw new Error(`未注册 Agent 内核: ${kernelId}`);

    const ctx: AgentContext = {
      nodeId: node.id,
      nodeName: node.name,
      goalAndScope: [this.tree.goal, node.description].filter(Boolean),
      inputs: this.flow.inputsOf(node.id),
      branchProducts: node.childIds.flatMap((cid) => this.flow.productsOf(NodeId.of(cid))),
      skills: (node.capabilities.skills ?? [])
        .map((id) => this.skills.get(id))
        .filter((s): s is Skill => Boolean(s)),
    };
    const result = await kernel.act(ctx);

    // 2) 挂载动作（CI-CD 等扩展点，保持抽象）
    for (const exId of node.capabilities.actions ?? []) {
      const executor = this.executors.get(exId);
      if (!executor) throw new Error(`未注册动作执行器: ${exId}`);
      const actionResult = await executor.execute({ actionId: exId, nodeId: node.id, input: result.output });
      if (!actionResult.ok) throw new Error(`动作失败: ${exId}（${actionResult.error ?? '未知原因'}）`);
    }

    // 3) 产出 O：版本化、自动上行（守恒律由 FlowService / Product 守护）
    return this.flow.submitProduct(node.id, result.output);
  }

  /** 通过已注册渠道发送通知（待办为记录、通知为触达；失败可见不阻断） */
  async notify(channelId: string, notice: Notice): Promise<SendResult> {
    const channel = this.notifiers.get(channelId);
    if (!channel) return { ok: false, sentAt: new Date().toISOString(), error: `未注册通知渠道: ${channelId}` };
    return channel.send(notice);
  }
}
