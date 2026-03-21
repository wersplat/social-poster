/** Payload shapes stored in scheduled_posts.payload_json for planned posts. */

export interface FinalScorePayload {
  match_id: string
  home_team: string
  away_team: string
  home_score: number
  away_score: number
  date: string
  home_team_logo?: string | null
  away_team_logo?: string | null
  league_logo?: string | null
  boxscore_url?: string | null
  event_label?: string | null
}

export interface PlayerOfGamePayload {
  match_id: string
  player_name: string
  stat_line: string
  team_name: string
  date: string
  team_logo?: string | null
  league_logo?: string | null
}

export interface PowerRankingsTeam {
  rank: number
  team_name: string
  record: string
  change?: number
  team_logo?: string | null
}

export interface PowerRankingsPayload {
  week_label: string
  teams: PowerRankingsTeam[]
  league_logo?: string | null
}
