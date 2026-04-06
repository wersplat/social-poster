import {
  createCarouselChild,
  createCarouselParent,
  publishContainer,
  waitForContainerReady,
} from "./metaClient.js";
import { logger } from "../util/logger.js";

export async function publishCarousel(
  imageUrls: string[],
  caption?: string
): Promise<string> {
  const childIds: string[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const id = await createCarouselChild(imageUrls[i]);
    childIds.push(id);
    logger.debug("Created carousel child", { index: i, creationId: id });
  }
  const parentId = await createCarouselParent(childIds, caption);
  logger.info("Created carousel parent", { parentId });
  await waitForContainerReady(parentId);
  const mediaId = await publishContainer(parentId);
  logger.info("Published carousel to Instagram", { mediaId });
  return mediaId;
}
