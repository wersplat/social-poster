import pLimit from "p-limit";
import {
  fetchPostsToRender,
  updatePostRendered,
  updateBoxscoreFields,
  fetchBgAssetByCacheKey,
  insertBgAsset,
  updatePostBackground,
  updatePostBackgroundFailed,
} from "../supabase/queries.js";
import { uploadBuffer } from "../storage/r2.js";
import {
  renderFinalScore,
  renderPlayerOfGame,
  renderPowerRankings,
  renderBeatWriterMilestoneFlash,
  getFallbackBackgroundUrl,
} from "../render/playwright.js";
import { processBoxscoreImage } from "../render/boxscore/processBoxscore.js";
import { generateCaption } from "../ai/generateCaption.js";
import { getBackgroundCacheKey, generateBackground, type PostType, type StylePack } from "../ai/generateBackground.js";
import { parsePayload } from "../util/validate.js";
import type {
  BeatWriterMilestoneFlashPayload,
  FinalScorePayload,
  PlayerOfGamePayload,
  PowerRankingsPayload,
} from "../util/validate.js";
import { logger } from "../util/logger.js";
import { mergeCaption } from "../util/captionMerge.js";

const CONCURRENCY = 2;
const limit = pLimit(CONCURRENCY);

async function resolveBackgroundUrl(
  post: {
    id: string;
    post_type: string;
    bg_image_url: string | null;
    bg_style_pack: string | null;
    style_version: number | null;
    payload_json: unknown;
  }
): Promise<string> {
  const stylePack = (post.bg_style_pack ?? "regular") as StylePack;
  const styleVersion = post.style_version ?? 1;
  const payload = post.payload_json as Record<string, unknown>;
  const cacheKey = getBackgroundCacheKey(
    post.post_type as PostType,
    stylePack,
    styleVersion,
    payload
  );

  const existing = await fetchBgAssetByCacheKey(cacheKey);
  if (existing) {
    await updatePostBackground(post.id, {
      bg_image_url: existing.image_url,
      bg_prompt: existing.prompt,
      bg_style_pack: existing.style_pack,
      bg_cache_key: existing.cache_key,
      bg_status: "generated",
    });
    return existing.image_url;
  }

  try {
    const { imageUrl, prompt } = await generateBackground({
      postType: post.post_type as PostType,
      stylePack,
      cacheKey,
      payload,
    });
    await insertBgAsset({
      cache_key: cacheKey,
      style_pack: stylePack,
      prompt,
      image_url: imageUrl,
    });
    await updatePostBackground(post.id, {
      bg_image_url: imageUrl,
      bg_prompt: prompt,
      bg_style_pack: stylePack,
      bg_cache_key: cacheKey,
      bg_status: "generated",
    });
    return imageUrl;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("Background generation failed, using fallback", { id: post.id, err: msg });
    await updatePostBackgroundFailed(post.id, msg);
    return getFallbackBackgroundUrl();
  }
}

export async function renderPosts() {
  logger.info("Starting renderPosts job");

  const posts = await fetchPostsToRender();
  logger.info("Fetched posts to render", { count: posts.length });

  for (const post of posts) {
    await limit(async () => {
      try {
        if (post.asset_urls?.length) {
          logger.debug("Skipping already rendered", { id: post.id });
          return;
        }

        const payload = parsePayload(post.post_type, post.payload_json);
        const shouldRegen = !post.caption || post.force_regen;
        let baseCaption = post.caption ?? "";
        let captionMeta:
          | {
              hashtags: string[];
              alt_text: string;
              cta: string | null;
              tone: string;
              emoji_level: string;
              ai_variants: unknown | null;
            }
          | undefined;

        if (shouldRegen) {
          const aiResult = await generateCaption(post.post_type, payload);
          logger.info("Caption source", { id: post.id, source: aiResult.source });
          baseCaption = aiResult.caption;
          captionMeta = {
            hashtags: aiResult.hashtags,
            alt_text: aiResult.alt_text,
            cta: aiResult.cta,
            tone: aiResult.tone,
            emoji_level: aiResult.emoji_level,
            ai_variants: aiResult.variants ?? null,
          };
          if (aiResult.usage) {
            logger.info("Caption usage", { id: post.id, source: aiResult.source, usage: aiResult.usage });
          }
        } else if (post.hashtags?.length && post.alt_text) {
          captionMeta = {
            hashtags: post.hashtags,
            alt_text: post.alt_text,
            cta: post.cta ?? null,
            tone: post.tone ?? "pro",
            emoji_level: post.emoji_level ?? "none",
            ai_variants: post.ai_variants ?? null,
          };
        }

        const { mergedCaption, mergedHashtags } = mergeCaption(
          baseCaption,
          captionMeta?.hashtags ?? []
        );
        if (captionMeta) {
          captionMeta.hashtags = mergedHashtags;
        }

        let bgImageUrl: string = post.bg_image_url ?? "";
        if (!bgImageUrl) {
          bgImageUrl = await resolveBackgroundUrl(post);
        }
        if (!bgImageUrl) {
          bgImageUrl = getFallbackBackgroundUrl();
        }
        const renderOpts = { bgImageUrl };

        const assetUrls: string[] = [];

        if (post.post_type === "final_score") {
          const fsPayload = payload as FinalScorePayload;

          // Slide 1: existing branded Final Score graphic
          const buf = await renderFinalScore(fsPayload, renderOpts);
          const url = await uploadBuffer(
            `posts/${post.id}/0.png`,
            buf,
            "image/png"
          );
          assetUrls.push(url);

          // Slide 2: processed boxscore screenshot (if available)
          const boxscoreUrl =
            fsPayload.boxscore_url ?? post.boxscore_source_url ?? null;

          if (boxscoreUrl) {
            // Idempotency: skip if already processed and not forcing regen
            if (
              post.boxscore_processed_feed_url &&
              post.boxscore_status === "processed" &&
              !post.force_regen
            ) {
              logger.debug("Reusing cached boxscore images", { id: post.id });
              assetUrls.push(post.boxscore_processed_feed_url);
            } else {
              try {
                const { feedBuffer, storyBuffer, preset } =
                  await processBoxscoreImage({
                    sourceUrl: boxscoreUrl,
                    matchLabel: `${fsPayload.home_team} vs ${fsPayload.away_team}`,
                    eventLabel: fsPayload.event_label ?? undefined,
                    matchId: fsPayload.match_id,
                    verifiedAt: post.created_at,
                  });

                const feedUrl = await uploadBuffer(
                  `boxscores/processed/${fsPayload.match_id}/feed.png`,
                  feedBuffer,
                  "image/png"
                );
                const storyUrl = await uploadBuffer(
                  `boxscores/processed/${fsPayload.match_id}/story.png`,
                  storyBuffer,
                  "image/png"
                );

                assetUrls.push(feedUrl); // Slide 2 for carousel

                await updateBoxscoreFields(post.id, {
                  boxscore_source_url: boxscoreUrl,
                  boxscore_processed_feed_url: feedUrl,
                  boxscore_processed_story_url: storyUrl,
                  boxscore_crop_preset: preset,
                  boxscore_status: "processed",
                  boxscore_error: null,
                });

                logger.info("Boxscore processed", {
                  id: post.id,
                  preset,
                  matchId: fsPayload.match_id,
                });
              } catch (err) {
                const msg =
                  err instanceof Error ? err.message : String(err);
                logger.warn("Boxscore processing failed, publishing slide 1 only", {
                  id: post.id,
                  err: msg,
                });
                await updateBoxscoreFields(post.id, {
                  boxscore_source_url: boxscoreUrl,
                  boxscore_status: "failed",
                  boxscore_error: msg,
                });
                // Continue with just Slide 1
              }
            }
          }
        } else if (post.post_type === "player_of_game") {
          const buf = await renderPlayerOfGame(payload as PlayerOfGamePayload, renderOpts);
          const url = await uploadBuffer(
            `posts/${post.id}/0.png`,
            buf,
            "image/png"
          );
          assetUrls.push(url);
        } else if (post.post_type === "weekly_power_rankings") {
          const bufs = await renderPowerRankings(payload as PowerRankingsPayload, renderOpts);
          for (let i = 0; i < bufs.length; i++) {
            const url = await uploadBuffer(
              `posts/${post.id}/${i}.png`,
              bufs[i],
              "image/png"
            );
            assetUrls.push(url);
          }
        } else if (post.post_type === "beat_writer_milestone_flash") {
          const buf = await renderBeatWriterMilestoneFlash(
            payload as BeatWriterMilestoneFlashPayload,
            renderOpts
          );
          const url = await uploadBuffer(
            `posts/${post.id}/0.png`,
            buf,
            "image/png"
          );
          assetUrls.push(url);
        } else {
          throw new Error(`Unknown post_type: ${post.post_type}`);
        }

        await updatePostRendered(post.id, assetUrls, mergedCaption, captionMeta);
        logger.info("Rendered post", { id: post.id, postType: post.post_type });
      } catch (err) {
        logger.error("Render failed", err, { id: post.id });
        throw err;
      }
    });
  }

  logger.info("renderPosts job complete");
}
