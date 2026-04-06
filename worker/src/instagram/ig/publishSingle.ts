import {
  createImageContainer,
  publishContainer,
  waitForContainerReady,
} from "./metaClient.js";
import { logger } from "../util/logger.js";

export async function publishSingleImage(
  imageUrl: string,
  caption?: string
): Promise<string> {
  const creationId = await createImageContainer(imageUrl, caption);
  logger.info("Created image container", { creationId });
  await waitForContainerReady(creationId);
  const mediaId = await publishContainer(creationId);
  logger.info("Published to Instagram", { mediaId });
  return mediaId;
}
