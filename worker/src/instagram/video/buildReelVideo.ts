/**
 * Builds reel MP4 from scene images.
 * Same FFmpeg pipeline as story: Ken Burns zoom, fade transitions.
 */

import { buildStoryVideo } from "./buildStoryVideo.js";
import type { VideoSpec } from "./sceneScript.js";

/**
 * Build reel MP4 from VideoSpec and scene image paths.
 * @param spec - VideoSpec with scenes (paths to PNGs)
 * @param outputPath - Output MP4 path
 * @param stylePack - Optional style pack for VFX overlay
 */
export async function buildReelVideo(
  spec: VideoSpec,
  outputPath: string,
  stylePack?: string
): Promise<void> {
  await buildStoryVideo(spec, outputPath, stylePack);
}
