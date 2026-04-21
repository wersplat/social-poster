import { sha256Hex } from "./hash.js";
import { buildBgPrompt, buildSuperheroPrompt, type PostType, type StylePack } from "./bgPrompts.js";
import { generateImage } from "./imageClient.js";
import { uploadBuffer } from "../storage/r2.js";
import { augmentBackgroundPromptWithGameStory } from "../../ai/gameStoryBackgroundAugment.js";
import { captionForHeroOverlay } from "../render/templateData.js";
import type { PlayerOfGamePayload } from "../util/validate.js";

export type { PostType, StylePack };

export interface GenerateBackgroundParams {
  postType: PostType;
  stylePack: StylePack;
  cacheKey: string;
  payload: Record<string, unknown>;
  /** Pre-resolved game story text (from payload or DB). When present, a Gemini augment step runs before image generation. */
  gameStory?: string | null;
  /** Generated AI caption text. When present and superhero mode is enabled for player_of_game, the caption drives the image mood in the prompt. */
  caption?: string | null;
  /** Merged caption (for superhero: deduped quote + cache alignment). */
  mergedCaption?: string | null;
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

/** Short stable suffix derived from caption text, used in cache keys for superhero-mode POG posts. */
export function computeCaptionHashSuffix(caption: string): string {
  return sha256Hex(caption.trim()).slice(0, 12);
}

/** Cache key suffix when superhero prompt includes stat line + quote context. */
export function computeSuperheroPromptCacheSuffix(input: {
  moodCaption: string;
  statLine: string;
  quote: string;
}): string {
  return sha256Hex(`${input.moodCaption}|${input.statLine}|${input.quote}`).slice(0, 12);
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
  captionHashSuffix?: string | null
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
  if (postType === "beat_writer_milestone_flash") {
    parts.push(String(payload.writer_name ?? payload.beat_writer_name ?? ""));
    parts.push(String(payload.milestone_headline ?? payload.milestone ?? payload.headline ?? ""));
    if (payload.milestone_id) parts.push(String(payload.milestone_id));
    if (payload.match_id) parts.push(String(payload.match_id));
  }
  if (
    typeof postType === "string" &&
    postType.startsWith("announcement_") &&
    (payload.season_id || payload.season)
  ) {
    parts.push(String(payload.season_id ?? payload.season));
    parts.push(String(payload.vibe ?? ""));
    parts.push(String(payload.draft_date ?? ""));
    parts.push(String(payload.combine_dates ?? ""));
    parts.push(String(payload.prize_pool ?? ""));
    parts.push(String(payload.headline_override ?? ""));
    parts.push(String(payload.champion_team ?? ""));
    parts.push(String(payload.award_name ?? ""));
    parts.push(String(payload.recipient_name ?? ""));
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
  const { postType, stylePack, cacheKey, payload, gameStory, caption, mergedCaption } = params;

  const useSuperhero =
    postType === "player_of_game" &&
    isSuperheroModeEnabled() &&
    typeof caption === "string" &&
    caption.trim().length > 0;

  if (useSuperhero) {
    const p = payload as PlayerOfGamePayload;
    const quoteSrc = mergedCaption ?? caption!;
    const quote = captionForHeroOverlay(quoteSrc, {
      statLine: p.stat_line,
      playerName: p.player_name,
    });
    const superheroPrompt = buildSuperheroPrompt({
      moodCaption: caption!.trim(),
      playerName: p.player_name,
      teamName: p.team_name,
      statLine: p.stat_line,
      quote,
    });
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
  let outBuf = buffer;
  if (typeof postType === "string" && postType.startsWith("announcement_")) {
    try {
      const { composeAiPostGraphic } = await import("../../card-generator.js");
      outBuf = await composeAiPostGraphic(postType, payload, buffer);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[instagram/ai] compose announcement graphic failed, using raw background:", msg);
    }
  }
  const r2Key = `lba/bg/${stylePack}/${cacheKey}.png`;
  const imageUrl = await uploadBuffer(r2Key, outBuf, "image/png");
  return { imageUrl, prompt: augment.finalPrompt, augmentMeta: augment.meta };
}
