/**
 * Crop presets for NBA 2K boxscore screenshots.
 *
 * Each preset defines percentage-based crop margins to remove surrounding
 * UI chrome (navigation bars, button prompts, etc.) and isolate the
 * boxscore stat table region.
 *
 * Percentage values are relative to the full image dimension:
 *   cropTop 0.05 = remove top 5% of image height.
 */

export interface CropPreset {
  /** Unique preset name, e.g. "ps5_default" */
  name: string;
  /** Platform hint */
  platform: "ps5" | "xbox" | "generic";
  /** Fraction of height to remove from top (0–1) */
  cropTop: number;
  /** Fraction of height to remove from bottom (0–1) */
  cropBottom: number;
  /** Fraction of width to remove from left (0–1) */
  cropLeft: number;
  /** Fraction of width to remove from right (0–1) */
  cropRight: number;
  /** Human-readable description */
  description: string;
}

export interface CropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Preset library
// ---------------------------------------------------------------------------

export const CROP_PRESETS: CropPreset[] = [
  {
    name: "ps5_default",
    platform: "ps5",
    cropTop: 0.04,
    cropBottom: 0.06,
    cropLeft: 0.02,
    cropRight: 0.02,
    description: "PS5 default boxscore – removes top nav bar and bottom button prompts",
  },
  {
    name: "ps5_tight",
    platform: "ps5",
    cropTop: 0.08,
    cropBottom: 0.10,
    cropLeft: 0.04,
    cropRight: 0.04,
    description: "PS5 tight crop – aggressive removal of surrounding UI for cleaner look",
  },
  {
    name: "xbox_default",
    platform: "xbox",
    cropTop: 0.04,
    cropBottom: 0.06,
    cropLeft: 0.02,
    cropRight: 0.02,
    description: "Xbox default boxscore – removes guide bar and bottom prompts",
  },
  {
    name: "xbox_tight",
    platform: "xbox",
    cropTop: 0.08,
    cropBottom: 0.10,
    cropLeft: 0.04,
    cropRight: 0.04,
    description: "Xbox tight crop – aggressive removal of surrounding UI",
  },
  {
    name: "generic_minimal",
    platform: "generic",
    cropTop: 0.02,
    cropBottom: 0.02,
    cropLeft: 0.01,
    cropRight: 0.01,
    description: "Minimal crop for unknown sources – just trims edges",
  },
];

// ---------------------------------------------------------------------------
// Preset selection heuristic
// ---------------------------------------------------------------------------

/**
 * Select the best crop preset based on input image dimensions.
 *
 * PS5 screenshots are typically 1920×1080 (16:9 landscape).
 * Xbox screenshots are typically 1920×1080 as well but can also be
 * 3840×2160 (4K). We differentiate by resolution when possible.
 *
 * Falls back to generic_minimal when dimensions are unexpected.
 */
export function selectBestPreset(
  width: number,
  height: number,
  override?: string
): CropPreset {
  if (override) {
    const found = CROP_PRESETS.find((p) => p.name === override);
    if (found) return found;
  }

  const ratio = width / height;

  // Standard 16:9 landscape (1920×1080, 3840×2160, etc.)
  if (ratio >= 1.7 && ratio <= 1.8) {
    // 4K resolution → likely Xbox Series X
    if (width >= 3840) {
      return CROP_PRESETS.find((p) => p.name === "xbox_default")!;
    }
    // Standard 1080p – default to PS5 (most common in NBA 2K community)
    return CROP_PRESETS.find((p) => p.name === "ps5_default")!;
  }

  // 9:16 portrait (phone screenshot of boxscore, unlikely but handle)
  if (ratio >= 0.5 && ratio <= 0.6) {
    return CROP_PRESETS.find((p) => p.name === "generic_minimal")!;
  }

  // Fallback
  return CROP_PRESETS.find((p) => p.name === "generic_minimal")!;
}

// ---------------------------------------------------------------------------
// Crop box computation
// ---------------------------------------------------------------------------

/**
 * Compute the pixel-level crop box from a preset and image dimensions.
 * All values are clamped to ensure we never produce zero-area regions.
 */
export function computeCropBox(
  imageWidth: number,
  imageHeight: number,
  preset: CropPreset
): CropBox {
  const left = Math.round(imageWidth * preset.cropLeft);
  const top = Math.round(imageHeight * preset.cropTop);
  const right = Math.round(imageWidth * preset.cropRight);
  const bottom = Math.round(imageHeight * preset.cropBottom);

  const width = Math.max(1, imageWidth - left - right);
  const height = Math.max(1, imageHeight - top - bottom);

  return { left, top, width, height };
}
