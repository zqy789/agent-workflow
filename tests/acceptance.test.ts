// ============================================================================
// 验收测试 —— `node tests/acceptance.test.ts`
// 覆盖：逐级验收（严格祖先）· 三选一 · 必验位禁跳过 · 版本绑定 ·
//       打回终止该版本 · 新版本重新走全程 · 全程通过 → 完成 · 结论入账
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Node, Tree, Ledger, NodeId, NodeStatus, VerdictKind, FragmentKind } from '../src/domain/index.ts';
import { FlowService, AcceptanceService } from '../src/application/index.ts';
import { SequentialIdGenerator } from '../src/infrastructure/id-generator.ts';

function makeWorld(goal = '交付一把椅子'): {
  tree: Tree; flow: FlowService; acceptance: AcceptanceService; ledger: Ledger;
} {
  const gen = new SequentialIdGenerator();
  const selfId = gen.next('member');
  const tree = new Tree(new Node({ id: selfId, name: '皇帝', ownerId: selfId, isSelf: true }), gen, { goal });
  const ledger = new Ledger(gen);
  const flow = new FlowService(tree, gen, ledger);
  return { tree, flow, acceptance: new AcceptanceService(tree, flow, ledger), ledger };
}

/** 三明治结构：根 → 组长 → 木工 */
function makeChain(world: ReturnType<typeof makeWorld>) {
  const { tree, flow } = world;
  const lead = tree.createChild(tree.root.id, { name: '组长' });
  const worker = tree.createChild(lead.id, { name: '木工' });
  flow.giveInput(tree.root.id, lead.id, 'I');
  flow.giveInput(lead.id, worker.id, 'I');
  return { lead, worker };
}

test('逐级验收：组长通过 → 根通过 → 生产者完成', () => {
  const w = makeWorld();
  const { lead, worker } = makeChain(w);
  const product = w.flow.submitProduct(worker.id, '椅子 v1');

  assert.equal(w.acceptance.acceptedThrough(product), false); // 尚无结论
  w.acceptance.accept(lead.id, product);
  assert.equal(w.acceptance.acceptedThrough(product), false); // 根未判定
  w.acceptance.accept(w.tree.root.id, product);
  assert.equal(w.acceptance.acceptedThrough(product), true);
  assert.equal(worker.currentStatus, NodeStatus.Done); // 运行 → 完成
  assert.equal(w.ledger.verify(), true);
});

test('验收位守卫：生产者不可自验；兄弟/无关节点不可验收', () => {
  const w = makeWorld();
  const { lead, worker } = makeChain(w);
  const sibling = w.tree.createChild(lead.id, { name: '油漆工' });
  const product = w.flow.submitProduct(worker.id, '椅子 v1');

  assert.throws(() => w.acceptance.accept(worker.id, product), /生产者不可验收/);
  assert.throws(() => w.acceptance.accept(sibling.id, product), /严格祖先/);
  assert.throws(() => w.acceptance.accept(NodeId.of('树外'), product), /节点不存在/);
});

test('跳过：放行留痕；必验位禁用跳过', () => {
  const w = makeWorld();
  const lead = w.tree.createChild(w.tree.root.id, { name: '组长', mustVerify: true });
  const worker = w.tree.createChild(lead.id, { name: '木工' });
  w.flow.giveInput(w.tree.root.id, lead.id, 'I');
  w.flow.giveInput(lead.id, worker.id, 'I');
  const product = w.flow.submitProduct(worker.id, '椅子 v1');

  assert.throws(() => w.acceptance.skip(lead.id, product), /必验位/);
  assert.ok(w.acceptance.skip(w.tree.root.id, product, '放行留痕'));
  assert.throws(() => w.acceptance.skip(lead.id, product), /必验位/); // 仍不可跳过
});

test('打回：该版本上行终止，其后任何判定拒绝', () => {
  const w = makeWorld();
  const { lead, worker } = makeChain(w);
  const product = w.flow.submitProduct(worker.id, '椅子 v1 毛坯');

  w.acceptance.returnProduct(lead.id, product, '缺扶手');
  assert.equal(w.acceptance.isReturned(product), true);
  assert.equal(w.acceptance.acceptedThrough(product), false);
  assert.throws(() => w.acceptance.accept(w.tree.root.id, product), /已被打回/);
  assert.equal(worker.currentStatus, NodeStatus.Running); // 未完成

  const kinds = w.ledger.fragments().map((f) => f.kind);
  assert.ok(kinds.includes(FragmentKind.Return));
});

test('版本绑定：修订 = 新版本重新走全程，旧结论只对旧版本生效', () => {
  const w = makeWorld();
  const { lead, worker } = makeChain(w);

  const v1 = w.flow.submitProduct(worker.id, '椅子 v1');
  w.acceptance.accept(lead.id, v1);
  w.acceptance.accept(w.tree.root.id, v1);
  assert.equal(w.acceptance.acceptedThrough(v1), true);
  assert.equal(worker.currentStatus, NodeStatus.Done);

  // 打回修订：新 I → 新版本
  w.flow.giveInput(lead.id, worker.id, '修订要求'); // worker 回到等待→运行（叶子）
  const v2 = w.flow.submitProduct(worker.id, '椅子 v2');
  assert.equal(v2.version, 2);
  assert.equal(w.acceptance.acceptedThrough(v2), false); // 旧结论不覆盖新版本
  w.acceptance.accept(lead.id, v2);
  w.acceptance.accept(w.tree.root.id, v2);
  assert.equal(w.acceptance.acceptedThrough(v2), true);
  // 旧版本结论留链：verdictsOf(v1) 仍可查
  assert.equal(w.acceptance.verdictsOf(lead.id, v1).length, 1);
  assert.equal(w.acceptance.latestVerdictOf(lead.id, v1)?.kind, VerdictKind.Pass);
});

test('最新结论生效：同一验收位先通过后打回 → 版本终止', () => {
  const w = makeWorld();
  const { lead, worker } = makeChain(w);
  const product = w.flow.submitProduct(worker.id, '椅子 v1');

  w.acceptance.accept(lead.id, product);
  assert.equal(w.acceptance.isReturned(product), false);
  w.acceptance.returnProduct(lead.id, product, '复审发现问题');
  assert.equal(w.acceptance.isReturned(product), true);
  assert.equal(w.acceptance.latestVerdictOf(lead.id, product)?.kind, VerdictKind.Return);
});
