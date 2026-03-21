import { supabase } from './db.js'
import type { ScheduledPost } from './types.js'

type TeamRef = { name: string } | null

type MatchMvpRow = { player_id: string } | null

type PlayerStatRow = {
  player_id: string
  points: number
  rebounds: number
  assists: number
  display_gt: string | null
  team_id: string | null
}

type MatchRow = {
  score_a: number | null
  score_b: number | null
  stage: string | null
  season_id: string | null
  team_a: TeamRef
  team_b: TeamRef
  match_mvp: MatchMvpRow[] | null
  player_stats: PlayerStatRow[] | null
}

export async function resolvePostBody(post: ScheduledPost): Promise<string> {
  if (post.caption?.trim()) return buildFinalCaption(post, post.caption)

  if (post.post_type === 'verified_game' && post.match_id) {
    return buildGameResultCaption(post)
  }

  if (post.payload_json.body && typeof post.payload_json.body === 'string') {
    return buildFinalCaption(post, post.payload_json.body)
  }

  throw new Error('No post body could be resolved')
}

function buildFinalCaption(post: ScheduledPost, body: string): string {
  const parts = [body.trim()]

  if (post.cta?.trim()) parts.push(post.cta.trim())
  if (post.hashtags?.length) parts.push(post.hashtags.join(' '))

  return parts.join('\n')
}

async function buildGameResultCaption(post: ScheduledPost): Promise<string> {
  const { data: match, error } = await supabase
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

  if (error || !match) throw new Error(`Match ${post.match_id} not found`)

  const m = match as unknown as MatchRow
  const teamA = m.team_a?.name ?? 'Team A'
  const teamB = m.team_b?.name ?? 'Team B'
  const scoreLine = `FINAL: ${teamA} ${m.score_a}, ${teamB} ${m.score_b}`

  const mvpId = m.match_mvp?.[0]?.player_id
  const stats = m.player_stats ?? []

  const sorted = [...stats]
    .sort((a, b) => {
      if (a.player_id === mvpId) return -1
      if (b.player_id === mvpId) return 1
      return b.points - a.points
    })
    .slice(0, 2)

  const performers = sorted.map(s => {
    const statParts = [`${s.points} PTS`]
    if (s.assists >= 7) statParts.push(`${s.assists} AST`)
    if (s.rebounds >= 8) statParts.push(`${s.rebounds} REB`)
    return `${s.display_gt ?? 'Unknown'}: ${statParts.join(', ')}`
  })

  const boxUrl =
    typeof post.payload_json.box_score_url === 'string'
      ? post.payload_json.box_score_url
      : undefined
  const link = boxUrl ?? `proamrank.gg/games/${post.match_id}`

  const parts = [scoreLine, ...performers, link]
  if (post.hashtags?.length) parts.push(post.hashtags.join(' '))

  return parts.join('\n')
}
