import {
  buildAnnouncementCaption,
  postTypeToKind,
  type AnnouncementPayload,
} from "../../announcements/templates.js";
import type {
  BeatWriterMilestoneFlashPayload,
  FinalScorePayload,
  PlayerOfGamePayload,
  PowerRankingsPayload,
} from "../util/validate.js";

export interface CaptionGenerator {
  generate(postType: string, payload: unknown): string;
}

export const deterministicCaption: CaptionGenerator = {
  generate(postType: string, payload: unknown): string {
    if (postType === "final_score") {
      const p = payload as FinalScorePayload;
      return `Final: ${p.away_team} ${p.away_score} - ${p.home_score} ${p.home_team} #LBA`;
    }
    if (postType === "player_of_game") {
      const p = payload as PlayerOfGamePayload;
      return `Player of the Game: ${p.player_name} (${p.stat_line}) | ${p.team_name} #LBA`;
    }
    if (postType === "weekly_power_rankings") {
      const p = payload as PowerRankingsPayload;
      const top3 = p.teams.slice(0, 3).map((t) => `${t.rank}. ${t.team_name}`).join(" | ");
      return `${p.week_label} Power Rankings\n\nTop 3: ${top3}\n\n#LBA #PowerRankings`;
    }
    if (postType === "beat_writer_milestone_flash") {
      const p = payload as BeatWriterMilestoneFlashPayload;
      const w = p.writer_name.trim();
      return w ? `${p.milestone_headline} — ${w} #LBA` : `${p.milestone_headline} #LBA`;
    }
    if (postType.startsWith("announcement_")) {
      const kind = postTypeToKind(postType);
      if (!kind) return "#LBA #Legends";
      const p = payload as AnnouncementPayload;
      try {
        return `${buildAnnouncementCaption(kind, p)}\n\n#LBA #Legends`;
      } catch {
        return `#LBA #Legends ${p.season ?? ""}`.trim();
      }
    }
    return "#LBA";
  },
};
