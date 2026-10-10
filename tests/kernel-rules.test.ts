// ============================================================================
// 内核业务规则测试（零依赖断言，`node tests/kernel-rules.test.ts`）
// 覆盖：状态机 / FR05 人工介入 / FR06 退回与验收 / FR11 最终交付 / FR12 幂等与恢复
// ============================================================================

import { Kernel } from '../src/engine/index.ts';
import { exampleNodeDefinition } from '../src/config/index.ts';
import type { AgentContext, AgentKernel, Analysis } from '../src/extensions/index.ts';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed += 1; console.log('  \u2713 ' + msg); }
  else { failed += 1; console.error('  \u2717 ' + msg); }
}
function throws(fn: () => unknown, msg: string) {
  try { fn(); failed += 1; console.error('  \u2717 ' + msg + '（未抛错）'); }
  catch { passed += 1; console.log('  \u2713 ' + msg); }
}

// 始终报告缺口的 Agent（用于驱动人工介入流程）
const gapAgent: AgentKernel = {
  id: 'gap-agent',
  async analyze(ctx: AgentContext): Promise<Analysis> {
    return {
      satisfied: [],
      missing: ctx.inputRequirements.map((ir) => ({ requirementId: ir.id, what: ir.description, why: '无产物' })),
      conflicts: [],
      adaptable: [],
      openIssues: [{ fact: '缺少关键输入', suggestedOwner: '上游节点' }],
      impacts: [{ work: '阻塞', suggestion: '补充', recheckCondition: '复查' }],
    };
  },
};

function setup() {
  const k = new Kernel();
  const org = k.createOrganization('团队');
  const project = k.createProject(org.id, '项目');
  const req = k.createRequirement(project.id, {
    goal: '目标', creatorId: 'creator', deliveryTarget: '交付', scope: '范围', acceptanceCriteria: ['验收'],
  });
  k.transitionRequirement(req.id, '进行中');
  const upstream = k.createNode(project.id, {
    name: '上游节点', description: '输出材料', participants: [], inputRequirements: [], expectedOutputs: ['材料'],
    agentConfig: exampleNodeDefinition.agentConfig,
    processingRules: exampleNodeDefinition.processingRules,
    pipeline: [],
  });
  const downstream = k.createNode(project.id, exampleNodeDefinition);
  k.addRelation(project.id, 'dependency', upstream.id, downstream.id);
  return { k, org, project, req, upstream, downstream };
}

async function main() {
  console.log('== 状态机 ==');
  {
    const { k, downstream } = setup();
    k.transitionNode(downstream.id, '处理中');
    throws(() => k.transitionNode(downstream.id, '待开始'), '非法节点转移（处理中→待开始）抛错');
    k.transitionNode(downstream.id, '本轮结束');
    ok(k.store.requireNode(downstream.id).executionStatus === '本轮结束', '节点推进到本轮结束');
  }

  console.log('== FR05 人工介入（缺关键信息 → 补充 → 复查 → 解决）==');
  {
    const { k, downstream } = setup();
    const analysis = await k.analyzeNode(downstream.id, gapAgent);
    const raised = k.raiseInterventionsFromAnalysis(downstream.id, analysis);
    ok(raised.length === 1, '分析缺口生成 1 个人工介入项');
    ok(raised[0].status === '待处理', '介入项初始状态为待处理');
    const again = k.raiseInterventionsFromAnalysis(downstream.id, analysis);
    ok(again.length === 0, '重复分析不重复生成介入项（幂等）');
    k.answerIntervention(raised[0].id);
    ok(k.store.interventions.get(raised[0].id)?.status === '已补充', '补充后状态为已补充');
    k.recheckIntervention(raised[0].id);
    ok(k.store.interventions.get(raised[0].id)?.status === '复查中', '复查后状态为复查中');
    k.resolveIntervention(raised[0].id);
    ok(k.store.interventions.get(raised[0].id)?.status === '已解决', '最终已解决');
    throws(() => k.answerIntervention(raised[0].id), '已解决项再补充抛错');
  }

  console.log('== FR06 退回（草稿 → 人工批准，幂等）==');
  {
    const { k, downstream, upstream } = setup();
    const art = k.submitArtifact(upstream.id, 'u', '接口契约 v1');
    const draft = k.createReturnDraft({
      fromNodeId: downstream.id,
      targetArtifactRef: { artifactId: art.id, version: art.version },
      category: 'requirement_not_met',
      items: [{ requirementId: 'ir-api', evidence: '缺错误码', impact: '无法渲染', recheckCondition: '补齐后复查' }],
    });
    ok(draft.status === 'draft', '退回初始为草稿');
    ok(k.store.events.filter((e) => e.type === 'returned').length === 0, '草稿阶段无正式 returned 事件');
    const approved = k.approveReturn(draft.id, 'approver-1');
    ok(approved.status === 'approved', '批准后为正式退回');
    ok(k.store.events.filter((e) => e.type === 'returned').length === 1, '批准后产生 1 个 returned 事件');
    const approved2 = k.approveReturn(draft.id, 'approver-1');
    ok(approved2 === approved, '重复批准返回同一记录（幂等）');
    ok(k.store.events.filter((e) => e.type === 'returned').length === 1, '重复批准不产生重复事件');
  }

  console.log('== FR06/FR11 验收与最终交付 ==');
  {
    const { k, req, upstream } = setup();
    const art = k.submitArtifact(upstream.id, 'u', '最终产物 v1');
    throws(() => k.finalizeRequirement(req.id, { artifactId: art.id, version: art.version }, 'creator'), '无验收记录完结抛错');
    const rec = k.acceptArtifact({ artifactId: art.id, version: art.version, acceptorId: 'creator', requirementIds: [req.id], verdict: '已接受' });
    ok(rec.verdict === '已接受', '验收通过');
    k.acceptArtifact({ artifactId: art.id, version: art.version, acceptorId: 'creator', requirementIds: [req.id], verdict: '已接受' });
    const count = [...k.store.acceptances.values()].filter((a) => a.artifactId === art.id).length;
    ok(count === 1, '重复验收不新增记录（幂等）');
    const finalized = k.finalizeRequirement(req.id, { artifactId: art.id, version: art.version }, 'creator');
    ok(finalized.status === '已完结', '需求完结');
    ok(finalized.finalArtifactRef?.artifactId === art.id, '完结关联最终产物');
  }

  console.log('== FR12 记录与恢复 ==');
  {
    const { k, req, upstream, downstream } = setup();
    k.submitArtifact(upstream.id, 'u', '产物 v1');
    const analysis = await k.analyzeNode(downstream.id, gapAgent);
    k.raiseInterventionsFromAnalysis(downstream.id, analysis);
    const snap = k.snapshot();
    const k2 = new Kernel();
    k2.restore(snap);
    ok(k2.store.nodes.size === k.store.nodes.size, '恢复后节点数一致');
    ok(k2.store.events.length === k.store.events.length, '恢复后事件数一致');
    ok(k2.store.interventions.size === 1, '恢复后介入项保留');
    ok(
      k2.store.requirements.get(req.id)?.status === k.store.requirements.get(req.id)?.status,
      '恢复后需求状态一致',
    );
    // 恢复后新对象 id 不与历史冲突（继续创建节点应成功且 id 更大）
    const before = k2.store.nodes.size;
    k2.createNode(projectOf(k2), exampleNodeDefinition);
    ok(k2.store.nodes.size === before + 1, '恢复后可继续创建（id 计数器已抬升）');
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  if (failed > 0) process.exit(1);
}

function projectOf(k: Kernel): string {
  return [...k.store.projects.keys()][0];
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
