// MCP 工具提供方（FR09「MCP 接入」）
// 实现 MCP 客户端（JSON-RPC 2.0 over HTTP），把 MCP 服务器暴露的工具映射为 ToolProvider。
// endpoint 为配置点，未配置时明确失败、不伪造读取结果。
import type { Material, Tool, ToolProvider, ToolResult } from '../index.ts';

export interface McpToolProviderOptions {
  /** MCP Streamable HTTP endpoint */
  endpoint: string;
  /** 可选 Bearer token */
  authToken?: string;
  /** 提供方 id，默认 'mcp' */
  id?: string;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

const PROTOCOL_VERSION = '2025-03-26';

export class McpToolProvider implements ToolProvider {
  readonly id: string;
  readonly configured: boolean;
  private endpoint: string;
  private authToken?: string;
  private seq = 0;
  private initialized = false;

  constructor(opts: McpToolProviderOptions) {
    this.id = opts.id ?? 'mcp';
    this.endpoint = opts.endpoint;
    this.authToken = opts.authToken;
    this.configured = Boolean(this.endpoint);
  }

  private async rpc(method: string, params?: unknown, notification = false): Promise<JsonRpcResponse> {
    this.seq += 1;
    const body: Record<string, unknown> = { jsonrpc: '2.0', method };
    if (!notification) { body.id = this.seq; body.params = params ?? {}; }
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (this.authToken) headers.Authorization = `Bearer ${this.authToken}`;
    const res = await fetch(this.endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (notification) { await res.arrayBuffer().catch(() => {}); return { jsonrpc: '2.0' }; }
    if (!res.ok) throw new Error(`MCP 请求失败 ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/event-stream')) {
      const text = await res.text();
      const m = text.match(/data:\s*(\{[\s\S]*\})/);
      return m ? (JSON.parse(m[1]) as JsonRpcResponse) : { jsonrpc: '2.0', result: text };
    }
    return (await res.json()) as JsonRpcResponse;
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    const init = await this.rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'agent-workflow', version: '0.1.0' },
    });
    if (init.error) throw new Error(`MCP initialize 失败: ${init.error.message}`);
    await this.rpc('notifications/initialized', undefined, true);
    this.initialized = true;
  }

  async listTools(): Promise<Tool[]> {
    if (!this.configured) return [];
    await this.ensureInit();
    const r = await this.rpc('tools/list', {});
    if (r.error) throw new Error(`tools/list 失败: ${r.error.message}`);
    const tools = ((r.result as { tools?: unknown[] } | undefined)?.tools ?? []) as Array<Record<string, unknown>>;
    return tools.map((t) => ({
      id: String(t.name ?? ''),
      name: String(t.name ?? ''),
      description: String(t.description ?? ''),
    }));
  }

  async readMaterial(ref: string): Promise<Material> {
    if (!this.configured) throw new Error('MCP endpoint 未配置');
    await this.ensureInit();
    const r = await this.rpc('resources/read', { uri: ref });
    if (r.error) throw new Error(`resources/read 失败: ${r.error.message}`);
    return { ref, content: JSON.stringify(r.result), fetchedAt: new Date().toISOString() };
  }

  async call(toolId: string, args: unknown): Promise<ToolResult> {
    if (!this.configured) return { ok: false, error: 'MCP endpoint 未配置' };
    try {
      await this.ensureInit();
      const r = await this.rpc('tools/call', { name: toolId, arguments: args ?? {} });
      if (r.error) return { ok: false, error: `MCP 工具调用失败: ${r.error.message}` };
      return { ok: true, output: r.result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
