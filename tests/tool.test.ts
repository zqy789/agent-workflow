// ============================================================================
// FR09 工具接入测试 —— `node tests/tool.test.ts`
// 覆盖：工具注册 / listTools / readMaterial（真实联网）/ call / 流水线 tool_call 步骤
// ============================================================================

import { createServer, type Server } from 'node:http';
import { Kernel } from '../src/engine/index.ts';
import { httpToolProvider } from '../src/extensions/builtin/http-tool.ts';
import type { NodeDefinition, PipelineStep } from '../src/model/index.ts';

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

function nodeDef(pipeline: PipelineStep[]): NodeDefinition {
  return {
    name: '工作节点', description: '测试', participants: [], inputRequirements: [], expectedOutputs: ['产物'],
    agentConfig: { kernel: 'demo-agent', rolePrompt: '', tools: [], contextScope: '', uncertaintyStrategyId: '' },
    processingRules: { requireInputsBeforeStart: true, onMissingCriticalInput: 'notify_human' },
    pipeline,
  };
}

async function main() {
  // 起一个本地内容源，模拟「联网读取外部材料」
  const source = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('MATERIAL-CONTENT');
  });
  const base = await listen(source);

  const k = new Kernel();
  k.registerToolProvider(httpToolProvider);

  console.log('== FR09 工具注册与调用 ==');
  const tools = await httpToolProvider.listTools();
  ok(tools.some((t) => t.id === 'http_get'), 'listTools 返回 http_get 工具');

  const mat = await httpToolProvider.readMaterial(`${base}/material`);
  ok(mat.content === 'MATERIAL-CONTENT', 'readMaterial 真实联网读取材料');

  const callOk = await k.callTool('http', 'http_get', { url: `${base}/material` });
  ok(callOk.ok === true && String((callOk.output as { body?: string })?.body).includes('MATERIAL-CONTENT'), 'callTool 调用成功并返回内容');

  const callBad = await httpToolProvider.call('http_get', {});
  ok(callBad.ok === false, '缺少参数时工具返回失败（不伪造结果）');

  console.log('== FR09 流水线 tool_call 步骤 ==');
  const org = k.createOrganization('团队');
  const project = k.createProject(org.id, '项目');
  k.createRequirement(project.id, { goal: '目标', creatorId: 'c', deliveryTarget: '交付', scope: '范围', acceptanceCriteria: [] });
  const node = k.createNode(project.id, nodeDef([
    { id: 't1', type: 'tool_call', config: { provider: 'http', materialRef: `${base}/material` } },
  ]));
  const res = await k.runPipeline(node.id);
  ok(res.status === 'done', 'tool_call 步骤流水线完成');
  const out = res.results[0]?.output as { content?: string } | undefined;
  ok(out?.content === 'MATERIAL-CONTENT', 'tool_call 步骤读取到材料内容');

  await new Promise((r) => source.close(() => r()));

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
