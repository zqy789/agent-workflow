// ============================================================================
// FR01 权限（组织隔离）+ FR07 宏观看板测试 —— `node tests/permission-summary.test.ts`
// ============================================================================

import { Kernel } from '../src/engine/index.ts';
import { InMemoryIdentityProvider, OrgIsolationPermissionEvaluator } from '../src/extensions/builtin/permission.ts';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed += 1; console.log('  \u2713 ' + msg); }
  else { failed += 1; console.error('  \u2717 ' + msg); }
}

const base = {
  agentConfig: { kernel: 'demo-agent', rolePrompt: '', tools: [], contextScope: '', uncertaintyStrategyId: '' },
  processingRules: { requireInputsBeforeStart: true, onMissingCriticalInput: 'notify_human' },
  pipeline: [],
};

async function main() {
  const k = new Kernel();
  const orgA = k.createOrganization('组织A');
  const orgB = k.createOrganization('组织B');
  const a1 = k.addMember(orgA.id, '成员A1');
  const b1 = k.addMember(orgB.id, '成员B1');

  const identity = new InMemoryIdentityProvider(k.store);
  const permission = new OrgIsolationPermissionEvaluator(k.store, identity);

  console.log('== FR01 身份与组织数据隔离 ==');
  const m = await identity.resolveMember(a1.id);
  ok(m?.id === a1.id && m?.orgId === orgA.id, 'IdentityProvider 解析成员');
  ok((await identity.resolveMember('nope')) === null, '未知成员返回 null');

  const project = k.createProject(orgA.id, 'A项目');
  ok((await permission.can(a1.id, 'read', project.id)) === true, '同组织成员可访问');
  ok((await permission.can(b1.id, 'read', project.id)) === false, '跨组织成员被隔离');
  ok((await permission.can('nope', 'read', project.id)) === false, '未知成员被拒绝');

  console.log('== FR07 项目宏观看板 ==');
  const req = k.createRequirement(project.id, {
    goal: '交付页面', creatorId: a1.id, deliveryTarget: '页面', scope: '一期', acceptanceCriteria: ['可访问'],
  });
  k.transitionRequirement(req.id, '进行中');
  const upstream = k.createNode(project.id, { name: '上游', description: '输出材料', participants: [], inputRequirements: [], expectedOutputs: ['材料'], ...base });
  const downstream = k.createNode(project.id, { name: '下游', description: '消费材料', participants: [], inputRequirements: [], expectedOutputs: ['产物'], ...base });
  k.addRelation(project.id, 'dependency', upstream.id, downstream.id);
  k.submitArtifact(upstream.id, a1.id, '产物 v1');
  k.transitionNode(downstream.id, '处理中');
  k.transitionNode(downstream.id, '等待人工');

  const summary = k.summarizeProject(project.id);
  ok(summary.name === 'A项目', '汇总含项目名');
  ok(summary.requirements.length === 1 && summary.requirements[0].status === '进行中', '汇总含需求状态');
  ok(summary.nodes.length === 2, '汇总含节点');
  ok(summary.blockers.some((b: any) => b.type === 'node' && b.nodeId === downstream.id && b.status === '等待人工'), '汇总识别等待人工阻塞');
  ok(summary.artifactCount === 1, '汇总含产物计数');
  ok(summary.recentEvents.length >= 1, '汇总含最近事件');

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
