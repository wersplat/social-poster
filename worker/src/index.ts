import { createClient } from '@supabase/supabase-js'
import { TwitterApi } from 'twitter-api-v2'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// ─── X client factory (per-league credentials from webhook_config) ──────────

const xClientCache = new Map<string, TwitterApi>()

async function getXClient(leagueId: string): Promise<TwitterApi | null> {
  if (xClientCache.has(leagueId)) return xClientCache.get(leagueId)!

  const { data: rows } = await supabase
    .from('webhook_config')
    .select('key, value')
    .eq('league_id', leagueId)
    .in('key', ['x_access_token', 'x_access_secret'])

  if (!rows || rows.length < 2) return null

  const get = (k: string) => rows.find(r => r.key === k)?.value
  const client = new TwitterApi({
    appKey:       process.env.X_API_KEY!,
    appSecret:    process.env.X_API_SECRET!,
    accessToken:  get('x_access_token')!,
    accessSecret: get('x_access_secret')!,
  })

  xClientCache.set(leagueId, client)
  return client
}

// ─── Post body builder ───────────────────────────────────────────────────────

async function resolvePostBody(post: ScheduledPost): Promise<string> {
  // 1. Use caption if already set (admin wrote it, or trigger populated from match_game_stories)
  if (post.caption?.trim()) return buildFinalCaption(post, post.caption)

  // 2. For verified_game posts, build from match data
  if (post.post_type === 'verified_game' && post.match_id) {
    return buildGameResultCaption(post)
  }

  // 3. Fall back to payload_json.body if present
  if (post.payload_json?.body) return buildFinalCaption(post, post.payload_json.body)

  throw new Error('No post body could be resolved')
}

function buildFinalCaption(post: ScheduledPost, body: string): string {
  const parts = [body.trim()]

  if (post.cta?.trim()) parts.push(post.cta.trim())
  if (post.hashtags?.length) parts.push(post.hashtags.join(' '))

  return parts.join('\n')
}

async function buildGameResultCaption(post: ScheduledPost): Promise<string> {
  const { data: match } = await supabase
    .from('matches')
    .select(`
      score_a, score_b, stage, season_id,
      team_a:teams!team_a_id(name),
      team_b:teams!team_b_id(name),
      match_mvp(player_id),
      player_stats(player_id, points, rebounds, assists, display_gt, team_id)
    `)
    .eq('id', post.match_id!)
    .single()

  if (!match) throw new Error(`Match ${post.match_id} not found`)

  const teamA = (match.team_a as any)?.name ?? 'Team A'
  const teamB = (match.team_b as any)?.name ?? 'Team B'
  const scoreLine = `FINAL: ${teamA} ${match.score_a}, ${teamB} ${match.score_b}`

  // Top 2 performers by points, MVP first
  const mvpId = (match.match_mvp as any)?.[0]?.player_id
  const stats: any[] = match.player_stats ?? []

  const sorted = stats
    .sort((a, b) => {
      if (a.player_id === mvpId) return -1
      if (b.player_id === mvpId) return 1
      return b.points - a.points
    })
    .slice(0, 2)

  const performers = sorted.map(s => {
    const statParts = [`${s.points} PTS`]
    if (s.assists >= 7)   statParts.push(`${s.assists} AST`)
    if (s.rebounds >= 8)  statParts.push(`${s.rebounds} REB`)
    return `${s.display_gt ?? 'Unknown'}: ${statParts.join(', ')}`
  })

  const link = post.payload_json?.box_score_url
    ?? `proamrank.gg/games/${post.match_id}`

  const parts = [scoreLine, ...performers, link]
  if (post.hashtags?.length) parts.push(post.hashtags.join(' '))

  return parts.join('\n')
}

// ─── Platform publishers ─────────────────────────────────────────────────────

async function publishToX(post: ScheduledPost, body: string): Promise<string> {
  // Resolve league_id from match if not directly on post
  let leagueId = post.payload_json?.league_id

  if (!leagueId && post.match_id) {
    const { data } = await supabase
      .from('matches')
      .select('league_id')
      .eq('id', post.match_id)
      .single()
    leagueId = data?.league_id
  }

  const client = leagueId ? await getXClient(leagueId) : null

  // Fall back to env-level credentials if no per-league client
  const twitter = client ?? new TwitterApi({
    appKey:       process.env.X_API_KEY!,
    appSecret:    process.env.X_API_SECRET!,
    accessToken:  process.env.X_ACCESS_TOKEN!,
    accessSecret: process.env.X_ACCESS_SECRET!,
  })

  let mediaId: string | undefined

  // Prefer boxscore-processed image, then bg_asset, then media_url fallback
  const mediaUrl =
    post.boxscore_processed_feed_url ??
    post.bg_image_url ??
    (post.asset_urls?.[0])

  if (mediaUrl) {
    const arrayBuf = await fetch(mediaUrl).then(r => r.arrayBuffer())
    const buf = Buffer.from(new Uint8Array(arrayBuf))
    mediaId = await twitter.v1.uploadMedia(buf, { mimeType: 'image/png' })
  }

  const tweet = await twitter.v2.tweet({
    text: body,
    ...(mediaId ? { media: { media_ids: [mediaId] } } : {}),
  })

  return tweet.data.id
}

// ─── Main worker loop ────────────────────────────────────────────────────────

type ScheduledPost = {
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
  payload_json: Record<string, any>
  retries: number
  x_account_id: string | null
}

async function processPendingPosts() {
  const now = new Date().toISOString()

  const { data: posts, error } = await supabase
    .from('scheduled_posts')
    .select('*')
    .in('status', ['pending', 'scheduled'])
    .or(`scheduled_for.is.null,scheduled_for.lte.${now}`)
    .lt('retries', 3)
    .contains('publish_surface', ['x'])   // only rows targeting X
    .limit(10)

  if (error) {
    console.error('[worker] fetch error:', error.message)
    return
  }

  for (const post of posts ?? []) {
    // Optimistic lock
    await supabase
      .from('scheduled_posts')
      .update({ status: 'processing' })
      .eq('id', post.id)
      .eq('status', post.status) // guard against double-pick

    try {
      const body = await resolvePostBody(post)
      const surfaces: string[] = post.publish_surface ?? []

      const updates: Record<string, any> = {
        status: 'published',
        updated_at: new Date().toISOString(),
      }

      if (surfaces.includes('x')) {
        const xPostId = await publishToX(post, body)
        updates.x_post_id = xPostId
        console.log(`[x] posted ${xPostId} for scheduled_post ${post.id}`)
      }

      // Future: if (surfaces.includes('discord')) await publishToDiscord(post, body)

      await supabase
        .from('scheduled_posts')
        .update(updates)
        .eq('id', post.id)

    } catch (err: any) {
      const retries = (post.retries ?? 0) + 1
      console.error(`[worker] failed post ${post.id} (attempt ${retries}):`, err.message)

      await supabase
        .from('scheduled_posts')
        .update({
          status: retries >= 3 ? 'failed' : 'pending',
          retries,
          error: err.message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', post.id)
    }
  }
}

// ─── Stuck-post cleanup (resets rows locked >2min in 'processing') ───────────

async function resetStuckPosts() {
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString()

  await supabase
    .from('scheduled_posts')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('status', 'processing')
    .lt('updated_at', cutoff)
    .contains('publish_surface', ['x'])
}

// ─── Boot ────────────────────────────────────────────────────────────────────

console.log('[worker] social publisher started')
setInterval(processPendingPosts, 30_000)
setInterval(resetStuckPosts, 60_000)
processPendingPosts()
