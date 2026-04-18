import { chromium } from "playwright";
import { readFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  injectData,
  finalScoreToTemplateData,
  playerOfGameToTemplateData,
  powerRankingsSlideToTemplateData,
  beatWriterMilestoneFlashToTemplateData,
} from "./templateData.js";
import type {
  BeatWriterMilestoneFlashPayload,
  FinalScorePayload,
  PlayerOfGamePayload,
  PowerRankingsPayload,
} from "../util/validate.js";
import { logger } from "../util/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/instagram/render → worker root → src/instagram/render (templates not copied to dist)
const RENDER_DIR = resolve(__dirname, "..", "..", "..", "src", "instagram", "render");
const TEMPLATES_DIR = resolve(RENDER_DIR, "templates");
const ASSETS_DIR = resolve(RENDER_DIR, "assets");

let cachedBaseStyles: string | null = null;
function getBaseStyles(): string {
  if (cachedBaseStyles) return cachedBaseStyles;
  const brand = readFileSync(join(RENDER_DIR, "brand.css"), "utf-8");
  const base = readFileSync(join(TEMPLATES_DIR, "_base.css"), "utf-8");
  cachedBaseStyles = `${brand}\n${base}`;
  return cachedBaseStyles;
}

function withBaseStyles(html: string): string {
  const base = getBaseStyles();
  return html.replace(/<style>([\s\S]*?)<\/style>/, (_, content) => `<style>\n${base}\n${content}</style>`);
}

const VIEWPORT = { width: 1080, height: 1350 };

/** Data URL for fallback background when AI generation fails or is missing. */
let fallbackBgDataUrl: string | null = null;
export function getFallbackBackgroundUrl(): string {
  if (fallbackBgDataUrl) return fallbackBgDataUrl;
  const path = join(ASSETS_DIR, "fallback_bg.png");
  if (!existsSync(path)) return "";
  const buffer = readFileSync(path);
  fallbackBgDataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
  return fallbackBgDataUrl;
}

export interface RenderOptions {
  bgImageUrl?: string | null;
}

export async function renderFinalScore(payload: FinalScorePayload, options?: RenderOptions): Promise<Buffer> {
  let html = readFileSync(join(TEMPLATES_DIR, "final_score.html"), "utf-8");
  html = withBaseStyles(html);
  const data = { ...finalScoreToTemplateData(payload), bg_image_url: options?.bgImageUrl ?? getFallbackBackgroundUrl() };
  return renderHtml(html, data);
}

export async function renderPlayerOfGame(payload: PlayerOfGamePayload, options?: RenderOptions): Promise<Buffer> {
  let html = readFileSync(join(TEMPLATES_DIR, "player_of_game.html"), "utf-8");
  html = withBaseStyles(html);
  const data = { ...playerOfGameToTemplateData(payload), bg_image_url: options?.bgImageUrl ?? getFallbackBackgroundUrl() };
  return renderHtml(html, data);
}

/**
 * Superhero mode: the AI image is the full graphic (name, stats, caption, comic effects),
 * so we only overlay league logo (top-left) and date (bottom-right).
 */
export async function renderPlayerOfGameHero(
  payload: PlayerOfGamePayload,
  options?: RenderOptions
): Promise<Buffer> {
  let html = readFileSync(join(TEMPLATES_DIR, "player_of_game_hero.html"), "utf-8");
  html = withBaseStyles(html);
  const data = {
    ...playerOfGameToTemplateData(payload),
    bg_image_url: options?.bgImageUrl ?? getFallbackBackgroundUrl(),
  };
  return renderHtml(html, data);
}

export async function renderBeatWriterMilestoneFlash(
  payload: BeatWriterMilestoneFlashPayload,
  options?: RenderOptions
): Promise<Buffer> {
  let html = readFileSync(join(TEMPLATES_DIR, "beat_writer_milestone_flash.html"), "utf-8");
  html = withBaseStyles(html);
  const data = {
    ...beatWriterMilestoneFlashToTemplateData(payload),
    bg_image_url: options?.bgImageUrl ?? getFallbackBackgroundUrl(),
  };
  return renderHtml(html, data);
}

export async function renderPowerRankingsSlide(
  payload: PowerRankingsPayload,
  slideIndex: number,
  options?: RenderOptions
): Promise<Buffer> {
  let html = readFileSync(join(TEMPLATES_DIR, "power_rankings_slide.html"), "utf-8");
  html = withBaseStyles(html);
  const data = { ...powerRankingsSlideToTemplateData(payload, slideIndex), bg_image_url: options?.bgImageUrl ?? getFallbackBackgroundUrl() };
  return renderHtml(html, data);
}

export async function renderPowerRankings(payload: PowerRankingsPayload, options?: RenderOptions): Promise<Buffer[]> {
  const buffers: Buffer[] = [];
  for (let i = 0; i < payload.teams.length; i++) {
    buffers.push(await renderPowerRankingsSlide(payload, i, options));
  }
  return buffers;
}

async function renderHtml(html: string, data: Record<string, unknown>): Promise<Buffer> {
  const injected = injectData(html, data);
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewportSize(VIEWPORT);
    await page.setContent(injected, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.fonts.ready);
    const buffer = await page.screenshot({ type: "png" });
    return Buffer.from(buffer);
  } finally {
    await browser.close();
  }
}
