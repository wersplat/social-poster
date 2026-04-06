/**
 * Publish a video as an Instagram Story.
 *
 * Uses the STORIES media_type container flow:
 *   1. Create video container with video_url and media_type=STORIES
 *   2. Poll until status_code is FINISHED or PUBLISHED
 *   3. Publish container
 */

import {
  createVideoContainer,
  waitForContainerReady,
  publishContainer,
} from "./metaClient.js";
import { logger } from "../util/logger.js";

/** Video processing can take longer than images; use 5 min max wait. */
const VIDEO_MAX_WAIT_MS = 300_000;
const VIDEO_POLL_INTERVAL_MS = 3000;

export async function publishStoryVideo(videoUrl: string): Promise<string> {
  const creationId = await createVideoContainer({
    video_url: videoUrl,
    media_type: "STORIES",
  });
  logger.info("Created story video container", { creationId });
  await waitForContainerReady(creationId, {
    pollIntervalMs: VIDEO_POLL_INTERVAL_MS,
    maxWaitMs: VIDEO_MAX_WAIT_MS,
  });
  const mediaId = await publishContainer(creationId);
  logger.info("Published story video to Instagram", { mediaId });
  return mediaId;
}
