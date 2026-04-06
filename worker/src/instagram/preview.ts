#!/usr/bin/env node
/**
 * Preview templates locally using fixture data.
 * Usage: npx tsx src/preview.ts [final_score|player_of_game|power_rankings]
 * Saves PNG to preview_output/. Uses fallback background when no AI bg URL is set.
 */
import { readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import {
  injectData,
  finalScoreToTemplateData,
  playerOfGameToTemplateData,
  powerRankingsSlideToTemplateData,
} from "./render/templateData.js";
import { getFallbackBackgroundUrl } from "./render/playwright.js";
import type { FinalScorePayload, PlayerOfGamePayload, PowerRankingsPayload } from "./util/validate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "render", "templates");
const FIXTURES_DIR = join(__dirname, "render", "fixtures");
const OUTPUT_DIR = join(__dirname, "..", "..", "preview_output");

function loadJson<T>(name: string): T {
  const p = join(FIXTURES_DIR, `${name}.json`);
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

async function main() {
  const template = process.argv[2] ?? "final_score";
  const outDir = OUTPUT_DIR;
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const bgImageUrl = getFallbackBackgroundUrl();

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1080, height: 1350 });

  if (template === "final_score") {
    const payload = loadJson<FinalScorePayload>("final_score");
    const html = readFileSync(join(TEMPLATES_DIR, "final_score.html"), "utf-8");
    const data = { ...finalScoreToTemplateData(payload), bg_image_url: bgImageUrl };
    await page.setContent(injectData(html, data), { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.fonts.ready);
    await page.screenshot({ path: join(outDir, "final_score.png"), type: "png" });
    console.log(`Saved ${outDir}/final_score.png`);
  } else if (template === "player_of_game") {
    const payload = loadJson<PlayerOfGamePayload>("player_of_game");
    const html = readFileSync(join(TEMPLATES_DIR, "player_of_game.html"), "utf-8");
    const data = { ...playerOfGameToTemplateData(payload), bg_image_url: bgImageUrl };
    await page.setContent(injectData(html, data), { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.fonts.ready);
    await page.screenshot({ path: join(outDir, "player_of_game.png"), type: "png" });
    console.log(`Saved ${outDir}/player_of_game.png`);
  } else if (template === "power_rankings") {
    const payload = loadJson<PowerRankingsPayload>("power_rankings");
    const html = readFileSync(join(TEMPLATES_DIR, "power_rankings_slide.html"), "utf-8");
    for (let i = 0; i < payload.teams.length; i++) {
      const data = { ...powerRankingsSlideToTemplateData(payload, i), bg_image_url: bgImageUrl };
      await page.setContent(injectData(html, data), { waitUntil: "networkidle" });
      await page.waitForFunction(() => document.fonts.ready);
      await page.screenshot({ path: join(outDir, `power_rankings_${i + 1}.png`), type: "png" });
    }
    console.log(`Saved ${outDir}/power_rankings_1.png through power_rankings_${payload.teams.length}.png`);
  } else {
    console.error("Usage: npx tsx src/preview.ts [final_score|player_of_game|power_rankings]");
    process.exit(1);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
