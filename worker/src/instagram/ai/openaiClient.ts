import { logger } from "../util/logger.js";
import type { LLMResponseResult, LLMUsage } from "./types.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4.1-mini-2025-04-14";
const DEFAULT_TEMPERATURE = 0.6;
const DEFAULT_MAX_OUTPUT_TOKENS = 500;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 5000;

/** @deprecated Use LLMUsage from ./types.js */
export type OpenAIUsage = LLMUsage;

/** @deprecated Use LLMResponseResult from ./types.js */
export type OpenAIResponseResult = LLMResponseResult;

interface OpenAIResponseBody {
  id?: string;
  status?: string;
  error?: { message?: string };
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  output_text?: string;
  incomplete_details?: { reason?: string };
  usage?: LLMUsage;
  model?: string;
}

class NonRetryableError extends Error {
  name = "NonRetryableError";
}

export async function createOpenAIResponse(params: {
  instructions: string;
  input: Array<{ role: "user" | "system" | "developer" | "assistant"; content: string }>;
  schema: Record<string, unknown>;
}): Promise<LLMResponseResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY must be set");
  }

  const baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const temperature = parseNumber(process.env.OPENAI_TEMPERATURE, DEFAULT_TEMPERATURE);
  const maxOutputTokens = parseNumber(
    process.env.OPENAI_MAX_OUTPUT_TOKENS,
    DEFAULT_MAX_OUTPUT_TOKENS
  );

  const body = {
    model,
    instructions: params.instructions,
    input: params.input,
    temperature,
    max_output_tokens: maxOutputTokens,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "caption_output",
        schema: params.schema,
        strict: true,
      },
    },
  };

  const url = `${baseUrl.replace(/\/$/, "")}/responses`;
  const timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        timeoutMs
      );

      if (!response.ok) {
        const errText = await safeReadText(response);
        if (!isRetryableStatus(response.status) || attempt === DEFAULT_MAX_ATTEMPTS) {
          throw new NonRetryableError(
            `OpenAI error ${response.status}: ${errText || response.statusText}`
          );
        }
        await backoff(attempt);
        continue;
      }

      const data = (await response.json()) as OpenAIResponseBody;
      if (data.error?.message) {
        throw new NonRetryableError(`OpenAI error: ${data.error.message}`);
      }
      if (data.status && data.status !== "completed") {
        const reason = data.incomplete_details?.reason ?? data.status;
        throw new NonRetryableError(`OpenAI response not completed: ${reason}`);
      }

      const outputText = extractOutputText(data);
      if (data.id) {
        logger.info("OpenAI response received", { request_id: data.id, model: data.model });
      }
      return { outputText, responseId: data.id, usage: data.usage };
    } catch (err) {
      if (attempt === DEFAULT_MAX_ATTEMPTS || !isRetryableError(err)) {
        throw err;
      }
      await backoff(attempt);
    }
  }

  throw new Error("OpenAI request failed after retries");
}

function extractOutputText(data: OpenAIResponseBody): string {
  if (typeof data.output_text === "string" && data.output_text.length) {
    return data.output_text;
  }

  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "refusal") {
        throw new Error(`OpenAI refusal: ${content.refusal ?? "refused"}`);
      }
      if (content.type === "output_text" && content.text) {
        return content.text;
      }
    }
  }
  throw new Error("OpenAI response missing output text");
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error && err.name === "NonRetryableError") return false;
  return true;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function backoff(attempt: number) {
  const delay = Math.min(
    DEFAULT_BASE_DELAY_MS * Math.pow(2, attempt - 1),
    DEFAULT_MAX_DELAY_MS
  );
  await new Promise((resolve) => setTimeout(resolve, delay));
}
