/**
 * Static branded card generator (Figma-spec).
 * Produces complete 1200×630 PNGs using Satori with solid color backgrounds
 * matching the LBA Social Post Templates Figma file -- no AI image API needed.
 */
import type { ReactElement } from 'react'
import { createElement } from 'react'
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  renderSatoriToPng,
  fetchImageDataUrl,
  resolveFinalScoreGraphic,
} from './card-generator.js'
import {
  postTypeToKind,
  defaultHeadline,
  secondaryLines,
  ctaDisplayLabel,
  normalizeVibe,
  type AnnouncementPayload,
} from './announcements/templates.js'
import { resolveLeagueLogoForGraphicPayload } from './leagueLogo.js'
import { supabase } from './db.js'

const COLORS = {
  base: '#3b2d5c',
  scrim: '#120c1e',
  scrimOpacity: 0.5,
  gold: '#f0c75e',
  cream: '#f5f2eb',
  muted: '#9b8bb4',
  pillRed: '#c8314f',
  footerBand: '#1a2744',
  ctaBand: '#f0c75e',
  ctaText: '#120c1e',
} as const

function h(
  tag: string,
  style: Record<string, unknown>,
  ...children: (ReactElement | string | null)[]
): ReactElement {
  return createElement(tag, { style }, ...children.filter(Boolean))
}

function baseFrame(...children: (ReactElement | string | null)[]): ReactElement {
  return h(
    'div',
    {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      background: COLORS.base,
      fontFamily: 'Inter',
      overflow: 'hidden',
    },
    h('div', {
      position: 'absolute',
      top: 0,
      left: 0,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      background: COLORS.scrim,
      opacity: COLORS.scrimOpacity,
    }),
    h(
      'div',
      {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
      },
      ...children.filter(Boolean)
    )
  )
}

function logoImg(src: string, size = 56): ReactElement {
  return createElement('img', {
    src,
    width: size,
    height: size,
    style: { objectFit: 'contain' as const },
  })
}

// ---------- Final Score ----------

async function resolveKeyPerformer(matchId: string | null): Promise<string | null> {
  if (!matchId) return null
  const { data: mvpData } = await supabase
    .from('match_mvp')
    .select('player_id')
    .eq('match_id', matchId)
    .limit(1)
  const mvpId = mvpData?.[0]?.player_id ?? null

  const { data: stats } = await supabase
    .from('player_stats')
    .select('player_id, points, assists, rebounds, display_gt, player_name')
    .eq('match_id', matchId)

  if (!stats?.length) return null
  const perf = mvpId
    ? stats.find(s => s.player_id === mvpId) ?? stats.sort((a, b) => (b.points ?? 0) - (a.points ?? 0))[0]
    : stats.sort((a, b) => (b.points ?? 0) - (a.points ?? 0))[0]
  if (!perf) return null
  const name = perf.display_gt || perf.player_name || 'Player'
  return `${name} · ${perf.points ?? 0} PTS · ${perf.assists ?? 0} AST · ${perf.rebounds ?? 0} REB`
}

export async function generateStaticFinalScoreCard(
  payload: Record<string, unknown>
): Promise<Buffer> {
  const g = await resolveFinalScoreGraphic(payload)
  const leagueSrc = await fetchImageDataUrl(g.leagueLogo, 80)

  const season =
    typeof payload.season === 'string' ? payload.season.replace(/^season\s*/i, '').trim() : '2'
  const pillText = `FINAL · SEASON ${season.toUpperCase()}`

  const matchId = typeof payload.match_id === 'string' ? payload.match_id : null
  const keyPerf = await resolveKeyPerformer(matchId)

  const W = CARD_WIDTH
  const pillW = 330
  const pillH = 36
  const bandH = 80

  const tree = baseFrame(
    // Logo
    leagueSrc
      ? h('div', { display: 'flex', justifyContent: 'center', paddingTop: 20 }, logoImg(leagueSrc, 56))
      : h('div', { height: 20 }),
    // Pill
    h(
      'div',
      { display: 'flex', justifyContent: 'center', marginTop: 12 },
      h(
        'div',
        {
          background: COLORS.pillRed,
          borderRadius: 10,
          paddingLeft: 24,
          paddingRight: 24,
          paddingTop: 6,
          paddingBottom: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
        h(
          'div',
          { fontSize: 18, fontWeight: 700, color: COLORS.cream, textAlign: 'center' as const, letterSpacing: 1 },
          pillText
        )
      )
    ),
    // Score rows
    h(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        justifyContent: 'center',
        paddingLeft: 60,
        paddingRight: 60,
        gap: 0,
      },
      // Home team (gold)
      h(
        'div',
        { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
        h('div', { fontSize: 48, fontWeight: 700, color: COLORS.gold }, g.home.toUpperCase()),
        h('div', { fontSize: 80, fontWeight: 700, color: COLORS.cream }, String(g.homeScore))
      ),
      // Gold divider
      h('div', { width: '100%', height: 3, background: COLORS.gold, marginTop: 8, marginBottom: 8 }),
      // Away team (muted)
      h(
        'div',
        { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
        h('div', { fontSize: 48, fontWeight: 700, color: COLORS.muted }, g.away.toUpperCase()),
        h('div', { fontSize: 80, fontWeight: 700, color: COLORS.muted }, String(g.awayScore))
      )
    ),
    // Key Performer Band
    keyPerf
      ? h(
          'div',
          {
            width: W,
            height: bandH,
            background: COLORS.footerBand,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          },
          h('div', { position: 'absolute', top: 0, left: 0, width: W, height: 3, background: COLORS.gold }),
          h('div', { fontSize: 12, fontWeight: 600, color: COLORS.gold, letterSpacing: 2 }, 'KEY PERFORMER'),
          h('div', { fontSize: 22, fontWeight: 700, color: COLORS.cream, marginTop: 4 }, keyPerf)
        )
      : null
  )

  return renderSatoriToPng(CARD_WIDTH, CARD_HEIGHT, tree)
}

// ---------- Stat Leader (player_of_game) ----------

export async function generateStaticStatLeaderCard(
  payload: Record<string, unknown>
): Promise<Buffer> {
  const leagueSrc = await fetchImageDataUrl(
    (payload.league_logo as string | null) ?? null,
    80
  )
  const playerName = typeof payload.player_name === 'string' ? payload.player_name : 'PLAYER'
  const statLine = typeof payload.stat_line === 'string' ? payload.stat_line : ''
  const teamName = typeof payload.team_name === 'string' ? payload.team_name : ''
  const season =
    typeof payload.season === 'string' ? payload.season.replace(/^season\s*/i, '').trim() : '2'

  const statParts = statLine.split(/[\s/·]+/)
  const bigNumber = statParts.find(p => /^\d+(\.\d+)?$/.test(p)) ?? ''
  const statCategory = statLine.replace(bigNumber, '').replace(/[/·]/g, '').trim().toUpperCase() || 'STAT LINE'

  const tree = baseFrame(
    // Header row: logo left, season label right
    h(
      'div',
      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 24, paddingLeft: 30, paddingRight: 30 },
      leagueSrc ? logoImg(leagueSrc, 48) : h('div', { width: 48, height: 48 }),
      h('div', { fontSize: 14, fontWeight: 600, color: COLORS.muted, letterSpacing: 2 }, `STAT LEADER · SEASON ${season.toUpperCase()}`)
    ),
    // Big stat
    h(
      'div',
      { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, justifyContent: 'center', gap: 4 },
      h('div', { fontSize: 20, fontWeight: 600, color: COLORS.gold, letterSpacing: 2, textAlign: 'center' as const }, statCategory),
      bigNumber
        ? h('div', { fontSize: 140, fontWeight: 700, color: COLORS.cream, lineHeight: 1, textAlign: 'center' as const }, bigNumber)
        : null,
      h('div', { fontSize: 36, fontWeight: 700, color: COLORS.cream, textAlign: 'center' as const, marginTop: 8 }, playerName.toUpperCase()),
      teamName
        ? h('div', { fontSize: 18, fontWeight: 400, color: COLORS.muted, textAlign: 'center' as const }, teamName.toUpperCase())
        : null
    ),
    // Subline band
    h(
      'div',
      {
        width: CARD_WIDTH,
        height: 44,
        background: COLORS.footerBand,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      },
      h('div', { position: 'absolute', top: 0, left: 0, width: CARD_WIDTH, height: 3, background: COLORS.gold }),
      h('div', { fontSize: 14, fontWeight: 600, color: COLORS.muted, letterSpacing: 1 }, 'LEADS THE LBA')
    )
  )

  return renderSatoriToPng(CARD_WIDTH, CARD_HEIGHT, tree)
}

// ---------- Announcement ----------

export async function generateStaticAnnouncementCard(
  postType: string,
  payload: Record<string, unknown>
): Promise<Buffer> {
  const kind = postTypeToKind(postType)
  const resolvedLogoUrl = await resolveLeagueLogoForGraphicPayload(payload)
  const leagueSrc = await fetchImageDataUrl(resolvedLogoUrl, 80)

  const season = typeof payload.season === 'string' ? payload.season : ''
  const ctaRaw = typeof payload.cta === 'string' ? payload.cta : ''
  const announcementPayload: AnnouncementPayload = {
    season,
    cta: ctaRaw || ' ',
    cta_label: typeof payload.cta_label === 'string' ? payload.cta_label : undefined,
    vibe: normalizeVibe(typeof payload.vibe === 'string' ? payload.vibe : undefined),
  }

  const headline = kind ? defaultHeadline(kind, announcementPayload) : (typeof payload.headline_override === 'string' ? payload.headline_override : 'ANNOUNCEMENT')
  const lines = kind ? secondaryLines(kind, announcementPayload) : []
  const ctaLabel = kind ? ctaDisplayLabel(kind, announcementPayload) : 'LEARN MORE'
  const ctaUrl = ctaRaw.trim() ? (ctaRaw.includes('://') ? new URL(ctaRaw).host : ctaRaw).toUpperCase() : ''

  const headlineWords = headline.split(/\s+/)
  const headlineLines: string[] = []
  for (let i = 0; i < headlineWords.length; i += 2) {
    headlineLines.push(headlineWords.slice(i, i + 2).join(' '))
  }

  const W = CARD_WIDTH
  const bandH = 75

  const tree = baseFrame(
    // Logo
    leagueSrc
      ? h('div', { display: 'flex', justifyContent: 'center', paddingTop: 16 }, logoImg(leagueSrc, 50))
      : h('div', { height: 16 }),
    // Eyebrow
    h(
      'div',
      { display: 'flex', justifyContent: 'center', marginTop: 10 },
      h('div', {
        fontSize: 16,
        fontWeight: 600,
        color: COLORS.gold,
        letterSpacing: 2,
        textAlign: 'center' as const,
      }, `SEASON ${season.replace(/^season\s*/i, '').trim().toUpperCase()} IS COMING`)
    ),
    // Headline stack
    h(
      'div',
      { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, justifyContent: 'center', gap: 2 },
      ...headlineLines.map(line =>
        h('div', {
          fontSize: 68,
          fontWeight: 700,
          color: COLORS.cream,
          textAlign: 'center' as const,
          letterSpacing: 4,
          lineHeight: 1.1,
        }, line)
      )
    ),
    // Secondary lines
    lines.length > 0
      ? h(
          'div',
          { display: 'flex', justifyContent: 'center', marginBottom: 8 },
          h('div', { fontSize: 14, fontWeight: 400, color: COLORS.muted, textAlign: 'center' as const }, lines.join(' · '))
        )
      : null,
    // CTA Band
    h(
      'div',
      {
        width: W,
        height: bandH,
        background: COLORS.ctaBand,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
      h('div', { fontSize: 26, fontWeight: 700, color: COLORS.ctaText, letterSpacing: 1 },
        ctaUrl ? `${ctaLabel.toUpperCase()} · ${ctaUrl}` : ctaLabel.toUpperCase()
      )
    )
  )

  return renderSatoriToPng(CARD_WIDTH, CARD_HEIGHT, tree)
}

// ---------- Standings (Power Rankings) ----------

export async function generateStaticStandingsCard(
  payload: Record<string, unknown>
): Promise<Buffer> {
  const leagueSrc = await fetchImageDataUrl(
    (payload.league_logo as string | null) ?? null,
    80
  )
  const weekLabel = typeof payload.week_label === 'string' ? payload.week_label : 'POWER RANKINGS'
  const rawTeams = Array.isArray(payload.teams) ? payload.teams : []

  const W = CARD_WIDTH
  const rowH = 58
  const maxRows = 6

  const teamRows = rawTeams.slice(0, maxRows).map((t: Record<string, unknown>, i: number) => {
    const rank = typeof t.rank === 'number' ? t.rank : i + 1
    const name = typeof t.team_name === 'string' ? t.team_name : '?'
    const record = typeof t.record === 'string' ? t.record : ''

    return h(
      'div',
      {
        display: 'flex',
        alignItems: 'center',
        width: W - 120,
        height: rowH,
        background: 'rgba(255,255,255,0.06)',
        borderRadius: 8,
        paddingLeft: 12,
        paddingRight: 16,
        marginBottom: 4,
      },
      h(
        'div',
        {
          width: 44,
          height: 44,
          background: 'rgba(255,255,255,0.1)',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          fontWeight: 700,
          color: COLORS.cream,
        },
        String(rank)
      ),
      h('div', { fontSize: 24, fontWeight: 700, color: COLORS.cream, marginLeft: 16, flex: 1 }, name.toUpperCase()),
      h('div', { fontSize: 20, fontWeight: 700, color: COLORS.muted }, record)
    )
  })

  const tree = baseFrame(
    // Header
    h(
      'div',
      { display: 'flex', alignItems: 'center', padding: 20, paddingLeft: 30, gap: 16 },
      leagueSrc ? logoImg(leagueSrc, 48) : h('div', { width: 48, height: 48 }),
      h(
        'div',
        { display: 'flex', flexDirection: 'column' },
        h('div', { fontSize: 28, fontWeight: 700, color: COLORS.cream }, 'STANDINGS'),
        h('div', { fontSize: 14, fontWeight: 600, color: COLORS.muted, letterSpacing: 1 }, weekLabel.toUpperCase())
      )
    ),
    // Rows
    h(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        flex: 1,
        justifyContent: 'center',
        gap: 0,
      },
      ...teamRows
    )
  )

  return renderSatoriToPng(CARD_WIDTH, CARD_HEIGHT, tree)
}

// ---------- Router ----------

export async function generateStaticCard(
  postType: string,
  payload: Record<string, unknown>
): Promise<Buffer> {
  if (postType === 'final_score') return generateStaticFinalScoreCard(payload)
  if (postType === 'player_of_game') return generateStaticStatLeaderCard(payload)
  if (postType === 'weekly_power_rankings') return generateStaticStandingsCard(payload)
  if (postType.startsWith('announcement_')) return generateStaticAnnouncementCard(postType, payload)
  throw new Error(`[static-card] unsupported post_type: ${postType}`)
}
