// ============================================================================
// 抽象对象模型（内核 · 第 1 层）
// ----------------------------------------------------------------------------
// 本文件只回答「对象是什么」，刻意领域无关：
// 没有「产品节点 / 研发节点 / 钉钉 / 某个 MCP 工具」这类业务概念。
// 领域能力全部来自 config 层（第 2 层）与 extensions 层（第 3 层）。
// ============================================================================

export type ID = string;

// ----------------------------------------------------------------------------
// 状态机（对应 PRD §7）
// ----------------------------------------------------------------------------

/** 节点本轮执行状态 */
export type NodeExecutionStatus =
  | '待开始'
  | '处理中'
  | '等待人工'
  | '受阻'
  | '暂停'
  | '执行异常'
  | '本轮结束'
  | '已取消';

/** 输入适配状态（针对「依赖 + 要求 + 产物」） */
export type InputAdaptationStatus = '未满足' | '待确认' | '满足' | '需复验';

/** 接收方验收结论（针对「产物版本 + 接收方」） */
export type AcceptanceVerdict = '已接受' | '需修订' | '需复验';

/** 需求交付状态 */
export type RequirementDeliveryStatus =
  | '草稿'
  | '进行中'
  | '待最终验收'
  | '需修订'
  | '已完结'
  | '已取消';

/** 人工介入项状态 */
export type InterventionStatus = '待处理' | '已补充' | '复查中' | '已解决' | '已取消';

// ----------------------------------------------------------------------------
// 关系与事件分类
// ----------------------------------------------------------------------------

/**
 * 关系分类（对应 PRD §4.1）：
 * - dependency   A→B 表示「B 需要 A 的产物」（输入依赖）
 * - delivery     A→B 表示「A 的成果交给 B」（交付汇聚方向）
 * - decomposition 需求 → 子节点
 * - grouping     结构化分组（非执行依赖，PRD D01 待决）
 */
export type RelationType = 'dependency' | 'delivery' | 'decomposition' | 'grouping';

/** 事件类型（已发生的事实） */
export type EventType =
  | 'submitted'   // 提交产物
  | 'supplemented' // 补充材料
  | 'approved'    // 人工批准
  | 'returned'    // 退回
  | 'changed'     // 变更
  | 'failed'      // 失败
  | 'accepted';   // 验收接受

/** 事实来源性质（用于有效上下文的来源标注） */
export type ProvenanceKind = '原始材料' | '人工确认' | 'AI分析' | '待确认' | '已失效';

/** 输入要求必要性 */
export type Necessity = 'required' | 'optional';

// ----------------------------------------------------------------------------
// 实体（对应设计文档 §2.1 的 11 个对象）
// ----------------------------------------------------------------------------

export interface Organization {
  id: ID;
  name: string;
  members: Member[];
  roles: Role[];
}

export interface Member {
  id: ID;
  orgId: ID;
  name: string;
}

export interface Role {
  id: ID;
  orgId: ID;
  name: string;
  permissions: string[];
}

export interface Project {
  id: ID;
  orgId: ID;
  name: string;
  requirementIds: ID[];
}

export interface Requirement {
  id: ID;
  projectId: ID;
  goal: string;
  creatorId: ID;
  deliveryTarget: string;
  scope: string;
  acceptanceCriteria: string[];
  /** 完结时必须关联最终产物与验收记录 */
  finalArtifactRef?: ArtifactRef;
  status: RequirementDeliveryStatus;
}

export interface Participant {
  role: string;
  memberId: ID;
}

export interface InputRequirement {
  id: ID;
  nodeId: ID;
  description: string;
  necessity: Necessity;
  expectedForm: string;
  satisfyCondition: string;
  /** 这条要求为什么存在（锚定来源，避免接收方临时偏好被默认为上游责任） */
  basis?: string;
}

/**
 * 节点：可配置的抽象工作单元（核心可配置对象）。
 * 其 name / 参与者 / 输入要求 / 预期输出 / Agent / 规则 / 流水线 全部是数据。
 */
export interface Node {
  id: ID;
  projectId: ID;
  name: string;
  description: string;
  participants: Participant[];
  inputRequirements: InputRequirement[];
  expectedOutputs: string[];
  agentConfig: AgentConfig;
  processingRules: ProcessingRules;
  pipeline: PipelineStep[];
  executionStatus: NodeExecutionStatus;
}

export interface Relation {
  id: ID;
  projectId: ID;
  type: RelationType;
  fromNodeId: ID;
  toNodeId: ID;
  semantic?: string;
}

export interface ArtifactRef {
  artifactId: ID;
  version: number;
}

/** 产物：可引用、可验收的实际交付（版本化、不可变） */
export interface Artifact {
  id: ID;
  nodeId: ID;
  version: number;
  submitterId: ID;
  description: string;
  accessRef?: string;
  createdAt: string;
}

/** 事件：已发生的事实（与产物并行回传，PRD §4.2） */
export interface Event {
  id: ID;
  type: EventType;
  requirementId: ID;
  nodeId?: ID;
  artifactRef?: ArtifactRef;
  payload?: unknown;
  timestamp: string;
}

export interface HumanInterventionItem {
  id: ID;
  requirementId: ID;
  nodeId: ID;
  type: string;
  knownInfo: string;
  gap: string;
  basis: string;
  impact: string;
  targetRole?: string;
  targetMemberId?: ID;
  status: InterventionStatus;
}

export interface AcceptanceRecord {
  id: ID;
  artifactId: ID;
  version: number;
  acceptorId: ID;
  requirementIds: string[];
  verdict: AcceptanceVerdict;
  timestamp: string;
}

// ----------------------------------------------------------------------------
// 有效上下文（派生结构，PRD §2.3）
// ----------------------------------------------------------------------------

export interface ContextItem {
  kind: ProvenanceKind;
  content: string;
  /** 来源定位（如 artifact/event id + version），支持从总结定位原始依据 */
  sourceRef?: string;
}

export interface EffectiveContext {
  nodeId: ID;
  goalAndScope: ContextItem[];
  confirmedInputs: ContextItem[];
  decisions: ContextItem[];
  progress: ContextItem[];
  openIssues: ContextItem[];
  changes: ContextItem[];
  acceptanceCriteria: ContextItem[];
}

// ----------------------------------------------------------------------------
// 配置 schema 类型（第 2 层：声明式数据，用户可改）
// 这些形状属于模型层——它们是「配置的 schema」，config 层放「配置的实例」。
// ----------------------------------------------------------------------------

/** 不确定性策略可覆盖的 case（对应 PRD FR05 / D04） */
export type UncertaintyCase =
  | 'required_input_missing'
  | 'source_conflict'
  | 'key_rule_undefined'
  | 'tool_unreadable'
  | 'out_of_authorization';

export type UncertaintyAction = 'notify_human' | 'wait' | 'continue_with_assumption';

export interface UncertaintyStrategy {
  id: ID;
  defaultAction: UncertaintyAction;
  cases: Record<UncertaintyCase, UncertaintyAction>;
}

export interface ProcessingRules {
  requireInputsBeforeStart: boolean;
  onMissingCriticalInput: UncertaintyAction;
}

/** Agent 配置分三层：连接层（kernel）/ 节点职责层（rolePrompt）/ 权限层（tools/contextScope） */
export interface AgentConfig {
  kernel: string;
  rolePrompt: string;
  tools: string[];
  contextScope: string;
  uncertaintyStrategyId: ID;
}

export type PipelineStepType =
  | 'check_input'
  | 'agent_analyze'
  | 'tool_call'
  | 'human_confirm'
  | 'submit_artifact'
  | 'emit_event';

export interface PipelineStep {
  id: ID;
  type: PipelineStepType;
  config?: unknown;
}

export interface NotificationChannelConfig {
  channel: string;
  recipientRules: string;
  filters: string[];
}

// ----------------------------------------------------------------------------
// 退回（PRD §6.6 / FR06）
// ----------------------------------------------------------------------------

/** 退回类别：区分「既定未满足 / 需求未明确 / 新增要求」，避免直接归责上游 */
export type ReturnCategory = 'requirement_not_met' | 'requirement_unclear' | 'new_requirement';

export interface ReturnItem {
  requirementId: ID;
  evidence: string;
  impact: string;
  recheckCondition: string;
}

/**
 * 退回请求：Agent 生成草稿 → 人工批准后成为正式退回。
 * 未经批准的草稿不对外显示为正式退回（PRD 规则 6）。
 */
export interface ReturnRequest {
  id: ID;
  fromNodeId: ID;
  targetArtifactRef: ArtifactRef;
  category: ReturnCategory;
  items: ReturnItem[];
  status: 'draft' | 'approved';
  approvedBy?: ID;
  approvedAt?: string;
}

/** 创建节点用的定义（不含运行时才有的 id / executionStatus） */
export interface NodeDefinition {
  name: string;
  description: string;
  participants: Participant[];
  inputRequirements: Omit<InputRequirement, 'nodeId'>[];
  expectedOutputs: string[];
  agentConfig: AgentConfig;
  processingRules: ProcessingRules;
  pipeline: PipelineStep[];
}
