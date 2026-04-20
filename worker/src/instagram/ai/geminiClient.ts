import { logger } from "../util/logger.js";
import type { LLMResponseResult, LLMUsage } from "./types.js";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_TEMPERATURE = 1.0;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 5000;

interface GeminiGenerateContentParams {
  instructions: string;
  input: Array<{ role: "user" | "system" | "developer" | "assistant"; content: string }>;
  schema: Record<string, unknown>;
}

interface GeminiResponseBody {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string; thought?: boolean }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { message?: string; code?: number };
}

class NonRetryableError extends Error {
  name = "NonRetryableError";
}

export async function createGeminiResponse(
  params: GeminiGenerateContentParams
): Promise<LLMResponseResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY must be set");
  }

  const baseUrl = (process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const temperature = parseNumber(process.env.GEMINI_TEMPERATURE, DEFAULT_TEMPERATURE);
  const maxOutputTokens = parseNumber(
    process.env.GEMINI_MAX_OUTPUT_TOKENS,
    DEFAULT_MAX_OUTPUT_TOKENS
  );

  const userContent = params.input.find((m) => m.role === "user")?.content ?? "";
  const prompt = [params.instructions, userContent].filter(Boolean).join("\n\n");

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens,
      responseMimeType: "application/json",
      responseSchema: params.schema,
    },
  };

  const url = `${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        timeoutMs
      );

      const data = (await response.json()) as GeminiResponseBody;

      if (data.error?.message) {
        throw new NonRetryableError(`Gemini error: ${data.error.message}`);
      }
      if (!response.ok) {
        const errText = JSON.stringify(data);
        if (!isRetryableStatus(response.status) || attempt === DEFAULT_MAX_ATTEMPTS) {
          throw new NonRetryableError(`Gemini error ${response.status}: ${errText}`);
        }
        await backoff(attempt);
        continue;
      }

      const outputText = extractOutputText(data, logger, model, attempt);
      const usage = mapUsage(data.usageMetadata);
      return { outputText, usage };
    } catch (err) {
      if (attempt === DEFAULT_MAX_ATTEMPTS || !isRetryableError(err)) {
        throw err;
      }
      await backoff(attempt);
    }
  }

  throw new Error("Gemini request failed after retries");
}

function extractOutputText(
  data: GeminiResponseBody,
  log: typeof logger,
  model: string,
  attempt: number
): string {
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const finishReason = candidate?.finishReason;
  const text = parts
    .filter((p) => !p.thought)
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("")
    .trim();
  log.info("Gemini response received", {
    model,
    attempt,
    partCount: parts.length,
    outputLength: text.length,
    finishReason: finishReason ?? undefined,
  });
  if (text.length) {
    return text;
  }
  throw new Error("Gemini response missing output text");
}

function mapUsage(usageMetadata?: GeminiResponseBody["usageMetadata"]): LLMUsage | undefined {
  if (!usageMetadata) return undefined;
  const input = usageMetadata.promptTokenCount;
  const output = usageMetadata.candidatesTokenCount;
  const total = usageMetadata.totalTokenCount;
  if (input === undefined && output === undefined && total === undefined) return undefined;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: total,
  };
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

async function backoff(attempt: number): Promise<void> {
  const delay = Math.min(
    DEFAULT_BASE_DELAY_MS * Math.pow(2, attempt - 1),
    DEFAULT_MAX_DELAY_MS
  );
  await new Promise((resolve) => setTimeout(resolve, delay));
}
