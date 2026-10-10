// ============================================================================
// 扩展点接口（第 3 层 · 可插拔）
// ----------------------------------------------------------------------------
// 内核只依赖这些接口，不认识任何具体实现。
// 换模型 / 换工具 / 换通知渠道 = 新增一个 provider 实现 + 配置里引用。
// ============================================================================

import type {
  Artifact,
  ArtifactRef,
  ID,
  InputRequirement,
  Member,
  PipelineStep,
} from '../model/index.ts';

// ----------------------------------------------------------------------------
// AgentKernel（PRD FR04 / FR07 / FR09）
// ----------------------------------------------------------------------------

export interface SatisfiedItem {
  requirementId: ID;
  artifactRef?: ArtifactRef;
  content: string;
}

export interface MissingItem {
  requirementId: ID;
  what: string;
  why: string;
}

export interface ConflictItem {
  sources: string[];
  detail: string;
}

export interface AdaptableItem {
  from: string;
  to: string;
  mapping: string;
}

export interface OpenIssue {
  fact: string;
  suggestedOwner?: string;
}

export interface Impact {
  work: string;
  suggestion: string;
  recheckCondition: string;
}

/** 节点 Agent 的分析输出（对应 PRD FR04 的输出表） */
export interface Analysis {
  satisfied: SatisfiedItem[];
  missing: MissingItem[];
  conflicts: ConflictItem[];
  adaptable: AdaptableItem[];
  openIssues: OpenIssue[];
  impacts: Impact[];
}

/** 传给 Agent 的上下文：内核只给「事实」，语义判断交给 Agent */
export interface AgentContext {
  nodeId: ID;
  goalAndScope: string[];
  inputRequirements: InputRequirement[];
  dependencyArtifacts: Artifact[];
}

export interface AgentKernel {
  readonly id: string;
  analyze(ctx: AgentContext): Promise<Analysis>;
}

// ----------------------------------------------------------------------------
// ToolProvider（PRD FR09 · MCP 为一种实现）
// ----------------------------------------------------------------------------

export interface Tool {
  id: string;
  name: string;
  description: string;
}

export interface ToolResult {
  ok: boolean;
  output?: unknown;
  error?: string;
}

export interface Material {
  ref: string;
  content: string;
  fetchedAt: string;
}

export interface ToolProvider {
  readonly id: string;
  listTools(): Promise<Tool[]>;
  readMaterial(ref: string): Promise<Material>;
  call(toolId: string, args: unknown): Promise<ToolResult>;
}

// ----------------------------------------------------------------------------
// Notifier（PRD FR08 · 钉钉/企微/邮件为具体实现）
// ----------------------------------------------------------------------------

export interface Notification {
  to: string;
  channel: string;
  title: string;
  body: string;
  actionUrl?: string;
}

export interface SendResult {
  ok: boolean;
  error?: string;
  sentAt: string;
}

export interface Notifier {
  readonly id: string;
  send(msg: Notification): Promise<SendResult>;
}

// ----------------------------------------------------------------------------
// PipelineStepExecutor（PRD FR10）
// ----------------------------------------------------------------------------

export interface StepContext {
  nodeId: ID;
  agentKernel?: AgentKernel;
  /** 节点事实快照（供自定义步骤只读使用，避免直接依赖内核内部结构） */
  facts?: unknown;
}

export interface StepResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  /** 该步骤需要等待人工，暂停流水线（等待点可恢复） */
  wait?: boolean;
}

export interface PipelineStepExecutor {
  /** 与 PipelineStep.type 对应 */
  readonly id: string;
  execute(step: PipelineStep, ctx: StepContext): Promise<StepResult>;
}

// ----------------------------------------------------------------------------
// IdentityProvider / PermissionEvaluator（PRD FR01 · 组织与权限）
// ----------------------------------------------------------------------------

export interface IdentityProvider {
  readonly id: string;
  resolveMember(memberId: ID): Promise<Member | null>;
}

export interface PermissionEvaluator {
  readonly id: string;
  can(actorId: ID, action: string, resourceId: ID): Promise<boolean>;
}
