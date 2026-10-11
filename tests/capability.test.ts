// ============================================================================
// 能力测试 —— `node tests/capability.test.ts`
// 覆盖：节点能力执行（Agent→产出 O）· 运行态守卫 · 内核未注册报错 ·
//       SKILL 组合注入上下文 · CI-CD 动作执行/失败 · 待办为记录 · SkillLoader
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Node, Tree, Ledger, NodeId, NodeStatus, Skill } from '../src/domain/index.ts';
import { FlowService, CapabilityService } from '../src/application/index.ts';
import { SequentialIdGenerator } from '../src/infrastructure/id-generator.ts';
import { DemoAgentKernel } from '../src/infrastructure/agents/demo-agent.ts';
import { SkillLoader } from '../src/infrastructure/skill-loader.ts';
import { TodoNotifier } from '../src/infrastructure/notifiers/todo-notifier.ts';

function makeWorld(goal?: string): {
  tree: Tree; flow: FlowService; caps: CapabilityService; ledger: Ledger; gen: SequentialIdGenerator;
} {
  const gen = new SequentialIdGenerator();
  const selfId = gen.next('member');
  const tree = new Tree(new Node({ id: selfId, name: '皇帝', ownerId: selfId, isSelf: true }), gen, { goal });
  const ledger = new Ledger(gen);
  const flow = new FlowService(tree, gen, ledger);
  const caps = new CapabilityService(tree, flow);
  caps.registerAgent(new DemoAgentKernel());
  return { tree, flow, caps, ledger, gen };
}

test('节点能力执行：运行态 → Agent 产出 → O 版本化自动上行', async () => {
  const { tree, flow, caps } = makeWorld('交付一把椅子');
  const a = tree.createChild(tree.root.id, { name: '木工' });

  flow.giveInput(tree.root.id, a.id, '木头');
  assert.equal(a.currentStatus, NodeStatus.Running);

  const product = await caps.runNode(a.id);
  assert.equal(product.version, 1);
  assert.match(String(product.content), /木工 完成产出/);
  assert.match(String(product.content), /输入 1 项/);
});

test('目标与范围进入 Agent 上下文（根提出的 goal）', async () => {
  const { tree, flow, caps } = makeWorld('交付一把椅子');
  const a = tree.createChild(tree.root.id, { name: '木工', description: '负责加工木头' });
  flow.giveInput(tree.root.id, a.id, '木头');

  const product = await caps.runNode(a.id);
  assert.match(String(product.content), /木工/); // 输出基于上下文生成
  // 上下文目标：用自定义内核验证 goal 确实注入
  const seen: string[] = [];
  caps.registerAgent({
    id: 'spy',
    async act(ctx) {
      seen.push(...ctx.goalAndScope);
      return { output: ctx.goalAndScope.join(' / ') };
    },
  });
  const b = tree.createChild(tree.root.id, { name: 'B', capabilities: { agentKernel: 'spy' } });
  flow.giveInput(tree.root.id, b.id, 'x');
  const p2 = await caps.runNode(b.id);
  assert.equal(p2.content, '交付一把椅子');
});

test('守卫：非运行态不可执行；未注册内核报错', async () => {
  const { tree, flow, caps } = makeWorld();
  const a = tree.createChild(tree.root.id, { name: 'A' });
  await assert.rejects(() => caps.runNode(a.id), /不在运行态/); // 等待态

  const b = tree.createChild(tree.root.id, { name: 'B', capabilities: { agentKernel: '不存在的内核' } });
  flow.giveInput(tree.root.id, b.id, 'x'); // 叶子 → 运行
  await assert.rejects(() => caps.runNode(b.id), /未注册 Agent 内核/);
});

test('SKILL 组合：节点引用的技能注入 Agent 上下文', async () => {
  const { tree, flow, caps } = makeWorld();
  caps.registerSkill(new Skill({ id: 'woodwork', content: '# 木工技能\n榫卯工艺要点' }));
  const a = tree.createChild(tree.root.id, {
    name: '木工',
    capabilities: { agentKernel: 'demo', skills: ['woodwork'] },
  });
  flow.giveInput(tree.root.id, a.id, '木头');

  const product = await caps.runNode(a.id);
  assert.match(String(product.content), /技能 1 项/);
});

test('动作执行器（CI-CD 抽象）：执行成功并入账；失败阻断产出', async () => {
  const { tree, flow, caps, ledger } = makeWorld();
  const calls: string[] = [];
  caps.registerExecutor({
    id: 'ci-check',
    async execute(action) {
      calls.push(String(action.input));
      return { ok: true, output: '检查通过' };
    },
  });
  const a = tree.createChild(tree.root.id, { name: '研发', capabilities: { actions: ['ci-check'] } });
  flow.giveInput(tree.root.id, a.id, '需求');
  const before = ledger.size;

  const product = await caps.runNode(a.id);
  assert.equal(product.version, 1);
  assert.equal(calls.length, 1); // 动作被调用
  assert.ok(ledger.size > before); // 产出已入账

  // 失败的动作阻断产出
  caps.registerExecutor({
    id: 'ci-fail',
    async execute() { return { ok: false, error: '构建失败' }; },
  });
  const b = tree.createChild(tree.root.id, { name: '研发B', capabilities: { actions: ['ci-fail'] } });
  flow.giveInput(tree.root.id, b.id, '需求');
  await assert.rejects(() => caps.runNode(b.id), /动作失败/);
  assert.equal(flow.productsOf(b.id).length, 0); // 未产出
});

test('待办为记录：TodoNotifier 记录完整且可累积', async () => {
  const { caps } = makeWorld();
  const todo = new TodoNotifier();
  caps.registerNotifier(todo);

  const r1 = await caps.notify('todo', { to: '木工', title: '需要审批', body: '请确认产物' });
  const r2 = await caps.notify('todo', { to: '木工', title: '被退回', body: '补充说明' });
  assert.equal(r1.ok, true);
  assert.equal(todo.todos.length, 2);
  assert.equal(todo.todos[0]?.to, '木工');
  assert.equal(todo.todos[1]?.title, '被退回');
  // 未注册渠道：失败可见
  const r3 = await caps.notify('dingtalk', { to: 'x', title: 't', body: 'b' });
  assert.equal(r3.ok, false);
});

test('SkillLoader：目录中的 .md 文件加载为 Skill（id=文件名）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-workflow-skills-'));
  try {
    writeFileSync(join(dir, 'woodwork.md'), '# 木工\n榫卯');
    writeFileSync(join(dir, 'review.md'), '# 评审\n要点');
    writeFileSync(join(dir, 'notes.txt'), '不是技能');

    const skills = new SkillLoader().load(dir);
    assert.equal(skills.length, 2);
    const byId = new Map(skills.map((s) => [s.id, s]));
    assert.equal(byId.get('woodwork')?.content, '# 木工\n榫卯');
    assert.equal(byId.get('review')?.content, '# 评审\n要点');
    assert.equal(byId.has('notes'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
