import type {
  BeatWriterMilestoneFlashPayload,
  FinalScorePayload,
  PlayerOfGamePayload,
  PowerRankingsPayload,
} from "../util/validate.js";

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

/** Strip hashtag tokens for on-image caption overlay (hashtags stay in the IG caption only). */
export function captionForHeroOverlay(mergedCaption: string): string {
  return mergedCaption
    .replace(/#\w+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Template fields for superhero POG: DB stats + caption overlay (HTML-escaped).
 */
export function playerOfGameHeroToTemplateData(
  p: PlayerOfGamePayload,
  mergedCaption: string
): Record<string, unknown> {
  const captionClean = captionForHeroOverlay(mergedCaption);
  return {
    player_name: escapeHtml(p.player_name),
    stat_line: escapeHtml(p.stat_line),
    team_name: escapeHtml(p.team_name),
    date: escapeHtml(p.date),
    team_logo: p.team_logo ?? "",
    league_logo: p.league_logo ?? "",
    hero_caption: escapeHtml(captionClean),
    hero_caption_wrap_display: captionClean.length > 0 ? "block" : "none",
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
