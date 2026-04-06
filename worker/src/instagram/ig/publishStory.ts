import {
  createStoryContainer,
  publishContainer,
  waitForContainerReady,
} from "./metaClient.js";
import { logger } from "../util/logger.js";

/**
 * Publish a single image as an Instagram Story.
 *
 * Uses the STORIES media_type container flow:
 *   1. Create story container with image_url
 *   2. Wait for container FINISHED status
 *   3. Publish container
 */
export async function publishStory(imageUrl: string): Promise<string> {
  const creationId = await createStoryContainer(imageUrl);
  logger.info("Created story container", { creationId });
  await waitForContainerReady(creationId);
  const mediaId = await publishContainer(creationId);
  logger.info("Published story to Instagram", { mediaId });
  return mediaId;
}
