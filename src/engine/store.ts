// ============================================================================
// 内核存储（内存事实库）
// ----------------------------------------------------------------------------
// 「统一事实」是业务上一致的记录。这里用内存 Map 表达最小事实集合，
// 后续可替换为持久化实现，不影响上层引擎逻辑。
// ============================================================================

import type {
  AcceptanceRecord,
  Artifact,
  Event,
  HumanInterventionItem,
  ID,
  Node,
  Organization,
  Project,
  Relation,
  Requirement,
  ReturnRequest,
} from '../model/index.ts';

/** 内存事实库的纯数据快照（用于 FR12 记录与恢复） */
export interface StorePlain {
  organizations: Organization[];
  projects: Project[];
  requirements: Requirement[];
  nodes: Node[];
  relations: Relation[];
  artifacts: [ID, Artifact[]][];
  events: Event[];
  interventions: HumanInterventionItem[];
  acceptances: AcceptanceRecord[];
  returns: ReturnRequest[];
  pipelineProgress: [ID, PipelineProgress][];
}

/** 节点流水线执行进度（FR10 等待点恢复） */
export interface PipelineProgress {
  completedStepIds: ID[];
  status: 'running' | 'waiting' | 'done' | 'failed';
}

export class Store {
  organizations = new Map<ID, Organization>();
  projects = new Map<ID, Project>();
  requirements = new Map<ID, Requirement>();
  nodes = new Map<ID, Node>();
  relations = new Map<ID, Relation>();
  /** nodeId -> 该节点按版本排序的产物列表 */
  artifacts = new Map<ID, Artifact[]>();
  events: Event[] = [];
  interventions = new Map<ID, HumanInterventionItem>();
  acceptances = new Map<ID, AcceptanceRecord>();
  returns = new Map<ID, ReturnRequest>();
  pipelineProgress = new Map<ID, PipelineProgress>();

  /** 本节点依赖的节点 id（dependency: from → to，to 依赖 from） */
  dependencies(nodeId: ID): ID[] {
    return [...this.relations.values()]
      .filter((r) => r.type === 'dependency' && r.toNodeId === nodeId)
      .map((r) => r.fromNodeId);
  }

  /** 依赖本节点的节点 id */
  dependents(nodeId: ID): ID[] {
    return [...this.relations.values()]
      .filter((r) => r.type === 'dependency' && r.fromNodeId === nodeId)
      .map((r) => r.toNodeId);
  }

  /** 指定节点所有产物（按版本升序） */
  artifactsOf(nodeId: ID): Artifact[] {
    return this.artifacts.get(nodeId) ?? [];
  }

  latestArtifact(nodeId: ID): Artifact | undefined {
    const list = this.artifactsOf(nodeId);
    return list[list.length - 1];
  }

  /** 某节点的直接依赖产物（展平） */
  dependencyArtifacts(nodeId: ID): Artifact[] {
    return this.dependencies(nodeId).flatMap((depId) => this.artifactsOf(depId));
  }

  requireNode(nodeId: ID): Node {
    const n = this.nodes.get(nodeId);
    if (!n) throw new Error(`节点不存在: ${nodeId}`);
    return n;
  }

  requireRequirement(reqId: ID): Requirement {
    const r = this.requirements.get(reqId);
    if (!r) throw new Error(`需求不存在: ${reqId}`);
    return r;
  }

  /** 导出纯数据快照（服务重启前持久化） */
  toPlain(): StorePlain {
    return {
      organizations: [...this.organizations.values()],
      projects: [...this.projects.values()],
      requirements: [...this.requirements.values()],
      nodes: [...this.nodes.values()],
      relations: [...this.relations.values()],
      artifacts: [...this.artifacts.entries()],
      events: [...this.events],
      interventions: [...this.interventions.values()],
      acceptances: [...this.acceptances.values()],
      returns: [...this.returns.values()],
      pipelineProgress: [...this.pipelineProgress.entries()],
    };
  }

  /** 从纯数据快照恢复（服务重启后还原事实） */
  loadFrom(p: StorePlain): void {
    this.organizations = new Map(p.organizations.map((x) => [x.id, x]));
    this.projects = new Map(p.projects.map((x) => [x.id, x]));
    this.requirements = new Map(p.requirements.map((x) => [x.id, x]));
    this.nodes = new Map(p.nodes.map((x) => [x.id, x]));
    this.relations = new Map(p.relations.map((x) => [x.id, x]));
    this.artifacts = new Map(p.artifacts);
    this.events = [...p.events];
    this.interventions = new Map(p.interventions.map((x) => [x.id, x]));
    this.acceptances = new Map(p.acceptances.map((x) => [x.id, x]));
    this.returns = new Map(p.returns.map((x) => [x.id, x]));
    this.pipelineProgress = new Map(p.pipelineProgress);
  }
}
