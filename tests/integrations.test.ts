// ============================================================================
// FR08 钉钉 + FR09 MCP 接入测试 —— `node tests/integrations.test.ts`
// 用本地 mock（MCP 服务器 / 钉钉 webhook）验证真实协议与发送格式。
// ============================================================================

import { createServer, type Server } from 'node:http';
import { McpToolProvider } from '../src/extensions/builtin/mcp-tool.ts';
import { DingTalkNotifier } from '../src/extensions/builtin/dingtalk-notifier.ts';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed += 1; console.log('  \u2713 ' + msg); }
  else { failed += 1; console.error('  \u2717 ' + msg); }
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
    });
  });
}

async function readJson(req: import('node:http').IncomingMessage): Promise<any> {
  let raw = '';
  for await (const c of req) raw += c;
  return raw ? JSON.parse(raw) : {};
}

async function main() {
  // ---- mock MCP 服务器 ----
  let toolCalls: any[] = [];
  const mcp = createServer(async (req, res) => {
    const msg = await readJson(req);
    let result: unknown = {};
    if (msg.method === 'initialize') {
      result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'mock-mcp', version: '0' } };
    } else if (msg.method === 'tools/list') {
      result = { tools: [{ name: 'echo', description: '回显工具', inputSchema: { type: 'object' } }] };
    } else if (msg.method === 'tools/call') {
      toolCalls.push(msg.params);
      result = { content: [{ type: 'text', text: 'ECHO:' + JSON.stringify(msg.params.arguments) }], isError: false };
    } else if (msg.method === 'resources/read') {
      result = { contents: [{ uri: msg.params.uri, text: 'RESOURCE-CONTENT' }] };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
  });
  const mcpBase = await listen(mcp);

  // ---- mock 钉钉 webhook ----
  let dingtalkPayload: any = null;
  const ding = createServer(async (req, res) => {
    dingtalkPayload = await readJson(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }));
  });
  const dingBase = await listen(ding);

  console.log('== FR09 MCP 客户端 ==');
  const mcpProvider = new McpToolProvider({ endpoint: mcpBase });
  ok(mcpProvider.configured === true, '配置 endpoint 后 configured=true');

  const tools = await mcpProvider.listTools();
  ok(tools.some((t) => t.id === 'echo'), 'listTools 通过 MCP 协议拿到 echo 工具');
  ok(toolCalls.length === 0, '初始化阶段未误调工具');

  const callRes = await mcpProvider.call('echo', { msg: 'hi' });
  ok(callRes.ok === true, 'tools/call 调用成功');
  const content = (callRes.output as { content?: { text?: string }[] })?.content?.[0]?.text ?? '';
  ok(content.includes('ECHO:') && content.includes('hi'), '工具参数经 MCP 协议正确传递');

  const mat = await mcpProvider.readMaterial('resource://x');
  ok(mat.content.includes('RESOURCE-CONTENT'), 'resources/read 读取材料');

  const noEndpoint = new McpToolProvider({ endpoint: '' });
  ok((await noEndpoint.call('echo', {})).ok === false, '未配置 endpoint 时工具调用明确失败');

  console.log('== FR08 钉钉通知 ==');
  const dingtalk = new DingTalkNotifier({ webhook: dingBase + '/robot/send' });
  ok(dingtalk.configured === true, '配置 webhook 后 configured=true');
  const sendRes = await dingtalk.send({ to: '节点责任人', channel: 'dingtalk', title: '需要审批', body: '请确认产物', actionUrl: 'http://x/item' });
  ok(sendRes.ok === true, '钉钉发送成功');
  ok(dingtalkPayload?.msgtype === 'markdown', '发送格式为 markdown 消息');
  ok(String(dingtalkPayload?.markdown?.text).includes('请确认产物'), '消息内容正确');
  ok(String(dingtalkPayload?.markdown?.text).includes('http://x/item'), '带处理入口链接');

  const noWebhook = new DingTalkNotifier({ webhook: '' });
  ok((await noWebhook.send({ to: 'x', channel: 'dingtalk', title: 't', body: 'b' })).ok === false, '未配置 webhook 时明确失败');

  await new Promise((r) => mcp.close(() => r()));
  await new Promise((r) => ding.close(() => r()));

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
