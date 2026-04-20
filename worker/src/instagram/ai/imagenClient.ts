import { logger } from "../util/logger.js";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "imagen-4.0-generate-001";
const DEFAULT_ASPECT_RATIO = "4:5";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

interface ImagenPredictResponse {
  predictions?: Array<{
    bytesBase64Encoded?: string;
    image?: { bytesBase64Encoded?: string };
  }>;
  error?: { message?: string };
}

/**
 * Call Google Imagen API (predict), return PNG buffer from first prediction.
 * Uses GEMINI_API_KEY, GEMINI_BASE_URL, GEMINI_IMAGE_MODEL, GEMINI_IMAGE_ASPECT_RATIO.
 * Same timeout and retry behavior as OpenAI image client.
 */
export async function generateImageImagen(prompt: string): Promise<Buffer> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY must be set for image generation");
  }

  const baseUrl = (process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_MODEL;
  const aspectRatio = process.env.GEMINI_IMAGE_ASPECT_RATIO ?? DEFAULT_ASPECT_RATIO;

  const url = `${baseUrl}/models/${model}:predict?key=${encodeURIComponent(apiKey)}`;
  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio,
    },
  };

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = (await response.json()) as ImagenPredictResponse;
      if (data.error?.message) {
        throw new Error(`Imagen API: ${data.error.message}`);
      }
      if (!response.ok) {
        throw new Error(`Imagen API ${response.status}: ${JSON.stringify(data)}`);
      }

      const first = data.predictions?.[0];
      const b64 =
        first?.bytesBase64Encoded ?? first?.image?.bytesBase64Encoded;
      if (!b64) {
        throw new Error("Imagen API: missing predictions[0].bytesBase64Encoded");
      }
      const buffer = Buffer.from(b64, "base64");
      logger.info("Imagen image generated", { size: buffer.length, attempt });
      return buffer;
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES) break;
      logger.warn("Imagen image attempt failed, retrying", { attempt, err: String(err) });
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr;
}
