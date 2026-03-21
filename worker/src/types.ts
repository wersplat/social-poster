/** JSON payload on scheduled_posts (not null in DB). */
export type ScheduledPostPayload = {
  body?: string
  box_score_url?: string
  league_id?: string
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
