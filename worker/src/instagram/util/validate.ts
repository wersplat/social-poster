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

export type PayloadJson =
  | { post_type: "final_score"; data: FinalScorePayload }
  | { post_type: "player_of_game"; data: PlayerOfGamePayload }
  | { post_type: "weekly_power_rankings"; data: PowerRankingsPayload };

const schemas: Record<string, z.ZodSchema> = {
  final_score: FinalScorePayloadSchema,
  player_of_game: PlayerOfGamePayloadSchema,
  weekly_power_rankings: PowerRankingsPayloadSchema,
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
