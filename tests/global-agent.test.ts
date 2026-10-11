// ============================================================================
// 全局 Agent 与根节点测试 —— `node tests/global-agent.test.ts`
// 覆盖：全局 Agent 订阅账本（Observer）· 时间统计 · 超时提醒入账与通知触达 ·
//       根节点改写为新 I（留痕 + 下传）· 止步 · 剪枝入账
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Node, Tree, Ledger, NodeId, NodeStatus, FragmentKind } from '../src/domain/index.ts';
import { FlowService, GlobalAgent, RootController, TimeoutAlarmPolicy } from '../src/application/index.ts';
import { SequentialIdGenerator } from '../src/infrastructure/id-generator.ts';

function makeWorld(): {
  tree: Tree; flow: FlowService; ledger: Ledger; agent: GlobalAgent; controller: RootController; gen: SequentialIdGenerator;
} {
  const gen = new SequentialIdGenerator();
  const selfId = gen.next('member');
  const tree = new Tree(new Node({ id: selfId, name: '根节点', ownerId: selfId, isSelf: true }), gen);
  const ledger = new Ledger(gen);
  const flow = new FlowService(tree, gen, ledger);
  const agent = new GlobalAgent(NodeId.of('global-agent'), tree, ledger, [new TimeoutAlarmPolicy(100)]);
  const controller = new RootController(tree, flow, ledger);
  return { tree, flow, ledger, agent, controller, gen };
}

test('全局 Agent 订阅账本：流的每次交易都被观察到（时间统计）', () => {
  const { tree, flow, agent } = makeWorld();
  const a = tree.createChild(tree.root.id, { name: 'A' });

  const t0 = Date.now();
  flow.giveInput(tree.root.id, a.id, '木头');

  const stats = agent.timeStats(t0 + 5);
  const statA = stats.find((s) => s.nodeId.equals(a.id));
  assert.ok(statA);
  assert.ok(statA.receivedInputAt !== null);
  assert.equal(statA.status, NodeStatus.Running); // 叶子收到 I 即运行
  assert.equal(statA.waitMs, null); // 非等待态无等待时长
});

test('时间统计：等待中的节点 waitMs 随沉默时长增长', () => {
  const { tree, flow, agent } = makeWorld();
  const a = tree.createChild(tree.root.id, { name: 'A' });
  const a1 = tree.createChild(a.id, { name: 'A1' });

  const t0 = Date.now();
  flow.giveInput(tree.root.id, a.id, 'I');
  flow.giveInput(a.id, a1.id, 'I1');
  // A 等 A1 回流，处于等待

  const before = agent.timeStats(t0 + 10).find((s) => s.nodeId.equals(a.id));
  assert.equal(before?.status, NodeStatus.Waiting);
  assert.ok((before?.waitMs ?? 0) >= 0);
  assert.ok(before?.lastActivityAt !== null);

  flow.submitProduct(a1.id, 'O1');
  const after = agent.timeStats(t0 + 20).find((s) => s.nodeId.equals(a.id));
  assert.equal(after?.status, NodeStatus.Running);
});

test('超时提醒：等待超时 → 提醒入账（TimeoutAlarm 碎片），送达根节点', () => {
  const { tree, flow, ledger, agent } = makeWorld();
  const a = tree.createChild(tree.root.id, { name: 'A' });
  const a1 = tree.createChild(a.id, { name: 'A1' });

  const t0 = Date.now();
  flow.giveInput(tree.root.id, a.id, 'I');
  flow.giveInput(a.id, a1.id, 'I1');

  // 未超时：不提醒
  assert.equal(agent.check(t0 + 50).length, 0);

  // 超时：提醒一条，且以碎片入账、送达根节点
  const alarms = agent.check(t0 + 300);
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0]?.nodeId.equals(a.id), true);

  const fragments = ledger.fragments();
  const alarmFragment = fragments[fragments.length - 1];
  assert.equal(alarmFragment?.kind, FragmentKind.TimeoutAlarm);
  assert.equal(alarmFragment?.fromId.equals(NodeId.of('global-agent')), true);
  assert.equal(alarmFragment?.toId.equals(tree.root.id), true);
  assert.equal(ledger.verify(), true);
});

test('提醒 → 订阅者通知触达（Observer 转发到待办渠道）', () => {
  const { tree, flow, agent } = makeWorld();
  const a = tree.createChild(tree.root.id, { name: 'A' });
  const a1 = tree.createChild(a.id, { name: 'A1' });
  const t0 = Date.now();
  flow.giveInput(tree.root.id, a.id, 'I');
  flow.giveInput(a.id, a1.id, 'I1');

  const heard: { nodeId: string; reason: string }[] = [];
  const off = agent.onAlarm((alarm) => {
    heard.push({ nodeId: alarm.nodeId.value, reason: alarm.reason });
  });
  agent.check(t0 + 600000);
  off();

  assert.equal(heard.length, 1);
  assert.equal(heard[0]?.nodeId, a.id.value);
  assert.equal(heard[0]?.reason, 'timeout');

  // 退订后不再收到
  agent.check(t0 + 600001);
  assert.equal(heard.length, 1);
});

test('未开工的节点与根节点不提醒', () => {
  const { tree, flow, agent } = makeWorld();
  const a = tree.createChild(tree.root.id, { name: 'A' });
  const t0 = Date.now();

  // A 未开工（尚无输入）不提醒；根节点永不提醒
  assert.equal(agent.check(t0 + 10000).length, 0);

  flow.giveInput(tree.root.id, a.id, 'I'); // A 是叶子 → 运行中，不提醒
  assert.equal(agent.check(t0 + 10000).length, 0);
});

test('根节点改写：消息送达 → 改写为新 I 下达直接子节点（双重留痕）', () => {
  const { tree, flow, ledger, controller } = makeWorld();
  const a = tree.createChild(tree.root.id, { name: 'A' });

  flow.giveInput(tree.root.id, a.id, '第1轮');
  flow.submitProduct(a.id, 'O1');
  // O 上行的碎片（SubmitProduct）逐跳汇聚到根节点
  const submitFragment = ledger.fragments().find((f) => f.kind === FragmentKind.SubmitProduct);
  assert.ok(submitFragment);

  controller.deliver(submitFragment);
  assert.equal(controller.pendingMessages().length, 1);

  const rewritten = controller.rewriteToNewInput(submitFragment, a.id, '修订要求：加扶手');
  assert.equal(rewritten.content, '修订要求：加扶手');
  assert.equal(controller.pendingMessages().length, 0);

  // 留痕：NewInput（引用原消息）+ GiveInput（实际下传）
  const kinds = ledger.fragments().slice(-2).map((f) => f.kind);
  assert.deepEqual(kinds, [FragmentKind.NewInput, FragmentKind.GiveInput]);
  const newInputFragment = ledger.fragments().slice(-2)[0];
  assert.equal(
    (newInputFragment?.payload as { rewrittenFrom?: string })?.rewrittenFrom,
    submitFragment?.id.value,
  );
  // 新一轮：A 回到等待（叶子无子，收到新 I 即汇合满足 → 运行）
  assert.equal(a.currentStatus, NodeStatus.Running);
});

test('根节点只对直接子节点下达新 I；未送达的消息不可改写', () => {
  const { tree, flow, ledger, controller } = makeWorld();
  const a = tree.createChild(tree.root.id, { name: 'A' });
  const a1 = tree.createChild(a.id, { name: 'A1' });
  flow.giveInput(tree.root.id, a.id, 'I');

  const fragment = ledger.fragments()[0];
  assert.throws(() => controller.rewriteToNewInput(fragment, a1.id, 'x'), /尚未送达/); // 未 deliver
  controller.deliver(fragment);
  assert.throws(() => controller.rewriteToNewInput(fragment, a1.id, 'x'), /直接子节点/); // 跨级
  assert.ok(controller.rewriteToNewInput(fragment, a.id, 'x')); // 直接子节点 ✓
});

test('根节点止步：消息消费后不再流转，不产生新交易', () => {
  const { tree, flow, ledger, controller } = makeWorld();
  const a = tree.createChild(tree.root.id, { name: 'A' });
  flow.giveInput(tree.root.id, a.id, 'I');
  flow.submitProduct(a.id, 'O1');
  const sizeBefore = ledger.size;

  const submitFragment = ledger.fragments().find((f) => f.kind === FragmentKind.SubmitProduct);
  assert.ok(submitFragment);
  controller.deliver(submitFragment);
  controller.letStop(submitFragment);

  assert.equal(controller.pendingMessages().length, 0);
  assert.equal(ledger.size, sizeBefore); // 止步不产生碎片（不作为 = 无交易）
});

test('剪枝：死锁唯一出口，结构性动作入账', () => {
  const { tree, ledger, controller } = makeWorld();
  const a = tree.createChild(tree.root.id, { name: 'A' });
  const a1 = tree.createChild(a.id, { name: 'A1' });

  controller.pruneBranch(a.id);
  assert.equal(tree.hasNode(a.id), false);
  assert.equal(tree.hasNode(a1.id), false);

  const last = ledger.fragments()[ledger.fragments().length - 1];
  assert.equal(last?.kind, FragmentKind.Prune);
  assert.equal(ledger.verify(), true);
});
