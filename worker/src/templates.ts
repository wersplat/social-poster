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

  if (post.post_type === 'final_score') {
    return buildFinalCaption(post, await buildFinalScoreCaption(post))
  }

  if (post.post_type === 'player_of_game') {
    return buildFinalCaption(post, buildPlayerOfGameCaption(post.payload_json))
  }

  if (post.post_type === 'weekly_power_rankings') {
    return buildFinalCaption(post, buildPowerRankingsCaption(post.payload_json))
  }

  if (post.payload_json.body && typeof post.payload_json.body === 'string') {
    return buildFinalCaption(post, post.payload_json.body)
  }

  throw new Error('No post body could be resolved')
}

type FinalScoreTeamsRow = {
  score_a: number | null
  score_b: number | null
  team_a: { name: string } | null
  team_b: { name: string } | null
}

/** Prefer DB team names when payload has match_id (planned posts keep match_id in payload only). */
async function buildFinalScoreCaption(post: ScheduledPost): Promise<string> {
  const p = post.payload_json
  const mid =
    (typeof p.match_id === 'string' && p.match_id.trim()) ||
    post.match_id ||
    ''

  if (mid) {
    const { data: match, error } = await supabase
      .from('matches')
      .select(
        `
        score_a, score_b,
        team_a:teams!team_a_id(name),
        team_b:teams!team_b_id(name)
      `
      )
      .eq('id', mid)
      .single()
    if (!error && match) {
      const m = match as unknown as FinalScoreTeamsRow
      const home = m.team_a?.name ?? '?'
      const away = m.team_b?.name ?? '?'
      const hs =
        typeof p.home_score === 'number' && Number.isFinite(p.home_score)
          ? p.home_score
          : (m.score_a ?? 0)
      const ascore =
        typeof p.away_score === 'number' && Number.isFinite(p.away_score)
          ? p.away_score
          : (m.score_b ?? 0)
      const line = `FINAL: ${home} ${hs}, ${away} ${ascore}`
      const box =
        typeof p.boxscore_url === 'string' && p.boxscore_url.trim()
          ? p.boxscore_url.trim()
          : undefined
      const link = box ?? `proamrank.gg/games/${mid}`
      return [line, link].filter(Boolean).join('\n')
    }
  }

  const home = typeof p.home_team === 'string' ? p.home_team : '?'
  const away = typeof p.away_team === 'string' ? p.away_team : '?'
  const hs = typeof p.home_score === 'number' ? p.home_score : 0
  const ascore = typeof p.away_score === 'number' ? p.away_score : 0
  const line = `FINAL: ${home} ${hs}, ${away} ${ascore}`
  const box =
    typeof p.boxscore_url === 'string' && p.boxscore_url.trim()
      ? p.boxscore_url.trim()
      : undefined
  const link = box ?? (mid ? `proamrank.gg/games/${mid}` : '')
  return [line, link].filter(Boolean).join('\n')
}

function buildPlayerOfGameCaption(p: ScheduledPost['payload_json']): string {
  const name = typeof p.player_name === 'string' ? p.player_name : 'Player'
  const team = typeof p.team_name === 'string' ? p.team_name : ''
  const stat = typeof p.stat_line === 'string' ? p.stat_line : ''
  const head = `Player of the Game: ${name}${team ? ` (${team})` : ''}`
  return [head, stat].filter(Boolean).join('\n')
}

function buildPowerRankingsCaption(p: ScheduledPost['payload_json']): string {
  const week =
    typeof p.week_label === 'string' ? p.week_label : 'Power rankings'
  const rawTeams = Array.isArray(p.teams) ? p.teams : []
  const lines: string[] = [week, '']
  for (const t of rawTeams.slice(0, 10)) {
    if (!t || typeof t !== 'object') continue
    const rank = typeof t.rank === 'number' ? t.rank : 0
    const teamName =
      typeof t.team_name === 'string' ? t.team_name : '?'
    const record = typeof t.record === 'string' ? t.record : ''
    lines.push(`${rank}. ${teamName}${record ? ` (${record})` : ''}`)
  }
  return lines.join('\n')
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
