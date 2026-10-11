// ============================================================================
// interfaces · HTTP API（零依赖，Node 内置 http）
// ----------------------------------------------------------------------------
// 组合根：装配 领域对象 + 存储 + 服务，并暴露 JSON API（前端的数据源）。
// 恢复顺序（设计 §11.1）：账本校验装载 → 树快照装载 → 重放快照水位后的差额。
// 持久化：账本随 seal 实时追加落盘；树快照在每次写操作后整写。
// ============================================================================

import { createServer, type Server } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, statSync } from 'node:fs';

import { Node, Tree, Forest, Ledger, NodeId, Visibility, VerdictKind } from '../../domain/index.ts';
import type { NodeCapabilities } from '../../domain/index.ts';
import { FlowService, AcceptanceService, RootController, GlobalAgent, CapabilityService, TimeoutAlarmPolicy, RebuildService } from '../../application/index.ts';
import { SequentialIdGenerator } from '../../infrastructure/id-generator.ts';
import { FileLedgerStore } from '../../infrastructure/file-ledger-store.ts';
import { ForestStoreFile } from '../../infrastructure/forest-store.ts';
import { DemoAgentKernel } from '../../infrastructure/agents/demo-agent.ts';
import { DeepSeekAgentKernel } from '../../infrastructure/agents/deepseek-agent.ts';
import { TodoNotifier } from '../../infrastructure/notifiers/todo-notifier.ts';
import { DingTalkNotifier } from '../../infrastructure/notifiers/dingtalk-notifier.ts';
import type { MessageFragment } from '../../domain/fragment.ts';
import type { FragmentKind } from '../../domain/values.ts';
import type { TreePlain } from '../../domain/tree.ts';
import type { NodePlain } from '../../domain/node.ts';
import type { Input } from '../../domain/input.ts';
import type { Product } from '../../domain/product.ts';
import type { Verdict } from '../../domain/verdict.ts';

const GLOBAL_AGENT_ID = NodeId.of('global-agent');
const DEFAULT_TIMEOUT_MS = 60 * 1000;

/** 一棵树的世界：结构 + 围绕它的全部服务 */
export interface TreeWorld {
  tree: Tree;
  flow: FlowService;
  acceptance: AcceptanceService;
  controller: RootController;
  globalAgent: GlobalAgent;
  caps: CapabilityService;
}

export interface AppWorld {
  forest: Forest;
  ledger: Ledger;
  idGen: SequentialIdGenerator;
  worlds: Map<string, TreeWorld>;
  save: () => void;
}

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  ico: 'image/x-icon',
};

function json(res: import('node:http').ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw) as Record<string, unknown>); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function serveStatic(res: import('node:http').ServerResponse, webDir: string, urlPath: string): boolean {
  const base = normalize(webDir).replace(/[\\/]+$/, '');
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const abs = normalize(join(webDir, rel));
  if (abs !== base && !abs.startsWith(base + sep)) return false;
  if (!existsSync(abs) || !statSync(abs).isFile()) return false;
  const ext = abs.split('.').pop() ?? '';
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
  res.end(readFileSync(abs));
  return true;
}

export function createApp(opts: { dataDir: string; env?: Record<string, string | undefined> }): { server: Server; world: AppWorld } {
  const dataDir = opts.dataDir;
  const env = opts.env ?? process.env;
  mkdirSync(dataDir, { recursive: true });

  // ------------------------------------------------------------------ 装配
  const idGen = new SequentialIdGenerator();
  const ledger = new Ledger(idGen);
  const ledgerStore = new FileLedgerStore({ path: join(dataDir, 'ledger') });
  ledger.load(ledgerStore.load()); // 先验链：篡改/损坏 → 抛错拒绝启动

  const forestStore = new ForestStoreFile(join(dataDir, 'forest.json'));
  const forest = new Forest();
  const raw = forestStore.load();
  if (raw) {
    const plain = JSON.parse(raw) as { trees: TreePlain[] };
    for (const tp of plain.trees) forest.plant(Tree.fromPlain(tp, idGen));
  }

  const worlds = new Map<string, TreeWorld>();
  // 连接配置点（环境变量注入，可测试）：Agent 内核与通知渠道
  const demoAgent = new DemoAgentKernel();
  const deepseekAgent = new DeepSeekAgentKernel({
    apiKey: env.DEEPSEEK_API_KEY ?? '',
    baseUrl: env.DEEPSEEK_BASE_URL,
    model: env.DEEPSEEK_MODEL,
  });
  const todoNotifier = new TodoNotifier();
  const dingtalkNotifier = new DingTalkNotifier({ webhook: env.DINGTALK_WEBHOOK ?? '' });
  const buildWorld = (tree: Tree): TreeWorld => {
    const flow = new FlowService(tree, idGen, ledger);
    const acceptance = new AcceptanceService(tree, flow, ledger);
    const controller = new RootController(tree, flow, ledger);
    const caps = new CapabilityService(tree, flow);
    caps.registerAgent(demoAgent);
    caps.registerAgent(deepseekAgent);
    caps.registerNotifier(todoNotifier);
    caps.registerNotifier(dingtalkNotifier);
    const globalAgent = new GlobalAgent(GLOBAL_AGENT_ID, tree, ledger, [new TimeoutAlarmPolicy(DEFAULT_TIMEOUT_MS)]);
    // 全局 Agent 提醒 → 通知触达（Observer 转发；待办为记录、渠道为触达）
    globalAgent.onAlarm((alarm) => {
      void caps.notify('todo', {
        to: '根节点',
        title: `全局 Agent 提醒 · ${alarm.reason}`,
        body: `${alarm.detail}（节点 ${alarm.nodeId.value}）`,
      });
    });
    return { tree, flow, acceptance, controller, globalAgent, caps };
  };
  for (const tree of forest.allTrees()) worlds.set(tree.root.id.value, buildWorld(tree));

  // 账本全量重放：流状态（输入/产物/结论）只存在于账本，重建事实表
  // （状态由快照恢复；跨树碎片由各服务自动过滤）
  for (const w of worlds.values()) RebuildService.rebuild(w.flow, w.acceptance, ledger.fragments());

  // 抬升 ID 计数器：节点 ID + 碎片 ID + 产物 ID（快照 + 账本全量扫描）
  let maxSeq = 0;
  const bumpFrom = (ids: Iterable<string>): void => {
    for (const v of ids) {
      const m = /(\d+)$/.exec(v);
      if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
    }
  };
  for (const tree of forest.allTrees()) bumpFrom(tree.allNodes().map((n) => n.id.value));
  for (const f of ledger.fragments()) {
    bumpFrom([f.id.value]);
    if (f.kind === 'submit_product') {
      const p = f.payload as { productId?: string } | undefined;
      if (p?.productId) bumpFrom([p.productId]);
    }
  }
  idGen.bump(maxSeq);

  // 账本持久化：运行时每一笔 seal 即时追加落盘（Observer）
  ledger.subscribe((fragment) => ledgerStore.append(fragment));

  // 树快照：整写（账本无需水位——恢复时对账本全量重放）
  const save = (): void => {
    forestStore.save(JSON.stringify({
      trees: forest.allTrees().map((t) => t.toPlain()),
    }));
  };

  const getWorld = (rootId: string): TreeWorld | undefined => worlds.get(rootId);

  // ------------------------------------------------------------------ HTTP
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    try {
      if (method === 'GET' && path === '/health') return json(res, 200, { ok: true });
      if (method === 'GET' && path === '/integrations') {
        return json(res, 200, {
          agents: [
            { id: demoAgent.id, configured: true },
            { id: deepseekAgent.id, configured: deepseekAgent.configured, model: deepseekAgent.model },
          ],
          notifiers: [
            { id: todoNotifier.id, configured: true },
            { id: dingtalkNotifier.id, configured: dingtalkNotifier.configured },
          ],
        });
      }

      if (method === 'GET') {
        const webDir = fileURLToPath(new URL('../../../web/', import.meta.url));
        if (serveStatic(res, webDir, path)) return;
      }

      const body = await readBody(req);
      const s = (k: string) => (body[k] as string) ?? '';
      const arr = (k: string) => (body[k] as string[]) ?? [];

      // ---- 树 ----
      if (method === 'POST' && path === '/trees') {
        const rootId = idGen.next('member');
        const root = new Node({
          id: rootId,
          name: s('name') || '我的树',
          ownerId: rootId, // 自己的 owner 即自己（账户 = 自己节点）
          isSelf: true,
        });
        const tree = new Tree(root, idGen, { goal: s('goal'), acceptanceCriteria: arr('acceptanceCriteria') });
        forest.plant(tree);
        worlds.set(root.id.value, buildWorld(tree));
        save();
        return json(res, 201, { rootId: root.id.value, ...tree.toPlain() });
      }
      if (method === 'GET' && path === '/trees') {
        return json(res, 200, forest.allTrees().map((t) => ({
          rootId: t.root.id.value,
          name: t.root.name,
          goal: t.goal,
          nodeCount: t.size,
        })));
      }

      // ---- 以树为界的资源 ----
      const treeMatch = /^\/trees\/([^/]+)(\/.*)?$/.exec(path);
      if (treeMatch) {
        const rootId = treeMatch[1];
        const rest = treeMatch[2] ?? '';
        const world = getWorld(rootId);
        if (!world) return json(res, 404, { error: `树不存在: ${rootId}` });
        const { tree, flow, acceptance, controller, globalAgent, caps } = world;

        if (method === 'GET' && rest === '') {
          return json(res, 200, {
            ...tree.toPlain(),
            stats: globalAgent.timeStats(),
            inputs: tree.allNodes().map((n) => [n.id.value, flow.inputsOf(n.id).map((i) => ({ content: i.content, givenBy: i.givenBy.value, tick: i.tick }))]),
            products: tree.allNodes().map((n) => [n.id.value, flow.productsOf(n.id).map((p) => ({ id: p.id.value, version: p.version, content: p.content, createdAt: p.createdAt }))]),
          });
        }
        if (method === 'POST' && rest === '/nodes') {
          const def = (body.definition ?? {}) as Record<string, unknown>;
          const nodeDef = {
            ...def,
            ownerId: def.ownerId ? NodeId.of(String(def.ownerId)) : undefined,
          } as Parameters<Tree['createChild']>[1];
          const r = tree.createChild(NodeId.of(s('parentId')), nodeDef);
          save();
          return json(res, 201, r.toPlain());
        }
        if (method === 'POST' && rest === '/join') {
          const subtreeRootId = NodeId.of(s('subtreeRootId'));
          const source = forest.treeOf(subtreeRootId);
          if (!source) return json(res, 400, { error: '子树根不在任何树中' });
          tree.join(NodeId.of(s('parentId')), source.require(subtreeRootId));
          if (source.root.id.equals(subtreeRootId)) {
            forest.remove(subtreeRootId);
            worlds.delete(subtreeRootId.value); // 并入后原树溶解
          }
          save();
          return json(res, 200, { ok: true });
        }
        if (method === 'POST' && rest === '/inputs') {
          let content: unknown = body.content;
          if (body.ref) {
            // 跨树引用：I 可引用任何公有节点的 O（设计 §5 规则 9）
            const ref = body.ref as { treeRootId?: string; productId?: string; version?: number };
            const src = getWorld(ref.treeRootId ?? '');
            if (!src) return json(res, 400, { error: '引用树不存在' });
            const product = src.flow.findProduct(NodeId.of(ref.productId ?? ''), ref.version);
            if (!product) return json(res, 400, { error: '引用的产物不存在' });
            const producer = src.tree.require(product.producerId);
            if (producer.currentVisibility !== Visibility.Public) {
              return json(res, 403, { error: '产物未公开，不可跨树引用（公有 = 跨树协作唯一通道）' });
            }
            content = { kind: 'product-ref', treeRootId: ref.treeRootId, productId: ref.productId, version: ref.version, source: product.content };
          }
          const r = flow.giveInput(NodeId.of(s('fromId')), NodeId.of(s('toId')), content);
          save();
          return json(res, 201, r);
        }
        if (method === 'POST' && rest === '/products') {
          const r = flow.submitProduct(NodeId.of(s('nodeId')), body.content);
          save();
          return json(res, 201, r);
        }
        if (method === 'POST' && rest === '/run') {
          const r = await caps.runNode(NodeId.of(s('nodeId')));
          save();
          return json(res, 200, r);
        }
        if (method === 'POST' && rest === '/verdicts') {
          const product = flow.findProduct(NodeId.of(s('productId')), Number(body.version));
          if (!product) return json(res, 400, { error: '产物不存在' });
          const kind = s('kind') as 'pass' | 'skip' | 'return';
          const nodeId = NodeId.of(s('nodeId'));
          let verdict: Verdict;
          if (kind === 'pass') verdict = acceptance.accept(nodeId, product, s('reason'));
          else if (kind === 'skip') verdict = acceptance.skip(nodeId, product, s('reason') || '放行');
          else verdict = acceptance.returnProduct(nodeId, product, s('reason') || '打回');
          save();
          return json(res, 200, verdict);
        }
        if (method === 'POST' && rest === '/council') {
          const action = s('action');
          if (action === 'deliver') {
            const fragment = findFragment(ledger, s('fragmentId'));
            if (!fragment) return json(res, 400, { error: '碎片不存在' });
            controller.deliver(fragment);
          } else if (action === 'rewrite') {
            const fragment = findFragment(ledger, s('fragmentId'));
            if (!fragment) return json(res, 400, { error: '碎片不存在' });
            const input = controller.rewriteToNewInput(fragment, NodeId.of(s('targetNodeId')), body.content);
            save();
            return json(res, 200, { input: { content: input.content, givenBy: input.givenBy.value, tick: input.tick } });
          } else if (action === 'stop') {
            const fragment = findFragment(ledger, s('fragmentId'));
            if (!fragment) return json(res, 400, { error: '碎片不存在' });
            controller.letStop(fragment);
          } else if (action === 'prune') {
            controller.pruneBranch(NodeId.of(s('nodeId')));
            save();
          } else {
            return json(res, 400, { error: `未知根节点动作: ${action}` });
          }
          save();
          return json(res, 200, { ok: true, pending: controller.pendingMessages().map((f) => f.id.value) });
        }
        if (method === 'GET' && rest === '/todos') {
          return json(res, 200, todoNotifier.todos);
        }
        if (method === 'GET' && rest === '/global-agent/stats') {
          return json(res, 200, globalAgent.timeStats().map((t) => ({ ...t, nodeId: t.nodeId.value })));
        }
        if (method === 'POST' && rest === '/global-agent/check') {
          const now = typeof body.now === 'number' ? body.now : Date.now();
          const alarms = globalAgent.check(now);
          save();
          return json(res, 200, { alarms: alarms.map((a) => ({ ...a, nodeId: a.nodeId.value })) });
        }
        if (method === 'GET' && rest === '/ledger') {
          const limit = Number(url.searchParams.get('limit') ?? 200);
          const all = ledger.fragments();
          return json(res, 200, all.slice(-limit).map((f) => ({
            id: f.id.value, prevHash: f.prevHash, kind: f.kind,
            fromId: f.fromId.value, toId: f.toId.value, payload: f.payload, timestamp: f.timestamp,
          })));
        }
        if (method === 'POST' && rest === '/position') {
          const node = tree.require(NodeId.of(s('nodeId')));
          node.setPosition({ x: Number(body.x), y: Number(body.y) });
          save();
          return json(res, 200, node.toPlain());
        }
        const capMatch = /^\/nodes\/([^/]+)\/capabilities$/.exec(rest);
        if (method === 'POST' && capMatch) {
          const node = tree.require(NodeId.of(capMatch[1]));
          const actorId = s('actorId') ? NodeId.of(s('actorId')) : node.ownerId;
          node.changeCapabilities((body.capabilities ?? {}) as NodeCapabilities, actorId);
          save();
          return json(res, 200, node.toPlain());
        }
        const visMatch = /^\/nodes\/([^/]+)\/visibility$/.exec(rest);
        if (method === 'POST' && visMatch) {
          const node = tree.require(NodeId.of(visMatch[1]));
          const actorId = s('actorId') ? NodeId.of(s('actorId')) : node.ownerId;
          tree.changeVisibility(node.id, s('visibility') as Visibility, actorId);
          save();
          return json(res, 200, node.toPlain());
        }
        return json(res, 404, { error: `未找到: ${method} ${path}` });
      }

      return json(res, 404, { error: `未找到: ${method} ${path}` });
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  return { server, world: { forest, ledger, idGen, worlds, save } };
}

function findFragment(ledger: Ledger, id: string): MessageFragment | undefined {
  return ledger.fragments().find((f) => f.id.value === id);
}

// 供导出使用的类型引用（避免未使用告警）
export type { NodePlain, Input, Product, Verdict, FragmentKind };
