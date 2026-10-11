// ============================================================================
// 连接与集成测试 —— `node tests/integrations.test.ts`
// 覆盖：DeepSeek 内核（真实请求 → 解析产出 / 未配置降级 / 宽松解析）·
//       钉钉渠道（送达成功/失败可见）· createApp 按 env 装配 + /integrations
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { DeepSeekAgentKernel, buildAgentPrompt, parseAgentResult } from '../src/infrastructure/agents/deepseek-agent.ts';
import { DingTalkNotifier } from '../src/infrastructure/notifiers/dingtalk-notifier.ts';
import { NodeId } from '../src/domain/values.ts';
import type { AgentContext } from '../src/domain/ports.ts';
import { createApp } from '../src/interfaces/http/app.ts';

function mockServer(handler: (req: { url?: string; method?: string; headers: Record<string, string | string[] | undefined>; body: string }) => { status: number; body: string }): Promise<{ base: string; server: Server; requests: { body: string }[] }> {
  const requests: { body: string }[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      requests.push({ body: raw });
      const out = handler({ url: req.url, method: req.method, headers: req.headers, body: raw });
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(out.body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ base: `http://127.0.0.1:${port}`, server, requests });
    });
  });
}

const closeServer = (s: Server) => new Promise<void>((r) => s.close(() => r()));

function ctx(): AgentContext {
  return {
    nodeId: NodeId.of('node-x'),
    nodeName: '设计节点',
    goalAndScope: ['交付一把椅子', '负责外观设计'],
    inputs: [{ content: '木头', givenBy: NodeId.of('root'), tick: 1 }],
    branchProducts: [],
    skills: [],
  };
}

// ------------------------------------------------------------------ DeepSeek
test('DeepSeek 内核：请求 → 解析 JSON 产出（OpenAI 兼容）', async () => {
  const mock = await mockServer(({ method, headers, body }) => {
    assert.equal(method, 'POST');
    assert.equal(headers.authorization, 'Bearer sk-test');
    assert.match(body, /deepseek-chat/);
    return {
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: '{"output":"椅子设计稿","notes":["颜色待定"]}' } }] }),
    };
  });

  const kernel = new DeepSeekAgentKernel({ apiKey: 'sk-test', baseUrl: mock.base, model: 'deepseek-chat' });
  const result = await kernel.act(ctx());
  assert.equal(result.output, '椅子设计稿');
  assert.deepEqual(result.notes, ['颜色待定']);
  await closeServer(mock.server);
});

test('DeepSeek 未配置：明确降级、不伪造结果、不发请求', async () => {
  let called = false;
  const mock = await mockServer(() => { called = true; return { status: 200, body: '{}' }; });
  const kernel = new DeepSeekAgentKernel({ apiKey: '', baseUrl: mock.base });
  const result = await kernel.act(ctx());
  assert.match(String(result.output), /未配置/);
  assert.equal(called, false);
  await closeServer(mock.server);
});

test('宽松解析：代码围栏 / 多余文本兜底', () => {
  assert.deepEqual(parseAgentResult('```json\n{"output":"A"}\n```'), { output: 'A', notes: undefined });
  const withNoise = parseAgentResult('好的，结果如下：{"output":"B","notes":["n"]} 以上');
  assert.equal(withNoise.output, 'B');
  const broken = parseAgentResult('不是 JSON 的纯文本');
  assert.equal(broken.output, '不是 JSON 的纯文本');
});

test('提示词包含目标 / 输入 / 分支产物 / SKILL 事实', () => {
  const c: AgentContext = {
    nodeId: NodeId.of('n'),
    nodeName: 'N',
    goalAndScope: ['木头 → 椅子'],
    inputs: [{ content: '板材', givenBy: NodeId.of('p'), tick: 1 }],
    branchProducts: [{ id: NodeId.of('p1'), producerId: NodeId.of('c'), version: 2, content: '椅腿', createdAt: 'x', tick: 1 }],
    skills: [{ id: 'wood', content: '# 木工\n榫卯' }],
  };
  const prompt = buildAgentPrompt(c);
  assert.match(prompt, /木头 → 椅子/);
  assert.match(prompt, /板材/);
  assert.match(prompt, /v2: "椅腿"/);
  assert.match(prompt, /榫卯/);
});

// ------------------------------------------------------------------ 钉钉
test('钉钉渠道：errcode 0 = 送达成功；非 0 = 失败可见', async () => {
  const okMock = await mockServer(({ body }) => {
    assert.match(body, /msgtype/);
    assert.match(body, /markdown/);
    return { status: 200, body: JSON.stringify({ errcode: 0, errmsg: 'ok' }) };
  });
  const ding = new DingTalkNotifier({ webhook: okMock.base + '/robot' });
  const sent = await ding.send({ to: '木工', title: '需要审批', body: '请确认产物' });
  assert.equal(sent.ok, true);
  await closeServer(okMock.server);

  const failMock = await mockServer(() => ({ status: 200, body: JSON.stringify({ errcode: 310000, errmsg: '关键词不匹配' }) }));
  const ding2 = new DingTalkNotifier({ webhook: failMock.base + '/robot' });
  const failed = await ding2.send({ to: '木工', title: 'x', body: 'y' });
  assert.equal(failed.ok, false);
  assert.match(failed.error ?? '', /310000/);
  await closeServer(failMock.server);
});

test('钉钉未配置：明确失败', async () => {
  const ding = new DingTalkNotifier({ webhook: '' });
  const r = await ding.send({ to: 'x', title: 't', body: 'b' });
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /未配置/);
});

// ------------------------------------------------------------------ 组合根
test('createApp 按 env 装配：/integrations 反映配置状态', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-workflow-int-'));
  try {
    const { server } = createApp({ dataDir: dir, env: { DEEPSEEK_API_KEY: 'sk-x', DINGTALK_WEBHOOK: 'https://example.com/hook' } });
    const base = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const a = server.address();
        const port = typeof a === 'object' && a ? a.port : 0;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
    const res = await (await fetch(base + '/integrations')).json() as {
      agents: { id: string; configured: boolean; model?: string }[];
      notifiers: { id: string; configured: boolean }[];
    };
    assert.equal(res.agents.find((a) => a.id === 'deepseek')?.configured, true);
    assert.equal(res.notifiers.find((n) => n.id === 'dingtalk')?.configured, true);
    await new Promise<void>((r) => server.close(() => r()));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
