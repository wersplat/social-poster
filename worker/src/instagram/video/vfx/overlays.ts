/**
 * Optional VFX overlays for video scenes.
 * Maps style_pack to overlay assets (particles, scanline, streak).
 */

import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "src",
  "instagram",
  "render",
  "assets"
);

/** Map style pack to overlay type. Returns path if asset exists, null otherwise. */
export function getOverlayPath(stylePack: string): string | null {
  // regular_season_launch: light streak overlay (low opacity)
  // stage_combine_playground: faint scanline or haze overlay (low opacity)
  const mapping: Record<string, string> = {
    regular_season_launch: "streak.png",
    stage_combine_playground: "scanline.png",
  };

  const filename = mapping[stylePack];
  if (!filename) return null;

  const path = join(ASSETS_DIR, filename);
  return existsSync(path) ? path : null;
}
