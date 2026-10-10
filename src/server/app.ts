// ============================================================================
// HTTP API 服务（零依赖，Node 内置 http）
// ----------------------------------------------------------------------------
// 把内核能力暴露为 JSON API，作为 Web 前端的服务端（FR01/FR02/FR07 的入口）。
// 启动时从文件恢复状态；每次写操作后持久化快照。
// ============================================================================

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kernel } from '../engine/index.ts';
import { consoleNotifier } from '../extensions/builtin/console-notifier.ts';
import { DeepSeekAgentKernel } from '../extensions/builtin/deepseek-agent.ts';
import { McpToolProvider } from '../extensions/builtin/mcp-tool.ts';
import { DingTalkNotifier } from '../extensions/builtin/dingtalk-notifier.ts';
import { InMemoryIdentityProvider, OrgIsolationPermissionEvaluator } from '../extensions/builtin/permission.ts';
import { loadLlmConfig } from '../config/llm.ts';
import type { NodeDefinition, RelationType } from '../model/index.ts';
import type { AgentContext, AgentKernel, Analysis } from '../extensions/index.ts';
import { createFilePersistence, type FilePersistence } from './persist.ts';

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  ico: 'image/x-icon',
};

function serveStatic(res: ServerResponse, webDir: string, urlPath: string): boolean {
  const base = normalize(webDir).replace(/[\\/]+$/, '');
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const abs = normalize(join(webDir, rel));
  if (abs !== base && !abs.startsWith(base + sep)) return false; // 防目录穿越
  if (!existsSync(abs) || !statSync(abs).isFile()) return false;
  const ext = abs.split('.').pop() ?? '';
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
  res.end(readFileSync(abs));
  return true;
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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

// 演示用 Agent（真实实现换成调 LLM 的 AgentKernel，接口不变）
const demoAgent: AgentKernel = {
  id: 'demo-agent',
  async analyze(_ctx: AgentContext): Promise<Analysis> {
    return { satisfied: [], missing: [], conflicts: [], adaptable: [], openIssues: [], impacts: [] };
  },
};

export function createApp(
  persistPath: string,
  webDir: string = fileURLToPath(new URL('../../web/', import.meta.url)),
): { server: Server; kernel: Kernel; save: () => void } {
  const kernel = new Kernel();
  const persist: FilePersistence = createFilePersistence(persistPath);
  const loaded = persist.load();
  if (loaded) kernel.restore(loaded);
  kernel.registerAgentKernel(demoAgent);
  kernel.registerNotifier(consoleNotifier);
  // DeepSeek 内核：key 从环境变量读取（配置点），未配置时 demo-agent 仍可用
  const llm = loadLlmConfig();
  const deepseek = new DeepSeekAgentKernel({ apiKey: llm.apiKey, baseUrl: llm.baseUrl, model: llm.model });
  kernel.registerAgentKernel(deepseek);
  // MCP 工具 + 钉钉通知：endpoint / webhook 从环境变量读取（配置点）
  const mcp = new McpToolProvider({ endpoint: process.env.MCP_ENDPOINT ?? '' });
  if (mcp.configured) kernel.registerToolProvider(mcp);
  const dingtalk = new DingTalkNotifier({ webhook: process.env.DINGTALK_WEBHOOK ?? '' });
  if (dingtalk.configured) kernel.registerNotifier(dingtalk);
  // 身份与权限（FR01 组织数据隔离）
  const identity = new InMemoryIdentityProvider(kernel.store);
  const permission = new OrgIsolationPermissionEvaluator(kernel.store, identity);

  const save = () => persist.save(kernel.snapshot());

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    try {
      // ---- 查询 ----
      if (method === 'GET' && path === '/health') {
        return json(res, 200, { ok: true, ts: new Date().toISOString() });
      }
      if (method === 'GET' && path === '/llm/status') {
        return json(res, 200, { provider: 'deepseek', configured: deepseek.configured, model: llm.model, baseUrl: llm.baseUrl });
      }
      if (method === 'GET' && path === '/integrations/status') {
        return json(res, 200, {
          llm: { provider: 'deepseek', configured: deepseek.configured, model: llm.model },
          mcp: { configured: mcp.configured },
          dingtalk: { configured: dingtalk.configured },
        });
      }
      if (method === 'GET' && path === '/state') {
        return json(res, 200, {
          organizations: kernel.store.organizations.size,
          projects: kernel.store.projects.size,
          requirements: kernel.store.requirements.size,
          nodes: kernel.store.nodes.size,
          artifacts: [...kernel.store.artifacts.values()].reduce((n, l) => n + l.length, 0),
          events: kernel.store.events.length,
        });
      }
      if (method === 'GET' && path === '/snapshot') {
        return json(res, 200, kernel.snapshot());
      }
      if (method === 'GET' && path.startsWith('/context/')) {
        const nodeId = path.slice('/context/'.length);
        return json(res, 200, kernel.organizeContext(nodeId));
      }
      if (method === 'GET' && path.startsWith('/project/') && path.endsWith('/summary')) {
        const projectId = path.slice('/project/'.length, -'/summary'.length);
        return json(res, 200, kernel.summarizeProject(projectId));
      }
      if (method === 'GET' && path === '/permissions/check') {
        const actor = url.searchParams.get('actor') ?? '';
        const action = url.searchParams.get('action') ?? 'read';
        const resource = url.searchParams.get('resource') ?? '';
        const allowed = await permission.can(actor, action, resource);
        return json(res, 200, { allowed });
      }

      // ---- 静态前端（Web 工作入口）----
      if (method === 'GET') {
        if (serveStatic(res, webDir, path)) return;
        return json(res, 404, { error: `未找到: ${method} ${path}` });
      }

      // ---- 写操作 ----
      const body = await readBody(req);
      const s = (k: string) => (body[k] as string) ?? '';
      const arr = (k: string) => (body[k] as string[]) ?? [];

      if (method === 'POST' && path === '/orgs') {
        const r = kernel.createOrganization(s('name'));
        save(); return json(res, 201, r);
      }
      if (method === 'POST' && path === '/members') {
        const r = kernel.addMember(s('orgId'), s('name'));
        save(); return json(res, 201, r);
      }
      if (method === 'POST' && path === '/projects') {
        const r = kernel.createProject(s('orgId'), s('name'));
        save(); return json(res, 201, r);
      }
      if (method === 'POST' && path === '/requirements') {
        const r = kernel.createRequirement(s('projectId'), {
          goal: s('goal'),
          creatorId: s('creatorId'),
          deliveryTarget: s('deliveryTarget'),
          scope: s('scope'),
          acceptanceCriteria: arr('acceptanceCriteria'),
        });
        save(); return json(res, 201, r);
      }
      if (method === 'POST' && path === '/nodes') {
        const r = kernel.createNode(s('projectId'), body.definition as NodeDefinition);
        save(); return json(res, 201, r);
      }
      if (method === 'POST' && path === '/relations') {
        const r = kernel.addRelation(
          s('projectId'),
          (body.type as RelationType) ?? 'dependency',
          s('fromNodeId'),
          s('toNodeId'),
          body.semantic as string | undefined,
        );
        save(); return json(res, 201, r);
      }
      if (method === 'POST' && path === '/artifacts') {
        const r = kernel.submitArtifact(s('nodeId'), s('submitterId'), s('description'), body.accessRef as string | undefined);
        save(); return json(res, 201, r);
      }
      if (method === 'POST' && path === '/analyze') {
        const r = await kernel.analyzeNode(s('nodeId'), demoAgent);
        return json(res, 200, r);
      }
      if (method === 'POST' && path === '/pipeline/run') {
        const r = await kernel.runPipeline(s('nodeId'));
        save(); return json(res, 200, r);
      }

      return json(res, 404, { error: `未找到: ${method} ${path}` });
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  return { server, kernel, save };
}
