import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { supabase } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'changeme'

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
        bg_image_url, x_post_id, error, retries, created_at, match_id
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

    const { data, error } = await supabase
      .from('scheduled_posts')
      .insert({
        post_type: type,
        status,
        caption: caption || null,
        hashtags: tags.length ? tags : null,
        scheduled_for: scheduledFor,
        publish_surface: ['x'],
        payload_json: {},
      })
      .select()
      .single()
    if (error) return c.json({ error: error.message }, 500)
    return c.json(data, 201)
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
