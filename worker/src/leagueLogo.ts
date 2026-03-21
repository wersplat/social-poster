import { supabase } from './db.js'

/**
 * Turn stored asset URLs into something Node fetch() can load.
 * - Full http(s) URLs pass through.
 * - Protocol-relative URLs get https.
 * - Paths starting with `/` are joined to SUPABASE_URL (common for Storage paths in DB).
 * - `storage/v1/...` without leading slash is also joined to SUPABASE_URL.
 * - Bare host/path like `cdn.example.com/x.png` gets https:// prepended.
 */
export function toFetchableAssetUrl(raw: string): string {
  const t = raw.trim()
  if (!t) return t
  if (/^https?:\/\//i.test(t)) return t
  if (t.startsWith('//')) return `https:${t}`

  const base = process.env.SUPABASE_URL?.trim().replace(/\/$/, '') ?? ''
  if (t.startsWith('/') && base) {
    return `${base}${t}`
  }
  if (base && /^storage\/v1\//i.test(t)) {
    return `${base}/${t}`
  }

  return `https://${t}`
}

export async function fetchLeagueLogoUrlByLeagueId(
  leagueId: string
): Promise<string | null> {
  const id = leagueId.trim()
  if (!id) return null

  const { data, error } = await supabase
    .from('leagues_info')
    .select('lg_logo_url, banner_url')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) return null
  const row = data as { lg_logo_url: string | null; banner_url: string | null }
  const primary =
    typeof row.lg_logo_url === 'string' && row.lg_logo_url.trim()
      ? row.lg_logo_url.trim()
      : null
  if (primary) return primary
  const banner =
    typeof row.banner_url === 'string' && row.banner_url.trim()
      ? row.banner_url.trim()
      : null
  return banner
}

/**
 * Logo URL for Satori overlays: payload override first, then leagues_info.lg_logo_url.
 */
function payloadString(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') {
    const t = v.trim()
    return t.length > 0 ? t : null
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

export async function resolveLeagueLogoForGraphicPayload(
  p: Record<string, unknown>
): Promise<string | null> {
  const direct = payloadString(p.league_logo)
  if (direct) return direct

  const lid = payloadString(p.league_id)
  if (!lid) return null

  return fetchLeagueLogoUrlByLeagueId(lid)
}
