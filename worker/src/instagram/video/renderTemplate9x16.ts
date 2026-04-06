/**
 * Render 9:16 HTML templates (1080x1920) to PNG buffers via Playwright.
 */

import { chromium } from "playwright";
import { readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { injectData } from "../render/templateData.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "instagram",
  "video",
  "templates"
);
const RENDER_DIR = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "instagram",
  "render"
);

const VIEWPORT_9X16 = { width: 1080, height: 1920 };

let cachedStyles: string | null = null;
function getBaseStyles(): string {
  if (cachedStyles) return cachedStyles;
  const brand = readFileSync(join(RENDER_DIR, "brand.css"), "utf-8");
  const base9x16 = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  width: 1080px; height: 1920px;
  background: linear-gradient(135deg, var(--lba-midnight-court-blue) 0%, var(--lba-dynasty-purple) 100%);
  background-size: cover;
  background-position: center;
  color: var(--lba-text);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px;
}
.logo { width: 56px; height: 56px; object-fit: contain; }
.logo:not([src]), .logo[src=""], img.logo-empty { display: none; }
.header { display: flex; align-items: center; gap: 12px; position: absolute; top: 40px; left: 50%; transform: translateX(-50%); }
`;
  cachedStyles = `${brand}\n${base9x16}`;
  return cachedStyles;
}

function withBaseStyles(html: string): string {
  const base = getBaseStyles();
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  if (match) {
    return html.replace(match[0], `<style>\n${base}\n${match[1]}</style>`);
  }
  return html.replace("</head>", `<style>\n${base}\n</style>\n</head>`);
}

export async function renderTemplate9x16(
  templateName: string,
  data: Record<string, unknown>
): Promise<Buffer> {
  const templatePath = join(TEMPLATES_DIR, `${templateName}.html`);
  let html = readFileSync(templatePath, "utf-8");
  html = withBaseStyles(html);
  const injected = injectData(html, data);

  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewportSize(VIEWPORT_9X16);
    await page.setContent(injected, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.fonts.ready);
    const buffer = await page.screenshot({ type: "png" });
    return Buffer.from(buffer);
  } finally {
    await browser.close();
  }
}
