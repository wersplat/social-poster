import { z } from "zod";

export const FinalScorePayloadSchema = z.object({
  match_id: z.string().uuid(),
  home_team: z.string(),
  away_team: z.string(),
  home_score: z.number(),
  away_score: z.number(),
  date: z.string(),
  home_team_logo: z.string().nullish(),
  away_team_logo: z.string().nullish(),
  league_logo: z.string().nullish(),
  boxscore_url: z.string().nullish(),
  event_label: z.string().nullish(),
});
export type FinalScorePayload = z.infer<typeof FinalScorePayloadSchema>;

export const PlayerOfGamePayloadSchema = z.object({
  match_id: z.string().uuid(),
  player_name: z.string(),
  stat_line: z.string(),
  team_name: z.string(),
  date: z.string(),
  team_logo: z.string().nullish(),
  league_logo: z.string().nullish(),
});
export type PlayerOfGamePayload = z.infer<typeof PlayerOfGamePayloadSchema>;

export const PowerRankingsTeamSchema = z.object({
  rank: z.number(),
  team_name: z.string(),
  record: z.string(),
  change: z.number().optional(),
  team_logo: z.string().nullish(),
});
export const PowerRankingsPayloadSchema = z.object({
  week_label: z.string(),
  teams: z.array(PowerRankingsTeamSchema).min(1).max(10),
  league_logo: z.string().nullish(),
});
export type PowerRankingsPayload = z.infer<typeof PowerRankingsPayloadSchema>;

/** Payload for AI announcement graphics (X + Instagram); matches worker card-generator / DB trigger fields. */
export const AnnouncementGraphicPayloadSchema = z
  .object({
    season: z.string().min(1),
    cta: z.string(),
    season_id: z.string().optional(),
    league_id: z.string().optional(),
    league_logo: z.string().nullish(),
    cta_label: z.string().optional(),
    vibe: z.string().optional(),
    draft_date: z.string().optional(),
    combine_dates: z.string().optional(),
    prize_pool: z.string().optional(),
    headline_override: z.string().optional(),
    result_lines: z.array(z.string()).nullish(),
    champion_team: z.string().optional(),
    series_score: z.string().optional(),
    award_name: z.string().optional(),
    recipient_name: z.string().optional(),
    recipient_stats: z.string().optional(),
    game_count: z.string().optional(),
    start_date: z.string().optional(),
    bracket_size: z.string().optional(),
  })
  .passthrough();

export type AnnouncementGraphicPayload = z.infer<typeof AnnouncementGraphicPayloadSchema>;

/** Normalized payload for beat-writer milestone flash graphics (aliases accepted in raw JSON). */
export type BeatWriterMilestoneFlashPayload = {
  /** May be empty when the DB row only stores `headline` (production beat-writer pipeline). */
  writer_name: string;
  milestone_headline: string;
  writer_image_url: string;
  date: string;
  league_logo: string | null;
  match_id?: string;
  milestone_id?: string;
};

const BeatWriterRawSchema = z
  .object({
    writer_name: z.string().optional(),
    beat_writer_name: z.string().optional(),
    milestone: z.string().optional(),
    milestone_headline: z.string().optional(),
    headline: z.string().optional(),
    writer_image_url: z.string().optional(),
    writer_avatar_url: z.string().optional(),
    beat_writer_image_url: z.string().optional(),
    avatar_url: z.string().optional(),
    date: z.string().optional(),
    league_logo: z.string().nullish(),
    match_id: z.string().uuid().nullish(),
    milestone_id: z.string().optional(),
    /** Present on rows from the beat-writer pipeline (e.g. milestone_flash). */
    article_type: z.string().optional(),
  })
  .passthrough();

/** Strip markdown bold markers from LLM headlines (DB payloads often include **name**). */
function normalizeBeatWriterHeadline(s: string): string {
  return s.replace(/\*\*/g, "").trim();
}

export function parseBeatWriterMilestoneFlash(raw: unknown): BeatWriterMilestoneFlashPayload {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Invalid payload for beat_writer_milestone_flash: expected object");
  }
  const r = BeatWriterRawSchema.parse(raw);
  const writerName = (r.writer_name ?? r.beat_writer_name ?? "").trim();
  const milestoneHeadline = normalizeBeatWriterHeadline(
    (r.milestone ?? r.milestone_headline ?? r.headline ?? "").trim()
  );
  if (!milestoneHeadline) {
    throw new Error(
      "Invalid payload for beat_writer_milestone_flash: milestone headline (milestone, milestone_headline, or headline) required"
    );
  }
  const img =
    r.writer_image_url ?? r.writer_avatar_url ?? r.beat_writer_image_url ?? r.avatar_url ?? "";
  const dateStr = (r.date ?? "").trim();
  return {
    writer_name: writerName,
    milestone_headline: milestoneHeadline,
    writer_image_url: typeof img === "string" ? img.trim() : "",
    date: dateStr || new Date().toISOString().slice(0, 10),
    league_logo: r.league_logo ?? null,
    match_id: r.match_id?.trim() || undefined,
    milestone_id: (() => {
      if (r.milestone_id == null) return undefined;
      const s = String(r.milestone_id).trim();
      return s || undefined;
    })(),
  };
}

const BeatWriterMilestoneFlashPayloadSchema = z.unknown().transform((v) => parseBeatWriterMilestoneFlash(v));

export type PayloadJson =
  | { post_type: "final_score"; data: FinalScorePayload }
  | { post_type: "player_of_game"; data: PlayerOfGamePayload }
  | { post_type: "weekly_power_rankings"; data: PowerRankingsPayload }
  | { post_type: "beat_writer_milestone_flash"; data: BeatWriterMilestoneFlashPayload }
  | { post_type: "announcement_registration"; data: AnnouncementGraphicPayload }
  | { post_type: "announcement_draft"; data: AnnouncementGraphicPayload }
  | { post_type: "announcement_results"; data: AnnouncementGraphicPayload }
  | { post_type: "announcement_playoffs"; data: AnnouncementGraphicPayload }
  | { post_type: "announcement_champion"; data: AnnouncementGraphicPayload }
  | { post_type: "announcement_awards"; data: AnnouncementGraphicPayload }
  | { post_type: "announcement_schedule"; data: AnnouncementGraphicPayload };

const ANNOUNCEMENT_IG_SCHEMAS: Record<string, z.ZodSchema> = {
  announcement_registration: AnnouncementGraphicPayloadSchema,
  announcement_draft: AnnouncementGraphicPayloadSchema,
  announcement_results: AnnouncementGraphicPayloadSchema,
  announcement_playoffs: AnnouncementGraphicPayloadSchema,
  announcement_champion: AnnouncementGraphicPayloadSchema,
  announcement_awards: AnnouncementGraphicPayloadSchema,
  announcement_schedule: AnnouncementGraphicPayloadSchema,
};

const schemas: Record<string, z.ZodSchema> = {
  final_score: FinalScorePayloadSchema,
  player_of_game: PlayerOfGamePayloadSchema,
  weekly_power_rankings: PowerRankingsPayloadSchema,
  beat_writer_milestone_flash: BeatWriterMilestoneFlashPayloadSchema,
  ...ANNOUNCEMENT_IG_SCHEMAS,
};

export function parsePayload(postType: string, raw: unknown): PayloadJson["data"] {
  const schema = schemas[postType];
  if (!schema) throw new Error(`Unknown post_type: ${postType}`);
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid payload for ${postType}: ${result.error.message}`);
  }
  return result.data as PayloadJson["data"];
}
