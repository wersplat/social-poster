/**
 * Boxscore image processing pipeline.
 *
 * Downloads a submitted NBA 2K boxscore screenshot, crops it to remove
 * surrounding UI chrome, resizes to Instagram-ready dimensions, and
 * composites branded header/footer strips.
 *
 * Produces two variants:
 *   - Feed image  (1080 × 1350)  for carousel Slide 2
 *   - Story image (1080 × 1920)  for Instagram Stories
 */

import sharp from "sharp";
import { selectBestPreset, computeCropBox } from "./cropPresets.js";
import type { CropPreset } from "./cropPresets.js";
import { createHeaderStripSvg, createFooterStripSvg } from "./brandStrip.js";
import { logger } from "../../util/logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Instagram feed post (4:5 portrait) */
const FEED_WIDTH = 1080;
const FEED_HEIGHT = 1350;

/** Instagram story (9:16 portrait) */
const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;

/** Brand background color (midnight-court-blue) */
const BG_COLOR = { r: 15, g: 23, b: 42, alpha: 1 }; // #0f172a

/** Header strip heights per format */
const FEED_HEADER_HEIGHT = 100;
const FEED_FOOTER_HEIGHT = 50;
const STORY_HEADER_HEIGHT = 130;
const STORY_FOOTER_HEIGHT = 60;

/** LBA logo URL (env override or default) */
const LBA_LOGO_URL =
  process.env.LBA_LOGO_URL ?? "https://logo.proamrank.gg/lba.avif";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ProcessBoxscoreOptions {
  /** URL of the original submitted boxscore screenshot */
  sourceUrl: string;
  /** Matchup label for branding, e.g. "TEAM A vs TEAM B" */
  matchLabel?: string;
  /** Event / league label, e.g. "Stage Combine" */
  eventLabel?: string;
  /** Match UUID (used for footer hash) */
  matchId?: string;
  /** Verification timestamp (ISO string) */
  verifiedAt?: string;
  /** Force a specific crop preset name instead of auto-selecting */
  cropPresetOverride?: string;
}

export interface ProcessBoxscoreResult {
  /** PNG buffer for Instagram feed (1080×1350) */
  feedBuffer: Buffer;
  /** PNG buffer for Instagram story (1080×1920) */
  storyBuffer: Buffer;
  /** Name of the crop preset that was used */
  preset: string;
}

/**
 * Main entry point: download, crop, resize, brand, and export boxscore images.
 */
export async function processBoxscoreImage(
  opts: ProcessBoxscoreOptions
): Promise<ProcessBoxscoreResult> {
  const { sourceUrl, matchLabel, eventLabel, matchId, verifiedAt, cropPresetOverride } = opts;

  // 1. Download source image into buffer
  logger.info("Downloading boxscore source image", { url: sourceUrl });
  const sourceBuffer = await downloadImage(sourceUrl);

  // 2. Read metadata
  const metadata = await sharp(sourceBuffer).metadata();
  const srcWidth = metadata.width;
  const srcHeight = metadata.height;
  if (!srcWidth || !srcHeight) {
    throw new Error("Unable to read image dimensions from boxscore source");
  }
  logger.debug("Boxscore source dimensions", { width: srcWidth, height: srcHeight });

  // 3. Select crop preset
  const preset: CropPreset = selectBestPreset(srcWidth, srcHeight, cropPresetOverride);
  logger.debug("Selected crop preset", { preset: preset.name });

  // 4. Crop
  const cropBox = computeCropBox(srcWidth, srcHeight, preset);
  const croppedBuffer = await sharp(sourceBuffer)
    .extract(cropBox)
    .toBuffer();
  logger.debug("Cropped boxscore", { ...cropBox });

  // 5. Generate both output formats in parallel
  const matchIdShort = matchId ? matchId.slice(0, 8) : undefined;

  const [feedBuffer, storyBuffer] = await Promise.all([
    buildOutputImage({
      croppedBuffer,
      canvasWidth: FEED_WIDTH,
      canvasHeight: FEED_HEIGHT,
      headerHeight: FEED_HEADER_HEIGHT,
      footerHeight: FEED_FOOTER_HEIGHT,
      matchLabel,
      eventLabel,
      matchIdShort,
      verifiedAt,
    }),
    buildOutputImage({
      croppedBuffer,
      canvasWidth: STORY_WIDTH,
      canvasHeight: STORY_HEIGHT,
      headerHeight: STORY_HEADER_HEIGHT,
      footerHeight: STORY_FOOTER_HEIGHT,
      matchLabel,
      eventLabel,
      matchIdShort,
      verifiedAt,
    }),
  ]);

  logger.info("Boxscore processing complete", { preset: preset.name });

  return { feedBuffer, storyBuffer, preset: preset.name };
}

// ---------------------------------------------------------------------------
// Internal: build a single output image
// ---------------------------------------------------------------------------

interface BuildOutputOptions {
  croppedBuffer: Buffer;
  canvasWidth: number;
  canvasHeight: number;
  headerHeight: number;
  footerHeight: number;
  matchLabel?: string;
  eventLabel?: string;
  matchIdShort?: string;
  verifiedAt?: string;
}

async function buildOutputImage(opts: BuildOutputOptions): Promise<Buffer> {
  const {
    croppedBuffer,
    canvasWidth,
    canvasHeight,
    headerHeight,
    footerHeight,
    matchLabel,
    eventLabel,
    matchIdShort,
    verifiedAt,
  } = opts;

  // Available area for the boxscore image (between header and footer)
  const contentHeight = canvasHeight - headerHeight - footerHeight;
  const contentWidth = canvasWidth;

  // Resize cropped boxscore to fit inside the content area, preserving aspect ratio
  const resizedBoxscore = await sharp(croppedBuffer)
    .resize(contentWidth, contentHeight, {
      fit: "inside",
      withoutEnlargement: false,
      background: BG_COLOR,
    })
    .png()
    .toBuffer();

  // Get resized dimensions for centering
  const resizedMeta = await sharp(resizedBoxscore).metadata();
  const resizedW = resizedMeta.width ?? contentWidth;
  const resizedH = resizedMeta.height ?? contentHeight;

  // Center the boxscore image horizontally and vertically within the content area
  const boxscoreLeft = Math.round((contentWidth - resizedW) / 2);
  const boxscoreTop = headerHeight + Math.round((contentHeight - resizedH) / 2);

  // Generate header strip SVG
  const headerSvg = createHeaderStripSvg({
    width: canvasWidth,
    height: headerHeight,
    matchLabel,
    eventLabel,
  });

  // Generate footer strip SVG
  const footerSvg = createFooterStripSvg({
    width: canvasWidth,
    height: footerHeight,
    matchIdShort,
    verifiedAt,
  });

  // Try to download LBA logo for compositing into header
  let logoComposite: sharp.OverlayOptions | undefined;
  try {
    const logoBuffer = await downloadImage(LBA_LOGO_URL);
    const resizedLogo = await sharp(logoBuffer)
      .resize(32, 32, { fit: "inside" })
      .png()
      .toBuffer();
    // Place logo at top-left area of header (to the left of "LBA" text)
    logoComposite = {
      input: resizedLogo,
      left: 30,
      top: Math.round((headerHeight - 32) / 2),
    };
  } catch {
    // Logo download failed – text fallback in SVG is sufficient
    logger.debug("LBA logo download failed, using text fallback");
  }

  // Build the compositing layers
  const composites: sharp.OverlayOptions[] = [
    // Header strip
    {
      input: headerSvg,
      left: 0,
      top: 0,
    },
    // Footer strip
    {
      input: footerSvg,
      left: 0,
      top: canvasHeight - footerHeight,
    },
    // Boxscore image (centered in content area)
    {
      input: resizedBoxscore,
      left: boxscoreLeft,
      top: boxscoreTop,
    },
  ];

  // Add logo overlay if available (offset to not clash with "LBA" text)
  if (logoComposite) {
    // Shift "LBA" text position is handled in SVG;
    // place logo just before text area for a nice touch.
    // Actually, since the SVG already has "LBA" text, we skip the logo
    // overlay to avoid visual collision. The logo is better used when
    // we have a proper transparent PNG. For now, the text in the SVG
    // serves as the logo fallback.
  }

  // Create the final canvas and composite everything
  const output = await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: BG_COLOR,
    },
  })
    .png()
    .composite(composites)
    .png({ quality: 90 })
    .toBuffer();

  return output;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Download an image from a URL into a Buffer.
 * Throws on non-OK responses.
 */
async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download image: ${res.status} ${res.statusText} (${url})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
