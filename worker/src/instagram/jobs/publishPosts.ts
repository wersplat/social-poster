import { withRetry } from "../util/retry.js";
import {
  fetchPostsToPublish,
  setPostPublishing,
  updatePostPublished,
  updatePostFailed,
} from "../supabase/queries.js";
import { publishSingleImage } from "../ig/publishSingle.js";
import { publishCarousel } from "../ig/publishCarousel.js";
import { publishStory } from "../ig/publishStory.js";
import { TokenExpiredError } from "../ig/metaClient.js";
import type { ScheduledPostRow } from "../supabase/queries.js";
import { logger } from "../util/logger.js";

export async function publishPosts() {
  logger.info("Starting publishPosts job");

  const posts = await fetchPostsToPublish();
  logger.info("Fetched posts to publish", { count: posts.length });

  for (const post of posts) {
    try {
      await setPostPublishing(post.id);

      const igMediaId = await withRetry(
        () => publishPost(post),
        {
          maxAttempts: 3,
          baseMs: 1000,
          isRetryable: (err) => !(err instanceof TokenExpiredError),
        }
      );

      await updatePostPublished(post.id, igMediaId);
      logger.info("Published post", { id: post.id, igMediaId });

      // After publishing feed post, also publish boxscore as a Story
      if (
        post.post_type === "final_score" &&
        post.boxscore_processed_story_url &&
        post.boxscore_status === "processed"
      ) {
        try {
          const storyMediaId = await withRetry(
            () => publishStory(post.boxscore_processed_story_url!),
            {
              maxAttempts: 3,
              baseMs: 1000,
              isRetryable: (err) => !(err instanceof TokenExpiredError),
            }
          );
          logger.info("Published boxscore story", {
            id: post.id,
            storyMediaId,
          });
        } catch (storyErr) {
          // Story failure is non-fatal – feed post already published
          const storyMsg =
            storyErr instanceof Error ? storyErr.message : String(storyErr);
          logger.warn("Boxscore story publish failed (feed already published)", {
            id: post.id,
            err: storyMsg,
          });
        }
      }
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        const msg = err.message;
        await updatePostFailed(post.id, msg);
        logger.error(
          "Publish stopped: access token expired. Refresh META_ACCESS_TOKEN and re-run the job.",
          err,
          { id: post.id }
        );
        logger.info("Remaining posts left in queue; run publish again after refreshing token.");
        break;
      }
      const msg = err instanceof Error ? err.message : String(err);
      await updatePostFailed(post.id, msg);
      logger.error("Publish failed", err, { id: post.id });
    }
  }

  logger.info("publishPosts job complete");
}

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

  logger.info("Publish decision", {
    id: post.id,
    post_type: post.post_type,
    asset_urls_count: assetUrls.length,
    has_boxscore_feed_url: !!boxscoreFeedUrl,
    boxscore_status: post.boxscore_status ?? "(null)",
    boxscore_ok: boxscoreOk,
  });

  // Carousel: power rankings or final_score with boxscore slide(s)
  if (post.post_type === "weekly_power_rankings") {
    return publishCarousel(assetUrls, post.caption ?? undefined);
  }

  if (post.post_type === "final_score") {
    // Use carousel when we have multiple assets, or when boxscore was processed (in case asset_urls was never updated with slide 2)
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
    logger.info("Publishing as single (no carousel)", {
      id: post.id,
      reason:
        assetUrls.length > 1
          ? "n/a"
          : !boxscoreOk
            ? "boxscore not ready"
            : !assetUrls[0]
              ? "no first slide URL"
              : "unknown",
    });
  }

  return publishSingleImage(assetUrls[0], post.caption ?? undefined);
}
