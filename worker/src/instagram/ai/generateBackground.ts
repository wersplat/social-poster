import { sha256Hex } from "./hash.js";
import { buildBgPrompt, type PostType, type StylePack } from "./bgPrompts.js";
import { generateImage } from "./imageClient.js";
import { uploadBuffer } from "../storage/r2.js";

export type { PostType, StylePack };

export interface GenerateBackgroundParams {
  postType: PostType;
  stylePack: StylePack;
  cacheKey: string;
  payload: Record<string, unknown>;
}

export interface GenerateBackgroundResult {
  imageUrl: string;
  prompt: string;
}

/**
 * Stable cache key for background plates: post_type + style_pack + style_version + season/week (if present) + optional identifiers.
 * For weekly_power_rankings, one key per week so all 10 slides reuse the same plate.
 */
export function getBackgroundCacheKey(
  postType: PostType,
  stylePack: string,
  styleVersion: number,
  payload: Record<string, unknown>
): string {
  const parts: string[] = [postType, stylePack, String(styleVersion)];
  if (postType === "weekly_power_rankings" && payload.week_label) {
    parts.push(String(payload.week_label));
  }
  if (postType === "final_score" && payload.match_id) {
    parts.push(String(payload.match_id));
  }
  if (postType === "player_of_game" && payload.match_id) {
    parts.push(String(payload.match_id));
  }
  return sha256Hex(parts.join(":"));
}

/**
 * Build prompt, call OpenAI image generation, upload PNG to R2 at lba/bg/{stylePack}/{cacheKey}.png.
 * Returns public image URL and the prompt used.
 */
export async function generateBackground(params: GenerateBackgroundParams): Promise<GenerateBackgroundResult> {
  const { postType, stylePack, cacheKey, payload } = params;
  const prompt = buildBgPrompt({ postType, stylePack, payload });
  const buffer = await generateImage(prompt);
  const r2Key = `lba/bg/${stylePack}/${cacheKey}.png`;
  const imageUrl = await uploadBuffer(r2Key, buffer, "image/png");
  return { imageUrl, prompt };
}
