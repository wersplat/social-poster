import { sha256Hex } from "./hash.js";
import { buildBgPrompt, buildSuperheroArtPrompt, type PostType, type StylePack } from "./bgPrompts.js";
import { generateImage } from "./imageClient.js";
import { uploadBuffer } from "../storage/r2.js";
import { augmentBackgroundPromptWithGameStory } from "../../ai/gameStoryBackgroundAugment.js";

export type { PostType, StylePack };

export interface GenerateBackgroundParams {
  postType: PostType;
  stylePack: StylePack;
  cacheKey: string;
  payload: Record<string, unknown>;
  /** Pre-resolved game story text (from payload or DB). When present, a Gemini augment step runs before image generation. */
  gameStory?: string | null;
  /** Unused for superhero art (text is Playwright-overlayed); kept for API compatibility. */
  caption?: string | null;
}

export interface GenerateBackgroundResult {
  imageUrl: string;
  prompt: string;
  augmentMeta?: { sentiment: string; keywords: string[] } | null;
}

/**
 * Whether superhero-themed graphics are enabled for `player_of_game` posts.
 * Defaults to false; toggled via POG_SUPERHERO_MODE env var.
 */
export function isSuperheroModeEnabled(): boolean {
  const v = process.env.POG_SUPERHERO_MODE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/**
 * Stable cache key for background plates: post_type + style_pack + style_version + season/week (if present) + optional identifiers.
 * For weekly_power_rankings, one key per week so all 10 slides reuse the same plate.
 */
export function getBackgroundCacheKey(
  postType: PostType,
  stylePack: string,
  styleVersion: number,
  payload: Record<string, unknown>,
  storyHashSuffix?: string | null,
  captionHashSuffix?: string | null,
  /** Separates superhero art-only plates from abstract POG backgrounds for the same match. */
  playerOfGameSuperhero?: boolean
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
    if (playerOfGameSuperhero) {
      parts.push("pog_superhero_v2");
    }
  }
  if (postType === "beat_writer_milestone_flash") {
    parts.push(String(payload.writer_name ?? payload.beat_writer_name ?? ""));
    parts.push(String(payload.milestone_headline ?? payload.milestone ?? payload.headline ?? ""));
    if (payload.milestone_id) parts.push(String(payload.milestone_id));
    if (payload.match_id) parts.push(String(payload.match_id));
  }
  if (storyHashSuffix) {
    parts.push(`gs:${storyHashSuffix}`);
  }
  if (captionHashSuffix) {
    parts.push(`cap:${captionHashSuffix}`);
  }
  return sha256Hex(parts.join(":"));
}

/**
 * Build prompt, optionally augment with game-story mood via Gemini, generate image,
 * upload PNG to R2 at lba/bg/{stylePack}/{cacheKey}.png. Returns public image URL and
 * the final prompt used.
 */
export async function generateBackground(params: GenerateBackgroundParams): Promise<GenerateBackgroundResult> {
  const { postType, stylePack, cacheKey, payload, gameStory } = params;

  const useSuperhero = postType === "player_of_game" && isSuperheroModeEnabled();

  if (useSuperhero) {
    const superheroPrompt = buildSuperheroArtPrompt();
    const buffer = await generateImage(superheroPrompt);
    const r2Key = `lba/bg/${stylePack}/${cacheKey}.png`;
    const imageUrl = await uploadBuffer(r2Key, buffer, "image/png");
    return { imageUrl, prompt: superheroPrompt, augmentMeta: null };
  }

  const basePrompt = buildBgPrompt({ postType, stylePack, payload });
  const augment = await augmentBackgroundPromptWithGameStory({
    basePrompt,
    gameStory: gameStory ?? null,
    postType,
  });
  const buffer = await generateImage(augment.finalPrompt);
  const r2Key = `lba/bg/${stylePack}/${cacheKey}.png`;
  const imageUrl = await uploadBuffer(r2Key, buffer, "image/png");
  return { imageUrl, prompt: augment.finalPrompt, augmentMeta: augment.meta };
}
