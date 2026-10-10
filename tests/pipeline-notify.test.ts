// ============================================================================
// 流水线（FR10）与通知（FR08）测试 —— `node tests/pipeline-notify.test.ts`
// 覆盖：完整流水线 / 等待点恢复 / 自定义步骤扩展点 / 通知触达
// ============================================================================

import { Kernel } from '../src/engine/index.ts';
import { TodoNotifier } from '../src/extensions/builtin/todo-notifier.ts';
import type { NodeDefinition, PipelineStep } from '../src/model/index.ts';
import type {
  AgentContext,
  AgentKernel,
  Analysis,
  PipelineStepExecutor,
} from '../src/extensions/index.ts';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed += 1; console.log('  \u2713 ' + msg); }
  else { failed += 1; console.error('  \u2717 ' + msg); }
}

const happyAgent: AgentKernel = {
  id: 'happy-agent',
  async analyze(_ctx: AgentContext): Promise<Analysis> {
    return { satisfied: [], missing: [], conflicts: [], adaptable: [], openIssues: [], impacts: [] };
  },
};

function nodeDef(pipeline: PipelineStep[], name = '工作节点'): NodeDefinition {
  return {
    name,
    description: '测试节点',
    participants: [],
    inputRequirements: [],
    expectedOutputs: ['产物'],
    agentConfig: { kernel: 'happy-agent', rolePrompt: '', tools: [], contextScope: '', uncertaintyStrategyId: '' },
    processingRules: { requireInputsBeforeStart: true, onMissingCriticalInput: 'notify_human' },
    pipeline,
  };
}

function setup() {
  const k = new Kernel();
  k.registerAgentKernel(happyAgent);
  const org = k.createOrganization('团队');
  const project = k.createProject(org.id, '项目');
  const req = k.createRequirement(project.id, {
    goal: '目标', creatorId: 'c', deliveryTarget: '交付', scope: '范围', acceptanceCriteria: ['验收'],
  });
  k.transitionRequirement(req.id, '进行中');
  return { k, org, project, req };
}

async function main() {
  console.log('== FR10 完整流水线（check_input → agent_analyze → submit_artifact → emit_event）==');
  {
    const { k, project } = setup();
    const node = k.createNode(project.id, nodeDef([
      { id: 's1', type: 'check_input' },
      { id: 's2', type: 'agent_analyze' },
      { id: 's3', type: 'submit_artifact', config: { description: '交付物 v1', submitterId: 'worker' } },
      { id: 's4', type: 'emit_event' },
    ]));
    const res = await k.runPipeline(node.id);
    ok(res.status === 'done', '流水线完整执行到 done');
    ok(k.store.artifactsOf(node.id).length === 1, 'submit_artifact 提交了 1 个产物');
    ok(k.store.events.some((e) => e.type === 'submitted' && e.nodeId === node.id), '产生 submitted 事件');
    ok(k.store.pipelineProgress.get(node.id)?.status === 'done', '流水线进度为 done');
  }

  console.log('== FR10 等待点恢复（human_confirm 阻断 → 人工解决 → 继续）==');
  {
    const { k, project } = setup();
    const todo = new TodoNotifier();
    k.registerNotifier(todo);
    const node = k.createNode(project.id, nodeDef([
      { id: 'c1', type: 'human_confirm', config: { prompt: '请确认提交' } },
      { id: 'c2', type: 'emit_event' },
    ]));
    const r1 = await k.runStep(node.id);
    ok(r1.wait === true, 'human_confirm 步骤等待人工');
    ok(k.store.requireNode(node.id).executionStatus === '等待人工', '节点进入等待人工');
    ok(todo.todos.length === 1, '发出 1 条待办通知');
    const it = [...k.store.interventions.values()][0];
    ok(it?.type === 'human_confirm', '生成 human_confirm 介入项');
    k.answerIntervention(it.id);
    k.resolveIntervention(it.id);
    const r2 = await k.runStep(node.id);
    ok(r2.ok === true && !r2.wait, '解决后 human_confirm 通过');
    await k.runStep(node.id); // emit_event
    await k.runStep(node.id); // 收尾
    ok(k.store.pipelineProgress.get(node.id)?.status === 'done', '等待后恢复并完成流水线');
  }

  console.log('== FR10 自定义步骤（扩展点：新增步骤类型不改内核）==');
  {
    const { k, project } = setup();
    const calls: string[] = [];
    const customStep: PipelineStepExecutor = {
      id: 'log_step',
      async execute(step, ctx) {
        calls.push(`${step.id}:${String(ctx.facts)}`);
        return { ok: true, output: `logged ${step.id}` };
      },
    };
    k.registerStepExecutor(customStep);
    const node = k.createNode(project.id, nodeDef([{ id: 'x1', type: 'log_step', config: { msg: 'hi' } }]));
    const res = await k.runPipeline(node.id);
    ok(res.status === 'done', '自定义步骤流水线完成');
    ok(calls.length === 1, '自定义执行器被调用 1 次');
    ok(calls[0].includes('x1'), '自定义执行器收到步骤 id');
  }

  console.log('== FR08 通知（缺依赖 → 需要补充通知 → 补充后恢复）==');
  {
    const { k, project } = setup();
    const todo = new TodoNotifier();
    k.registerNotifier(todo);
    const up = k.createNode(project.id, nodeDef([], '上游节点'));
    const work = k.createNode(project.id, nodeDef([{ id: 'c1', type: 'check_input' }], '工作节点'));
    k.addRelation(project.id, 'dependency', up.id, work.id);
    const r1 = await k.runStep(work.id);
    ok(r1.wait === true, '缺依赖产物时 check_input 等待');
    ok(k.store.requireNode(work.id).executionStatus === '等待人工', '节点进入等待人工');
    ok(todo.todos.some((t) => t.title === '需要补充'), '发出「需要补充」通知');
    k.submitArtifact(up.id, 'u', '产物 v1');
    const r2 = await k.runStep(work.id);
    ok(r2.ok === true && !r2.wait, '补充后 check_input 通过并恢复');
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
