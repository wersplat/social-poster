/**
 * Publish video (Story and Reel) to Instagram.
 * Runs after renderVideos; requires video_status=rendered.
 */

import { withRetry } from "../util/retry.js";
import {
  fetchPostsForVideoPublish,
  updateVideoFields,
} from "../supabase/queries.js";
import { publishStoryVideo } from "../ig/publishStoryVideo.js";
import { publishReelVideo } from "../ig/publishReelVideo.js";
import { TokenExpiredError } from "../ig/metaClient.js";
import { logger } from "../util/logger.js";

export async function publishVideos() {
  logger.info("Starting publishVideos job");

  const posts = await fetchPostsForVideoPublish();
  logger.info("Fetched posts for video publish", { count: posts.length });

  for (const post of posts) {
    try {
      const surfaces = post.publish_surface ?? [];

      if (surfaces.includes("story") && post.video_story_url) {
        await withRetry(
          () => publishStoryVideo(post.video_story_url!),
          {
            maxAttempts: 3,
            baseMs: 1000,
            isRetryable: (err) => !(err instanceof TokenExpiredError),
          }
        );
        logger.info("Published story video", { id: post.id });
      }

      if (surfaces.includes("reel") && post.video_reel_url) {
        await withRetry(
          () => publishReelVideo(post.video_reel_url!, post.caption ?? undefined),
          {
            maxAttempts: 3,
            baseMs: 1000,
            isRetryable: (err) => !(err instanceof TokenExpiredError),
          }
        );
        logger.info("Published reel video", { id: post.id });
      }

      await updateVideoFields(post.id, {
        video_status: "published",
        video_error: null,
      });
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        const msg = err.message;
        await updateVideoFields(post.id, {
          video_status: "failed",
          video_error: msg,
        });
        logger.error(
          "Video publish stopped: access token expired. Refresh META_ACCESS_TOKEN.",
          err,
          { id: post.id }
        );
        break;
      }
      const msg = err instanceof Error ? err.message : String(err);
      await updateVideoFields(post.id, {
        video_status: "failed",
        video_error: msg,
      });
      logger.error("Video publish failed", err, { id: post.id });
    }
  }

  logger.info("publishVideos job complete");
}
