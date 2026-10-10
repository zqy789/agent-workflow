// ============================================================================
// 节点流水线执行器（FR10）
// ----------------------------------------------------------------------------
// 内置步骤（check_input / agent_analyze / human_confirm / submit_artifact / emit_event）
// 由内核直接实现，拥有完整事实访问；任意自定义步骤通过 PipelineStepExecutor
// 扩展点注册——新增步骤类型不改内核。
// 流水线支持「等待点恢复」：wait 的步骤不计入完成，人工处理后从该点继续。
// ============================================================================

import type { ID, Node, PipelineStep } from '../model/index.ts';
import type {
  AgentKernel,
  PipelineStepExecutor,
  StepContext,
  StepResult,
} from '../extensions/index.ts';
import type { Kernel } from './index.ts';

export interface PipelineRunResult {
  results: StepResult[];
  status: 'done' | 'waiting' | 'failed';
}

export class PipelineRunner {
  private custom = new Map<string, PipelineStepExecutor>();
  private kernel: Kernel;

  constructor(kernel: Kernel) {
    this.kernel = kernel;
  }

  /** 注册自定义步骤执行器（扩展点：新增步骤类型不改内核） */
  register(ex: PipelineStepExecutor): void {
    this.custom.set(ex.id, ex);
  }

  /** 执行单个步骤（等待点语义：wait 步骤不推进，可恢复） */
  async runStep(nodeId: ID, agent?: AgentKernel): Promise<StepResult> {
    const node = this.kernel.store.requireNode(nodeId);
    if (node.executionStatus === '待开始' || node.executionStatus === '等待人工') {
      this.kernel.transitionNode(nodeId, '处理中');
    }
    const progress = this.kernel.store.pipelineProgress.get(nodeId) ?? {
      completedStepIds: [] as ID[],
      status: 'running' as const,
    };
    const step = node.pipeline.find((s) => !progress.completedStepIds.includes(s.id));
    if (!step) {
      progress.status = 'done';
      this.kernel.store.pipelineProgress.set(nodeId, progress);
      return { ok: true, output: 'pipeline completed' };
    }
    const result = await this.executeStep(node, step, agent);
    if (result.ok && !result.wait) {
      progress.completedStepIds = [...progress.completedStepIds, step.id];
      progress.status = 'running';
    } else if (result.wait) {
      progress.status = 'waiting';
    } else {
      progress.status = 'failed';
    }
    this.kernel.store.pipelineProgress.set(nodeId, progress);
    return result;
  }

  /** 连续执行直到完成 / 等待人工 / 失败 */
  async runPipeline(nodeId: ID, agent?: AgentKernel): Promise<PipelineRunResult> {
    const results: StepResult[] = [];
    for (let guard = 0; guard < 100; guard += 1) {
      const r = await this.runStep(nodeId, agent);
      const progress = this.kernel.store.pipelineProgress.get(nodeId);
      if (progress?.status === 'done') return { results, status: 'done' };
      results.push(r);
      if (r.wait) return { results, status: 'waiting' };
      if (!r.ok) return { results, status: 'failed' };
    }
    return { results, status: 'failed' };
  }

  private async executeStep(node: Node, step: PipelineStep, agent?: AgentKernel): Promise<StepResult> {
    switch (step.type) {
      case 'check_input': return this.checkInput(node);
      case 'agent_analyze': return this.agentAnalyze(node, agent);
      case 'tool_call': return this.toolCall(node, step);
      case 'human_confirm': return this.humanConfirm(node, step);
      case 'submit_artifact': return this.submitArtifact(node, step);
      case 'emit_event': return this.emitEvent(node);
      default: return this.customStep(node, step, agent);
    }
  }

  private async checkInput(node: Node): Promise<StepResult> {
    const check = this.kernel.structuralInputCheck(node.id);
    if (check.hasStructuralGap) {
      this.kernel.transitionNode(node.id, '等待人工');
      await this.kernel.notify({
        to: '节点责任人',
        title: '需要补充',
        body: `缺少依赖产物: ${check.missingDependencies.join(', ')}`,
      });
      return { ok: false, wait: true, error: `缺少依赖产物: ${check.missingDependencies.join(', ')}`, output: check };
    }
    return { ok: true, output: check };
  }

  private async agentAnalyze(node: Node, agent?: AgentKernel): Promise<StepResult> {
    if (!agent) return { ok: false, error: `未注册 Agent 内核: ${node.agentConfig.kernel}` };
    const analysis = await this.kernel.analyzeNode(node.id, agent);
    const raised = this.kernel.raiseInterventionsFromAnalysis(node.id, analysis);
    if (raised.length > 0) {
      this.kernel.transitionNode(node.id, '等待人工');
      await this.kernel.notify({ to: '节点责任人', title: '需要补充', body: `分析发现 ${raised.length} 个缺口` });
      return { ok: false, wait: true, output: { analysis, raised } };
    }
    return { ok: true, output: analysis };
  }

  private async toolCall(node: Node, step: PipelineStep): Promise<StepResult> {
    const cfg = step.config as { provider?: string; tool?: string; args?: unknown; materialRef?: string } | undefined;
    if (!cfg?.provider) return { ok: false, error: 'tool_call 缺少 provider 配置' };
    const tp = this.kernel.getToolProvider(cfg.provider);
    if (!tp) return { ok: false, error: `未注册工具提供方: ${cfg.provider}` };
    if (cfg.materialRef) {
      try {
        const mat = await tp.readMaterial(cfg.materialRef);
        return { ok: true, output: mat };
      } catch (e) {
        return { ok: false, error: `读取材料失败: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    if (!cfg.tool) return { ok: false, error: 'tool_call 缺少 tool 配置' };
    const r = await tp.call(cfg.tool, cfg.args);
    return { ok: r.ok, output: r.output, error: r.error };
  }

  private async humanConfirm(node: Node, step: PipelineStep): Promise<StepResult> {
    const existing = [...this.kernel.store.interventions.values()].find(
      (it) => it.nodeId === node.id && it.type === 'human_confirm',
    );
    if (existing && existing.status === '已解决') {
      return { ok: true, output: { confirmed: true } };
    }
    if (existing && existing.status !== '已取消') {
      this.kernel.transitionNode(node.id, '等待人工');
      return { ok: true, wait: true, output: { interventionId: existing.id, note: '等待人工确认' } };
    }
    this.kernel.transitionNode(node.id, '等待人工');
    const cfg = step.config as { prompt?: string } | undefined;
    const it = this.kernel.raiseIntervention({
      requirementId: this.kernel.nodeRequirementOf(node.id),
      nodeId: node.id,
      type: 'human_confirm',
      knownInfo: '流水线到达人工确认步骤',
      gap: cfg?.prompt ?? '请确认产物并批准提交',
      basis: '人工确认',
      impact: '未确认前不提交',
    });
    await this.kernel.notify({ to: '节点责任人', title: '需要审批', body: `请确认并推进节点「${node.name}」` });
    return { ok: true, wait: true, output: { interventionId: it.id } };
  }

  private async submitArtifact(node: Node, step: PipelineStep): Promise<StepResult> {
    const cfg = step.config as { description?: string; submitterId?: string } | undefined;
    if (!cfg?.description) {
      await this.kernel.notify({ to: '节点责任人', title: '需要补充', body: 'submit_artifact 步骤缺少产物描述' });
      return { ok: false, wait: true, error: 'submit_artifact 缺少 description 配置' };
    }
    const art = this.kernel.submitArtifact(node.id, cfg.submitterId ?? 'system', cfg.description);
    return { ok: true, output: art };
  }

  private async emitEvent(node: Node): Promise<StepResult> {
    const ev = this.kernel.recordEvent({
      type: 'submitted',
      nodeId: node.id,
      requirementId: this.kernel.nodeRequirementOf(node.id),
      payload: '流水线完成',
    });
    return { ok: true, output: ev };
  }

  private async customStep(node: Node, step: PipelineStep, agent?: AgentKernel): Promise<StepResult> {
    const ex = this.custom.get(step.type);
    if (!ex) return { ok: false, error: `未注册流水线步骤: ${step.type}` };
    const ctx: StepContext = {
      nodeId: node.id,
      agentKernel: agent,
      facts: { name: node.name, expectedOutputs: node.expectedOutputs },
    };
    return ex.execute(step, ctx);
  }
}
