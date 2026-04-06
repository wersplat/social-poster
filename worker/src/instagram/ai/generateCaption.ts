import {
  CaptionSchema,
  type CaptionResult,
  buildCaptionJsonSchema,
  buildCaptionJsonSchemaForGemini,
} from "./captionSchemas.js";
import { buildPrompt } from "./prompt.js";
import { createOpenAIResponse } from "./openaiClient.js";
import { createGeminiResponse } from "./geminiClient.js";
import type { LLMUsage } from "./types.js";
import { deterministicCaption } from "../render/caption.js";
import { logger } from "../util/logger.js";

const CAPTION_PROVIDER_OPENAI = "openai";
const CAPTION_PROVIDER_GEMINI = "gemini";

export type CaptionSource = "openai" | "gemini" | "fallback";

export interface GeneratedCaption extends CaptionResult {
  source: CaptionSource;
  usage?: LLMUsage;
}

function getCaptionProvider(): "openai" | "gemini" {
  const v = process.env.AI_CAPTION_PROVIDER?.toLowerCase().trim();
  if (v === CAPTION_PROVIDER_GEMINI) return "gemini";
  return CAPTION_PROVIDER_OPENAI;
}

export async function generateCaption(
  postType: string,
  payload: unknown
): Promise<GeneratedCaption> {
  const { instructions, user } = buildPrompt(postType, payload);
  const provider = getCaptionProvider();

  if (provider === CAPTION_PROVIDER_OPENAI && !process.env.OPENAI_API_KEY) {
    logger.warn("OPENAI_API_KEY not set; using fallback caption");
    const fallback = buildFallback(postType, payload);
    return { ...fallback, source: "fallback" };
  }
  if (provider === CAPTION_PROVIDER_GEMINI && !process.env.GEMINI_API_KEY) {
    logger.warn("GEMINI_API_KEY not set; using fallback caption");
    const fallback = buildFallback(postType, payload);
    return { ...fallback, source: "fallback" };
  }

  const maxAttempts = 2;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.debug("Calling AI for caption", { postType, provider, attempt });
      const response =
        provider === CAPTION_PROVIDER_GEMINI
          ? await createGeminiResponse({
              instructions,
              input: [{ role: "user", content: user }],
              schema: buildCaptionJsonSchemaForGemini(),
            })
          : await createOpenAIResponse({
              instructions,
              input: [{ role: "user", content: user }],
              schema: buildCaptionJsonSchema(),
            });

      const raw = normalizeJsonResponse(response.outputText);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        logger.warn("Caption JSON parse failed", {
          postType,
          reason: msg,
          rawLength: raw.length,
          rawPreview: raw.slice(0, 200),
        });
        throw parseErr;
      }
      const result = CaptionSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(`Caption schema validation failed: ${result.error.message}`);
      }

      const normalized = normalizeCaptionResult(result.data);
      logger.debug("AI caption generated", { postType, source: provider });
      return {
        ...normalized,
        source: provider,
        usage: response.usage,
      };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTruncated =
        attempt < maxAttempts &&
        (msg.includes("Unterminated string") || msg.includes("Unexpected end of JSON input"));
      if (isTruncated) {
        logger.warn("Caption attempt failed (possible truncation), retrying", {
          postType,
          attempt,
          reason: msg,
        });
        continue;
      }
      break;
    }
  }

  try {
    throw lastErr;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("AI caption failed, using fallback", { postType, reason });
    const fallback = buildFallback(postType, payload);
    return { ...fallback, source: "fallback" };
  }
}

/**
 * Strip markdown code fences and trim so we can parse JSON from Gemini (which may wrap in ```json ... ```).
 */
function normalizeJsonResponse(text: string): string {
  let s = text.trim();
  const jsonBlock = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/;
  const m = s.match(jsonBlock);
  if (m) {
    s = m[1].trim();
  }
  return s;
}

function normalizeCaptionResult(result: CaptionResult): CaptionResult {
  const hashtags = result.hashtags.map((t) => t.trim()).filter(Boolean);
  const caption = result.caption.trim();
  const altText = result.alt_text.trim();
  const cta = result.cta?.trim() || null;

  return {
    ...result,
    caption,
    alt_text: altText,
    cta,
    hashtags,
    variants: result.variants ?? null,
  };
}

function buildFallback(postType: string, payload: unknown): CaptionResult {
  const caption = deterministicCaption.generate(postType, payload);
  const hashtags = buildFallbackHashtags(postType);
  const altText = buildFallbackAltText(postType, payload);

  return {
    caption,
    hashtags,
    alt_text: altText,
    cta: null,
    tone: "pro",
    emoji_level: "none",
    variants: null,
  };
}

function buildFallbackHashtags(postType: string): string[] {
  if (postType === "final_score") {
    return ["#LBA", "#FinalScore", "#Esports", "#Hoops", "#NYC"];
  }
  if (postType === "player_of_game") {
    return ["#LBA", "#PlayerOfTheGame", "#Esports", "#Hoops", "#NYC"];
  }
  if (postType === "weekly_power_rankings") {
    return ["#LBA", "#PowerRankings", "#Esports", "#Hoops", "#NYC"];
  }
  return ["#LBA", "#Esports", "#NYC", "#Hoops", "#Highlights"];
}

function buildFallbackAltText(postType: string, payload: unknown): string {
  if (postType === "final_score" && isRecord(payload)) {
    const home = String(payload.home_team ?? "Home");
    const away = String(payload.away_team ?? "Away");
    const homeScore = String(payload.home_score ?? "");
    const awayScore = String(payload.away_score ?? "");
    return `Final score graphic: ${away} ${awayScore} - ${homeScore} ${home}.`;
  }
  if (postType === "player_of_game" && isRecord(payload)) {
    const player = String(payload.player_name ?? "Player");
    const line = String(payload.stat_line ?? "");
    return `Player of the game graphic featuring ${player}${line ? ` (${line})` : ""}.`;
  }
  if (postType === "weekly_power_rankings" && isRecord(payload)) {
    const week = String(payload.week_label ?? "This week");
    return `${week} power rankings graphic with the top teams.`;
  }
  return "LBA esports graphic.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
