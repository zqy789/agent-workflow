// ============================================================================
// 账本测试 —— `node tests/ledger.test.ts`
// 覆盖：链式哈希 · 只追加 · 完整性校验 · 篡改检测 · 恢复装载 ·
//       文件分段存储 · 流动作入账（每次相邻交易 = 一条碎片）
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  Node, Tree, Ledger, MessageFragment, NodeId, FragmentKind, GENESIS_HASH,
} from '../src/domain/index.ts';
import { FlowService } from '../src/application/index.ts';
import { SequentialIdGenerator } from '../src/infrastructure/id-generator.ts';
import { FileLedgerStore } from '../src/infrastructure/file-ledger-store.ts';

function makeGen(): SequentialIdGenerator {
  return new SequentialIdGenerator();
}

// ------------------------------------------------------------------ 链
test('记账 = 只追加：prevHash 链式引用前一片', () => {
  const gen = makeGen();
  const ledger = new Ledger(gen);
  const a = NodeId.of('node-a');
  const b = NodeId.of('node-b');

  const f1 = ledger.seal({ kind: FragmentKind.GiveInput, fromId: a, toId: b, payload: 'x' });
  const f2 = ledger.seal({ kind: FragmentKind.SubmitProduct, fromId: b, toId: a, payload: 'y' });

  assert.equal(ledger.size, 2);
  assert.equal(f1.prevHash, GENESIS_HASH);
  assert.equal(f2.prevHash, f1.hash());
  assert.equal(ledger.tailHash(), f2.hash());
});

test('完整性校验：篡改任何一片 → 整链验失败', () => {
  const gen = makeGen();
  const ledger = new Ledger(gen);
  const a = NodeId.of('node-a');
  const b = NodeId.of('node-b');
  ledger.seal({ kind: FragmentKind.GiveInput, fromId: a, toId: b, payload: 'v1' });
  ledger.seal({ kind: FragmentKind.Pass, fromId: a, toId: b, payload: 'v1' });
  assert.equal(ledger.verify(), true);

  // 伪造：篡改第一片的 payload（内容被改，哈希随之改变 → 后链断裂）
  const original = ledger.fragments();
  const forged = [
    new MessageFragment({
      id: original[0].id,
      prevHash: original[0].prevHash,
      kind: original[0].kind,
      fromId: original[0].fromId,
      toId: original[0].toId,
      payload: '被篡改的内容',
      timestamp: original[0].timestamp,
    }),
    original[1],
  ];
  const other = new Ledger(gen);
  assert.throws(() => other.load(forged), /校验失败/);
});

test('恢复装载：合法链可整体装入，重放按追加顺序', () => {
  const gen = makeGen();
  const source = new Ledger(gen);
  const a = NodeId.of('node-a');
  const b = NodeId.of('node-b');
  for (let i = 0; i < 5; i += 1) {
    source.seal({ kind: FragmentKind.GiveInput, fromId: a, toId: b, payload: `第${i}次` });
  }

  const restored = new Ledger(makeGen());
  restored.load(source.fragments());
  assert.equal(restored.size, 5);
  assert.equal(restored.verify(), true);
  const replay = restored.replay();
  assert.equal(replay[0]?.payload, '第0次');
  assert.equal(replay[4]?.payload, '第4次');
});

// ------------------------------------------------------------------ 文件存储
test('文件账本：落盘 → 重开 → 装载后整链仍可验', () => {
  const dir = join(tmpdir(), `agent-workflow-ledger-${Date.now()}`);
  try {
    const gen = makeGen();
    const ledger = new Ledger(gen);
    const store = new FileLedgerStore({ path: dir });
    const a = NodeId.of('node-a');
    const b = NodeId.of('node-b');
    for (let i = 0; i < 3; i += 1) {
      const f = ledger.seal({ kind: FragmentKind.GiveInput, fromId: a, toId: b, payload: { i } });
      store.append(f);
    }

    const reopened = new FileLedgerStore({ path: dir });
    const restored = new Ledger(makeGen());
    restored.load(reopened.load());
    assert.equal(restored.size, 3);
    assert.equal(restored.verify(), true);
    assert.deepEqual(restored.replay()[2]?.payload, { i: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('文件账本：超过分段阈值自动轮转，读取按段序', () => {
  const dir = join(tmpdir(), `agent-workflow-ledger-seg-${Date.now()}`);
  try {
    const gen = makeGen();
    const ledger = new Ledger(gen);
    const store = new FileLedgerStore({ path: dir, maxSegmentBytes: 1024 });
    const a = NodeId.of('node-a');
    const b = NodeId.of('node-b');
    for (let i = 0; i < 20; i += 1) {
      const f = ledger.seal({
        kind: FragmentKind.GiveInput, fromId: a, toId: b,
        payload: `足够长的内容触发分段 ${i} `.repeat(8),
      });
      store.append(f);
    }

    const restored = new Ledger(makeGen());
    restored.load(new FileLedgerStore({ path: dir }).load());
    assert.equal(restored.size, 20);
    assert.equal(restored.verify(), true); // 跨段装载链仍完整
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ 流 × 账本
test('每次相邻交易 = 一条碎片：流的 I/O 全部入账', () => {
  const gen = makeGen();
  const selfId = gen.next('member');
  const tree = new Tree(new Node({ id: selfId, name: '我', ownerId: selfId, isSelf: true }), gen);
  const ledger = new Ledger(gen);
  const flow = new FlowService(tree, gen, ledger);
  const a = tree.createChild(tree.root.id, { name: 'A' });

  flow.giveInput(tree.root.id, a.id, '木头');
  flow.submitProduct(a.id, '椅子 v1');

  assert.equal(ledger.size, 2);
  assert.equal(ledger.replay()[0]?.kind, FragmentKind.GiveInput);
  assert.equal(ledger.replay()[1]?.kind, FragmentKind.SubmitProduct);
  assert.equal(ledger.verify(), true);
});
