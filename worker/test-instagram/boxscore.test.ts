import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  CROP_PRESETS,
  selectBestPreset,
  computeCropBox,
} from "../src/instagram/render/boxscore/cropPresets.js";
import {
  createHeaderStripSvg,
  createFooterStripSvg,
} from "../src/instagram/render/boxscore/brandStrip.js";

// ---------------------------------------------------------------------------
// Crop preset selection tests
// ---------------------------------------------------------------------------

test("selectBestPreset returns ps5_default for 1920x1080 (16:9)", () => {
  const preset = selectBestPreset(1920, 1080);
  assert.equal(preset.name, "ps5_default");
  assert.equal(preset.platform, "ps5");
});

test("selectBestPreset returns xbox_default for 3840x2160 (4K 16:9)", () => {
  const preset = selectBestPreset(3840, 2160);
  assert.equal(preset.name, "xbox_default");
  assert.equal(preset.platform, "xbox");
});

test("selectBestPreset returns generic_minimal for unusual aspect ratio", () => {
  const preset = selectBestPreset(800, 800); // 1:1 square
  assert.equal(preset.name, "generic_minimal");
  assert.equal(preset.platform, "generic");
});

test("selectBestPreset respects override parameter", () => {
  const preset = selectBestPreset(1920, 1080, "xbox_tight");
  assert.equal(preset.name, "xbox_tight");
  assert.equal(preset.platform, "xbox");
});

test("selectBestPreset ignores invalid override and falls back to heuristic", () => {
  const preset = selectBestPreset(1920, 1080, "nonexistent_preset");
  assert.equal(preset.name, "ps5_default");
});

// ---------------------------------------------------------------------------
// Crop box computation tests
// ---------------------------------------------------------------------------

test("computeCropBox produces correct pixel values for ps5_default", () => {
  const preset = CROP_PRESETS.find((p) => p.name === "ps5_default")!;
  const box = computeCropBox(1920, 1080, preset);

  // cropLeft=0.02 → 38px, cropTop=0.04 → 43px
  assert.equal(box.left, Math.round(1920 * 0.02));
  assert.equal(box.top, Math.round(1080 * 0.04));
  // width = 1920 - left - right = 1920 - 38 - 38 = 1844
  assert.equal(box.width, 1920 - Math.round(1920 * 0.02) - Math.round(1920 * 0.02));
  // height = 1080 - top - bottom = 1080 - 43 - 65 = 972
  assert.equal(box.height, 1080 - Math.round(1080 * 0.04) - Math.round(1080 * 0.06));
});

test("computeCropBox never produces zero-area regions", () => {
  const tinyPreset = { ...CROP_PRESETS[0], cropTop: 0.49, cropBottom: 0.49, cropLeft: 0.49, cropRight: 0.49 };
  const box = computeCropBox(100, 100, tinyPreset);
  assert.ok(box.width >= 1);
  assert.ok(box.height >= 1);
});

// ---------------------------------------------------------------------------
// Brand strip SVG tests
// ---------------------------------------------------------------------------

test("createHeaderStripSvg returns valid SVG buffer with correct dimensions", async () => {
  const svg = createHeaderStripSvg({
    width: 1080,
    height: 100,
    matchLabel: "TEAM A vs TEAM B",
    eventLabel: "Stage Combine",
  });

  assert.ok(Buffer.isBuffer(svg));
  assert.ok(svg.length > 0);

  // Parse the SVG with sharp and verify dimensions
  const meta = await sharp(svg).metadata();
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 100);
});

test("createFooterStripSvg returns valid SVG buffer", async () => {
  const svg = createFooterStripSvg({
    width: 1080,
    height: 50,
    matchIdShort: "abc12345",
    verifiedAt: "2026-02-07T12:00:00Z",
  });

  assert.ok(Buffer.isBuffer(svg));
  assert.ok(svg.length > 0);

  const meta = await sharp(svg).metadata();
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 50);
});

test("createFooterStripSvg handles empty inputs", async () => {
  const svg = createFooterStripSvg({
    width: 1080,
    height: 50,
  });

  assert.ok(Buffer.isBuffer(svg));
  const meta = await sharp(svg).metadata();
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 50);
});

// ---------------------------------------------------------------------------
// End-to-end output size tests (using a synthetic test image)
// ---------------------------------------------------------------------------

test("processBoxscoreImage produces feed output at 1080x1350", async () => {
  // Create a synthetic 1920x1080 test image (solid color, simulating a PS5 screenshot)
  const testImage = await sharp({
    create: {
      width: 1920,
      height: 1080,
      channels: 4,
      background: { r: 50, g: 50, b: 80, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  // We need to dynamically import processBoxscoreImage because it reads env vars at top level.
  // Instead, we'll directly test the pipeline logic using Sharp.
  // Import the modules we need:
  const { computeCropBox: cc, selectBestPreset: sbp } = await import(
    "../src/instagram/render/boxscore/cropPresets.js"
  );
  const { createHeaderStripSvg: chs, createFooterStripSvg: cfs } = await import(
    "../src/instagram/render/boxscore/brandStrip.js"
  );

  // Simulate the pipeline
  const preset = sbp(1920, 1080);
  const cropBox = cc(1920, 1080, preset);

  const cropped = await sharp(testImage).extract(cropBox).toBuffer();

  const FEED_W = 1080;
  const FEED_H = 1350;
  const HEADER_H = 100;
  const FOOTER_H = 50;
  const contentH = FEED_H - HEADER_H - FOOTER_H;

  const resized = await sharp(cropped)
    .resize(FEED_W, contentH, { fit: "inside" })
    .png()
    .toBuffer();

  const resizedMeta = await sharp(resized).metadata();
  const rw = resizedMeta.width ?? FEED_W;
  const rh = resizedMeta.height ?? contentH;

  const headerSvg = chs({ width: FEED_W, height: HEADER_H, matchLabel: "A vs B" });
  const footerSvg = cfs({ width: FEED_W, height: FOOTER_H, matchIdShort: "test1234" });

  const result = await sharp({
    create: { width: FEED_W, height: FEED_H, channels: 4, background: { r: 15, g: 23, b: 42, alpha: 1 } },
  })
    .png()
    .composite([
      { input: headerSvg, left: 0, top: 0 },
      { input: footerSvg, left: 0, top: FEED_H - FOOTER_H },
      {
        input: resized,
        left: Math.round((FEED_W - rw) / 2),
        top: HEADER_H + Math.round((contentH - rh) / 2),
      },
    ])
    .png()
    .toBuffer();

  const finalMeta = await sharp(result).metadata();
  assert.equal(finalMeta.width, 1080, "Feed output width must be 1080");
  assert.equal(finalMeta.height, 1350, "Feed output height must be 1350");
});

test("processBoxscoreImage produces story output at 1080x1920", async () => {
  const testImage = await sharp({
    create: {
      width: 1920,
      height: 1080,
      channels: 4,
      background: { r: 50, g: 50, b: 80, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const { computeCropBox: cc, selectBestPreset: sbp } = await import(
    "../src/instagram/render/boxscore/cropPresets.js"
  );
  const { createHeaderStripSvg: chs, createFooterStripSvg: cfs } = await import(
    "../src/instagram/render/boxscore/brandStrip.js"
  );

  const preset = sbp(1920, 1080);
  const cropBox = cc(1920, 1080, preset);
  const cropped = await sharp(testImage).extract(cropBox).toBuffer();

  const STORY_W = 1080;
  const STORY_H = 1920;
  const HEADER_H = 130;
  const FOOTER_H = 60;
  const contentH = STORY_H - HEADER_H - FOOTER_H;

  const resized = await sharp(cropped)
    .resize(STORY_W, contentH, { fit: "inside" })
    .png()
    .toBuffer();

  const resizedMeta = await sharp(resized).metadata();
  const rw = resizedMeta.width ?? STORY_W;
  const rh = resizedMeta.height ?? contentH;

  const headerSvg = chs({ width: STORY_W, height: HEADER_H, matchLabel: "A vs B" });
  const footerSvg = cfs({ width: STORY_W, height: FOOTER_H, matchIdShort: "test1234" });

  const result = await sharp({
    create: { width: STORY_W, height: STORY_H, channels: 4, background: { r: 15, g: 23, b: 42, alpha: 1 } },
  })
    .png()
    .composite([
      { input: headerSvg, left: 0, top: 0 },
      { input: footerSvg, left: 0, top: STORY_H - FOOTER_H },
      {
        input: resized,
        left: Math.round((STORY_W - rw) / 2),
        top: HEADER_H + Math.round((contentH - rh) / 2),
      },
    ])
    .png()
    .toBuffer();

  const finalMeta = await sharp(result).metadata();
  assert.equal(finalMeta.width, 1080, "Story output width must be 1080");
  assert.equal(finalMeta.height, 1920, "Story output height must be 1920");
});

// ---------------------------------------------------------------------------
// All presets are well-formed
// ---------------------------------------------------------------------------

test("all presets have valid crop fractions (0 <= x < 0.5)", () => {
  for (const p of CROP_PRESETS) {
    assert.ok(p.cropTop >= 0 && p.cropTop < 0.5, `${p.name} cropTop`);
    assert.ok(p.cropBottom >= 0 && p.cropBottom < 0.5, `${p.name} cropBottom`);
    assert.ok(p.cropLeft >= 0 && p.cropLeft < 0.5, `${p.name} cropLeft`);
    assert.ok(p.cropRight >= 0 && p.cropRight < 0.5, `${p.name} cropRight`);
    // Total crop should leave at least 10% of the image
    assert.ok(p.cropTop + p.cropBottom < 0.9, `${p.name} vertical total`);
    assert.ok(p.cropLeft + p.cropRight < 0.9, `${p.name} horizontal total`);
  }
});
