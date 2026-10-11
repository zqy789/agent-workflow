// ============================================================================
// infrastructure · DeepSeek Agent 内核（真实 LLM，OpenAI 兼容协议）
// ----------------------------------------------------------------------------
// 设计依据：docs/04-v02-design.md §8 能力体系（Agent Models：换模型 = 改配置）
//   - 实现 AgentKernel 端口：把节点上下文组织成提示词 → 调 LLM → 解析产出；
//   - 未配置 key 时明确降级为离线语义，不伪造结果；
//   - 可扩展性测试 #2：节点配置 agentKernel='deepseek' 即换内核，内核代码零改动。
// ============================================================================

import type { AgentContext, AgentKernel, AgentResult } from '../../domain/ports.ts';

export interface DeepSeekAgentOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

const SYSTEM_PROMPT = [
  '你是「节点 Agent」：协作树中的一个工作单元（可被配置为任何能力：研发/设计/CI-CD/…）。',
  '你会收到：树的目标与你的职责、收到的输入 I、分支回流产物 O、组合进本节点的 SKILL 内容。',
  '请基于这些事实完成本节点的产出，并把未决问题写进 notes。',
  '只输出 JSON，不要输出任何解释或 Markdown 代码块。结构：',
  '{"output":"产出的具体内容（将作为 O 自动上行）","notes":["备注/未决事项"]}',
  '对没有证据的业务含义不要臆断为已确认事实。',
].join('\n');

/** 组织提示词：内核只给「事实」，语义判断交给 Agent（设计 §FR04 同构） */
export function buildAgentPrompt(ctx: AgentContext): string {
  const lines: string[] = [];
  lines.push('## 目标与职责');
  for (const s of ctx.goalAndScope) lines.push(`- ${s}`);
  lines.push('');
  lines.push('## 收到的输入 I');
  if (ctx.inputs.length === 0) lines.push('- （无）');
  for (const i of ctx.inputs) lines.push(`- ${JSON.stringify(i.content)}`);
  lines.push('');
  lines.push('## 分支回流产物 O');
  if (ctx.branchProducts.length === 0) lines.push('- （无）');
  for (const p of ctx.branchProducts) lines.push(`- v${p.version}: ${JSON.stringify(p.content)}`);
  lines.push('');
  lines.push('## 组合的 SKILL');
  if (ctx.skills.length === 0) lines.push('- （无）');
  for (const sk of ctx.skills) lines.push(`### ${sk.id}\n${sk.content}`);
  lines.push('');
  lines.push('请产出本节点的成果（按系统提示的 JSON 结构）。');
  return lines.join('\n');
}

/** 宽松解析：剥离代码围栏、截取大括号、字段兜底 */
export function parseAgentResult(raw: string): AgentResult {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    const o = JSON.parse(text) as { output?: unknown; notes?: unknown };
    return {
      output: o.output ?? raw,
      notes: Array.isArray(o.notes) ? o.notes.map(String) : undefined,
    };
  } catch {
    return { output: raw };
  }
}

export class DeepSeekAgentKernel implements AgentKernel {
  readonly id = 'deepseek';
  readonly model: string;
  readonly baseUrl: string;
  readonly configured: boolean;
  private readonly apiKey: string;

  constructor(opts: DeepSeekAgentOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://api.deepseek.com').replace(/\/+$/, '');
    this.model = opts.model ?? 'deepseek-chat';
    this.configured = Boolean(this.apiKey);
  }

  async act(ctx: AgentContext): Promise<AgentResult> {
    if (!this.configured) {
      return {
        output: `${ctx.nodeName} 产出（DeepSeek 未配置：请设置环境变量 DEEPSEEK_API_KEY；当前为离线降级语义）`,
        notes: [...ctx.goalAndScope],
      };
    }
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildAgentPrompt(ctx) },
        ],
        temperature: 0.3,
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
    return parseAgentResult(content);
  }
}
