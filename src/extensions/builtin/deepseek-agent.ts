// ============================================================================
// DeepSeek Agent 内核（真实 LLM，OpenAI 兼容协议）
// ----------------------------------------------------------------------------
// 实现 AgentKernel 扩展点：把节点上下文组织成提示词 → 调 DeepSeek → 解析为 Analysis。
// 未配置 key 时明确返回「未配置」，不伪造结果（FR09）。
// ============================================================================

import type { AgentContext, AgentKernel, Analysis } from '../index.ts';

export interface DeepSeekAgentOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

const SYSTEM_PROMPT = [
  '你是研发协作平台中的「节点 Agent」，负责判断依赖节点交付的产物是否满足本节点的输入要求。',
  '你的输出必须是 JSON，且只输出 JSON，不要输出任何解释或 Markdown 代码块。',
  'JSON 结构：',
  '{"satisfied":[{"requirementId":"...","artifactRef":{"artifactId":"...","version":1},"content":"..."}],',
  '"missing":[{"requirementId":"...","what":"...","why":"..."}],',
  '"conflicts":[{"sources":["..."],"detail":"..."}],',
  '"adaptable":[{"from":"...","to":"...","mapping":"..."}],',
  '"openIssues":[{"fact":"...","suggestedOwner":"..."}],',
  '"impacts":[{"work":"...","suggestion":"...","recheckCondition":"..."}]}',
  '对没有证据的业务含义不要臆断为已确认事实；金额单位未定义时应请求澄清，而不是自行决定转换规则。',
].join('\n');

export function buildAnalysisPrompt(ctx: AgentContext): string {
  const lines: string[] = [];
  lines.push('## 目标与范围');
  for (const s of ctx.goalAndScope) lines.push(`- ${s}`);
  lines.push('');
  lines.push('## 输入要求');
  for (const ir of ctx.inputRequirements) {
    lines.push(`- [${ir.necessity}] ${ir.description}（满足条件：${ir.satisfyCondition}）`);
  }
  lines.push('');
  lines.push('## 依赖产物');
  if (ctx.dependencyArtifacts.length === 0) lines.push('- （无）');
  for (const a of ctx.dependencyArtifacts) {
    lines.push(`- ${a.nodeId} v${a.version}: ${a.description}`);
  }
  lines.push('');
  lines.push('请分析上述产物是否满足输入要求，并按系统提示的 JSON 结构输出。');
  return lines.join('\n');
}

/** 宽松解析 LLM 返回：剥离代码围栏、截取大括号、字段兜底为数组 */
export function parseAnalysis(raw: string): Analysis {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
    const openIssues: Analysis['openIssues'] = arr(o.openIssues).map((it) => {
      if (typeof it === 'string') return { fact: it };
      if (it && typeof it === 'object' && 'fact' in it) return { fact: String((it as { fact: unknown }).fact) };
      return { fact: JSON.stringify(it) };
    });
    return {
      satisfied: arr(o.satisfied) as Analysis['satisfied'],
      missing: arr(o.missing) as Analysis['missing'],
      conflicts: arr(o.conflicts) as Analysis['conflicts'],
      adaptable: arr(o.adaptable) as Analysis['adaptable'],
      openIssues,
      impacts: arr(o.impacts) as Analysis['impacts'],
    };
  } catch {
    return {
      satisfied: [], missing: [], conflicts: [], adaptable: [],
      openIssues: [{ fact: raw.slice(0, 500) }],
      impacts: [],
    };
  }
}

export class DeepSeekAgentKernel implements AgentKernel {
  readonly id = 'deepseek';
  readonly model: string;
  readonly baseUrl: string;
  readonly configured: boolean;
  private apiKey: string;

  constructor(opts: DeepSeekAgentOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://api.deepseek.com').replace(/\/+$/, '');
    this.model = opts.model ?? 'deepseek-chat';
    this.configured = Boolean(this.apiKey);
  }

  async analyze(ctx: AgentContext): Promise<Analysis> {
    if (!this.configured) {
      return {
        satisfied: [], missing: [], conflicts: [], adaptable: [],
        openIssues: [{ fact: 'DeepSeek API Key 未配置：请设置环境变量 DEEPSEEK_API_KEY', suggestedOwner: '管理员' }],
        impacts: [],
      };
    }
    const content = await this.chat(buildAnalysisPrompt(ctx));
    return parseAnalysis(content);
  }

  private async chat(prompt: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        stream: false,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`DeepSeek API 错误 ${res.status}: ${t.slice(0, 300)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content) throw new Error('DeepSeek API 返回内容为空');
    return content;
  }
}
