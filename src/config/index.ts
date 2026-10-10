// ============================================================================
// 配置实例（第 2 层 · 灵魂的载体）
// ----------------------------------------------------------------------------
// 这里放的是「配置的值」，证明领域能力是数据、不是代码。
// 新增一种节点类型 = 新增一份 NodeDefinition，内核零改动。
// ============================================================================

import type {
  AgentConfig,
  NodeDefinition,
  NotificationChannelConfig,
  ProcessingRules,
  UncertaintyStrategy,
} from '../model/index.ts';

/** 默认不确定性策略（对应 PRD C07：缺关键信息 → 通知人工） */
export const defaultUncertaintyStrategy: UncertaintyStrategy = {
  id: 'strategy-default',
  defaultAction: 'notify_human',
  cases: {
    required_input_missing: 'notify_human',
    source_conflict: 'notify_human',
    key_rule_undefined: 'notify_human',
    tool_unreadable: 'notify_human',
    out_of_authorization: 'notify_human',
  },
};

/** 默认处理规则 */
export const defaultProcessingRules: ProcessingRules = {
  requireInputsBeforeStart: true,
  onMissingCriticalInput: 'notify_human',
};

/** 默认 Agent 配置（kernel 是扩展点引用，换内核只改这一行） */
export const defaultAgentConfig: AgentConfig = {
  kernel: 'provider:demo',
  rolePrompt: '理解本节点目标与输入要求，分析依赖产物是否满足、缺失与冲突。',
  tools: [],
  contextScope: '本节点 + 直接依赖产物',
  uncertaintyStrategyId: 'strategy-default',
};

/**
 * 示例节点定义：一个「渲染节点」。
 * 内核不认识「渲染节点」是什么，只知道它是图上、带着输入要求与流水线的工作单元。
 */
export const exampleNodeDefinition: NodeDefinition = {
  name: '渲染节点',
  description: '把后端接口契约与设计资源渲染成可交付页面。',
  participants: [{ role: 'owner', memberId: 'member-render' }],
  inputRequirements: [
    {
      id: 'ir-api',
      description: '需要后端提供的接口契约',
      necessity: 'required',
      expectedForm: '文档 / 链接',
      satisfyCondition: '包含字段与错误码定义',
      basis: '与后端节点确认',
    },
    {
      id: 'ir-design',
      description: '需要设计提供的交互与资源',
      necessity: 'required',
      expectedForm: '文件 / 链接',
      satisfyCondition: '包含页面交互说明与切图资源',
      basis: '与设计节点确认',
    },
  ],
  expectedOutputs: ['可渲染页面资源'],
  agentConfig: defaultAgentConfig,
  processingRules: defaultProcessingRules,
  pipeline: [
    { id: 'p1', type: 'check_input' },
    { id: 'p2', type: 'agent_analyze' },
    { id: 'p3', type: 'human_confirm' },
    { id: 'p4', type: 'submit_artifact' },
  ],
};

/** 示例通知渠道（钉钉为明确接入目标，PRD C12） */
export const exampleNotificationChannels: NotificationChannelConfig[] = [
  {
    channel: 'dingtalk',
    recipientRules: '角色=节点责任人',
    filters: ['需要补充', '需要审批', '被退回', '最终成果待验收'],
  },
  {
    channel: 'web',
    recipientRules: '项目成员',
    filters: ['需要补充', '需要审批', '被退回', '最终成果待验收'],
  },
];
