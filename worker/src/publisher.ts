import {
  ApiRequestError,
  ApiResponseError,
  TwitterApi,
} from 'twitter-api-v2'
import { supabase } from './db.js'
import type { ScheduledPost } from './types.js'

export function getXAppConsumerKeys(): { appKey: string; appSecret: string } {
  const appKey = process.env.X_API_KEY?.trim()
  const appSecret = process.env.X_API_SECRET?.trim()
  if (!appKey || !appSecret) {
    throw new Error(
      '[x] Set X_API_KEY and X_API_SECRET (Consumer Key / Secret from your X app in the developer portal).'
    )
  }
  return { appKey, appSecret }
}

function formatXApiError(err: unknown): string {
  if (err instanceof ApiResponseError) {
    const payload =
      err.data !== undefined && err.data !== null
        ? (() => {
            try {
              return JSON.stringify(err.data)
            } catch {
              return String(err.data)
            }
          })()
        : ''
    const hint =
      err.code === 401
        ? ' (HTTP 401: OAuth rejected — regenerate User Access Token + Secret in the X developer portal for THIS app (must include Read + Write); tokens from another app or old keys will fail. If the post uses a league, set webhook_config x_access_token + x_access_secret for that league, or fix X_ACCESS_TOKEN / X_ACCESS_SECRET in .env.)'
        : err.code === 402
          ? ' (HTTP 402: X often uses this for billing/API access limits — check developer portal plan and app permissions.)'
          : err.code === 403
            ? ' (HTTP 403: forbidden — check app permissions / token scope / Basic vs paid tier.)'
            : ''
    return `${err.message}${payload ? ` | body: ${payload}` : ''}${hint}`
  }
  if (err instanceof ApiRequestError) {
    return `${err.message} | underlying: ${err.requestError?.message ?? String(err.requestError)}`
  }
  if (err instanceof Error) return err.message
  return String(err)
}

const xClientCache = new Map<string, TwitterApi>()

/** Call after updating webhook_config X tokens for a league so the next post picks up new credentials. */
export function invalidateXClientCacheForLeague(leagueId: string): void {
  xClientCache.delete(leagueId)
}

/** Log once at boot if default user credentials are missing (per-league-only setups still need app keys). */
export function warnXAuthOnBoot(): void {
  const appKey = process.env.X_API_KEY?.trim()
  const appSecret = process.env.X_API_SECRET?.trim()
  if (!appKey || !appSecret) {
    console.warn(
      '[x] X_API_KEY / X_API_SECRET missing — posting to X will fail until app Consumer Key & Secret are set.'
    )
    return
  }
  const tok = process.env.X_ACCESS_TOKEN?.trim()
  const sec = process.env.X_ACCESS_SECRET?.trim()
  if (!tok || !sec) {
    console.warn(
      '[x] X_ACCESS_TOKEN / X_ACCESS_SECRET missing — only posts with per-league webhook_config (x_access_token + x_access_secret) can publish; announcements / unmatched leagues need .env user tokens.'
    )
  }
}

export async function getXClient(leagueId: string): Promise<TwitterApi | null> {
  if (xClientCache.has(leagueId)) return xClientCache.get(leagueId)!

  const { data: rows } = await supabase
    .from('webhook_config')
    .select('key, value')
    .eq('league_id', leagueId)
    .in('key', ['x_access_token', 'x_access_secret'])

  if (!rows || rows.length < 2) return null

  const get = (k: string) => rows.find(r => r.key === k)?.value
  const token = get('x_access_token')
  const secret = get('x_access_secret')
  if (!token?.trim() || !secret?.trim()) return null

  const { appKey, appSecret } = getXAppConsumerKeys()
  const client = new TwitterApi({
    appKey,
    appSecret,
    accessToken: token.trim(),
    accessSecret: secret.trim(),
  })

  xClientCache.set(leagueId, client)
  return client
}

export async function publishToX(post: ScheduledPost, body: string): Promise<string> {
  let leagueId: string | undefined =
    typeof post.payload_json.league_id === 'string'
      ? post.payload_json.league_id
      : undefined

  if (!leagueId && post.match_id) {
    const { data } = await supabase
      .from('matches')
      .select('league_id')
      .eq('id', post.match_id)
      .single()
    leagueId = data?.league_id ?? undefined
  }

  const client = leagueId ? await getXClient(leagueId) : null

  const { appKey, appSecret } = getXAppConsumerKeys()
  let twitter: TwitterApi
  if (client) {
    twitter = client
  } else {
    const accessToken = process.env.X_ACCESS_TOKEN?.trim()
    const accessSecret = process.env.X_ACCESS_SECRET?.trim()
    if (!accessToken || !accessSecret) {
      throw new Error(
        `[x tweet] No per-league X tokens in webhook_config for league_id=${leagueId ?? '(none)'} ` +
          'and X_ACCESS_TOKEN / X_ACCESS_SECRET are missing in the environment. ' +
          'Add OAuth 1.0a user token+secret to .env, or add x_access_token + x_access_secret for this league.'
      )
    }
    twitter = new TwitterApi({
      appKey,
      appSecret,
      accessToken,
      accessSecret,
    })
  }

  let mediaId: string | undefined

  const mediaUrl =
    post.boxscore_processed_feed_url ??
    post.bg_image_url ??
    post.asset_urls?.[0]

  if (mediaUrl) {
    try {
      const res = await fetch(mediaUrl)
      if (!res.ok) {
        throw new Error(
          `[x media] fetch image ${mediaUrl.slice(0, 80)}… failed: HTTP ${res.status}`
        )
      }
      const arrayBuf = await res.arrayBuffer()
      const buf = Buffer.from(new Uint8Array(arrayBuf))
      mediaId = await twitter.v1.uploadMedia(buf, { mimeType: 'image/png' })
    } catch (err: unknown) {
      throw new Error(
        err instanceof Error && err.message.startsWith('[x media]')
          ? err.message
          : `[x media] ${formatXApiError(err)}`
      )
    }
  }

  try {
    const tweet = await twitter.v2.tweet({
      text: body,
      ...(mediaId ? { media: { media_ids: [mediaId] } } : {}),
    })
    return tweet.data.id
  } catch (err: unknown) {
    throw new Error(`[x tweet] ${formatXApiError(err)}`)
  }
}
