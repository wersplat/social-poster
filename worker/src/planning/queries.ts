import { supabase } from '../db.js'
import { getCurrentSeasonIdForLeague } from '../currentSeason.js'
import type {
  AnnouncementScheduledPayload,
  FinalScorePayload,
  PlayerOfGamePayload,
  PowerRankingsPayload,
} from './payloads.js'

export function getLeagueId(): string {
  const id = process.env.LEAGUE_ID?.trim()
  if (!id) throw new Error('LEAGUE_ID must be set for planning jobs')
  return id
}

interface MatchMvpSelectRow {
  id: string
  played_at: string | null
  verified_at: string | null
  team_a_id: string | null
  team_b_id: string | null
  winner_id: string | null
}

interface MatchMvpRow {
  match_id: string
  player_id: string
}

interface PlayerMvpSelectRow {
  id: string
  gamertag: string
  alternate_gamertag: string | null
}

interface PlayerStatsMvpSelectRow {
  match_id: string
  player_id: string | null
  points: number | null
  rebounds: number | null
  assists: number | null
  steals: number | null
  blocks: number | null
  display_gt: string | null
  player_name: string | null
}

interface TeamMvpSelectRow {
  id: string
  name: string
  logo_url: string | null
}

export type MatchWithMvpResult = {
  match_id: string
  played_at: string
  player_id: string
  player_name: string
  stat_line: string
  team_name: string
  team_logo?: string | null
  league_logo?: string | null
}

export async function fetchCompletedMatches(leagueId: string, limit = 10) {
  const { data: matches, error } = await supabase
    .from('matches')
    .select(
      'id, team_a_id, team_b_id, score_a, score_b, played_at, verified_at, boxscore_url'
    )
    .eq('verified', true)
    .eq('league_id', leagueId)
    .not('team_a_id', 'is', null)
    .not('team_b_id', 'is', null)
    .order('verified_at', { ascending: false, nullsFirst: false })
    .order('played_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  if (!matches?.length) return []

  const teamIds = [
    ...new Set(
      matches.flatMap(m =>
        [m.team_a_id, m.team_b_id].filter(Boolean) as string[]
      )
    ),
  ]
  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, logo_url')
    .in('id', teamIds)
  const teamMap = new Map(
    (teams ?? []).map(t => [t.id, { name: t.name, logo_url: t.logo_url }])
  )

  const { data: league } = await supabase
    .from('leagues_info')
    .select('lg_logo_url')
    .eq('id', leagueId)
    .single()
  const leagueLogo = league?.lg_logo_url ?? undefined

  return matches.map(m => {
    const home = teamMap.get(m.team_a_id as string)
    const away = teamMap.get(m.team_b_id as string)
    return {
      id: m.id,
      score_a: m.score_a,
      score_b: m.score_b,
      played_at: m.played_at,
      verified_at: m.verified_at,
      home_team: home?.name ?? 'TBD',
      away_team: away?.name ?? 'TBD',
      home_team_logo: home?.logo_url,
      away_team_logo: away?.logo_url,
      league_logo: leagueLogo,
      boxscore_url: m.boxscore_url as string | null,
    }
  })
}

export async function fetchMatchesWithMvp(
  leagueId: string,
  limit = 10
): Promise<MatchWithMvpResult[]> {
  const { data: matchesData, error } = await supabase
    .from('matches')
    .select('id, played_at, verified_at, team_a_id, team_b_id, winner_id')
    .eq('verified', true)
    .eq('league_id', leagueId)
    .order('verified_at', { ascending: false, nullsFirst: false })
    .order('played_at', { ascending: false })
    .limit(limit * 2)

  if (error) throw error
  const matches = (matchesData ?? []) as MatchMvpSelectRow[]
  if (!matches.length) return []

  const matchIds = matches.map(m => m.id)
  const { data: mvpsData } = await supabase
    .from('match_mvp')
    .select('match_id, player_id')
    .in('match_id', matchIds)

  const mvps = (mvpsData ?? []) as MatchMvpRow[]
  if (!mvps.length) return []
  const mvpByMatch = new Map(mvps.map(m => [m.match_id, m.player_id]))

  const playerIds = [...new Set(mvps.map(m => m.player_id))]
  const { data: playersData } = await supabase
    .from('players')
    .select('id, gamertag, alternate_gamertag')
    .in('id', playerIds)
  const players = (playersData ?? []) as PlayerMvpSelectRow[]
  const playerMap = new Map(players.map(p => [p.id, p]))

  const { data: statsData } = await supabase
    .from('player_stats')
    .select(
      'match_id, player_id, points, rebounds, assists, steals, blocks, display_gt, player_name'
    )
    .in('match_id', matchIds)
  const stats = (statsData ?? []) as PlayerStatsMvpSelectRow[]
  const statMap = new Map(stats.map(s => [`${s.match_id}:${s.player_id}`, s]))

  const { data: teamsData } = await supabase
    .from('teams')
    .select('id, name, logo_url')
  const teams = (teamsData ?? []) as TeamMvpSelectRow[]
  const teamMap = new Map(
    teams.map(t => [t.id, { name: t.name, logo_url: t.logo_url }])
  )

  const { data: league } = await supabase
    .from('leagues_info')
    .select('lg_logo_url')
    .eq('id', leagueId)
    .single()
  const leagueLogo =
    (league as { lg_logo_url?: string | null } | null)?.lg_logo_url ?? undefined

  const results: MatchWithMvpResult[] = []

  for (const m of matches.slice(0, limit)) {
    const playerId = mvpByMatch.get(m.id)
    if (!playerId) continue
    const player = playerMap.get(playerId)
    if (!player) continue
    const s = statMap.get(`${m.id}:${playerId}`)
    const pts = s?.points ?? 0
    const reb = s?.rebounds ?? 0
    const ast = s?.assists ?? 0
    const stl = s?.steals ?? 0
    const blk = s?.blocks ?? 0
    const statLine =
      `${pts} PTS / ${reb} REB / ${ast} AST` +
      (stl || blk ? ` / ${stl} STL / ${blk} BLK` : '')
    const winnerTeam = m.winner_id ? teamMap.get(m.winner_id) : null
    const teamName = winnerTeam?.name ?? 'TBD'
    const teamLogo = winnerTeam?.logo_url
    const friendlyName =
      s?.display_gt ??
      s?.player_name ??
      player.alternate_gamertag ??
      player.gamertag ??
      'Unknown'

    results.push({
      match_id: m.id,
      played_at: m.played_at ?? m.verified_at ?? new Date().toISOString(),
      player_id: playerId,
      player_name: friendlyName,
      stat_line: statLine,
      team_name: teamName,
      team_logo: teamLogo,
      league_logo: leagueLogo,
    })
  }

  return results
}

export async function fetchTop10PowerRankings(leagueId: string): Promise<{
  teams: Array<{
    id: string
    name: string
    rank: number
    record: string
    team_logo: string | null
  }>
  league_logo: string | undefined
}> {
  const seasonId = await getCurrentSeasonIdForLeague(leagueId)
  if (!seasonId) {
    return { teams: [], league_logo: undefined }
  }

  const { data: lbaTeamIds, error: lbaErr } = await supabase
    .from('lba_teams')
    .select('team_id')

  if (lbaErr) throw lbaErr
  const allowedTeamIds = new Set((lbaTeamIds ?? []).map(r => r.team_id))
  if (allowedTeamIds.size === 0)
    return { teams: [], league_logo: undefined }

  const { data: standings, error } = await supabase
    .from('league_conference_standings')
    .select('team_id, team_name, team_logo, wins, losses')
    .eq('league_id', leagueId)
    .eq('season_id', seasonId)
    .order('wins', { ascending: false })
    .order('losses', { ascending: true })
    .limit(50)

  if (error) throw error
  if (!standings?.length) return { teams: [], league_logo: undefined }

  const { data: league } = await supabase
    .from('leagues_info')
    .select('lg_logo_url')
    .eq('id', leagueId)
    .single()
  const leagueLogo = league?.lg_logo_url ?? undefined

  const filtered = standings.filter(s => allowedTeamIds.has(s.team_id))
  return {
    teams: filtered.slice(0, 10).map((s, i) => ({
      id: s.team_id,
      name: s.team_name,
      rank: i + 1,
      record: `${s.wins ?? 0}-${s.losses ?? 0}`,
      team_logo: s.team_logo,
    })),
    league_logo: leagueLogo,
  }
}

/** Admin Studio: suggestions for a league (any league id, not env LEAGUE_ID). */
export async function fetchStudioSuggestions(leagueId: string) {
  const [final_score_matches, player_of_game, power_rankings] =
    await Promise.all([
      fetchCompletedMatches(leagueId, 20),
      fetchMatchesWithMvp(leagueId, 20),
      fetchTop10PowerRankings(leagueId),
    ])
  return { final_score_matches, player_of_game, power_rankings }
}

export async function existsScheduledByPayload(
  postType: string,
  payload: Record<string, unknown> | FinalScorePayload | PlayerOfGamePayload | PowerRankingsPayload
): Promise<boolean> {
  const p = payload as Record<string, unknown>
  const matchId = p.match_id as string | undefined
  const weekLabel = p.week_label as string | undefined
  const needle = postType === 'weekly_power_rankings' ? weekLabel : matchId
  if (!needle) return false

  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('id, payload_json')
    .eq('post_type', postType)
    .contains('publish_surface', ['x'])
    .limit(200)

  if (error) throw error
  const rows = data ?? []
  return rows.some(r => {
    const j = r.payload_json as Record<string, unknown>
    if (postType === 'weekly_power_rankings') return j?.week_label === needle
    return j?.match_id === needle
  })
}

/**
 * Insert a planned X post. Does not set scheduled_posts.match_id so rows coexist
 * with verified_game auto-posts (unique index on match_id for X).
 */
export async function insertPlannedXPost(
  postType: string,
  scheduledFor: string,
  payload: FinalScorePayload | PlayerOfGamePayload | PowerRankingsPayload,
  caption?: string | null,
  planningOptions?: { style_pack?: string; style_version?: number }
): Promise<string | undefined> {
  const leagueId = getLeagueId()
  const payload_json: Record<string, unknown> = {
    ...(payload as unknown as Record<string, unknown>),
    league_id: leagueId,
    style_pack: planningOptions?.style_pack ?? 'regular',
    style_version: planningOptions?.style_version ?? 1,
    generate_image: true,
  }

  const { data, error } = await supabase
    .from('scheduled_posts')
    .insert({
      post_type: postType,
      scheduled_for: scheduledFor,
      payload_json,
      caption: caption ?? null,
      status: 'scheduled',
      publish_surface: ['x'],
      match_id: null,
    })
    .select('id')
    .single()

  if (error) throw error
  return data?.id as string | undefined
}

/** True if a non-failed X post already exists for this league + announcement type + season key. */
export async function existsAnnouncementScheduled(
  leagueId: string,
  postType: string,
  seasonDedupeKey: string
): Promise<boolean> {
  if (!seasonDedupeKey.trim()) return false

  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('id, payload_json, status')
    .eq('post_type', postType)
    .contains('publish_surface', ['x'])
    .limit(500)

  if (error) throw error
  return (data ?? []).some(r => {
    if (r.status === 'failed') return false
    const j = r.payload_json as Record<string, unknown>
    if (j?.league_id !== leagueId) return false
    const sid = typeof j.season_id === 'string' ? j.season_id : ''
    const sl = typeof j.season === 'string' ? j.season : ''
    return sid === seasonDedupeKey || (!sid && sl === seasonDedupeKey)
  })
}

/**
 * Insert a planned announcement X post (match_id null — avoids match_id dedup index).
 */
export async function insertPlannedAnnouncementPost(
  leagueId: string,
  postType: string,
  scheduledFor: string,
  payload: Omit<AnnouncementScheduledPayload, 'league_id'> &
    Record<string, unknown>,
  caption?: string | null,
  planningOptions?: { style_pack?: string; style_version?: number }
): Promise<string | undefined> {
  const payload_json: Record<string, unknown> = {
    ...payload,
    league_id: leagueId,
    style_pack: planningOptions?.style_pack ?? 'regular',
    style_version: planningOptions?.style_version ?? 1,
    generate_image: payload.generate_image !== false,
  }

  const { data, error } = await supabase
    .from('scheduled_posts')
    .insert({
      post_type: postType,
      scheduled_for: scheduledFor,
      payload_json,
      caption: caption ?? null,
      status: 'scheduled',
      publish_surface: ['x'],
      match_id: null,
    })
    .select('id')
    .single()

  if (error) throw error
  return data?.id as string | undefined
}
