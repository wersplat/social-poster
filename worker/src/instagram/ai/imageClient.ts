import { logger } from "../util/logger.js";
import { generateImageImagen } from "./imagenClient.js";

const IMAGE_PROVIDER_OPENAI = "openai";
const IMAGE_PROVIDER_GEMINI = "gemini";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-image-1";
const DEFAULT_SIZE = "1024x1536";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

interface ImagesGenerationsResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string };
}

function getImageProvider(): "openai" | "gemini" {
  const v = process.env.AI_IMAGE_PROVIDER?.toLowerCase().trim();
  if (v === IMAGE_PROVIDER_GEMINI) return "gemini";
  return IMAGE_PROVIDER_OPENAI;
}

/**
 * Generate an image from a text prompt. Dispatches to OpenAI or Imagen (Gemini) based on AI_IMAGE_PROVIDER.
 * Returns a PNG buffer. Uses OPENAI_* or GEMINI_* env vars depending on provider.
 */
export async function generateImage(prompt: string): Promise<Buffer> {
  const provider = getImageProvider();
  if (provider === IMAGE_PROVIDER_GEMINI) {
    return generateImageImagen(prompt);
  }
  return generateImageOpenAI(prompt);
}

/**
 * Call OpenAI Images API (generations), return PNG buffer from b64_json.
 * Uses OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_IMAGE_MODEL, OPENAI_IMAGE_SIZE.
 * Timeout and max 2 retries; never logs the API key.
 */
async function generateImageOpenAI(prompt: string): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY must be set for image generation");
  }

  const baseUrl = (process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_MODEL;
  const size = process.env.OPENAI_IMAGE_SIZE ?? DEFAULT_SIZE;
  const quality = process.env.OPENAI_IMAGE_QUALITY; // optional, include only if set

  const url = `${baseUrl}/images/generations`;
  const body: Record<string, unknown> = {
    model,
    prompt,
    size,
  };
  if (quality) body.quality = quality;
  // GPT image models (gpt-image-1, etc.) always return base64; response_format is only for dall-e-2/dall-e-3 and would cause "Unknown parameter" for GPT models.

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = (await response.json()) as ImagesGenerationsResponse;
      if (data.error?.message) {
        throw new Error(`OpenAI Images API: ${data.error.message}`);
      }
      if (!response.ok) {
        throw new Error(`OpenAI Images API ${response.status}: ${JSON.stringify(data)}`);
      }
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) {
        throw new Error("OpenAI Images API: missing data[0].b64_json");
      }
      const buffer = Buffer.from(b64, "base64");
      logger.info("OpenAI image generated", { size: buffer.length, attempt });
      return buffer;
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES) break;
      logger.warn("OpenAI image attempt failed, retrying", { attempt, err: String(err) });
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr;
}
