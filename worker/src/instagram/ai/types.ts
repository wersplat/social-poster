/**
 * Shared types for LLM responses across providers (OpenAI, Gemini).
 */

export interface LLMUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface LLMResponseResult {
  outputText: string;
  responseId?: string;
  usage?: LLMUsage;
}
