// ============================================================================
// LLM 连接配置（FR09「内核可配置」的连接层）
// ----------------------------------------------------------------------------
// 配置点：通过环境变量提供，不硬编码。
//   DEEPSEEK_API_KEY    必填，DeepSeek 平台的 API Key
//   DEEPSEEK_BASE_URL   可选，默认 https://api.deepseek.com
//   DEEPSEEK_MODEL      可选，默认 deepseek-chat（reasoner 模型为 deepseek-reasoner）
// ============================================================================

export interface LlmConfig {
  provider: 'deepseek';
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function loadLlmConfig(env: Record<string, string | undefined> = process.env): LlmConfig {
  return {
    provider: 'deepseek',
    apiKey: env.DEEPSEEK_API_KEY ?? '',
    baseUrl: env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    model: env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  };
}
