/**
 * Strongly typed scene script for deterministic motion-graphics video.
 * Used for Stories and Reels.
 */

export type OverlayType = "none" | "particles" | "scanline" | "streak";

export interface Scene {
  /** Local temp path after download/render (PNG) */
  imageUrlOrPath: string;
  /** Duration in seconds */
  durationSec: number;
  /** Ken Burns zoom: scale from zoomFrom to zoomTo across scene duration. Default 1.00 -> 1.04 */
  motion?: { zoomFrom: number; zoomTo: number };
  /** Optional VFX overlay */
  overlay?: OverlayType;
  /** Reserve top safe area in pixels (title safe) */
  titleSafeTopPx?: number;
}

export interface Transition {
  type: "fade";
  durationSec: number;
}

export interface VideoSpec {
  width: 1080;
  height: 1920;
  fps: number;
  scenes: Scene[];
  transition: Transition;
  audio: { silent: true };
}

export const DEFAULT_MOTION: Scene["motion"] = {
  zoomFrom: 1.0,
  zoomTo: 1.04,
};
