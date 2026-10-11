// ============================================================================
// 流引擎测试 —— `node tests/flow.test.ts`
// 覆盖：I 只可父传子（相邻+方向）· I 可改写 · O 版本化不可篡改 · 根不产产物
//       全等汇合（事实驱动的等待→运行）· 新 I = 新一轮（完成→等待）
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Node, Tree, NodeStatus, Ledger } from '../src/domain/index.ts';
import { FlowService } from '../src/application/index.ts';
import { SequentialIdGenerator } from '../src/infrastructure/id-generator.ts';

function selfNode(gen: SequentialIdGenerator, name = '我'): Node {
  const id = gen.next('member');
  return new Node({ id, name, ownerId: id, isSelf: true });
}

function makeWorld(): { tree: Tree; flow: FlowService; ledger: Ledger } {
  const gen = new SequentialIdGenerator();
  const tree = new Tree(selfNode(gen), gen);
  const ledger = new Ledger(gen);
  return { tree, flow: new FlowService(tree, gen, ledger), ledger };
}

// ------------------------------------------------------------------ I 下传
test('I 只能由父传给子：兄弟 / 跨级 / 反向均拒绝', () => {
  const { tree, flow } = makeWorld();
  const a = tree.createChild(tree.root.id, { name: 'A' });
  const b = tree.createChild(tree.root.id, { name: 'B' });
  const a1 = tree.createChild(a.id, { name: 'A1' });

  flow.giveInput(tree.root.id, a.id, '木头'); // 父→子 ✓
  assert.equal(flow.inputsOf(a.id).length, 1);

  assert.throws(() => flow.giveInput(a.id, tree.root.id, 'x'), /只能由父传给子/); // 反向
  assert.throws(() => flow.giveInput(a.id, b.id, 'x'), /只能由父传给子/); // 兄弟
  assert.throws(() => flow.giveInput(tree.root.id, a1.id, 'x'), /只能由父传给子/); // 跨级
});

test('I 可改写：每级向下传递的内容由给出方决定', () => {
  const { tree, flow } = makeWorld();
  const a = tree.createChild(tree.root.id, { name: 'A' });
  const a1 = tree.createChild(a.id, { name: 'A1' });

  flow.giveInput(tree.root.id, a.id, '木头');
  // A 基于自己的理解加工后下传（I 可篡改）
  flow.giveInput(a.id, a1.id, '加工后的木头：劈成板材');

  const received = flow.inputsOf(a1.id);
  assert.equal(received.length, 1);
  assert.equal(received[0]?.content, '加工后的木头：劈成板材');
});

// ------------------------------------------------------------------ O 上行
test('O 版本化追加：修订 = 新版本，旧版本内容不变（不可篡改）', () => {
  const { tree, flow } = makeWorld();
  const a = tree.createChild(tree.root.id, { name: 'A' });

  const v1 = flow.submitProduct(a.id, '椅子 v1 毛坯');
  const v2 = flow.submitProduct(a.id, '椅子 v2 精修');

  assert.equal(v1.version, 1);
  assert.equal(v2.version, 2);
  assert.equal(v1.content, '椅子 v1 毛坯'); // 旧版本原样保留
  assert.equal(v2.content, '椅子 v2 精修');
  assert.equal(flow.productsOf(a.id).length, 2);
  assert.equal(flow.latestProductOf(a.id)?.version, 2);
});

test('根不产生产物：根提出目标并收回成果', () => {
  const { tree, flow } = makeWorld();
  assert.throws(() => flow.submitProduct(tree.root.id, 'x'), /根不产生产物/);
});

// ------------------------------------------------------------------ 全等汇合
test('全等汇合：等全部分支回流后才 等待 → 运行', () => {
  const { tree, flow } = makeWorld();
  const a = tree.createChild(tree.root.id, { name: 'A' });
  const a1 = tree.createChild(a.id, { name: 'A1' });
  const a2 = tree.createChild(a.id, { name: 'A2' });

  flow.giveInput(tree.root.id, a.id, 'I');
  flow.giveInput(a.id, a1.id, 'I1');
  flow.giveInput(a.id, a2.id, 'I2');

  assert.equal(flow.isJoinSatisfied(a.id), false); // A1/A2 尚未回流
  assert.equal(a.currentStatus, NodeStatus.Waiting);

  flow.submitProduct(a1.id, 'O1');
  assert.equal(flow.isJoinSatisfied(a.id), false); // 仍缺 A2
  assert.equal(a.currentStatus, NodeStatus.Waiting);

  flow.submitProduct(a2.id, 'O2');
  assert.equal(flow.isJoinSatisfied(a.id), true); // 全等
  assert.equal(a.currentStatus, NodeStatus.Running); // 事实驱动：等待 → 运行
});

test('叶子节点收到 I 即满足汇合，自动进入运行', () => {
  const { tree, flow } = makeWorld();
  const a = tree.createChild(tree.root.id, { name: 'A' });

  flow.giveInput(tree.root.id, a.id, 'I');
  assert.equal(flow.isJoinSatisfied(a.id), true);
  assert.equal(a.currentStatus, NodeStatus.Running);
});

test('新 I = 新一轮：完成 → 等待，旧轮产物不再满足本轮汇合', () => {
  const { tree, flow } = makeWorld();
  const a = tree.createChild(tree.root.id, { name: 'A' });
  const a1 = tree.createChild(a.id, { name: 'A1' });

  flow.giveInput(tree.root.id, a.id, '第1轮 I');
  flow.giveInput(a.id, a1.id, 'I1');
  flow.submitProduct(a1.id, 'O1');
  assert.equal(a.currentStatus, NodeStatus.Running); // 第1轮汇合满足

  a.transition(NodeStatus.Done); // 第1轮完成（验收在后续步骤）
  flow.giveInput(tree.root.id, a.id, '第2轮 I'); // 新 I 到达
  assert.equal(a.currentStatus, NodeStatus.Waiting); // 完成 → 等待
  assert.equal(flow.isJoinSatisfied(a.id), false); // A1 的旧产物属于上一轮
  flow.submitProduct(a1.id, 'O2'); // A1 新一轮回流
  assert.equal(flow.isJoinSatisfied(a.id), true);
  assert.equal(a.currentStatus, NodeStatus.Running);
});
