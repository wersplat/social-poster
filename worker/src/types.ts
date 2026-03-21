/** JSON payload on scheduled_posts (not null in DB). */
export type ScheduledPostPayload = {
  body?: string
  box_score_url?: string
  league_id?: string
  /** When false, poller skips AI background generation for image post types. */
  generate_image?: boolean
  style_pack?: string
  style_version?: number
  ai_bg_prompt?: string
  ai_bg_generated_at?: string
  /** final_score */
  match_id?: string
  home_team?: string
  away_team?: string
  home_score?: number
  away_score?: number
  date?: string
  boxscore_url?: string | null
  /** player_of_game */
  player_name?: string
  stat_line?: string
  team_name?: string
  team_logo?: string | null
  league_logo?: string | null
  /** weekly_power_rankings */
  week_label?: string
  teams?: Array<{
    rank: number
    team_name: string
    record: string
    team_logo?: string | null
  }>
  /** announcement_registration | announcement_draft | announcement_results | announcement_playoffs | announcement_champion | announcement_awards | announcement_schedule */
  season?: string
  season_id?: string
  draft_date?: string
  combine_dates?: string
  prize_pool?: string
  cta?: string
  cta_label?: string
  vibe?: string
  headline_override?: string
  result_lines?: string[]
  champion_team?: string
  series_score?: string
  award_name?: string
  recipient_name?: string
  recipient_stats?: string
  game_count?: string
  start_date?: string
  bracket_size?: string
  [key: string]: unknown
}

export type ScheduledPost = {
  id: string
  post_type: string
  status: string
  match_id: string | null
  caption: string | null
  cta: string | null
  hashtags: string[] | null
  asset_urls: string[] | null
  bg_image_url: string | null
  boxscore_processed_feed_url: string | null
  publish_surface: string[] | null
  payload_json: ScheduledPostPayload
  retries: number
  x_account_id: string | null
}
