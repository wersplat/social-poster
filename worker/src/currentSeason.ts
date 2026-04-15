import { supabase } from './db.js'

/**
 * Resolves the current season for a league: active season if any, else most recent by start_date.
 * Matches lba-next `getCurrentSeasonId` behavior but accepts any `league_id`.
 */
export async function getCurrentSeasonIdForLeague(
  leagueId: string
): Promise<string | null> {
  const { data: activeData, error: activeError } = await supabase
    .from('league_seasons')
    .select('id')
    .eq('league_id', leagueId)
    .eq('is_active', true)
    .order('start_date', { ascending: false })
    .limit(1)

  if (activeError) {
    console.warn('[currentSeason] active season:', activeError.message)
  }
  if (activeData && activeData.length > 0) {
    return activeData[0].id
  }

  const { data: recentData, error: recentError } = await supabase
    .from('league_seasons')
    .select('id')
    .eq('league_id', leagueId)
    .order('start_date', { ascending: false })
    .limit(1)

  if (recentError) {
    console.warn('[currentSeason] recent season:', recentError.message)
    return null
  }
  if (!recentData || recentData.length === 0) {
    return null
  }
  return recentData[0].id
}
