// ============================================================================
// 树内核测试 —— `node tests/tree-kernel.test.ts`
// 覆盖：三态转移 · 相邻律 · 只能向下建 · 唯一父/不可自环 · 可见性继承与覆盖
//       「自己」节点不可动 · 剪枝 · 加入上司节点 · 多树共存 · ID 唯一
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Node, Tree, Forest } from '../src/domain/index.ts';
import { NodeId, NodeStatus, Visibility } from '../src/domain/index.ts';
import { SequentialIdGenerator } from '../src/infrastructure/id-generator.ts';

// ------------------------------------------------------------------ 夹具
function selfNode(gen: SequentialIdGenerator, name = '我'): Node {
  const id = gen.next('member');
  return new Node({ id, name, ownerId: id, isSelf: true });
}

function makeTree(): { tree: Tree; gen: SequentialIdGenerator } {
  const gen = new SequentialIdGenerator();
  const tree = new Tree(selfNode(gen), gen);
  return { tree, gen };
}

// ------------------------------------------------------------------ 结构
test('树的根必须是「自己」节点', () => {
  const gen = new SequentialIdGenerator();
  const ordinary = new Node({
    id: gen.next('node'), name: '普通节点', ownerId: NodeId.of('member-x'),
  });
  assert.throws(() => new Tree(ordinary, gen), /根必须是/);
});

test('只能向下建：子节点挂到父之下，可继续开叉', () => {
  const { tree } = makeTree();
  const a = tree.createChild(tree.root.id, { name: '节点A' });
  const b = tree.createChild(tree.root.id, { name: '节点B' });
  const a1 = tree.createChild(a.id, { name: '节点A1' });

  assert.equal(a.parent?.id.equals(tree.root.id), true);
  assert.equal(b.parent?.id.equals(tree.root.id), true);
  assert.equal(a1.parent?.id.equals(a.id), true);
  assert.equal(tree.root.hasChild(a.id), true);
  assert.equal(tree.size, 4);
  assert.throws(() => tree.createChild(NodeId.of('不存在的节点'), { name: 'x' }), /节点不存在/);
});

test('相邻律的唯一裁判：父子相邻，兄弟/跨级不相邻', () => {
  const { tree } = makeTree();
  const a = tree.createChild(tree.root.id, { name: 'A' });
  const b = tree.createChild(tree.root.id, { name: 'B' });
  const a1 = tree.createChild(a.id, { name: 'A1' });

  assert.equal(tree.isAdjacent(tree.root.id, a.id), true);
  assert.equal(tree.isAdjacent(a.id, a1.id), true);
  assert.equal(tree.isAdjacent(tree.root.id, b.id), true);
  // 兄弟不相邻：A 与 B 不能直接联系
  assert.equal(tree.isAdjacent(a.id, b.id), false);
  // 跨级不相邻：根与 A1 必须逐跳
  assert.equal(tree.isAdjacent(tree.root.id, a1.id), false);
  assert.equal(tree.isAdjacent(tree.root.id, NodeId.of('树外节点')), false);
});

test('唯一父与不可自环', () => {
  const { tree } = makeTree();
  const a = tree.createChild(tree.root.id, { name: 'A' });
  const b = tree.createChild(tree.root.id, { name: 'B' });

  assert.throws(() => a.attachChild(a), /不可自环/);
  assert.throws(() => b.attachChild(a), /已有父/);
  assert.throws(() => a.attachChild(tree.root), /不可成环/); // 根是 a 的祖先
});

test('可见性：默认私有，子继承父，可覆盖，仅创建者可改', () => {
  const { tree } = makeTree();
  const me = tree.root;
  const a = tree.createChild(me.id, { name: 'A' });
  assert.equal(a.currentVisibility, Visibility.Private); // 默认私有

  me.changeVisibility(Visibility.Public, me.ownerId);
  const b = tree.createChild(me.id, { name: 'B' });
  assert.equal(b.currentVisibility, Visibility.Public); // 子默认继承父

  // 子可单独覆盖
  b.changeVisibility(Visibility.Private, b.ownerId);
  assert.equal(b.currentVisibility, Visibility.Private);
  assert.equal(a.currentVisibility, Visibility.Private); // 不追溯级联

  // 非创建者不可改
  const outsider = NodeId.of('outsider');
  assert.throws(() => a.changeVisibility(Visibility.Public, outsider), /仅节点创建者/);
});

test('三态转移：四条合法路径 + 非法转移拦截', () => {
  const { tree } = makeTree();
  const a = tree.createChild(tree.root.id, { name: 'A' });
  assert.equal(a.currentStatus, NodeStatus.Waiting);

  a.transition(NodeStatus.Running);   // 等待 → 运行
  assert.equal(a.currentStatus, NodeStatus.Running);
  a.transition(NodeStatus.Done);      // 运行 → 完成
  assert.equal(a.currentStatus, NodeStatus.Done);
  a.transition(NodeStatus.Waiting);   // 完成 → 等待（新 I 到达）
  assert.equal(a.currentStatus, NodeStatus.Waiting);

  a.transition(NodeStatus.Running);
  a.transition(NodeStatus.Waiting);   // 运行 → 等待（打回/超时）
  assert.equal(a.currentStatus, NodeStatus.Waiting);

  // 非法：等待 → 完成（跳过运行）
  const fresh = tree.createChild(tree.root.id, { name: 'fresh' });
  assert.throws(() => fresh.transition(NodeStatus.Done), /非法状态转移/);
  // 非法：完成 → 运行（不可回退到运行）
  a.transition(NodeStatus.Running);
  a.transition(NodeStatus.Done);
  assert.throws(() => a.transition(NodeStatus.Running), /非法状态转移/);
  // 幂等：同态不抛错
  a.transition(NodeStatus.Done);
  assert.equal(a.currentStatus, NodeStatus.Done);
});

test('剪枝：移除整棵子树；「自己」节点不可剪', () => {
  const { tree } = makeTree();
  const a = tree.createChild(tree.root.id, { name: 'A' });
  const a1 = tree.createChild(a.id, { name: 'A1' });
  const b = tree.createChild(tree.root.id, { name: 'B' });

  tree.prune(a.id);
  assert.equal(tree.hasNode(a.id), false);
  assert.equal(tree.hasNode(a1.id), false);
  assert.equal(tree.hasNode(b.id), true);
  assert.equal(tree.root.hasChild(a.id), false);
  assert.equal(a.parent, null);

  assert.throws(() => tree.prune(tree.root.id), /不可剪枝/);
});

test('加入上司节点：子树并入他树，且不可成环', () => {
  const { tree: t1 } = makeTree();
  const superior = t1.createChild(t1.root.id, { name: '上司' });

  const gen2 = new SequentialIdGenerator(1000);
  const t2 = new Tree(selfNode(gen2, '同事'), gen2);
  const work = t2.createChild(t2.root.id, { name: '同事的工作节点' });

  t1.join(superior.id, t2.root); // 同事的「自己」节点加入上司节点之下
  assert.equal(t2.root.parent?.id.equals(superior.id), true);
  assert.equal(t1.hasNode(work.id), true); // 整棵子树并入
  assert.equal(t1.isAdjacent(superior.id, t2.root.id), true);

  // 成环防护（Node 级）：把祖先挂到后代之下
  assert.throws(() => work.attachChild(t1.root), /不可成环/);
  // 已在树中，不可重复加入
  assert.throws(() => t1.join(superior.id, t2.root), /已在本树/);
});

test('多树共存：Forest 定位节点所属树', () => {
  const forest = new Forest();
  const gen1 = new SequentialIdGenerator();
  const t1 = new Tree(selfNode(gen1, '我·甲组织'), gen1);
  const gen2 = new SequentialIdGenerator(100);
  const t2 = new Tree(selfNode(gen2, '我·乙组织'), gen2);
  forest.plant(t1);
  forest.plant(t2);

  const nodeInT1 = t1.createChild(t1.root.id, { name: '甲的工作' });
  assert.equal(forest.treeCount, 2);
  assert.equal(forest.treeOf(nodeInT1.id), t1);
  assert.equal(forest.treeOf(t2.root.id), t2);
  assert.equal(forest.treeOf(NodeId.of('无归属')), undefined);

  assert.throws(() => forest.plant(t1), /已存在/); // 根 ID 全局唯一
});

test('ID 生成唯一且不可为空', () => {
  const gen = new SequentialIdGenerator();
  const ids = new Set<string>();
  for (let i = 0; i < 100; i += 1) ids.add(gen.next('node').value);
  assert.equal(ids.size, 100);
  assert.throws(() => NodeId.of(''), /不能为空/);
  assert.equal(NodeId.of('a').equals(NodeId.of('a')), true);
  assert.equal(NodeId.of('a').equals(NodeId.of('b')), false);
});
