import type {
  AnnouncementGraphicPayload,
  BeatWriterMilestoneFlashPayload,
  FinalScorePayload,
  PlayerOfGamePayload,
  PowerRankingsPayload,
} from "../util/validate.js";
import {
  postTypeToKind,
  defaultHeadline,
  secondaryLines,
  ctaDisplayLabel,
  normalizeVibe,
  type AnnouncementPayload,
} from "../../announcements/templates.js";

export function injectData(html: string, data: Record<string, unknown>): string {
  let out = html;
  for (const [k, v] of Object.entries(data)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "g"), String(v ?? ""));
  }
  return out;
}

export function getTemplateName(postType: string, slideIndex?: number): string {
  if (postType === "final_score") return "final_score";
  if (postType === "player_of_game") return "player_of_game";
  if (postType === "weekly_power_rankings") return "power_rankings_slide";
  if (postType === "beat_writer_milestone_flash") return "beat_writer_milestone_flash";
  throw new Error(`Unknown post_type: ${postType}`);
}

export function finalScoreToTemplateData(p: FinalScorePayload): Record<string, unknown> {
  return {
    home_team: p.home_team,
    away_team: p.away_team,
    home_score: p.home_score,
    away_score: p.away_score,
    date: p.date,
    home_team_logo: p.home_team_logo ?? "",
    away_team_logo: p.away_team_logo ?? "",
    league_logo: p.league_logo ?? "",
  };
}

export function playerOfGameToTemplateData(p: PlayerOfGamePayload): Record<string, unknown> {
  return {
    player_name: p.player_name,
    stat_line: p.stat_line,
    team_name: p.team_name,
    date: p.date,
    team_logo: p.team_logo ?? "",
    league_logo: p.league_logo ?? "",
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export interface CaptionHeroOverlayOpts {
  /** DB stat line — removed from bubble when caption echoes it */
  statLine?: string;
  /** Leading/trailing duplicate of display name removed from narrative */
  playerName?: string;
}

/**
 * Strip hashtags; remove stat line and duplicate name so the bubble is
 * narrative-only (stats stay in the headline panel).
 */
export function captionForHeroOverlay(
  mergedCaption: string,
  opts?: CaptionHeroOverlayOpts
): string {
  let s = mergedCaption.replace(/#\w+/g, "");
  s = normalizeSpaces(s);

  const statLine = opts?.statLine?.trim() ?? "";
  if (statLine.length > 0) {
    s = s.replace(new RegExp(escapeRegex(normalizeSpaces(statLine)), "gi"), "");
    const parts = statLine.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const flex = parts.map((p) => escapeRegex(p)).join("\\s*\\/\\s*");
      s = s.replace(new RegExp(flex, "gi"), "");
    }
    s = s.replace(
      /\b\d+\s*PTS\s*\/\s*\d+\s*REB\s*\/\s*\d+\s*AST(?:\s*\/\s*\d+\s*(?:STL|BLK)(?:\s*\/\s*\d+\s*(?:STL|BLK))?)?/gi,
      ""
    );
    s = s.replace(/\b\d+\s*PTS\b\s*\/\s*\d+\s*REB\b/gi, "");
  }

  const name = opts?.playerName?.trim() ?? "";
  if (name.length >= 2) {
    s = s.replace(new RegExp(`^${escapeRegex(name)}\\s*[|:\\-–]\\s*`, "i"), "");
    s = s.replace(new RegExp(`^${escapeRegex(name)}\\s+`, "i"), "");
    s = s.replace(new RegExp(`\\s*${escapeRegex(name)}\\s*[|]\\s*`, "gi"), " ");
  }

  s = normalizeSpaces(s);
  s = s.replace(/^[,;:.]\s*/g, "").replace(/\s*[,;]{2,}\s*/g, ", ");
  return s;
}

/**
 * Template fields for superhero POG: DB stats + caption overlay (HTML-escaped).
 */
export function playerOfGameHeroToTemplateData(
  p: PlayerOfGamePayload,
  mergedCaption: string
): Record<string, unknown> {
  const captionClean = captionForHeroOverlay(mergedCaption, {
    statLine: p.stat_line,
    playerName: p.player_name,
  });
  return {
    player_name: escapeHtml(p.player_name),
    stat_line: escapeHtml(p.stat_line),
    team_name: escapeHtml(p.team_name),
    date: escapeHtml(p.date),
    team_logo: p.team_logo ?? "",
    league_logo: p.league_logo ?? "",
    hero_caption: escapeHtml(captionClean),
    hero_quote_section_display: captionClean.length > 0 ? "block" : "none",
  };
}

export function beatWriterMilestoneFlashToTemplateData(p: BeatWriterMilestoneFlashPayload): Record<string, unknown> {
  const showWriter = p.writer_name.trim().length > 0;
  return {
    writer_name: p.writer_name,
    writer_name_display: showWriter ? "block" : "none",
    milestone_headline: p.milestone_headline,
    writer_image_url: p.writer_image_url,
    date: p.date,
    league_logo: p.league_logo ?? "",
  };
}

export function powerRankingsSlideToTemplateData(
  p: PowerRankingsPayload,
  slideIndex: number
): Record<string, unknown> {
  const team = p.teams[slideIndex];
  if (!team) throw new Error(`No team at index ${slideIndex}`);
  return {
    week_label: p.week_label,
    rank: team.rank,
    team_name: team.team_name,
    record: team.record,
    change: team.change != null ? (team.change > 0 ? `+${team.change}` : String(team.change)) : "",
    team_logo: team.team_logo ?? "",
    league_logo: p.league_logo ?? "",
  };
}

// --------------- Static template data mappers ---------------

export function staticFinalScoreToTemplateData(
  p: FinalScorePayload,
  opts: { seasonLabel?: string; keyPerformerLine?: string } = {}
): Record<string, unknown> {
  return {
    home_team: p.home_team.toUpperCase(),
    away_team: p.away_team.toUpperCase(),
    home_score: p.home_score,
    away_score: p.away_score,
    league_logo: p.league_logo ?? "",
    pill_text: opts.seasonLabel ? `FINAL · ${opts.seasonLabel.toUpperCase()}` : "FINAL",
    key_performer_line: opts.keyPerformerLine ?? "",
  };
}

export function staticAnnouncementToTemplateData(
  postType: string,
  p: AnnouncementGraphicPayload
): Record<string, unknown> {
  const kind = postTypeToKind(postType);
  const annoPayload: AnnouncementPayload = {
    season: p.season,
    cta: p.cta,
    cta_label: p.cta_label,
    vibe: normalizeVibe(p.vibe),
  };

  const headline = kind
    ? defaultHeadline(kind, annoPayload)
    : p.headline_override ?? "ANNOUNCEMENT";

  const words = headline.split(/\s+/);
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += 2) {
    lines.push(words.slice(i, i + 2).join(" "));
  }

  const secondary = kind ? secondaryLines(kind, annoPayload) : [];
  const ctaLabel = kind ? ctaDisplayLabel(kind, annoPayload) : "LEARN MORE";
  const ctaRaw = (p.cta ?? "").trim();
  let ctaHost = "";
  try {
    ctaHost = ctaRaw.includes("://") ? new URL(ctaRaw).host.toUpperCase() : ctaRaw.toUpperCase();
  } catch {
    ctaHost = ctaRaw.toUpperCase();
  }

  const season = p.season.replace(/^season\s*/i, "").trim();

  return {
    league_logo: p.league_logo ?? "",
    eyebrow: `SEASON ${season.toUpperCase()} IS COMING`,
    headline_1: lines[0] ?? "",
    headline_2: lines[1] ?? "",
    headline_3: lines[2] ?? "",
    subline: secondary.join(" · "),
    cta_text: ctaHost
      ? `${ctaLabel.toUpperCase()} · ${ctaHost}`
      : ctaLabel.toUpperCase(),
  };
}

export function staticStandingsToTemplateData(
  p: PowerRankingsPayload,
  opts: { conferenceLabel?: string } = {}
): Record<string, unknown> {
  const maxRows = 6;
  const teams = p.teams.slice(0, maxRows);
  const rowsHtml = teams
    .map(
      (t, i) =>
        `<div class="row">
          <div class="rank-box">${t.rank ?? i + 1}</div>
          <div class="team-name">${escapeHtml(t.team_name.toUpperCase())}</div>
          <div class="record">${escapeHtml(t.record)}</div>
        </div>`
    )
    .join("\n");

  return {
    league_logo: p.league_logo ?? "",
    conference_label: opts.conferenceLabel ?? "STANDINGS",
    season_week: p.week_label.toUpperCase(),
    team_rows: rowsHtml,
  };
}

export function staticStatLeaderToTemplateData(
  p: PlayerOfGamePayload,
  opts: { seasonLabel?: string } = {}
): Record<string, unknown> {
  const statParts = p.stat_line.split(/[\s/·]+/);
  const bigNumber = statParts.find((s) => /^\d+(\.\d+)?$/.test(s)) ?? "";
  const statCategory =
    p.stat_line
      .replace(bigNumber, "")
      .replace(/[/·]/g, "")
      .trim()
      .toUpperCase() || "STAT LINE";

  return {
    league_logo: p.league_logo ?? "",
    season_label: opts.seasonLabel
      ? `STAT LEADER · ${opts.seasonLabel.toUpperCase()}`
      : "STAT LEADER",
    stat_category: statCategory,
    big_number: bigNumber,
    player_name: p.player_name.toUpperCase(),
    team_name: p.team_name.toUpperCase(),
    subline: "LEADS THE LBA",
  };
}
