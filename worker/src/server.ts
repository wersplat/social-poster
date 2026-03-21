import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { TwitterApi } from 'twitter-api-v2'
import {
  generateBackgroundForPost,
  isAiImagePostType,
} from './ai/generateBackground.js'
import { buildBgPrompt, normalizeStylePack } from './ai/bgPrompts.js'
import {
  type AnnouncementKind,
  type AnnouncementPayload,
  buildAnnouncementCaption,
  buildMidjourneyPromptExport,
  kindToPostType,
  normalizeVibe,
} from './announcements/templates.js'
import { supabase } from './db.js'
import { fetchLeagueLogoUrlByLeagueId } from './leagueLogo.js'
import { isR2Configured } from './r2.js'
import { planPosts } from './planning/planPosts.js'
import {
  existsAnnouncementScheduled,
  fetchStudioSuggestions,
} from './planning/queries.js'
import {
  getXAppConsumerKeys,
  invalidateXClientCacheForLeague,
} from './publisher.js'
import {
  signXOAuthPayload,
  verifyXOAuthCookie,
  xOAuthCookieHeader,
  type XOAuthPendingPayload,
} from './xOAuth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'changeme'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(s: string): boolean {
  return UUID_RE.test(s.trim())
}

function parseAnnouncementKindParam(seg: string | undefined): AnnouncementKind | null {
  const s = (seg ?? '').trim().toLowerCase()
  if (s === 'registration') return 'registration'
  if (s === 'draft') return 'draft'
  if (s === 'results') return 'results'
  if (s === 'playoffs') return 'playoffs'
  if (s === 'champion') return 'champion'
  if (s === 'awards') return 'awards'
  if (s === 'schedule') return 'schedule'
  return null
}

function getR2ConfigError(): string | null {
  const missing: string[] = []
  if (!process.env.R2_ACCESS_KEY_ID?.trim()) missing.push('R2_ACCESS_KEY_ID')
  if (!process.env.R2_SECRET_ACCESS_KEY?.trim()) missing.push('R2_SECRET_ACCESS_KEY')
  if (!process.env.R2_BUCKET?.trim()) missing.push('R2_BUCKET')
  if (!process.env.R2_PUBLIC_BASE_URL?.trim()) missing.push('R2_PUBLIC_BASE_URL')
  const hasEndpoint = !!process.env.R2_ENDPOINT?.trim()
  const hasAccount = !!process.env.R2_ACCOUNT_ID?.trim()
  if (!hasEndpoint && !hasAccount) {
    missing.push('R2_ENDPOINT or R2_ACCOUNT_ID')
  }
  if (missing.length === 0) return null
  return `R2 is not fully configured. Missing or empty env: ${missing.join(', ')}. Same shape as lba-social: optional R2_ENDPOINT, or R2_ACCOUNT_ID to build the S3 endpoint; R2_BUCKET = bucket name or bucket/prefix.`
}

function getAiImageApiConfigError(): string | null {
  const p = process.env.AI_IMAGE_PROVIDER?.toLowerCase().trim()
  const useGemini = p === 'gemini'
  if (useGemini) {
    if (!process.env.GEMINI_API_KEY?.trim()) {
      return 'AI_IMAGE_PROVIDER=gemini but GEMINI_API_KEY is missing or empty.'
    }
    return null
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return 'OPENAI_API_KEY is missing or empty (default image provider is OpenAI). For Imagen, set AI_IMAGE_PROVIDER=gemini and GEMINI_API_KEY.'
  }
  return null
}

function oauthCallbackUrl(c: { req: { url: string } }): string {
  const explicit = process.env.X_OAUTH_CALLBACK_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')
  return new URL(c.req.url).origin + '/api/x/oauth/callback'
}

function adminRedirectUrl(c: { req: { url: string } }, query: string): string {
  const origin = new URL(c.req.url).origin
  return `${origin}/admin${query ? `?${query}` : ''}`
}

function normalizeTeamEmbed(v: unknown): { name: string } | null {
  if (v == null) return null
  if (Array.isArray(v)) {
    const x = v[0]
    if (x && typeof x === 'object' && x !== null && 'name' in x) {
      return { name: String((x as { name: unknown }).name) }
    }
    return null
  }
  if (typeof v === 'object' && 'name' in v) {
    return { name: String((v as { name: unknown }).name) }
  }
  return null
}

const authMiddleware = createMiddleware(async (c, next) => {
  const auth = c.req.header('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (token !== ADMIN_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

export function createServer() {
  const app = new Hono()

  app.get('/health', c => c.text('ok'))

  app.get('/favicon.ico', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#7c6af7"/></svg>'
    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  })

  app.get('/admin', c => {
    const path = join(__dirname, '../public/admin.html')
    const html = readFileSync(path, 'utf8')
    return c.html(html)
  })

  app.get('/api/posts', authMiddleware, async c => {
    const mode = c.req.query('mode') ?? 'queue'
    const statusFilter =
      mode === 'queue'
        ? ['pending', 'processing', 'scheduled', 'draft']
        : ['published', 'failed']

    // No FK scheduled_posts.match_id → matches.id in some DBs → PostgREST cannot embed `matches`.
    // Fetch posts, then matches in a second query and merge (same shape the admin UI expects).
    const { data: posts, error } = await supabase
      .from('scheduled_posts')
      .select(
        `
        id, post_type, status, caption, hashtags, scheduled_for,
        bg_image_url, x_post_id, error, retries, created_at, match_id,
        payload_json
      `
      )
      .in('status', statusFilter)
      .contains('publish_surface', ['x'])
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) return c.json({ error: error.message }, 500)

    const list = posts ?? []
    const matchIds = [
      ...new Set(
        list
          .map(p => p.match_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      ),
    ]

    const matchById = new Map<
      string,
      {
        score_a: number | null
        score_b: number | null
        team_a: { name: string } | null
        team_b: { name: string } | null
      }
    >()

    if (matchIds.length > 0) {
      const { data: matches, error: mErr } = await supabase
        .from('matches')
        .select(
          `
          id, score_a, score_b,
          team_a:teams!team_a_id(name),
          team_b:teams!team_b_id(name)
        `
        )
        .in('id', matchIds)

      if (mErr) return c.json({ error: mErr.message }, 500)

      for (const m of matches ?? []) {
        const row = m as {
          id: string
          score_a: number | null
          score_b: number | null
          team_a: unknown
          team_b: unknown
        }
        matchById.set(row.id, {
          score_a: row.score_a,
          score_b: row.score_b,
          team_a: normalizeTeamEmbed(row.team_a),
          team_b: normalizeTeamEmbed(row.team_b),
        })
      }
    }

    const enriched = list.map(p => ({
      ...p,
      matches:
        p.match_id && matchById.has(p.match_id)
          ? matchById.get(p.match_id)!
          : null,
    }))

    return c.json(enriched)
  })

  app.patch('/api/posts/:id', authMiddleware, async c => {
    const id = c.req.param('id')
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    const allowed = ['caption', 'status', 'scheduled_for', 'hashtags'] as const
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const key of allowed) {
      if (!(key in body)) continue
      if (key === 'scheduled_for') {
        const v = body.scheduled_for
        if (v == null || v === '') {
          patch.scheduled_for = new Date().toISOString()
        } else if (typeof v === 'string') {
          patch.scheduled_for = new Date(v).toISOString()
        } else {
          patch.scheduled_for = v
        }
        continue
      }
      patch[key] = body[key]
    }

    if ('bg_image_url' in body) {
      const v = body.bg_image_url
      if (v === null || v === '') patch.bg_image_url = null
      else if (typeof v === 'string') patch.bg_image_url = v.trim() || null
    }

    const pp = body.payload_patch
    if (
      pp !== null &&
      pp !== undefined &&
      typeof pp === 'object' &&
      !Array.isArray(pp)
    ) {
      const { data: row, error: selErr } = await supabase
        .from('scheduled_posts')
        .select('payload_json')
        .eq('id', id)
        .single()
      if (selErr) return c.json({ error: selErr.message }, 500)
      const raw = row?.payload_json
      const cur: Record<string, unknown> =
        raw !== null &&
        raw !== undefined &&
        typeof raw === 'object' &&
        !Array.isArray(raw)
          ? { ...(raw as Record<string, unknown>) }
          : {}
      const incoming = pp as Record<string, unknown>
      for (const k of ['generate_image', 'style_pack', 'style_version'] as const) {
        if (k in incoming) cur[k] = incoming[k]
      }
      patch.payload_json = cur
    }

    const { data, error } = await supabase
      .from('scheduled_posts')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    if (error) return c.json({ error: error.message }, 500)
    return c.json(data)
  })

  app.post('/api/posts/:id/publish-now', authMiddleware, async c => {
    const id = c.req.param('id')
    const due = new Date().toISOString()
    const { data, error } = await supabase
      .from('scheduled_posts')
      .update({
        status: 'pending',
        scheduled_for: due,
        retries: 0,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()
    if (error) return c.json({ error: error.message }, 500)
    return c.json(data)
  })

  app.post('/api/posts/:id/generate-image', authMiddleware, async c => {
    const id = c.req.param('id')
    let force = false
    try {
      const b = await c.req.json()
      if (b && typeof b === 'object' && b.force === true) force = true
    } catch {
      /* empty body */
    }

    const { data: row, error: selErr } = await supabase
      .from('scheduled_posts')
      .select('*')
      .eq('id', id)
      .single()

    if (selErr || !row) return c.json({ error: 'Not found' }, 404)

    const surfaces = row.publish_surface as string[] | null
    if (!surfaces?.includes('x'))
      return c.json({ error: 'Not an X post' }, 400)

    if (!isAiImagePostType(row.post_type as string)) {
      return c.json(
        { error: 'Post type does not support AI background' },
        400
      )
    }

    const p =
      row.payload_json &&
      typeof row.payload_json === 'object' &&
      !Array.isArray(row.payload_json)
        ? { ...(row.payload_json as Record<string, unknown>) }
        : {}

    if (!force && p.generate_image === false) {
      return c.json(
        {
          error:
            'generate_image is false; send JSON body { "force": true } to override',
        },
        400
      )
    }

    const r2Err = getR2ConfigError()
    if (r2Err) {
      console.warn('[generate-image]', r2Err)
      return c.json({ error: r2Err, code: 'r2_not_configured' }, 422)
    }
    const aiErr = getAiImageApiConfigError()
    if (aiErr) {
      console.warn('[generate-image]', aiErr)
      return c.json({ error: aiErr, code: 'ai_api_not_configured' }, 422)
    }

    const stylePack =
      typeof p.style_pack === 'string' && p.style_pack.trim()
        ? p.style_pack.trim()
        : 'regular'
    const styleVersion =
      typeof p.style_version === 'number' && Number.isFinite(p.style_version)
        ? p.style_version
        : 1

    try {
      const { imageUrl, prompt } = await generateBackgroundForPost({
        postType: row.post_type as string,
        stylePack,
        styleVersion,
        payload: p,
      })
      const nextPayload = {
        ...p,
        ai_bg_prompt: prompt,
        ai_bg_generated_at: new Date().toISOString(),
      }
      const { data: updated, error: upErr } = await supabase
        .from('scheduled_posts')
        .update({
          bg_image_url: imageUrl,
          payload_json: nextPayload,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single()
      if (upErr) {
        console.error('[generate-image] supabase update failed:', upErr.message)
        return c.json({ error: upErr.message }, 500)
      }
      return c.json(updated)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[generate-image] failed:', e)
      return c.json({ error: msg }, 500)
    }
  })

  app.get('/api/announcements/:kind/preview-prompt', authMiddleware, async c => {
    const kind = parseAnnouncementKindParam(c.req.param('kind'))
    if (!kind) {
      return c.json(
        {
          error:
            'kind must be registration, draft, results, playoffs, champion, awards, or schedule',
        },
        400
      )
    }

    const season = (c.req.query('season') ?? '').trim() || 'Season 2'
    const cta = (c.req.query('cta') ?? '').trim() || 'lba.gg/signup/player'
    const draft_date = (c.req.query('draft_date') ?? '').trim()
    const combine_dates = (c.req.query('combine_dates') ?? '').trim()
    const prize_pool = (c.req.query('prize_pool') ?? '').trim()
    const headline_override = (c.req.query('headline_override') ?? '').trim()
    const league_logo = (c.req.query('league_logo') ?? '').trim()
    const champion_team = (c.req.query('champion_team') ?? '').trim()
    const series_score = (c.req.query('series_score') ?? '').trim()
    const award_name = (c.req.query('award_name') ?? '').trim()
    const recipient_name = (c.req.query('recipient_name') ?? '').trim()
    const recipient_stats = (c.req.query('recipient_stats') ?? '').trim()
    const game_count = (c.req.query('game_count') ?? '').trim()
    const start_date = (c.req.query('start_date') ?? '').trim()
    const bracket_size = (c.req.query('bracket_size') ?? '').trim()
    const vibe = normalizeVibe(c.req.query('vibe'))
    const stylePack = normalizeStylePack(c.req.query('style_pack'))

    const payload: AnnouncementPayload = {
      season,
      cta,
      vibe,
      draft_date: draft_date || undefined,
      combine_dates: combine_dates || undefined,
      prize_pool: prize_pool || undefined,
      headline_override: headline_override || undefined,
      league_logo: league_logo || null,
      champion_team: champion_team || undefined,
      series_score: series_score || undefined,
      award_name: award_name || undefined,
      recipient_name: recipient_name || undefined,
      recipient_stats: recipient_stats || undefined,
      game_count: game_count || undefined,
      start_date: start_date || undefined,
      bracket_size: bracket_size || undefined,
    }

    const postType = kindToPostType(kind)
    const prompt = buildBgPrompt({
      postType,
      stylePack,
      payload: { ...payload, vibe } as Record<string, unknown>,
    })

    return c.json({
      post_type: postType,
      ai_image_prompt: prompt,
      midjourney_prompt_export: buildMidjourneyPromptExport(kind, payload),
      default_caption: buildAnnouncementCaption(kind, payload),
    })
  })

  async function handleAnnouncementPost(c: Context, kind: AnnouncementKind) {
    let body: Record<string, unknown>
    try {
      body = (await c.req.json()) as Record<string, unknown>
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    const season =
      typeof body.season === 'string' && body.season.trim() ? body.season.trim() : ''
    if (!season) return c.json({ error: 'season is required' }, 400)

    const ctaRaw = typeof body.cta === 'string' && body.cta.trim() ? body.cta.trim() : ''
    if (!ctaRaw) return c.json({ error: 'cta is required' }, 400)

    const defaultLeague = process.env.LEAGUE_ID?.trim()
    const leagueId =
      typeof body.league_id === 'string' && body.league_id.trim()
        ? body.league_id.trim()
        : defaultLeague ?? ''
    if (!leagueId || !isUuid(leagueId)) {
      return c.json(
        { error: 'league_id (UUID) is required, or set LEAGUE_ID in the worker environment' },
        400
      )
    }

    const postType = kindToPostType(kind)
    const seasonId =
      typeof body.season_id === 'string' && body.season_id.trim()
        ? body.season_id.trim()
        : ''
    const dedupeKey = seasonId || season
    const skipDedupe = body.skip_dedupe === true || body.force === true

    if (!skipDedupe) {
      const exists = await existsAnnouncementScheduled(leagueId, postType, dedupeKey)
      if (exists) {
        return c.json(
          {
            error:
              'Duplicate announcement for this league, post type, and season key. Pass skip_dedupe: true to insert anyway.',
            dedupe_key: dedupeKey,
          },
          409
        )
      }
    }

    const payload: Record<string, unknown> = {
      season,
      cta: ctaRaw,
      league_id: leagueId,
      vibe: normalizeVibe(typeof body.vibe === 'string' ? body.vibe : undefined),
      generate_image: body.generate_image !== false,
      style_pack:
        typeof body.style_pack === 'string' && body.style_pack.trim()
          ? body.style_pack.trim()
          : 'regular',
      style_version:
        typeof body.style_version === 'number' && Number.isFinite(body.style_version)
          ? body.style_version
          : 1,
    }

    if (seasonId) payload.season_id = seasonId
    if (typeof body.draft_date === 'string' && body.draft_date.trim()) {
      payload.draft_date = body.draft_date.trim()
    }
    if (typeof body.combine_dates === 'string' && body.combine_dates.trim()) {
      payload.combine_dates = body.combine_dates.trim()
    }
    if (typeof body.prize_pool === 'string' && body.prize_pool.trim()) {
      payload.prize_pool = body.prize_pool.trim()
    }
    if (typeof body.cta_label === 'string' && body.cta_label.trim()) {
      payload.cta_label = body.cta_label.trim()
    }
    const bodyLogo =
      typeof body.league_logo === 'string' && body.league_logo.trim()
        ? body.league_logo.trim()
        : ''
    if (bodyLogo) {
      payload.league_logo = bodyLogo
    } else {
      const fromDb = await fetchLeagueLogoUrlByLeagueId(leagueId)
      if (fromDb) payload.league_logo = fromDb
    }
    if (typeof body.headline_override === 'string' && body.headline_override.trim()) {
      payload.headline_override = body.headline_override.trim()
    }
    if (Array.isArray(body.result_lines)) {
      payload.result_lines = body.result_lines.filter(
        (x): x is string => typeof x === 'string'
      )
    }
    if (typeof body.champion_team === 'string' && body.champion_team.trim()) {
      payload.champion_team = body.champion_team.trim()
    }
    if (typeof body.series_score === 'string' && body.series_score.trim()) {
      payload.series_score = body.series_score.trim()
    }
    if (typeof body.award_name === 'string' && body.award_name.trim()) {
      payload.award_name = body.award_name.trim()
    }
    if (typeof body.recipient_name === 'string' && body.recipient_name.trim()) {
      payload.recipient_name = body.recipient_name.trim()
    }
    if (typeof body.recipient_stats === 'string' && body.recipient_stats.trim()) {
      payload.recipient_stats = body.recipient_stats.trim()
    }
    if (typeof body.game_count === 'string' && body.game_count.trim()) {
      payload.game_count = body.game_count.trim()
    }
    if (typeof body.start_date === 'string' && body.start_date.trim()) {
      payload.start_date = body.start_date.trim()
    }
    if (typeof body.bracket_size === 'string' && body.bracket_size.trim()) {
      payload.bracket_size = body.bracket_size.trim()
    }

    const draft = body.draft === true
    const explicitSchedule =
      typeof body.scheduled_for === 'string' && body.scheduled_for.trim()
        ? new Date(body.scheduled_for).toISOString()
        : null
    const scheduledFor = explicitSchedule ?? new Date().toISOString()
    const status = draft ? 'draft' : explicitSchedule ? 'scheduled' : 'pending'

    const caption =
      typeof body.caption === 'string' && body.caption.trim()
        ? body.caption.trim()
        : null

    const hashtagRaw = typeof body.hashtags === 'string' ? body.hashtags : ''
    const tags = hashtagRaw
      .split(/\s+/)
      .filter((t: string) => t.startsWith('#'))

    const insertRow: Record<string, unknown> = {
      post_type: postType,
      status,
      caption,
      hashtags: tags.length ? tags : null,
      scheduled_for: scheduledFor,
      publish_surface: ['x'],
      payload_json: payload,
      match_id: null,
    }

    const { data, error } = await supabase
      .from('scheduled_posts')
      .insert(insertRow)
      .select()
      .single()
    if (error) return c.json({ error: error.message }, 500)
    return c.json(data, 201)
  }

  app.post('/api/announcements/registration', authMiddleware, async c => {
    return handleAnnouncementPost(c, 'registration')
  })
  app.post('/api/announcements/draft', authMiddleware, async c => {
    return handleAnnouncementPost(c, 'draft')
  })
  app.post('/api/announcements/results', authMiddleware, async c => {
    return handleAnnouncementPost(c, 'results')
  })
  app.post('/api/announcements/playoffs', authMiddleware, async c => {
    return handleAnnouncementPost(c, 'playoffs')
  })
  app.post('/api/announcements/champion', authMiddleware, async c => {
    return handleAnnouncementPost(c, 'champion')
  })
  app.post('/api/announcements/awards', authMiddleware, async c => {
    return handleAnnouncementPost(c, 'awards')
  })
  app.post('/api/announcements/schedule', authMiddleware, async c => {
    return handleAnnouncementPost(c, 'schedule')
  })

  app.get('/api/studio/suggestions', authMiddleware, async c => {
    const leagueId = (c.req.query('league_id') ?? '').trim()
    if (!leagueId || !isUuid(leagueId)) {
      return c.json({ error: 'league_id query param must be a valid UUID' }, 400)
    }
    try {
      const data = await fetchStudioSuggestions(leagueId)
      return c.json(data)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ error: message }, 500)
    }
  })

  app.post('/api/posts', authMiddleware, async c => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    const hashtagRaw = typeof body.hashtags === 'string' ? body.hashtags : ''
    const tags = hashtagRaw
      .split(/\s+/)
      .filter((t: string) => t.startsWith('#'))

    const caption =
      typeof body.caption === 'string' ? body.caption.trim() : ''
    const type = typeof body.type === 'string' ? body.type : 'announcement'
    const draft = body.draft === true
    const explicitSchedule =
      typeof body.scheduled_for === 'string' && body.scheduled_for.trim()
        ? new Date(body.scheduled_for).toISOString()
        : null

    // DB column scheduled_for is NOT NULL in this project — use "now" when posting immediately.
    const scheduledFor = explicitSchedule ?? new Date().toISOString()

    const status = draft
      ? 'draft'
      : explicitSchedule
        ? 'scheduled'
        : 'pending'

    const payloadRaw = body.payload_json
    const payload_json: Record<string, unknown> =
      payloadRaw !== null &&
      payloadRaw !== undefined &&
      typeof payloadRaw === 'object' &&
      !Array.isArray(payloadRaw)
        ? { ...(payloadRaw as Record<string, unknown>) }
        : {}

    if (body.generate_image === false) payload_json.generate_image = false
    if (body.generate_image === true) payload_json.generate_image = true

    const sp = body.style_pack
    if (typeof sp === 'string' && sp.trim()) payload_json.style_pack = sp.trim()

    const sv = body.style_version
    if (typeof sv === 'number' && Number.isFinite(sv)) payload_json.style_version = sv

    const defaultLeague = process.env.LEAGUE_ID?.trim()
    if (defaultLeague && typeof payload_json.league_id !== 'string') {
      payload_json.league_id = defaultLeague
    }
    const lid = body.league_id
    if (typeof lid === 'string' && lid.trim()) payload_json.league_id = lid.trim()

    const announcementLeagueId =
      typeof payload_json.league_id === 'string' && payload_json.league_id.trim()
        ? payload_json.league_id.trim()
        : defaultLeague ?? ''
    if (
      type.startsWith('announcement_') &&
      announcementLeagueId &&
      isUuid(announcementLeagueId) &&
      !(typeof payload_json.league_logo === 'string' && payload_json.league_logo.trim())
    ) {
      const logoUrl = await fetchLeagueLogoUrlByLeagueId(announcementLeagueId)
      if (logoUrl) payload_json.league_logo = logoUrl
    }

    const mid = body.match_id
    const match_id =
      typeof mid === 'string' && mid.trim() ? mid.trim() : null

    const insertRow: Record<string, unknown> = {
      post_type: type,
      status,
      caption: caption || null,
      hashtags: tags.length ? tags : null,
      scheduled_for: scheduledFor,
      publish_surface: ['x'],
      payload_json,
      match_id,
    }

    const bg = body.bg_image_url
    if (typeof bg === 'string' && bg.trim()) insertRow.bg_image_url = bg.trim()

    const assets = body.asset_urls
    if (Array.isArray(assets) && assets.every((u): u is string => typeof u === 'string')) {
      insertRow.asset_urls = assets
    }

    const { data, error } = await supabase
      .from('scheduled_posts')
      .insert(insertRow)
      .select()
      .single()
    if (error) return c.json({ error: error.message }, 500)
    return c.json(data, 201)
  })

  app.post('/api/jobs/plan', authMiddleware, async c => {
    try {
      const result = await planPosts()
      return c.json(result)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ error: message }, 500)
    }
  })

  app.get('/api/policies', authMiddleware, async c => {
    const [{ data: leagues, error: leaguesErr }, { data: policies, error: polErr }] =
      await Promise.all([
        supabase.from('leagues_info').select('id, league').order('league'),
        supabase.from('post_policies').select('*'),
      ])

    if (leaguesErr) return c.json({ error: leaguesErr.message }, 500)
    if (polErr) return c.json({ error: polErr.message }, 500)

    const leagueList = leagues ?? []
    const leagueIds = leagueList.map(l => l.id)

    let wcRows: { league_id: string; key: string }[] = []
    if (leagueIds.length > 0) {
      const { data, error: wcErr } = await supabase
        .from('webhook_config')
        .select('league_id, key')
        .in('league_id', leagueIds)
        .in('key', ['x_access_token', 'x_access_secret'])
      if (wcErr) return c.json({ error: wcErr.message }, 500)
      wcRows = (data ?? []) as { league_id: string; key: string }[]
    }

    const creds = new Map<string, Set<string>>()
    for (const row of wcRows) {
      const lid = row.league_id as string
      const k = row.key as string
      if (!creds.has(lid)) creds.set(lid, new Set())
      creds.get(lid)!.add(k)
    }

    const enriched = leagueList.map(lg => {
      const keys = creds.get(lg.id) ?? new Set()
      const hasCredentials =
        keys.has('x_access_token') && keys.has('x_access_secret')
      return { ...lg, has_x_credentials: hasCredentials }
    })

    return c.json({ leagues: enriched, policies: policies ?? [] })
  })

  app.post('/api/x/oauth/start', authMiddleware, async c => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    const leagueId =
      typeof body.league_id === 'string' ? body.league_id.trim() : ''
    if (!leagueId) return c.json({ error: 'league_id required' }, 400)

    const callbackUrl = oauthCallbackUrl(c)
    try {
      const { appKey, appSecret } = getXAppConsumerKeys()
      const client = new TwitterApi({ appKey, appSecret })
      const authLink = await client.generateAuthLink(callbackUrl, {
        linkMode: 'authorize',
      })
      const payload: XOAuthPendingPayload = {
        league_id: leagueId,
        oauth_token: authLink.oauth_token,
        oauth_token_secret: authLink.oauth_token_secret,
        exp: Date.now() + 14 * 60 * 1000,
      }
      const signed = signXOAuthPayload(payload)
      return c.json(
        { url: authLink.url },
        200,
        xOAuthCookieHeader(signed, false)
      )
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ error: message }, 500)
    }
  })

  app.get('/api/x/oauth/callback', async c => {
    const oauthToken = c.req.query('oauth_token') ?? ''
    const oauthVerifier = c.req.query('oauth_verifier') ?? ''
    const clear = xOAuthCookieHeader('', true)
    const baseHeaders = { 'Set-Cookie': clear['Set-Cookie'] }

    if (!oauthVerifier) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: adminRedirectUrl(c, 'x_oauth=denied'),
          ...baseHeaders,
        },
      })
    }

    const raw = getCookie(c, 'x_oauth_pending')
    const pending = verifyXOAuthCookie(raw)
    if (!pending || pending.oauth_token !== oauthToken) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: adminRedirectUrl(c, 'x_oauth=invalid'),
          ...baseHeaders,
        },
      })
    }

    try {
      const { appKey, appSecret } = getXAppConsumerKeys()
      const client = new TwitterApi({
        appKey,
        appSecret,
        accessToken: oauthToken,
        accessSecret: pending.oauth_token_secret,
      })
      const { accessToken, accessSecret } = await client.login(oauthVerifier)

      const leagueId = pending.league_id
      await supabase
        .from('webhook_config')
        .delete()
        .eq('league_id', leagueId)
        .in('key', ['x_access_token', 'x_access_secret'])

      const { error } = await supabase.from('webhook_config').insert([
        { league_id: leagueId, key: 'x_access_token', value: accessToken },
        { league_id: leagueId, key: 'x_access_secret', value: accessSecret },
      ])

      if (error) {
        const detail = error.message.slice(0, 200)
        return new Response(null, {
          status: 302,
          headers: {
            Location: adminRedirectUrl(
              c,
              `x_oauth=db_error&detail=${encodeURIComponent(detail)}`
            ),
            ...baseHeaders,
          },
        })
      }

      invalidateXClientCacheForLeague(leagueId)
      return new Response(null, {
        status: 302,
        headers: {
          Location: adminRedirectUrl(c, 'x_oauth=ok'),
          ...baseHeaders,
        },
      })
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200)
      return new Response(null, {
        status: 302,
        headers: {
          Location: adminRedirectUrl(
            c,
            `x_oauth=token_error&detail=${encodeURIComponent(msg)}`
          ),
          ...baseHeaders,
        },
      })
    }
  })

  app.patch('/api/policies/:leagueId', authMiddleware, async c => {
    const leagueId = c.req.param('leagueId')
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    const allowed = [
      'auto_post_verified_games',
      'include_box_score_link',
      'include_hashtags',
      'min_stat_threshold',
    ] as const
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const key of allowed) {
      if (key in body) patch[key] = body[key]
    }
    const { data, error } = await supabase
      .from('post_policies')
      .upsert({ league_id: leagueId, ...patch }, { onConflict: 'league_id' })
      .select()
      .single()
    if (error) return c.json({ error: error.message }, 500)
    return c.json(data)
  })

  return app
}
