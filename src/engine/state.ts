// ============================================================================
// 状态机（PRD §7）
// ----------------------------------------------------------------------------
// 核心是区分「执行过程 / 输入就绪 / 产物是否被接受」三个维度。
// 节点执行与需求交付是显式状态；输入适配与接收方验收是从事实派生的结论。
// ============================================================================

import type {
  Node,
  NodeExecutionStatus,
  Requirement,
  RequirementDeliveryStatus,
} from '../model/index.ts';

/** 节点执行状态合法转移（本轮结束 ≠ 交付通过） */
const NODE_TRANSITIONS: Record<NodeExecutionStatus, NodeExecutionStatus[]> = {
  待开始: ['处理中', '已取消'],
  处理中: ['等待人工', '受阻', '暂停', '执行异常', '本轮结束'],
  等待人工: ['处理中', '本轮结束', '已取消'],
  受阻: ['处理中', '已取消'],
  暂停: ['处理中', '已取消'],
  执行异常: ['处理中', '本轮结束', '已取消'],
  本轮结束: ['处理中'],
  已取消: [],
};

/** 需求交付状态合法转移（完结必须关联最终产物 + 验收记录） */
const REQUIREMENT_TRANSITIONS: Record<RequirementDeliveryStatus, RequirementDeliveryStatus[]> = {
  草稿: ['进行中', '已取消'],
  进行中: ['待最终验收', '需修订', '已取消'],
  待最终验收: ['已完结', '需修订'],
  需修订: ['进行中', '已取消'],
  已完结: [],
  已取消: [],
};

export function canTransitionNode(from: NodeExecutionStatus, to: NodeExecutionStatus): boolean {
  return NODE_TRANSITIONS[from].includes(to);
}

export function transitionNode(node: Node, to: NodeExecutionStatus): Node {
  if (!canTransitionNode(node.executionStatus, to)) {
    throw new Error(`非法节点状态转移: ${node.executionStatus} → ${to} (${node.id})`);
  }
  return { ...node, executionStatus: to };
}

export function canTransitionRequirement(
  from: RequirementDeliveryStatus,
  to: RequirementDeliveryStatus,
): boolean {
  return REQUIREMENT_TRANSITIONS[from].includes(to);
}

export function transitionRequirement(
  req: Requirement,
  to: RequirementDeliveryStatus,
): Requirement {
  if (!canTransitionRequirement(req.status, to)) {
    throw new Error(`非法需求状态转移: ${req.status} → ${to} (${req.id})`);
  }
  return { ...req, status: to };
}
