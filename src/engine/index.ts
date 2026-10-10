// ============================================================================
// 内核门面 Kernel
// ----------------------------------------------------------------------------
// 编排「对象创建 + 关系 + 事件/产物回传 + 结构检查 + 上下文组织 + 状态机」。
// 语义分析（满足/缺失/冲突/可适配）委托给扩展点 AgentKernel。
// 内核不包含任何业务概念，也不认识任何具体 Agent / 工具 / 通知实现。
// ============================================================================

import type {
  AcceptanceRecord,
  AcceptanceVerdict,
  Artifact,
  ArtifactRef,
  Event,
  EventType,
  HumanInterventionItem,
  ID,
  Member,
  Node,
  NodeDefinition,
  NodeExecutionStatus,
  Organization,
  Project,
  Relation,
  RelationType,
  Requirement,
  RequirementDeliveryStatus,
  ReturnCategory,
  ReturnItem,
  ReturnRequest,
} from '../model/index.ts';
import type { AgentContext, AgentKernel, Analysis } from '../extensions/index.ts';
import type {
  Notification,
  Notifier,
  PipelineStepExecutor,
  StepResult,
  ToolProvider,
  ToolResult,
} from '../extensions/index.ts';
import { Store } from './store.ts';
import type { StorePlain } from './store.ts';
import { transitionNode, transitionRequirement } from './state.ts';
import { organizeContext } from './context.ts';
import { PipelineRunner } from './pipeline.ts';
import type { PipelineRunResult } from './pipeline.ts';

let seq = 0;
function nextId(prefix: string): ID {
  seq += 1;
  return `${prefix}-${seq}`;
}

/** 恢复快照后抬升 id 计数器，避免新 id 与历史 id 冲突 */
function bumpSeq(ids: Iterable<string>): void {
  let max = 0;
  for (const id of ids) {
    const m = /(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  seq = Math.max(seq, max);
}

export interface StructuralInputCheck {
  nodeId: ID;
  /** 每个依赖节点是否有产物 */
  dependencies: { nodeId: ID; hasArtifact: boolean; latestVersion?: number }[];
  /** 尚无任何产物的依赖节点（结构性缺口；需求→依赖的语义映射交给 Agent） */
  missingDependencies: ID[];
  /** 是否存在结构性缺口 */
  hasStructuralGap: boolean;
}

export class Kernel {
  readonly store = new Store();
  /** nodeId -> requirementId（简化：完整版由 decomposition 关系或显式关联表达） */
  private nodeRequirement = new Map<ID, ID>();
  private agentKernels = new Map<string, AgentKernel>();
  private notifiers = new Map<string, Notifier>();
  private toolProviders = new Map<string, ToolProvider>();
  private runner?: PipelineRunner;

  // ------------------------------------------------------------------ 创建
  createOrganization(name: string): Organization {
    const org: Organization = { id: nextId('org'), name, members: [], roles: [] };
    this.store.organizations.set(org.id, org);
    return org;
  }

  /** 添加组织成员（FR01 基本职责与权限的载体） */
  addMember(orgId: ID, name: string): Member {
    const org = this.store.organizations.get(orgId);
    if (!org) throw new Error(`组织不存在: ${orgId}`);
    const member: Member = { id: nextId('member'), orgId, name };
    org.members.push(member);
    return member;
  }

  createProject(orgId: ID, name: string): Project {
    const project: Project = { id: nextId('project'), orgId, name, requirementIds: [] };
    this.store.projects.set(project.id, project);
    return project;
  }

  createRequirement(
    projectId: ID,
    input: { goal: string; creatorId: ID; deliveryTarget: string; scope: string; acceptanceCriteria: string[] },
  ): Requirement {
    const req: Requirement = {
      id: nextId('requirement'),
      projectId,
      ...input,
      status: '草稿',
    };
    this.store.requirements.set(req.id, req);
    const project = this.store.projects.get(projectId);
    if (project) project.requirementIds.push(req.id);
    return req;
  }

  createNode(projectId: ID, def: NodeDefinition, requirementId?: ID): Node {
    const reqId = requirementId ?? this.store.projects.get(projectId)?.requirementIds[0];
    if (!reqId) throw new Error('创建节点前需先存在需求');
    const node: Node = {
      id: nextId('node'),
      projectId,
      name: def.name,
      description: def.description,
      participants: def.participants,
      inputRequirements: def.inputRequirements.map((ir) => ({ ...ir, nodeId: '' })),
      expectedOutputs: def.expectedOutputs,
      agentConfig: def.agentConfig,
      processingRules: def.processingRules,
      pipeline: def.pipeline,
      executionStatus: '待开始',
    };
    node.inputRequirements = node.inputRequirements.map((ir) => ({ ...ir, nodeId: node.id }));
    this.store.nodes.set(node.id, node);
    this.nodeRequirement.set(node.id, reqId);
    return node;
  }

  addRelation(projectId: ID, type: RelationType, fromNodeId: ID, toNodeId: ID, semantic?: string): Relation {
    const rel: Relation = { id: nextId('relation'), projectId, type, fromNodeId, toNodeId, semantic };
    this.store.relations.set(rel.id, rel);
    return rel;
  }

  // ------------------------------------------------------------------ 事实回传
  /** 提交产物：形成新版本 + submitted 事件（事件与产物并行回传） */
  submitArtifact(
    nodeId: ID,
    submitterId: ID,
    description: string,
    accessRef?: string,
  ): Artifact {
    const node = this.store.requireNode(nodeId);
    const list = this.store.artifactsOf(nodeId);
    const version = list.length + 1;
    const artifact: Artifact = {
      id: nextId('artifact'),
      nodeId,
      version,
      submitterId,
      description,
      accessRef,
      createdAt: new Date().toISOString(),
    };
    this.store.artifacts.set(nodeId, [...list, artifact]);
    const requirementId = this.nodeRequirement.get(nodeId) ?? '';
    this.recordEvent({
      type: 'submitted',
      nodeId,
      requirementId,
      artifactRef: { artifactId: artifact.id, version },
      payload: description,
    });
    return artifact;
  }

  recordEvent(input: { type: EventType; nodeId?: ID; requirementId: ID; artifactRef?: ArtifactRef; payload?: unknown }): Event {
    const ev: Event = { id: nextId('event'), ...input, timestamp: new Date().toISOString() };
    this.store.events.push(ev);
    return ev;
  }

  // ------------------------------------------------------------------ 分析
  /** 结构适配检查（内核职责）：只报告「哪些依赖尚无产物」这一事实；语义匹配交给 Agent。 */
  structuralInputCheck(nodeId: ID): StructuralInputCheck {
    const dependencies = this.store.dependencies(nodeId).map((depId) => {
      const latest = this.store.latestArtifact(depId);
      return { nodeId: depId, hasArtifact: Boolean(latest), latestVersion: latest?.version };
    });
    const missingDependencies = dependencies.filter((d) => !d.hasArtifact).map((d) => d.nodeId);
    return { nodeId, dependencies, missingDependencies, hasStructuralGap: missingDependencies.length > 0 };
  }

  /** 调用扩展点 AgentKernel 做语义分析（满足/缺失/冲突/可适配/未决/影响） */
  async analyzeNode(nodeId: ID, kernel: AgentKernel): Promise<Analysis> {
    const node = this.store.requireNode(nodeId);
    const ctx: AgentContext = {
      nodeId,
      goalAndScope: this.goalStrings(nodeId),
      inputRequirements: node.inputRequirements,
      dependencyArtifacts: this.store.dependencyArtifacts(nodeId),
    };
    return kernel.analyze(ctx);
  }

  /** 从统一事实派生有效上下文 */
  organizeContext(nodeId: ID) {
    return organizeContext(this.store, nodeId);
  }

  /** 项目宏观看板（FR07）：目标/节点状态/阻塞/交付汇总 */
  summarizeProject(projectId: ID) {
    const project = this.store.projects.get(projectId);
    if (!project) throw new Error(`项目不存在: ${projectId}`);
    const requirements = project.requirementIds
      .map((id) => this.store.requirements.get(id))
      .filter((r): r is Requirement => Boolean(r));
    const nodes = [...this.store.nodes.values()].filter((n) => n.projectId === projectId);

    const blockers: { type: string; nodeId?: ID; name?: string; status?: string; gap?: string }[] = [];
    for (const n of nodes) {
      if (n.executionStatus === '等待人工' || n.executionStatus === '受阻' || n.executionStatus === '执行异常') {
        blockers.push({ type: 'node', nodeId: n.id, name: n.name, status: n.executionStatus });
      }
    }
    for (const it of this.store.interventions.values()) {
      const node = this.store.nodes.get(it.nodeId);
      if (node?.projectId === projectId && (it.status === '待处理' || it.status === '已补充' || it.status === '复查中')) {
        blockers.push({ type: 'intervention', nodeId: it.nodeId, name: node.name, gap: it.gap });
      }
    }

    const reqProject = new Map([...this.store.requirements.values()].map((r) => [r.id, r.projectId]));
    const recentEvents = this.store.events
      .filter((e) => reqProject.get(e.requirementId) === projectId)
      .slice(-10)
      .map((e) => ({ type: e.type, nodeId: e.nodeId, payload: e.payload }));

    const artifactCount = [...this.store.artifacts.values()]
      .flat()
      .filter((a) => this.store.nodes.get(a.nodeId)?.projectId === projectId).length;

    return {
      projectId,
      name: project.name,
      requirements: requirements.map((r) => ({ id: r.id, goal: r.goal, status: r.status })),
      nodes: nodes.map((n) => ({ id: n.id, name: n.name, status: n.executionStatus })),
      blockers,
      artifactCount,
      recentEvents,
    };
  }

  // ------------------------------------------------------------------ 状态
  transitionNode(nodeId: ID, to: NodeExecutionStatus): Node {
    const node = this.store.requireNode(nodeId);
    const next = transitionNode(node, to);
    this.store.nodes.set(nodeId, next);
    return next;
  }

  transitionRequirement(reqId: ID, to: RequirementDeliveryStatus): Requirement {
    const req = this.store.requireRequirement(reqId);
    const next = transitionRequirement(req, to);
    this.store.requirements.set(reqId, next);
    return next;
  }

  // ------------------------------------------------------------------ 人工介入（FR05）
  raiseIntervention(input: {
    requirementId: ID;
    nodeId: ID;
    type: string;
    knownInfo: string;
    gap: string;
    basis: string;
    impact: string;
    targetRole?: string;
    targetMemberId?: ID;
  }): HumanInterventionItem {
    const it: HumanInterventionItem = { id: nextId('intervention'), ...input, status: '待处理' };
    this.store.interventions.set(it.id, it);
    return it;
  }

  /** 从 Agent 分析结果生成人工介入项（幂等：同一缺口不重复生成） */
  raiseInterventionsFromAnalysis(nodeId: ID, analysis: Analysis): HumanInterventionItem[] {
    const reqId = this.nodeRequirement.get(nodeId) ?? '';
    const created: HumanInterventionItem[] = [];
    for (const issue of analysis.openIssues) {
      const exists = [...this.store.interventions.values()].some(
        (it) =>
          it.nodeId === nodeId &&
          it.gap === issue.fact &&
          (it.status === '待处理' || it.status === '已补充' || it.status === '复查中'),
      );
      if (exists) continue;
      created.push(
        this.raiseIntervention({
          requirementId: reqId,
          nodeId,
          type: 'semantic_gap',
          knownInfo: '来自 Agent 分析',
          gap: issue.fact,
          basis: issue.suggestedOwner ?? '节点责任人',
          impact: issue.fact,
          targetRole: issue.suggestedOwner,
        }),
      );
    }
    return created;
  }

  /** 补充材料：待处理 → 已补充 */
  answerIntervention(id: ID): HumanInterventionItem {
    const it = this.requireIntervention(id);
    if (it.status !== '待处理') throw new Error(`介入项状态不允许补充: ${it.status}`);
    const next: HumanInterventionItem = { ...it, status: '已补充' };
    this.store.interventions.set(id, next);
    this.recordEvent({ type: 'supplemented', nodeId: it.nodeId, requirementId: it.requirementId, payload: `介入项 ${id} 已补充` });
    return next;
  }

  /** 复查中：已补充 → 复查中 */
  recheckIntervention(id: ID): HumanInterventionItem {
    return this.setInterventionStatus(id, '复查中', ['已补充']);
  }

  /** 解决：已补充/复查中 → 已解决 */
  resolveIntervention(id: ID): HumanInterventionItem {
    return this.setInterventionStatus(id, '已解决', ['已补充', '复查中']);
  }

  /** 取消：未解决 → 已取消 */
  cancelIntervention(id: ID): HumanInterventionItem {
    return this.setInterventionStatus(id, '已取消', ['待处理', '已补充', '复查中']);
  }

  private setInterventionStatus(id: ID, to: HumanInterventionItem['status'], allowedFrom: HumanInterventionItem['status'][]): HumanInterventionItem {
    const it = this.requireIntervention(id);
    if (!allowedFrom.includes(it.status)) throw new Error(`介入项非法状态转移: ${it.status} → ${to}`);
    const next: HumanInterventionItem = { ...it, status: to };
    this.store.interventions.set(id, next);
    return next;
  }

  private requireIntervention(id: ID): HumanInterventionItem {
    const it = this.store.interventions.get(id);
    if (!it) throw new Error(`介入项不存在: ${id}`);
    return it;
  }

  // ------------------------------------------------------------------ 退回与验收（FR06 / FR11）
  /** Agent 生成退回草稿（尚未正式） */
  createReturnDraft(input: {
    fromNodeId: ID;
    targetArtifactRef: ArtifactRef;
    category: ReturnCategory;
    items: ReturnItem[];
  }): ReturnRequest {
    const rr: ReturnRequest = { id: nextId('return'), ...input, status: 'draft' };
    this.store.returns.set(rr.id, rr);
    return rr;
  }

  /** 人工批准 → 正式退回（幂等：已批准返回原记录，不重复产生事件） */
  approveReturn(draftId: ID, approverId: ID): ReturnRequest {
    const rr = this.store.returns.get(draftId);
    if (!rr) throw new Error(`退回请求不存在: ${draftId}`);
    if (rr.status === 'approved') return rr;
    const next: ReturnRequest = { ...rr, status: 'approved', approvedBy: approverId, approvedAt: new Date().toISOString() };
    this.store.returns.set(draftId, next);
    this.recordEvent({
      type: 'returned',
      nodeId: rr.fromNodeId,
      requirementId: this.nodeRequirement.get(rr.fromNodeId) ?? '',
      artifactRef: rr.targetArtifactRef,
      payload: { category: rr.category, approvedBy: approverId },
    });
    return next;
  }

  /** 验收：按「产物版本 + 验收人」幂等 upsert（同一接收方对同一版本只有一条结论） */
  acceptArtifact(input: {
    artifactId: ID;
    version: number;
    acceptorId: ID;
    requirementIds: string[];
    verdict: AcceptanceVerdict;
  }): AcceptanceRecord {
    const existing = [...this.store.acceptances.values()].find(
      (a) => a.artifactId === input.artifactId && a.version === input.version && a.acceptorId === input.acceptorId,
    );
    if (existing) {
      const next: AcceptanceRecord = { ...existing, verdict: input.verdict, requirementIds: input.requirementIds };
      this.store.acceptances.set(existing.id, next);
      return next;
    }
    const rec: AcceptanceRecord = { id: nextId('acceptance'), ...input, timestamp: new Date().toISOString() };
    this.store.acceptances.set(rec.id, rec);
    this.recordEvent({
      type: 'accepted',
      requirementId: input.requirementIds[0] ?? '',
      artifactRef: { artifactId: input.artifactId, version: input.version },
      payload: input.verdict,
    });
    return rec;
  }

  /** 最终交付：完结必须关联最终产物 + 已接受验收记录（PRD FR11） */
  finalizeRequirement(reqId: ID, artifactRef: ArtifactRef, acceptorId: ID): Requirement {
    const req = this.store.requireRequirement(reqId);
    const accepted = [...this.store.acceptances.values()].some(
      (a) =>
        a.artifactId === artifactRef.artifactId &&
        a.version === artifactRef.version &&
        a.acceptorId === acceptorId &&
        a.verdict === '已接受',
    );
    if (!accepted) throw new Error('无法完结：缺少针对最终产物的「已接受」验收记录');
    let current = req;
    if (current.status === '进行中') current = transitionRequirement(current, '待最终验收');
    const next = transitionRequirement(current, '已完结');
    next.finalArtifactRef = artifactRef;
    this.store.requirements.set(reqId, next);
    return next;
  }

  // ------------------------------------------------------------------ 记录与恢复（FR12）
  snapshot(): StorePlain {
    return this.store.toPlain();
  }

  restore(plain: StorePlain): void {
    this.store.loadFrom(plain);
    this.nodeRequirement.clear();
    for (const n of this.store.nodes.values()) {
      const reqId = this.store.projects.get(n.projectId)?.requirementIds[0];
      if (reqId) this.nodeRequirement.set(n.id, reqId);
    }
    bumpSeq([
      ...[...this.store.organizations.keys()],
      ...[...this.store.projects.keys()],
      ...[...this.store.requirements.keys()],
      ...[...this.store.nodes.keys()],
      ...[...this.store.relations.keys()],
      ...[...this.store.artifacts.keys()],
      ...this.store.events.map((e) => e.id),
      ...[...this.store.interventions.keys()],
      ...[...this.store.acceptances.keys()],
      ...[...this.store.returns.keys()],
    ]);
  }

  // ------------------------------------------------------------------ 扩展点注册（FR08 / FR09 / FR10）
  registerAgentKernel(kernel: AgentKernel): void {
    this.agentKernels.set(kernel.id, kernel);
  }

  registerNotifier(notifier: Notifier): void {
    this.notifiers.set(notifier.id, notifier);
  }

  registerStepExecutor(ex: PipelineStepExecutor): void {
    this.ensureRunner().register(ex);
  }

  registerToolProvider(tp: ToolProvider): void {
    this.toolProviders.set(tp.id, tp);
  }

  getToolProvider(id: string): ToolProvider | undefined {
    return this.toolProviders.get(id);
  }

  /** 调用已注册工具（FR09 工具读取链路） */
  async callTool(providerId: string, toolId: string, args: unknown): Promise<ToolResult> {
    const tp = this.toolProviders.get(providerId);
    if (!tp) throw new Error(`未注册工具提供方: ${providerId}`);
    return tp.call(toolId, args);
  }

  /** 发送通知到已注册渠道（channel 为空则发全部）；通知失败不阻断业务（FR08） */
  async notify(input: { to: string; channel?: string; title: string; body: string; actionUrl?: string }): Promise<void> {
    const targets = input.channel
      ? [this.notifiers.get(input.channel)].filter((n): n is Notifier => Boolean(n))
      : [...this.notifiers.values()];
    for (const n of targets) {
      try {
        await n.send({ to: input.to, channel: n.id, title: input.title, body: input.body, actionUrl: input.actionUrl });
      } catch {
        // 通知失败不丢待办、不阻断业务
      }
    }
  }

  /** 节点所属需求 id（简化映射） */
  nodeRequirementOf(nodeId: ID): string {
    return this.nodeRequirement.get(nodeId) ?? '';
  }

  // ------------------------------------------------------------------ 流水线（FR10）
  async runStep(nodeId: ID): Promise<StepResult> {
    const node = this.store.requireNode(nodeId);
    const agent = this.agentKernels.get(node.agentConfig.kernel);
    return this.ensureRunner().runStep(nodeId, agent);
  }

  async runPipeline(nodeId: ID): Promise<PipelineRunResult> {
    const node = this.store.requireNode(nodeId);
    const agent = this.agentKernels.get(node.agentConfig.kernel);
    return this.ensureRunner().runPipeline(nodeId, agent);
  }

  private ensureRunner(): PipelineRunner {
    if (!this.runner) this.runner = new PipelineRunner(this);
    return this.runner;
  }

  // ------------------------------------------------------------------ 内部
  private goalStrings(nodeId: ID): string[] {
    const node = this.store.requireNode(nodeId);
    const reqId = this.nodeRequirement.get(nodeId);
    const req = reqId ? this.store.requirements.get(reqId) : undefined;
    const out: string[] = [];
    if (req) out.push(`目标：${req.goal}`, `范围：${req.scope}`);
    out.push(`本节点：${node.description}`);
    return out;
  }
}
