// 内置工具提供方：HTTP 读取（真实联网，Node 内置 fetch）
// 演示 FR09「工具读取链路」——生产环境可替换为 MCP ToolProvider，接口不变。
import type { Material, Tool, ToolProvider, ToolResult } from '../index.ts';

export const httpToolProvider: ToolProvider = {
  id: 'http',
  async listTools(): Promise<Tool[]> {
    return [{ id: 'http_get', name: 'HTTP GET', description: '读取一个 URL 的内容' }];
  },
  async readMaterial(ref: string): Promise<Material> {
    const res = await fetch(ref);
    const content = await res.text();
    return { ref, content, fetchedAt: new Date().toISOString() };
  },
  async call(toolId: string, args: unknown): Promise<ToolResult> {
    if (toolId !== 'http_get') return { ok: false, error: `未知工具: ${toolId}` };
    const url = (args as { url?: string } | undefined)?.url;
    if (!url) return { ok: false, error: '缺少 url 参数' };
    try {
      const res = await fetch(url);
      const text = await res.text();
      return { ok: true, output: { status: res.status, body: text } };
    } catch (e) {
      // 工具读取失败明确可见，不伪造结果（FR09）
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
