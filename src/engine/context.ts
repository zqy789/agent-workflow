// ============================================================================
// 有效上下文组织（PRD §2.3 / §5.3）
// ----------------------------------------------------------------------------
// 从「统一事实」按节点派生有效上下文，不要求单一大状态对象。
// 每个条目标注来源性质（原始材料 / 人工确认 / AI 分析 / 待确认 / 已失效）。
// ============================================================================

import type { ContextItem, EffectiveContext, ID } from '../model/index.ts';
import type { Store } from './store.ts';

export function organizeContext(store: Store, nodeId: ID): EffectiveContext {
  const node = store.requireNode(nodeId);
  const project = store.projects.get(node.projectId);
  const requirement = project?.requirementIds
    .map((id) => store.requirements.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))[0];

  const goalAndScope: ContextItem[] = [];
  if (requirement) {
    goalAndScope.push({ kind: '人工确认', content: `目标：${requirement.goal}`, sourceRef: `requirement:${requirement.id}` });
    goalAndScope.push({ kind: '人工确认', content: `范围：${requirement.scope}`, sourceRef: `requirement:${requirement.id}` });
  }
  goalAndScope.push({ kind: '人工确认', content: `本节点职责：${node.description}`, sourceRef: `node:${node.id}` });

  const confirmedInputs: ContextItem[] = node.inputRequirements.map((ir) => ({
    kind: '人工确认',
    content: `[${ir.necessity}] ${ir.description}（满足条件：${ir.satisfyCondition}）`,
    sourceRef: `inputRequirement:${ir.id}`,
  }));

  // 依赖产物的最新版本进入「已确认输入」，标注原始材料来源
  for (const depId of store.dependencies(nodeId)) {
    const latest = store.latestArtifact(depId);
    if (latest) {
      confirmedInputs.push({
        kind: '原始材料',
        content: `${depId} 的产物 v${latest.version}：${latest.description}`,
        sourceRef: `artifact:${latest.id}@${latest.version}`,
      });
    }
  }

  const decisions: ContextItem[] = store.events
    .filter((e) => e.type === 'approved' && (e.nodeId === nodeId || !e.nodeId))
    .map((e) => ({ kind: '人工确认', content: `已批准：${String(e.payload ?? '')}`, sourceRef: `event:${e.id}` }));

  const progress: ContextItem[] = store.events
    .filter((e) => e.nodeId === nodeId)
    .map((e) => ({ kind: '原始材料', content: `[${e.type}] ${String(e.payload ?? '')}`, sourceRef: `event:${e.id}` }));
  progress.unshift({ kind: '人工确认', content: `执行状态：${node.executionStatus}`, sourceRef: `node:${node.id}` });

  const openIssues: ContextItem[] = [...store.interventions.values()]
    .filter((it) => it.nodeId === nodeId && (it.status === '待处理' || it.status === '已补充' || it.status === '复查中'))
    .map((it) => ({ kind: '待确认', content: `[${it.type}] 缺口：${it.gap}；影响：${it.impact}`, sourceRef: `intervention:${it.id}` }));

  const changes: ContextItem[] = store.events
    .filter((e) => e.type === 'changed' || e.type === 'returned')
    .map((e) => ({ kind: '原始材料', content: `[${e.type}] ${String(e.payload ?? '')}`, sourceRef: `event:${e.id}` }));

  const acceptanceCriteria: ContextItem[] = (requirement?.acceptanceCriteria ?? []).map((c) => ({
    kind: '人工确认',
    content: c,
    sourceRef: `requirement:${requirement?.id}`,
  }));

  return { nodeId, goalAndScope, confirmedInputs, decisions, progress, openIssues, changes, acceptanceCriteria };
}
