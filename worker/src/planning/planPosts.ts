import {
  existsScheduledByPayload,
  fetchCompletedMatches,
  fetchMatchesWithMvp,
  fetchTop10PowerRankings,
  getLeagueId,
  insertPlannedXPost,
} from './queries.js'
import type {
  FinalScorePayload,
  PlayerOfGamePayload,
  PowerRankingsPayload,
} from './payloads.js'

const POST_DELAY_MINUTES = 30
const POWER_RANKINGS_DAY = parseInt(process.env.POWER_RANKINGS_DAY ?? '0', 10)
const POWER_RANKINGS_HOUR = parseInt(process.env.POWER_RANKINGS_HOUR ?? '18', 10)

function getNextPowerRankingsTime(): Date {
  const now = new Date()
  const next = new Date(now)
  next.setHours(POWER_RANKINGS_HOUR, 0, 0, 0)
  next.setDate(next.getDate() + ((7 + POWER_RANKINGS_DAY - next.getDay()) % 7))
  if (next <= now) next.setDate(next.getDate() + 7)
  return next
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toISOString().split('T')[0]
}

const DEFAULT_PLAN_STYLE =
  process.env.PLAN_DEFAULT_STYLE_PACK?.trim() || 'regular'

/**
 * Plan X posts from league data (final scores, POG, power rankings).
 * Requires LEAGUE_ID. Power rankings need lba_teams + league_conference_standings.
 */
export async function planXLeaguePosts(): Promise<{
  inserted: number
  errors: string[]
}> {
  const leagueId = getLeagueId()
  const errors: string[] = []
  let inserted = 0

  console.log('[plan] starting planXLeaguePosts')

  try {
    const matches = await fetchCompletedMatches(leagueId, 10)
    console.log('[plan] completed matches', matches.length)

    for (const m of matches) {
      const scheduledFor = new Date(m.played_at ?? m.verified_at ?? Date.now())
      scheduledFor.setMinutes(scheduledFor.getMinutes() + POST_DELAY_MINUTES)

      const payload: FinalScorePayload = {
        match_id: m.id,
        home_team: m.home_team,
        away_team: m.away_team,
        home_score: m.score_a ?? 0,
        away_score: m.score_b ?? 0,
        date: formatDate(
          m.played_at ?? m.verified_at ?? new Date().toISOString()
        ),
        home_team_logo: m.home_team_logo,
        away_team_logo: m.away_team_logo,
        league_logo: m.league_logo,
        boxscore_url: m.boxscore_url ?? null,
      }

      if (await existsScheduledByPayload('final_score', payload)) continue

      await insertPlannedXPost(
        'final_score',
        scheduledFor.toISOString(),
        payload,
        null,
        { style_pack: DEFAULT_PLAN_STYLE }
      )
      inserted++
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`final_score: ${msg}`)
    console.error('[plan] final_score block failed:', e)
  }

  try {
    const mvps = await fetchMatchesWithMvp(leagueId, 10)
    console.log('[plan] matches with MVP', mvps.length)

    for (const m of mvps) {
      const scheduledFor = new Date(m.played_at)
      scheduledFor.setMinutes(scheduledFor.getMinutes() + POST_DELAY_MINUTES + 5)

      const payload: PlayerOfGamePayload = {
        match_id: m.match_id,
        player_name: m.player_name,
        stat_line: m.stat_line,
        team_name: m.team_name,
        date: formatDate(m.played_at),
        team_logo: m.team_logo,
        league_logo: m.league_logo,
      }

      if (await existsScheduledByPayload('player_of_game', payload)) continue

      await insertPlannedXPost(
        'player_of_game',
        scheduledFor.toISOString(),
        payload,
        null,
        { style_pack: DEFAULT_PLAN_STYLE }
      )
      inserted++
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`player_of_game: ${msg}`)
    console.error('[plan] player_of_game block failed:', e)
  }

  try {
    const nextPr = getNextPowerRankingsTime()
    const weekLabel = `Week ${Math.ceil(nextPr.getDate() / 7)}`

    const pr = await fetchTop10PowerRankings(leagueId)
    if (pr.teams.length >= 1) {
      const payload: PowerRankingsPayload = {
        week_label: weekLabel,
        league_logo: pr.league_logo,
        teams: pr.teams.map(t => ({
          rank: t.rank,
          team_name: t.name,
          record: t.record,
          team_logo: t.team_logo,
        })),
      }

      if (!(await existsScheduledByPayload('weekly_power_rankings', payload))) {
        await insertPlannedXPost(
          'weekly_power_rankings',
          nextPr.toISOString(),
          payload,
          null,
          { style_pack: DEFAULT_PLAN_STYLE }
        )
        inserted++
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`weekly_power_rankings: ${msg}`)
    console.error('[plan] power rankings block failed:', e)
  }

  console.log('[plan] X complete', { inserted, errors: errors.length })
  return { inserted, errors }
}
