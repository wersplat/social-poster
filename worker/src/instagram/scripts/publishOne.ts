/**
 * One-off script: publish a single scheduled post by ID.
 * Usage: POST_ID=<uuid> pnpm run publish-one
 * Accepts status "rendered" or "failed" (retry after fixing token); requires non-empty asset_urls.
 * Uses same carousel + boxscore logic as the main publish job.
 */
import "../loadEnv.js";
import { withRetry } from "../util/retry.js";
import {
  fetchPostById,
  setPostPublishing,
  updatePostPublished,
  updatePostFailed,
} from "../supabase/queries.js";
import { publishSingleImage } from "../ig/publishSingle.js";
import { publishCarousel } from "../ig/publishCarousel.js";
import { publishStory } from "../ig/publishStory.js";
import type { ScheduledPostRow } from "../supabase/queries.js";
import { logger } from "../util/logger.js";

async function publishPost(post: ScheduledPostRow): Promise<string> {
  const assetUrls = Array.isArray(post.asset_urls) ? post.asset_urls : [];
  const boxscoreFeedUrl =
    typeof post.boxscore_processed_feed_url === "string" &&
    post.boxscore_processed_feed_url.trim() !== ""
      ? post.boxscore_processed_feed_url.trim()
      : null;
  const boxscoreOk =
    boxscoreFeedUrl !== null &&
    String(post.boxscore_status ?? "").toLowerCase() === "processed";

  if (post.post_type === "weekly_power_rankings") {
    return publishCarousel(assetUrls, post.caption ?? undefined);
  }

  if (post.post_type === "final_score") {
    const feedUrls: string[] =
      assetUrls.length > 1
        ? assetUrls
        : boxscoreOk && assetUrls[0]
          ? [assetUrls[0], boxscoreFeedUrl!]
          : assetUrls;

    if (feedUrls.length > 1) {
      logger.info("Publishing as carousel", { id: post.id, slideCount: feedUrls.length });
      return publishCarousel(feedUrls, post.caption ?? undefined);
    }
  }

  return publishSingleImage(assetUrls[0], post.caption ?? undefined);
}

async function main() {
  const postId = process.env.POST_ID;
  if (!postId) {
    logger.error("POST_ID is required. Usage: POST_ID=<uuid> pnpm run publish-one");
    process.exit(1);
  }

  const post = await fetchPostById(postId);
  if (!post) {
    logger.error("Post not found", undefined, { id: postId });
    process.exit(1);
  }

  const canPublish = post.status === "rendered" || post.status === "failed";
  if (!canPublish) {
    logger.error("Post is not publishable (need status rendered or failed)", undefined, {
      id: postId,
      status: post.status,
    });
    process.exit(1);
  }

  if (!post.asset_urls?.length) {
    logger.error("Post has no asset_urls", undefined, { id: postId });
    process.exit(1);
  }

  try {
    await setPostPublishing(post.id);
    const igMediaId = await withRetry(() => publishPost(post), {
      maxAttempts: 3,
      baseMs: 1000,
    });
    await updatePostPublished(post.id, igMediaId);
    logger.info("Published post", { id: post.id, igMediaId });

    if (
      post.post_type === "final_score" &&
      post.boxscore_processed_story_url &&
      String(post.boxscore_status ?? "").toLowerCase() === "processed"
    ) {
      try {
        const storyMediaId = await withRetry(
          () => publishStory(post.boxscore_processed_story_url!),
          { maxAttempts: 3, baseMs: 1000 }
        );
        logger.info("Published boxscore story", { id: post.id, storyMediaId });
      } catch (storyErr) {
        const msg = storyErr instanceof Error ? storyErr.message : String(storyErr);
        logger.warn("Boxscore story publish failed", { id: post.id, err: msg });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updatePostFailed(post.id, msg);
    logger.error("Publish failed", err, { id: post.id });
    process.exit(1);
  }
}

main();
