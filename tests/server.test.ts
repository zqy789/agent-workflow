// ============================================================================
// 服务端端到端测试 —— `node tests/server.test.ts`
// 起真实 HTTP 服务（临时端口）→ 调 API → 重启服务验证文件持久化。
// ============================================================================

import { createApp } from '../src/server/app.ts';
import { unlinkSync } from 'node:fs';
import type { Server } from 'node:http';

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
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((r) => server.close(() => r()));
}

async function post(base: string, path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, any>;
}

async function get(base: string, path: string) {
  return (await (await fetch(`${base}${path}`)).json()) as Record<string, any>;
}

const nodeDef = {
  name: '工作节点',
  description: '执行流水线',
  participants: [],
  inputRequirements: [],
  expectedOutputs: ['产物'],
  agentConfig: { kernel: 'demo-agent', rolePrompt: '', tools: [], contextScope: '', uncertaintyStrategyId: '' },
  processingRules: { requireInputsBeforeStart: true, onMissingCriticalInput: 'notify_human' },
  pipeline: [
    { id: 's1', type: 'check_input' },
    { id: 's2', type: 'agent_analyze' },
    { id: 's3', type: 'submit_artifact', config: { description: '交付物 v1' } },
    { id: 's4', type: 'emit_event' },
  ],
};

async function main() {
  const stateFile = 'data/server-test-state.json';
  try { unlinkSync(stateFile); } catch { /* 不存在则忽略 */ }

  const { server } = createApp(stateFile);
  const base = await listen(server);

  console.log('== 服务端 API ==');
  const health = await get(base, '/health');
  ok(health.ok === true, 'GET /health 返回 ok');

  const llm = await get(base, '/llm/status');
  ok(llm.provider === 'deepseek', 'GET /llm/status 返回 provider');
  ok(llm.configured === false, '未配置 key 时 llm.status.configured=false');

  const homeRes = await fetch(`${base}/`);
  const homeText = await homeRes.text();
  ok(homeRes.status === 200 && homeText.includes('flowstate'), 'GET / 返回前端页面');

  const org = await post(base, '/orgs', { name: '测试团队' });
  ok(Boolean(org.id), 'POST /orgs 创建组织');

  const project = await post(base, '/projects', { orgId: org.id, name: '测试项目' });
  ok(Boolean(project.id), 'POST /projects 创建项目');

  const req = await post(base, '/requirements', {
    projectId: project.id, goal: '交付页面', creatorId: 'c', deliveryTarget: '页面可访问', scope: '一期', acceptanceCriteria: ['可访问'],
  });
  ok(Boolean(req.id), 'POST /requirements 创建需求');

  const node = await post(base, '/nodes', { projectId: project.id, definition: nodeDef });
  ok(Boolean(node.id), 'POST /nodes 创建节点');

  const run = await post(base, '/pipeline/run', { nodeId: node.id });
  ok(run.status === 'done', 'POST /pipeline/run 完成流水线');

  const ctx = await get(base, `/context/${node.id}`);
  ok(ctx.nodeId === node.id, 'GET /context 返回有效上下文');

  const state = await get(base, '/state');
  ok(state.nodes >= 1 && state.artifacts >= 1, 'GET /state 汇总正确');
  ok(state.events >= 1, '事件已记录');

  console.log('== FR12 文件持久化（重启恢复）==');
  await close(server);
  const { server: server2 } = createApp(stateFile);
  const base2 = await listen(server2);
  const state2 = await get(base2, '/state');
  ok(state2.nodes === state.nodes, '重启后节点数一致');
  ok(state2.artifacts === state.artifacts, '重启后产物数一致');
  ok(state2.events === state.events, '重启后事件数一致');
  await close(server2);

  try { unlinkSync(stateFile); } catch { /* ignore */ }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
