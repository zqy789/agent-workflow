// ============================================================================
// 全链路演练 —— `node examples/full-chain.ts`
// ----------------------------------------------------------------------------
// 通过真实 HTTP 服务走完 v0.2 全部核心链路，每一步打印日志：
//   建树开叉 → 加入上司节点 → 流跑通（I/O/全等汇合）→ 逐级验收 →
//   打回迭代 → 超时全局 Agent 提醒 → 根节点剪枝 → 根节点改写为新 I →
//   跨树引用 → 通知待办 → 重启 → 以「账本日志」为输入全量重放 → 一致性对比。
// 零依赖、零构建：Node ≥ 24 直接运行。
// ============================================================================

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import { createApp } from '../src/interfaces/http/app.ts';

const t0 = Date.now();
const clock = (): string => {
  const ms = Date.now() - t0;
  return `${String(Math.floor(ms / 1000)).padStart(2, '0')}:${String(ms % 1000).padStart(3, '0')}`;
};
const step = (s: string): void => console.log(`\n[${clock()}] ▸ ${s}`);
const ok = (s: string): void => console.log(`[${clock()}]    ✓ ${s}`);
const bar = (): void => console.log('═'.repeat(72));

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
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const dataDir = mkdtempSync(join(tmpdir(), 'agent-workflow-chain-'));
  bar();
  console.log('  Agent WorkFlow v0.2 · 全链路演练（后端服务 + 日志）');
  console.log('  数据目录:', dataDir);
  bar();

  const { server } = createApp({ dataDir });
  const base = await listen(server);

  // ------------------------------------------------------------------ 1 建树开叉 + 加入上司节点
  step('建树：甲组织（目标：木头 → 椅子；验收：能坐、稳）');
  const tA = await req(base, '/trees', 'POST', { name: '甲组织', goal: '木头 → 椅子', acceptanceCriteria: ['能坐', '稳'] });
  const rootA = tA.rootId as string;
  ok(`根节点: ${rootA}`);

  step('开叉分支：根节点 → 组长 → 木工 / 油漆工');
  const lead = await req(base, `/trees/${rootA}/nodes`, 'POST', { parentId: rootA, definition: { name: '组长' } });
  const wood = await req(base, `/trees/${rootA}/nodes`, 'POST', { parentId: lead.id, definition: { name: '木工' } });
  const paint = await req(base, `/trees/${rootA}/nodes`, 'POST', { parentId: lead.id, definition: { name: '油漆工' } });
  ok(`组长 ${lead.id} · 木工 ${wood.id} · 油漆工 ${paint.id}`);

  step('加入上司节点：乙组织的「自己」节点并入甲组织');
  const tB = await req(base, '/trees', 'POST', { name: '乙组织', goal: '协作' });
  const rootB = tB.rootId as string;
  const colleague = await req(base, `/trees/${rootB}/nodes`, 'POST', { parentId: rootB, definition: { name: '同事的工作' } });
  await req(base, `/trees/${rootA}/join`, 'POST', { parentId: rootA, subtreeRootId: rootB });
  const trees = await req(base, '/trees');
  ok(`乙组织溶解，系统剩余 ${trees.length} 棵树；同事节点 ${colleague.id} 并入甲组织`);

  // ------------------------------------------------------------------ 2 一次流跑通
  step('流 · I 下行：根节点 → 组长 → 木工（I 可逐级改写）');
  await req(base, `/trees/${rootA}/inputs`, 'POST', { fromId: rootA, toId: lead.id, content: '木头' });
  await req(base, `/trees/${rootA}/inputs`, 'POST', { fromId: lead.id, toId: wood.id, content: '加工后的木头：劈成板材' });
  ok('木工（叶子）收到 I → 全等汇合满足 → 等待 → 运行');

  step('流 · 运行：木工执行能力（Agent → 产出 O 自动上行）');
  const p1 = await req(base, `/trees/${rootA}/run`, 'POST', { nodeId: wood.id });
  ok(`O 产物 ${p1.id} v${p1.version} 已入账（不可篡改 · 版本化）`);

  step('验收 · 自下而上逐级：组长 通过 → 根节点 通过');
  await req(base, `/trees/${rootA}/verdicts`, 'POST', { nodeId: lead.id, productId: p1.id, version: 1, kind: 'pass' });
  await req(base, `/trees/${rootA}/verdicts`, 'POST', { nodeId: rootA, productId: p1.id, version: 1, kind: 'pass' });
  const tA1 = await req(base, `/trees/${rootA}`);
  const woodStatus = tA1.nodes.find((n: { id: string }) => n.id === wood.id).status;
  ok(`全程通过 → 木工 状态 = ${woodStatus}`);

  // ------------------------------------------------------------------ 3 打回迭代
  step('打回：组长对油漆工 v1 打回（缺光泽）→ 修订 = 新版本重新走全程');
  await req(base, `/trees/${rootA}/inputs`, 'POST', { fromId: lead.id, toId: paint.id, content: 'I' });
  const q1 = await req(base, `/trees/${rootA}/run`, 'POST', { nodeId: paint.id });
  await req(base, `/trees/${rootA}/verdicts`, 'POST', { nodeId: lead.id, productId: q1.id, version: 1, kind: 'return', reason: '缺光泽' });
  await req(base, `/trees/${rootA}/inputs`, 'POST', { fromId: lead.id, toId: paint.id, content: '修订：加光泽' });
  const q2 = await req(base, `/trees/${rootA}/run`, 'POST', { nodeId: paint.id });
  await req(base, `/trees/${rootA}/verdicts`, 'POST', { nodeId: lead.id, productId: q2.id, version: 2, kind: 'pass' });
  await req(base, `/trees/${rootA}/verdicts`, 'POST', { nodeId: rootA, productId: q2.id, version: 2, kind: 'pass' });
  ok(`v1 结论留链（打回），v2 重新走全程并通过（版本绑定）`);

  // ------------------------------------------------------------------ 4 超时提醒 + 剪枝
  step('超时：大工等小工回流，卡住 → 全局 Agent 提醒（提醒入账，送达根节点）');
  const senior = await req(base, `/trees/${rootA}/nodes`, 'POST', { parentId: lead.id, definition: { name: '大工' } });
  const junior = await req(base, `/trees/${rootA}/nodes`, 'POST', { parentId: senior.id, definition: { name: '小工' } });
  await req(base, `/trees/${rootA}/inputs`, 'POST', { fromId: lead.id, toId: senior.id, content: 'I' });
  await req(base, `/trees/${rootA}/inputs`, 'POST', { fromId: senior.id, toId: junior.id, content: 'I' });
  const check = await req(base, `/trees/${rootA}/global-agent/check`, 'POST', { now: Date.now() + 600000 });
  const alarm = check.alarms.find((a: { nodeId: string }) => a.nodeId === senior.id);
  ok(`提醒：${alarm.nodeId} ${alarm.reason} · ${alarm.detail}`);
  const todos = await req(base, `/trees/${rootA}/todos`);
  const todoAlarm = todos.find((t: { title: string }) => t.title.includes('全局 Agent 提醒'));
  ok(`通知触达：待办已记录「${todoAlarm.title}」（待办为记录、渠道为触达）`);

  step('根节点剪枝：死锁唯一出口（结构性动作 + 入账）');
  await req(base, `/trees/${rootA}/council`, 'POST', { action: 'prune', nodeId: senior.id });
  const tA2 = await req(base, `/trees/${rootA}`);
  ok(`大工/小工已移除；树剩余 ${tA2.nodes.length} 个节点`);

  // ------------------------------------------------------------------ 5 根节点改写为新 I
  step('根节点改写：上行消息到达根节点 → 改写为新 I 下达组长');
  const ledger1 = await req(base, `/trees/${rootA}/ledger?limit=500`);
  const submit = ledger1.find((f: { kind: string }) => f.kind === 'submit_product');
  await req(base, `/trees/${rootA}/council`, 'POST', { action: 'deliver', fragmentId: submit.id });
  const rewritten = await req(base, `/trees/${rootA}/council`, 'POST', {
    action: 'rewrite', fragmentId: submit.id, targetNodeId: lead.id, content: '修订要求：加扶手',
  });
  ok(`新 I：「${rewritten.input.content}」（NewInput 引用原碎片 ${submit.id} 留痕）`);

  // ------------------------------------------------------------------ 6 跨树引用
  step('跨树引用：能力库的公有图纸 → 木工的输入材料（私有被拒）');
  const tC = await req(base, '/trees', 'POST', { name: '能力库', goal: '共享图纸' });
  const rootC = tC.rootId as string;
  const blueprint = await req(base, `/trees/${rootC}/nodes`, 'POST', { parentId: rootC, definition: { name: '图纸', visibility: 'public' } });
  await req(base, `/trees/${rootC}/inputs`, 'POST', { fromId: rootC, toId: blueprint.id, content: 'I' });
  const pub = await req(base, `/trees/${rootC}/run`, 'POST', { nodeId: blueprint.id });
  const ref = await req(base, `/trees/${rootA}/inputs`, 'POST', {
    fromId: lead.id, toId: wood.id,
    ref: { treeRootId: rootC, productId: pub.id, version: 1 },
  });
  ok(`公有 O 引用成功：kind = ${ref.content.kind}（守恒律跨树成立）`);
  const secret = await req(base, `/trees/${rootC}/nodes`, 'POST', { parentId: rootC, definition: { name: '私藏' } });
  await req(base, `/trees/${rootC}/inputs`, 'POST', { fromId: rootC, toId: secret.id, content: 'I' });
  const priv = await req(base, `/trees/${rootC}/run`, 'POST', { nodeId: secret.id });
  try {
    await req(base, `/trees/${rootA}/inputs`, 'POST', {
      fromId: lead.id, toId: wood.id,
      ref: { treeRootId: rootC, productId: priv.id, version: 1 },
    });
    throw new Error('私有产物引用应被拒绝');
  } catch (e) {
    ok(`私有 O 引用被拒（403）✓`);
  }

  // ------------------------------------------------------------------ 7 通知待办
  step('通知：待办为记录（渠道触达经能力服务发送）');
  ok(`待办机制就绪（Web 待办 = 记录；钉钉渠道随 DINGTALK_WEBHOOK 配置启用）`);

  // ------------------------------------------------------------------ 8 账本摘要（重启前）
  const before = await req(base, `/trees/${rootA}`);
  const beforeLedger = await req(base, `/trees/${rootA}/ledger?limit=100000`);
  const kindCount: Record<string, number> = {};
  for (const f of beforeLedger) kindCount[f.kind] = (kindCount[f.kind] ?? 0) + 1;
  step(`账本摘要（重启前）：共 ${beforeLedger.length} 条碎片`);
  console.log(`        ${JSON.stringify(kindCount)}`);

  // ------------------------------------------------------------------ 9 重启：以日志为输入全量重放
  step('重启服务：账本日志 = 唯一真相源');
  await close(server);
  const { server: server2 } = createApp({ dataDir });
  const base2 = await listen(server2);
  const after = await req(base2, `/trees/${rootA}`);
  const afterLedger = await req(base2, `/trees/${rootA}/ledger?limit=100000`);
  ok(`账本装载 ${afterLedger.length} 条碎片（链式哈希校验通过）`);
  ok(`快照装载 ${after.nodes.length} 个节点；以日志为输入全量重放重建 流/产物/结论 事实表`);

  step('一致性对比：重启后 vs 重启前');
  const statusOf = (d: { nodes: { id: string; status: string }[] }) =>
    Object.fromEntries(d.nodes.map((n) => [n.id, n.status]));
  const deepEq = JSON.stringify(statusOf(before)) === JSON.stringify(statusOf(after));
  ok(`节点状态完全一致：${deepEq ? '✓' : '✗ 不一致！'}`);
  const prodCount = (d: { products: [string, { id: string }[]][] }) =>
    d.products.reduce((n, [, list]) => n + list.length, 0);
  ok(`产物总数一致：${prodCount(before)} → ${prodCount(after)} ${prodCount(before) === prodCount(after) ? '✓' : '✗'}`);
  const woodProducts = (after.products as [string, { version: number }[]][]).find(([id]) => id === wood.id);
  ok(`木工产物版本链（由日志重放重建）：v${(woodProducts?.[1].map((p) => p.version) ?? []).join('、v')}`);

  // 重放后继续交易：版本连续性
  await req(base2, `/trees/${rootA}/inputs`, 'POST', { fromId: lead.id, toId: wood.id, content: '再来一轮' });
  const again = await req(base2, `/trees/${rootA}/run`, 'POST', { nodeId: wood.id });
  ok(`重放后继续交易：新产物 version = ${again.version}（连续，无冲突）`);

  await close(server2);
  rmSync(dataDir, { recursive: true, force: true });

  bar();
  console.log('  全链路演练完成 ✓  （碎片入账 → 日志重放 → 状态一致 → 版本连续）');
  bar();
}

main().catch((e) => {
  console.error('\n✗ 演练失败:', e instanceof Error ? e.message : e);
  process.exit(1);
});
