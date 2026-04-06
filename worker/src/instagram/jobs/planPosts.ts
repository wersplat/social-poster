import {
  fetchCompletedMatches,
  fetchMatchesWithMvp,
  fetchTop10PowerRankings,
  existsScheduledByPayload,
  insertScheduledPost,
} from "../supabase/queries.js";
import { logger } from "../util/logger.js";
import type { FinalScorePayload, PlayerOfGamePayload, PowerRankingsPayload } from "../util/validate.js";

const POST_DELAY_MINUTES = 30;
const POWER_RANKINGS_DAY = parseInt(process.env.POWER_RANKINGS_DAY ?? "0", 10); // 0=Sun
const POWER_RANKINGS_HOUR = parseInt(process.env.POWER_RANKINGS_HOUR ?? "18", 10);

function getNextPowerRankingsTime(): Date {
  const now = new Date();
  const next = new Date(now);
  next.setHours(POWER_RANKINGS_HOUR, 0, 0, 0);
  next.setDate(next.getDate() + ((7 + POWER_RANKINGS_DAY - next.getDay()) % 7));
  if (next <= now) next.setDate(next.getDate() + 7);
  return next;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().split("T")[0];
}

export async function planPosts() {
  logger.info("Starting planPosts job");

  const matches = await fetchCompletedMatches(10);
  logger.info("Fetched completed matches", { count: matches.length });

  for (const m of matches) {
    const scheduledFor = new Date(m.played_at ?? m.verified_at ?? Date.now());
    scheduledFor.setMinutes(scheduledFor.getMinutes() + POST_DELAY_MINUTES);

    const payload: FinalScorePayload = {
      match_id: m.id,
      home_team: m.home_team,
      away_team: m.away_team,
      home_score: m.score_a ?? 0,
      away_score: m.score_b ?? 0,
      date: formatDate(m.played_at ?? m.verified_at ?? new Date().toISOString()),
      home_team_logo: m.home_team_logo,
      away_team_logo: m.away_team_logo,
      league_logo: m.league_logo,
      boxscore_url: m.boxscore_url ?? null,
    };

    const exists = await existsScheduledByPayload("final_score", payload);
    if (exists) continue;

    await insertScheduledPost(
      "final_score",
      scheduledFor.toISOString(),
      payload,
      undefined,
      ["feed", "story", "reel"]
    );
  }

  const mvps = await fetchMatchesWithMvp(10);
  logger.info("Fetched matches with MVP", { count: mvps.length });

  for (const m of mvps) {
    const scheduledFor = new Date(m.played_at);
    scheduledFor.setMinutes(scheduledFor.getMinutes() + POST_DELAY_MINUTES + 5);

    const payload: PlayerOfGamePayload = {
      match_id: m.match_id,
      player_name: m.player_name,
      stat_line: m.stat_line,
      team_name: m.team_name,
      date: formatDate(m.played_at),
      team_logo: m.team_logo,
      league_logo: m.league_logo,
    };

    const exists = await existsScheduledByPayload("player_of_game", payload);
    if (exists) continue;

    await insertScheduledPost(
      "player_of_game",
      scheduledFor.toISOString(),
      payload
    );
  }

  const nextPr = getNextPowerRankingsTime();
  const weekLabel = `Week ${Math.ceil(nextPr.getDate() / 7)}`;

  const pr = await fetchTop10PowerRankings();
  if (pr.teams.length >= 1) {
    const payload: PowerRankingsPayload = {
      week_label: weekLabel,
      league_logo: pr.league_logo,
      teams: pr.teams.map((t) => ({
        rank: t.rank,
        team_name: t.name,
        record: t.record,
        team_logo: t.team_logo,
      })),
    };

    const exists = await existsScheduledByPayload("weekly_power_rankings", payload);
    if (!exists) {
      await insertScheduledPost(
        "weekly_power_rankings",
        nextPr.toISOString(),
        payload
      );
    }
  }

  logger.info("planPosts job complete");
}
