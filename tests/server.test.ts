// ============================================================================
// 端到端测试 —— `node tests/server.test.ts`
// 覆盖设计 §14.1 六个最小闭环场景 + 重启恢复（账本验链/快照/全量重放）+
// 篡改检测（链式哈希拒绝启动）
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import { createApp } from '../src/interfaces/http/app.ts';

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}
const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

async function req(base: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'agent-workflow-e2e-'));
}

let shared: { dir: string; base: string; server: Server; rootA: string; lead: string; wood: string; paint: string } | null = null;

test('场景1：建树、开叉分支、加入上司节点', async () => {
  const dir = makeDir();
  const { server } = createApp({ dataDir: dir });
  const base = await listen(server);

  const tA = await req(base, '/trees', 'POST', { name: '甲组织', goal: '交付一把椅子', acceptanceCriteria: ['能坐', '稳'] });
  assert.equal(tA.status, 201);
  const rootA = tA.data.rootId as string;

  const lead = (await req(base, `/trees/${rootA}/nodes`, 'POST', { parentId: rootA, definition: { name: '组长' } })).data;
  const wood = (await req(base, `/trees/${rootA}/nodes`, 'POST', { parentId: lead.id, definition: { name: '木工' } })).data;
  const paint = (await req(base, `/trees/${rootA}/nodes`, 'POST', { parentId: lead.id, definition: { name: '油漆工' } })).data;

  const tB = await req(base, '/trees', 'POST', { name: '乙组织', goal: '协作' });
  const rootB = tB.data.rootId as string;
  const colleague = (await req(base, `/trees/${rootB}/nodes`, 'POST', { parentId: rootB, definition: { name: '同事的工作' } })).data;

  // 加入上司节点：乙组织的根并入甲组织
  const joined = await req(base, `/trees/${rootA}/join`, 'POST', { parentId: rootA, subtreeRootId: rootB });
  assert.equal(joined.status, 200);

  const trees = await req(base, '/trees');
  assert.equal(trees.data.length, 1); // 乙组织溶解

  const treeA = await req(base, `/trees/${rootA}`);
  assert.equal(treeA.data.nodes.length, 6); // 根+组长+木工+油漆工+乙根+同事
  assert.equal(treeA.data.goal, '交付一把椅子');
  assert.equal(treeA.data.nodes.some((n: { id: string }) => n.id === colleague.id), true);

  shared = { dir, base, server, rootA, lead: lead.id, wood: wood.id, paint: paint.id };
});

test('场景2：一次流跑通（I 下行 → 运行 → O 上行 → 逐级验收 → 完成）', async () => {
  assert.ok(shared);
  const { base, rootA, lead, wood } = shared;

  await req(base, `/trees/${rootA}/inputs`, 'POST', { fromId: rootA, toId: lead, content: 'I' });
  await req(base, `/trees/${rootA}/inputs`, 'POST', { fromId: lead, toId: wood, content: 'I' });
  const run = await req(base, `/trees/${rootA}/run`, 'POST', { nodeId: wood });
  assert.equal(run.status, 200);
  const product = run.data;
  assert.equal(product.version, 1);

  const v1 = await req(base, `/trees/${rootA}/verdicts`, 'POST', { nodeId: lead, productId: product.id, version: 1, kind: 'pass' });
  assert.equal(v1.status, 200);
  const v2 = await req(base, `/trees/${rootA}/verdicts`, 'POST', { nodeId: rootA, productId: product.id, version: 1, kind: 'pass' });
  assert.equal(v2.status, 200);

  const treeA = await req(base, `/trees/${rootA}`);
  const woodNode = treeA.data.nodes.find((n: { id: string }) => n.id === wood);
  assert.equal(woodNode.status, 'done'); // 全程通过 → 完成
});

test('场景3：打回迭代（新版本重新走全程，旧结论留链）', async () => {
  assert.ok(shared);
  const { base, rootA, lead, paint } = shared;

  await req(base, `/trees/${rootA}/inputs`, 'POST', { fromId: lead, toId: paint, content: 'I' });
  const p1 = (await req(base, `/trees/${rootA}/run`, 'POST', { nodeId: paint })).data;
  const ret = await req(base, `/trees/${rootA}/verdicts`, 'POST', { nodeId: lead, productId: p1.id, version: 1, kind: 'return', reason: '缺光泽' });
  assert.equal(ret.status, 200);

  // 打回后：修订 = 新版本
  await req(base, `/trees/${rootA}/inputs`, 'POST', { fromId: lead, toId: paint, content: '修订：加光泽' });
  const p2 = (await req(base, `/trees/${rootA}/run`, 'POST', { nodeId: paint })).data;
  assert.equal(p2.version, 2);

  await req(base, `/trees/${rootA}/verdicts`, 'POST', { nodeId: lead, productId: p2.id, version: 2, kind: 'pass' });
  await req(base, `/trees/${rootA}/verdicts`, 'POST', { nodeId: rootA, productId: p2.id, version: 2, kind: 'pass' });

  const ledger = await req(base, `/trees/${rootA}/ledger`);
  const kinds = ledger.data.map((f: { kind: string }) => f.kind);
  assert.ok(kinds.includes('return'));
  assert.ok(kinds.includes('pass'));
});

test('场景4：超时 → 全局 Agent 提醒 → 根节点剪枝（死锁出口）', async () => {
  assert.ok(shared);
  const { base, rootA, lead } = shared;

  const senior = (await req(base, `/trees/${rootA}/nodes`, 'POST', { parentId: lead, definition: { name: '大工' } })).data;
  const junior = (await req(base, `/trees/${rootA}/nodes`, 'POST', { parentId: senior.id, definition: { name: '小工' } })).data;
  await req(base, `/trees/${rootA}/inputs`, 'POST', { fromId: lead, toId: senior.id, content: 'I' });
  await req(base, `/trees/${rootA}/inputs`, 'POST', { fromId: senior.id, toId: junior.id, content: 'I' });
  // 大工等待小工回流（卡住）

  const check = await req(base, `/trees/${rootA}/global-agent/check`, 'POST', { now: Date.now() + 600000 });
  assert.equal(check.status, 200);
  const alarmed = check.data.alarms.some((a: { nodeId: string }) => a.nodeId === senior.id);
  assert.equal(alarmed, true);

  const todos = await req(base, `/trees/${rootA}/todos`);
  assert.equal(todos.data.some((t: { title: string }) => t.title.includes('全局 Agent 提醒')), true);

  const pruned = await req(base, `/trees/${rootA}/council`, 'POST', { action: 'prune', nodeId: senior.id });
  assert.equal(pruned.status, 200);
  const treeA = await req(base, `/trees/${rootA}`);
  assert.equal(treeA.data.nodes.some((n: { id: string }) => n.id === senior.id || n.id === junior.id), false);
});

test('场景5：根节点改写消息为新 I 向下流转', async () => {
  assert.ok(shared);
  const { base, rootA, lead } = shared;

  const ledger = await req(base, `/trees/${rootA}/ledger`);
  const submit = ledger.data.find((f: { kind: string; payload?: { productId?: string } }) => f.kind === 'submit_product' && f.payload?.productId);
  assert.ok(submit);

  await req(base, `/trees/${rootA}/council`, 'POST', { action: 'deliver', fragmentId: submit.id });
  const rewritten = await req(base, `/trees/${rootA}/council`, 'POST', { action: 'rewrite', fragmentId: submit.id, targetNodeId: lead, content: '修订：加扶手' });
  assert.equal(rewritten.status, 200);
  assert.equal(rewritten.data.input.content, '修订：加扶手');

  const treeA = await req(base, `/trees/${rootA}`);
  const leadInputs = (treeA.data.inputs as [string, { content: unknown }[]][]).find(([id]) => id === lead);
  assert.ok(leadInputs);
  const last = leadInputs[1][leadInputs[1].length - 1];
  assert.equal(last?.content, '修订：加扶手');
});

test('场景6：跨树引用公有 O 作为输入材料（私有拒绝）', async () => {
  assert.ok(shared);
  const { base, rootA, lead, wood } = shared;

  const tC = await req(base, '/trees', 'POST', { name: '能力库', goal: '共享图纸' });
  const rootC = tC.data.rootId as string;
  const blueprint = (await req(base, `/trees/${rootC}/nodes`, 'POST', { parentId: rootC, definition: { name: '图纸', visibility: 'public' } })).data;
  const secret = (await req(base, `/trees/${rootC}/nodes`, 'POST', { parentId: rootC, definition: { name: '私藏' } })).data;

  await req(base, `/trees/${rootC}/inputs`, 'POST', { fromId: rootC, toId: blueprint.id, content: 'I' });
  const pub = (await req(base, `/trees/${rootC}/run`, 'POST', { nodeId: blueprint.id })).data;
  await req(base, `/trees/${rootC}/inputs`, 'POST', { fromId: rootC, toId: secret.id, content: 'I' });
  const priv = (await req(base, `/trees/${rootC}/run`, 'POST', { nodeId: secret.id })).data;

  const refOk = await req(base, `/trees/${rootA}/inputs`, 'POST', {
    fromId: lead, toId: wood,
    ref: { treeRootId: rootC, productId: pub.id, version: 1 },
  });
  assert.equal(refOk.status, 201);
  assert.equal((refOk.data.content as { kind?: string }).kind, 'product-ref');

  const refDenied = await req(base, `/trees/${rootA}/inputs`, 'POST', {
    fromId: lead, toId: wood,
    ref: { treeRootId: rootC, productId: priv.id, version: 1 },
  });
  assert.equal(refDenied.status, 403);
});

test('场景7：重启恢复（账本验链 + 快照 + 全量重放 + 版本连续）', async () => {
  assert.ok(shared);
  const { dir, rootA, lead, wood } = shared;

  const before = await req(shared.base, `/trees/${rootA}`);
  const ledgerBefore = await req(shared.base, `/trees/${rootA}/ledger`);
  await close(shared.server);

  const { server: server2 } = createApp({ dataDir: dir });
  const base2 = await listen(server2);

  const after = await req(base2, `/trees/${rootA}`);
  assert.equal(after.data.nodes.length, before.data.nodes.length);
  // 重启不变式：全部节点状态与重启前完全一致（快照 + 全量重放）
  const beforeStatuses = Object.fromEntries(before.data.nodes.map((n: { id: string; status: string }) => [n.id, n.status]));
  const afterStatuses = Object.fromEntries(after.data.nodes.map((n: { id: string; status: string }) => [n.id, n.status]));
  assert.deepEqual(afterStatuses, beforeStatuses);

  const ledgerAfter = await req(base2, `/trees/${rootA}/ledger`);
  assert.equal(ledgerAfter.data.length, ledgerBefore.data.length); // 账本完整

  // 版本连续：木工再交一版 → version = 旧最高 + 1
  await req(base2, `/trees/${rootA}/inputs`, 'POST', { fromId: lead, toId: wood, content: '再来一轮' });
  const again = (await req(base2, `/trees/${rootA}/run`, 'POST', { nodeId: wood })).data;
  const woodProducts = (after.data.products as [string, { version: number }[]][]).find(([id]) => id === wood);
  const maxBefore = Math.max(...(woodProducts?.[1].map((p) => p.version) ?? [0]));
  assert.equal(again.version, maxBefore + 1);

  await close(server2);
  shared = null;
});

test('场景9：房间配置端点（能力挂载 + 可见性更新，权限守卫）', async () => {
  const dir = makeDir();
  try {
    const { server } = createApp({ dataDir: dir });
    const base = await listen(server);

    const t = await req(base, '/trees', 'POST', { name: '配置树', goal: 'g' });
    const rootId = t.data.rootId as string;
    const node = (await req(base, `/trees/${rootId}/nodes`, 'POST', { parentId: rootId, definition: { name: '木工' } })).data;

    // 挂载能力（创建者 = 根节点 owner）
    const caps = await req(base, `/trees/${rootId}/nodes/${node.id}/capabilities`, 'POST', {
      actorId: rootId,
      capabilities: { agentKernel: 'deepseek', actions: ['ci-check'] },
    });
    assert.equal(caps.status, 200);
    assert.equal(caps.data.capabilities.agentKernel, 'deepseek');
    assert.deepEqual(caps.data.capabilities.actions, ['ci-check']);

    // 权限守卫：非创建者不可改
    const denied = await req(base, `/trees/${rootId}/nodes/${node.id}/capabilities`, 'POST', {
      actorId: 'outsider',
      capabilities: { agentKernel: 'demo' },
    });
    assert.equal(denied.status, 400);

    // 可见性更新
    const vis = await req(base, `/trees/${rootId}/nodes/${node.id}/visibility`, 'POST', { actorId: rootId, visibility: 'public' });
    assert.equal(vis.status, 200);
    assert.equal(vis.data.visibility, 'public');
    const visDenied = await req(base, `/trees/${rootId}/nodes/${node.id}/visibility`, 'POST', { actorId: 'outsider', visibility: 'private' });
    assert.equal(visDenied.status, 400);

    // GET 树快照反映新配置
    const tree = await req(base, `/trees/${rootId}`);
    const fetched = tree.data.nodes.find((n: { id: string }) => n.id === node.id);
    assert.equal(fetched.capabilities.agentKernel, 'deepseek');
    assert.equal(fetched.visibility, 'public');

    await close(server);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('场景8：账本被篡改 → 链式哈希拒绝启动', () => {
  const dir = makeDir();
  const ledgerDir = join(dir, 'ledger');
  mkdirSync(ledgerDir, { recursive: true });
  // 合法第一片 + 伪造第二片（prevHash 不匹配）
  const frag1 = {
    id: 'fragment-1', prevHash: 'genesis', kind: 'give_input',
    fromId: 'a', toId: 'b', payload: { content: 'x' }, timestamp: 1,
  };
  const frag2 = {
    id: 'fragment-2', prevHash: 'ffffffffffffffffffffffffffffffffffffffff', kind: 'give_input',
    fromId: 'a', toId: 'b', payload: { content: '被篡改' }, timestamp: 2,
  };
  writeFileSync(join(ledgerDir, 'ledger-000001.log'), JSON.stringify(frag1) + '\n' + JSON.stringify(frag2) + '\n', 'utf8');

  assert.throws(() => createApp({ dataDir: dir }), /校验失败/);
  rmSync(dir, { recursive: true, force: true });
});
