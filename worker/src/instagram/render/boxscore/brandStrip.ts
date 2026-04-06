/**
 * Brand strip SVG generators for boxscore images.
 *
 * Produces SVG buffers that can be composited onto the final canvas via Sharp.
 * Uses inline SVG text rendering – no external font files required (system
 * sans-serif stack with bold weight produces a clean, professional look).
 */

// ---------------------------------------------------------------------------
// Brand colors (mirrors brand.css tokens)
// ---------------------------------------------------------------------------
const MIDNIGHT_COURT_BLUE = "#0f172a";
const DYNASTY_PURPLE = "#4c1d95";
const CHAMPIONSHIP_GOLD = "#eab308";
const TEXT_WHITE = "#ffffff";
const TEXT_MUTED = "rgba(255,255,255,0.7)";

// ---------------------------------------------------------------------------
// Config (env-driven with sensible defaults)
// ---------------------------------------------------------------------------
const HEADER_TEXT =
  process.env.BOXSCORE_HEADER_TEXT ?? "LBA VERIFIED BOX SCORE";
const HEADER_ENABLED =
  (process.env.BOXSCORE_HEADER_ENABLED ?? "true") === "true";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface HeaderStripOptions {
  /** Full canvas width (px) */
  width: number;
  /** Strip height (px) */
  height: number;
  /** Matchup label, e.g. "TEAM A vs TEAM B" */
  matchLabel?: string;
  /** Event / league label, e.g. "Stage Combine" */
  eventLabel?: string;
}

export interface FooterStripOptions {
  /** Full canvas width (px) */
  width: number;
  /** Strip height (px) */
  height: number;
  /** Short match ID hash (first 8 chars) */
  matchIdShort?: string;
  /** Verified timestamp */
  verifiedAt?: string;
}

// ---------------------------------------------------------------------------
// Header strip
// ---------------------------------------------------------------------------

/**
 * Generate an SVG Buffer for the branded header strip.
 *
 * Layout: | LBA (left) | HEADER_TEXT (center) | matchLabel / eventLabel (right) |
 */
export function createHeaderStripSvg(opts: HeaderStripOptions): Buffer {
  if (!HEADER_ENABLED) {
    // Return a transparent strip if disabled
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}"></svg>`
    );
  }

  const { width, height, matchLabel, eventLabel } = opts;
  const midY = height / 2;
  const fontFamily = `'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;

  // Right-side text: matchup on first line, event on second (if present)
  const rightLines: string[] = [];
  if (matchLabel) rightLines.push(escapeXml(matchLabel));
  if (eventLabel) rightLines.push(escapeXml(eventLabel));

  const rightTextSvg = rightLines
    .map((line, i) => {
      const y = rightLines.length === 1
        ? midY + 5
        : midY - 8 + i * 22;
      const fontSize = i === 0 ? 16 : 13;
      const fill = i === 0 ? TEXT_WHITE : TEXT_MUTED;
      return `<text x="${width - 30}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="600" fill="${fill}" text-anchor="end">${line}</text>`;
    })
    .join("\n    ");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="hdrGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${MIDNIGHT_COURT_BLUE}"/>
      <stop offset="100%" stop-color="${DYNASTY_PURPLE}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#hdrGrad)"/>
  <!-- Gold accent line at bottom -->
  <rect y="${height - 3}" width="${width}" height="3" fill="${CHAMPIONSHIP_GOLD}"/>
  <!-- Left: LBA text logo -->
  <text x="30" y="${midY + 6}" font-family="${fontFamily}" font-size="24" font-weight="800" fill="${CHAMPIONSHIP_GOLD}" letter-spacing="3">LBA</text>
  <!-- Center: main header text -->
  <text x="${width / 2}" y="${midY + 6}" font-family="${fontFamily}" font-size="18" font-weight="700" fill="${TEXT_WHITE}" text-anchor="middle" letter-spacing="2">${escapeXml(HEADER_TEXT)}</text>
  <!-- Right: matchup + event -->
  ${rightTextSvg}
</svg>`;

  return Buffer.from(svg);
}

// ---------------------------------------------------------------------------
// Footer strip (optional)
// ---------------------------------------------------------------------------

/**
 * Generate an SVG Buffer for the small footer strip.
 * Contains match ID hash and verified timestamp.
 */
export function createFooterStripSvg(opts: FooterStripOptions): Buffer {
  const { width, height, matchIdShort, verifiedAt } = opts;

  if (!matchIdShort && !verifiedAt) {
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`
    );
  }

  const fontFamily = `'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;
  const midY = height / 2 + 4;

  const leftText = matchIdShort ? `#${escapeXml(matchIdShort)}` : "";
  const rightText = verifiedAt
    ? `Verified ${escapeXml(formatTimestamp(verifiedAt))}`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="${MIDNIGHT_COURT_BLUE}"/>
  <!-- Gold accent line at top -->
  <rect width="${width}" height="2" fill="${CHAMPIONSHIP_GOLD}" opacity="0.5"/>
  <text x="30" y="${midY}" font-family="${fontFamily}" font-size="12" font-weight="500" fill="${TEXT_MUTED}">${leftText}</text>
  <text x="${width - 30}" y="${midY}" font-family="${fontFamily}" font-size="12" font-weight="500" fill="${TEXT_MUTED}" text-anchor="end">${rightText}</text>
</svg>`;

  return Buffer.from(svg);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
