// ============================================================================
// 最小可运行示例：从空白到「依赖适配 + 补充后继续 + 有效上下文」
// ----------------------------------------------------------------------------
// 运行：node examples/basic-flow.ts   （需 Node >= 24，原生运行 TypeScript）
// 演示内核与扩展点的分工：
//   - 内核：对象创建、关系、事件/产物回传、结构检查、上下文组织、状态机
//   - 扩展点：DemoAgentKernel 做语义分析（可替换为真实 LLM/MCP 内核）
// ============================================================================

import { Kernel } from '../src/engine/index.ts';
import { exampleNodeDefinition } from '../src/config/index.ts';
import type { AgentContext, AgentKernel, Analysis } from '../src/extensions/index.ts';

// 一个「演示版」Agent 内核：把输入要求与依赖产物做朴素关键词匹配。
// 真实实现会换成 LLM/MCP，但接口不变——这正是可扩展点的意义。
const demoAgent: AgentKernel = {
  id: 'demo-agent',
  async analyze(ctx: AgentContext): Promise<Analysis> {
    const satisfied: Analysis['satisfied'] = [];
    const missing: Analysis['missing'] = [];
    const openIssues: Analysis['openIssues'] = [];
    const impacts: Analysis['impacts'] = [];

    for (const ir of ctx.inputRequirements) {
      const tokens = extractTokens(ir);
      const candidates = ctx.dependencyArtifacts.filter((a) => tokens.some((t) => a.description.includes(t)));
      const first = candidates[0];
      if (first) {
        satisfied.push({
          requirementId: ir.id,
          artifactRef: { artifactId: first.id, version: first.version },
          content: `${ir.description} ← ${first.nodeId} 产物 v${first.version}（${first.description}）`,
        });
      } else {
        missing.push({ requirementId: ir.id, what: ir.description, why: `依赖方暂无「${ir.expectedForm}」产物` });
        openIssues.push({ fact: `缺少 ${ir.description}`, suggestedOwner: ir.basis ?? '节点责任人' });
        impacts.push({
          work: '渲染工作被阻塞',
          suggestion: `请上游补充：${ir.satisfyCondition}`,
          recheckCondition: '上游提交新版本后复查',
        });
      }
    }
    return { satisfied, missing, conflicts: [], adaptable: [], openIssues, impacts };
  },
};

function extractTokens(ir: { description: string }): string[] {
  // 演示用朴素分词：取描述中「的」之后的名词，再按并列词切分
  const m = ir.description.match(/的([\u4e00-\u9fa5]+)$/);
  if (!m) return [];
  return m[1].split(/[与、，,]/).filter(Boolean);
}

async function main() {
  const k = new Kernel();

  // 1. 组织 / 项目 / 需求
  const org = k.createOrganization('示例研发团队');
  const project = k.createProject(org.id, '示例需求项目');
  const req = k.createRequirement(project.id, {
    goal: '交付一个可渲染页面',
    creatorId: 'member-pm',
    deliveryTarget: '产品页面可访问',
    scope: '本期一个页面',
    acceptanceCriteria: ['页面可访问', '符合验收规则'],
  });
  k.transitionRequirement(req.id, '进行中');

  // 2. 三个上游节点 + 依赖关系（产品 / 后端 / 设计）
  const product = k.createNode(project.id, {
    name: '产品节点',
    description: '输出规则与验收要求',
    participants: [],
    inputRequirements: [],
    expectedOutputs: ['PRD 与验收规则'],
    agentConfig: exampleNodeDefinition.agentConfig,
    processingRules: exampleNodeDefinition.processingRules,
    pipeline: [],
  });
  const backend = k.createNode(project.id, {
    name: '后端节点',
    description: '输出接口与约束',
    participants: [],
    inputRequirements: [],
    expectedOutputs: ['接口契约'],
    agentConfig: exampleNodeDefinition.agentConfig,
    processingRules: exampleNodeDefinition.processingRules,
    pipeline: [],
  });
  const design = k.createNode(project.id, {
    name: '设计节点',
    description: '输出交互与资源',
    participants: [],
    inputRequirements: [],
    expectedOutputs: ['交互稿与切图'],
    agentConfig: exampleNodeDefinition.agentConfig,
    processingRules: exampleNodeDefinition.processingRules,
    pipeline: [],
  });

  // 3. 研发节点（用示例配置），依赖产品/后端/设计
  const dev = k.createNode(project.id, exampleNodeDefinition);
  k.addRelation(project.id, 'dependency', product.id, dev.id, '需要产品规则');
  k.addRelation(project.id, 'dependency', backend.id, dev.id, '需要后端接口');
  k.addRelation(project.id, 'dependency', design.id, dev.id, '需要设计资源');

  // 4. 上游提交产物（设计先不提交，制造关键缺口）
  k.submitArtifact(product.id, 'member-pm', 'PRD 与验收规则 v1');
  k.submitArtifact(backend.id, 'member-be', '接口契约与错误码定义 v1');

  console.log('==== 1) 结构适配检查（设计缺失）====');
  console.log(JSON.stringify(k.structuralInputCheck(dev.id), null, 2));

  console.log('\n==== 2) Agent 语义分析（扩展点，设计缺失 → 缺口/影响）====');
  const analysis1 = await k.analyzeNode(dev.id, demoAgent);
  console.log(JSON.stringify(analysis1, null, 2));

  // 5. 设计补充产物 → 重新分析（补充后继续）
  k.submitArtifact(design.id, 'member-design', '交互稿与切图资源 v1');

  console.log('\n==== 3) 补充后重新分析（全部满足）====');
  const analysis2 = await k.analyzeNode(dev.id, demoAgent);
  console.log(JSON.stringify(analysis2, null, 2));

  // 6. 有效上下文（派生）
  console.log('\n==== 4) 研发节点有效上下文 ====');
  console.log(JSON.stringify(k.organizeContext(dev.id), null, 2));

  // 7. 状态机：推进节点
  k.transitionNode(dev.id, '处理中');
  k.transitionNode(dev.id, '本轮结束');
  console.log('\n==== 5) 节点执行状态 ====');
  console.log(k.store.requireNode(dev.id).executionStatus);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
