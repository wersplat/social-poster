import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { Resvg } from '@resvg/resvg-js'
import type { ReactElement } from 'react'
import { createElement } from 'react'
import satori from 'satori'
import sharp from 'sharp'
import { supabase } from './db.js'
import { isR2Configured, uploadPublicPng } from './r2.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

type TeamRef = { name: string } | null

type MatchRow = {
  score_a: number | null
  score_b: number | null
  team_a: TeamRef
  team_b: TeamRef
}

function loadFonts(): { name: string; data: Buffer; weight: 400 | 700; style: 'normal' }[] {
  const regular = join(__dirname, '../fonts/Inter-Regular.ttf')
  const bold = join(__dirname, '../fonts/Inter-Bold.ttf')
  return [
    { name: 'Inter', data: readFileSync(regular), weight: 400, style: 'normal' },
    { name: 'Inter', data: readFileSync(bold), weight: 700, style: 'normal' },
  ]
}

let fontsCache: ReturnType<typeof loadFonts> | null = null

function getFonts() {
  if (!fontsCache) fontsCache = loadFonts()
  return fontsCache
}

export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 630

async function renderSatoriToPng(width: number, height: number, tree: ReactElement): Promise<Buffer> {
  const svg = await satori(tree, {
    width,
    height,
    fonts: getFonts().map(f => ({
      name: f.name,
      data: f.data,
      weight: f.weight,
      style: f.style,
    })),
  })
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } })
  return Buffer.from(png.render().asPng())
}

async function fetchImageDataUrl(
  url: string | null | undefined,
  maxSide: number
): Promise<string | null> {
  if (!url?.trim()) return null
  try {
    const res = await fetch(url.trim())
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const resized = await sharp(buf)
      .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
    return `data:image/png;base64,${resized.toString('base64')}`
  } catch {
    return null
  }
}

type MatchTeamsRow = {
  score_a: number | null
  score_b: number | null
  team_a: { name: string; logo_url: string | null } | null
  team_b: { name: string; logo_url: string | null } | null
}

async function resolveFinalScoreGraphic(p: Record<string, unknown>) {
  const mid = typeof p.match_id === 'string' ? p.match_id : null
  if (mid) {
    const { data, error } = await supabase
      .from('matches')
      .select(
        `
        score_a, score_b,
        team_a:teams!team_a_id(name, logo_url),
        team_b:teams!team_b_id(name, logo_url)
      `
      )
      .eq('id', mid)
      .single()
    if (!error && data) {
      const m = data as unknown as MatchTeamsRow
      const hs =
        typeof p.home_score === 'number' && Number.isFinite(p.home_score)
          ? p.home_score
          : (m.score_a ?? 0)
      const ascore =
        typeof p.away_score === 'number' && Number.isFinite(p.away_score)
          ? p.away_score
          : (m.score_b ?? 0)
      return {
        home: m.team_a?.name ?? '?',
        away: m.team_b?.name ?? '?',
        homeScore: hs,
        awayScore: ascore,
        homeLogo: m.team_a?.logo_url ?? (p.home_team_logo as string | null) ?? null,
        awayLogo: m.team_b?.logo_url ?? (p.away_team_logo as string | null) ?? null,
        leagueLogo: (p.league_logo as string | null) ?? null,
      }
    }
  }
  return {
    home: typeof p.home_team === 'string' ? p.home_team : '?',
    away: typeof p.away_team === 'string' ? p.away_team : '?',
    homeScore: typeof p.home_score === 'number' ? p.home_score : 0,
    awayScore: typeof p.away_score === 'number' ? p.away_score : 0,
    homeLogo: (p.home_team_logo as string | null) ?? null,
    awayLogo: (p.away_team_logo as string | null) ?? null,
    leagueLogo: (p.league_logo as string | null) ?? null,
  }
}

async function finalScoreOverlayTree(p: Record<string, unknown>): Promise<ReactElement> {
  const g = await resolveFinalScoreGraphic(p)
  const leagueSrc = await fetchImageDataUrl(g.leagueLogo, 80)
  const homeSrc = await fetchImageDataUrl(g.homeLogo, 112)
  const awaySrc = await fetchImageDataUrl(g.awayLogo, 112)

  return createElement(
    'div',
    {
      style: {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        background: 'transparent',
      },
    },
    createElement(
      'div',
      {
        style: {
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 24,
          paddingBottom: 40,
          paddingLeft: 48,
          paddingRight: 48,
          background:
            'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.45) 38%, rgba(0,0,0,0.9) 100%)',
        },
      },
      leagueSrc
        ? createElement('img', {
            src: leagueSrc,
            width: 64,
            height: 64,
            style: { objectFit: 'contain' as const, marginBottom: 20 },
          })
        : createElement('div', { style: { height: 0, marginBottom: 0 } }),
      createElement(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 40,
            width: '100%',
          },
        },
        createElement(
          'div',
          {
            style: {
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 12,
            },
          },
          homeSrc
            ? createElement('img', {
                src: homeSrc,
                width: 96,
                height: 96,
                style: { objectFit: 'contain' as const },
              })
            : createElement('div', { style: { width: 96, height: 96 } }),
          createElement(
            'div',
            {
              style: {
                fontSize: 36,
                fontWeight: 700,
                color: '#f2f2f7',
                textAlign: 'right' as const,
                maxWidth: 420,
              },
            },
            g.home
          )
        ),
        createElement(
          'div',
          {
            style: {
              fontSize: 80,
              fontWeight: 700,
              color: '#ffffff',
              minWidth: 300,
              textAlign: 'center' as const,
              letterSpacing: 2,
            },
          },
          `${g.homeScore}  —  ${g.awayScore}`
        ),
        createElement(
          'div',
          {
            style: {
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 12,
            },
          },
          awaySrc
            ? createElement('img', {
                src: awaySrc,
                width: 96,
                height: 96,
                style: { objectFit: 'contain' as const },
              })
            : createElement('div', { style: { width: 96, height: 96 } }),
          createElement(
            'div',
            {
              style: {
                fontSize: 36,
                fontWeight: 700,
                color: '#f2f2f7',
                textAlign: 'left' as const,
                maxWidth: 420,
              },
            },
            g.away
          )
        )
      )
    )
  )
}

async function pogOverlayTree(p: Record<string, unknown>): Promise<ReactElement> {
  const name = typeof p.player_name === 'string' ? p.player_name : 'Player'
  const team = typeof p.team_name === 'string' ? p.team_name : ''
  const stat = typeof p.stat_line === 'string' ? p.stat_line : ''
  const teamSrc = await fetchImageDataUrl(p.team_logo as string | null, 96)
  const leagueSrc = await fetchImageDataUrl(p.league_logo as string | null, 72)

  const pogInnerChildren: ReactElement[] = []
  if (leagueSrc) {
    pogInnerChildren.push(
      createElement('img', {
        src: leagueSrc,
        width: 56,
        height: 56,
        style: { objectFit: 'contain' as const },
      })
    )
  }
  pogInnerChildren.push(
    createElement(
      'div',
      {
        style: {
          fontSize: 22,
          fontWeight: 400,
          letterSpacing: 6,
          textTransform: 'uppercase' as const,
          color: '#9b8cff',
        },
      },
      'Player of the Game'
    ),
    createElement(
      'div',
      { style: { fontSize: 56, fontWeight: 700, color: '#ffffff', textAlign: 'center' as const } },
      name
    ),
    createElement(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 16,
          marginTop: 8,
        },
      },
      ...(teamSrc
        ? [
            createElement('img', {
              src: teamSrc,
              width: 56,
              height: 56,
              style: { objectFit: 'contain' as const },
            }),
          ]
        : []),
      ...(team
        ? [
            createElement(
              'div',
              { style: { fontSize: 32, fontWeight: 600, color: '#e0e0ea' } },
              team
            ),
          ]
        : [])
    )
  )
  if (stat) {
    pogInnerChildren.push(
      createElement(
        'div',
        { style: { fontSize: 28, color: '#b8b8c8', marginTop: 12 } },
        stat
      )
    )
  }

  return createElement(
    'div',
    {
      style: {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        background: 'transparent',
      },
    },
    createElement(
      'div',
      {
        style: {
          width: '100%',
          paddingTop: 48,
          paddingBottom: 48,
          paddingLeft: 64,
          paddingRight: 64,
          background:
            'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.5) 35%, rgba(0,0,0,0.92) 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
        },
      },
      ...pogInnerChildren
    )
  )
}

async function prOverlayTree(p: Record<string, unknown>): Promise<ReactElement> {
  const week =
    typeof p.week_label === 'string' && p.week_label.trim()
      ? p.week_label.trim()
      : 'Power rankings'
  const rawTeams = Array.isArray(p.teams) ? p.teams : []
  const leagueSrc = await fetchImageDataUrl(p.league_logo as string | null, 64)

  const rows: ReactElement[] = []
  for (const t of rawTeams.slice(0, 6)) {
    if (!t || typeof t !== 'object') continue
    const o = t as Record<string, unknown>
    const rank = typeof o.rank === 'number' ? o.rank : 0
    const teamName = typeof o.team_name === 'string' ? o.team_name : '?'
    const record = typeof o.record === 'string' ? o.record : ''
    const logoSrc = await fetchImageDataUrl(o.team_logo as string | null, 48)
    rows.push(
      createElement(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 16,
            marginBottom: 10,
            width: '100%',
          },
        },
        createElement(
          'div',
          { style: { fontSize: 26, fontWeight: 700, color: '#9b8cff', width: 44 } },
          `${rank}.`
        ),
        logoSrc
          ? createElement('img', {
              src: logoSrc,
              width: 40,
              height: 40,
              style: { objectFit: 'contain' as const },
            })
          : createElement('div', { style: { width: 40, height: 40 } }),
        createElement(
          'div',
          { style: { fontSize: 26, fontWeight: 600, color: '#f2f2f7', flex: 1 } },
          teamName
        ),
        createElement(
          'div',
          { style: { fontSize: 22, color: '#a8a8b8' } },
          record
        )
      )
    )
  }

  return createElement(
    'div',
    {
      style: {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        background: 'transparent',
      },
    },
    createElement(
      'div',
      {
        style: {
          width: '100%',
          paddingTop: 36,
          paddingBottom: 36,
          paddingLeft: 56,
          paddingRight: 56,
          background:
            'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 30%, rgba(0,0,0,0.94) 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        },
      },
      createElement(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 20,
            marginBottom: 20,
          },
        },
        ...(leagueSrc
          ? [
              createElement('img', {
                src: leagueSrc,
                width: 48,
                height: 48,
                style: { objectFit: 'contain' as const },
              }),
            ]
          : []),
        createElement(
          'div',
          { style: { fontSize: 40, fontWeight: 700, color: '#ffffff' } },
          week
        )
      ),
      ...rows
    )
  )
}

/**
 * Resize AI background to card size and composite text + logos (satori → PNG with alpha).
 * Used for final_score, player_of_game, weekly_power_rankings after image generation.
 */
export async function composeAiPostGraphic(
  postType: string,
  payload: Record<string, unknown>,
  backgroundBuffer: Buffer
): Promise<Buffer> {
  const base = await sharp(backgroundBuffer)
    .resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()

  let overlay: Buffer
  try {
    if (postType === 'final_score') {
      overlay = await renderSatoriToPng(CARD_WIDTH, CARD_HEIGHT, await finalScoreOverlayTree(payload))
    } else if (postType === 'player_of_game') {
      overlay = await renderSatoriToPng(CARD_WIDTH, CARD_HEIGHT, await pogOverlayTree(payload))
    } else if (postType === 'weekly_power_rankings') {
      overlay = await renderSatoriToPng(CARD_WIDTH, CARD_HEIGHT, await prOverlayTree(payload))
    } else {
      return base
    }
  } catch (e) {
    console.warn('[card] overlay render failed:', e)
    return base
  }

  return sharp(base)
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png()
    .toBuffer()
}

export async function generateGameCard(matchId: string): Promise<string> {
  if (!isR2Configured()) {
    throw new Error('R2 not configured')
  }

  const { data: match, error } = await supabase
    .from('matches')
    .select(
      `
      score_a, score_b,
      team_a:teams!team_a_id(name),
      team_b:teams!team_b_id(name)
    `
    )
    .eq('id', matchId)
    .single()

  if (error || !match) throw new Error(`Match ${matchId} not found for card`)

  const m = match as unknown as MatchRow
  const teamA = m.team_a?.name ?? 'Team A'
  const teamB = m.team_b?.name ?? 'Team B'
  const sa = m.score_a ?? '—'
  const sb = m.score_b ?? '—'

  const tree = createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'linear-gradient(145deg, #0f0f13 0%, #1a1a24 50%, #12121a 100%)',
        color: '#e8e8f0',
        fontFamily: 'Inter',
      },
    },
    createElement(
      'div',
      {
        style: {
          fontSize: 28,
          fontWeight: 400,
          letterSpacing: 4,
          textTransform: 'uppercase' as const,
          color: '#7c6af7',
          marginBottom: 32,
        },
      },
      'Final'
    ),
    createElement(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 48,
          padding: '0 64px',
        },
      },
      createElement(
        'div',
        { style: { flex: 1, textAlign: 'right' as const } },
        createElement(
          'div',
          { style: { fontSize: 42, fontWeight: 700, lineHeight: 1.2 } },
          teamA
        )
      ),
      createElement(
        'div',
        {
          style: {
            fontSize: 72,
            fontWeight: 700,
            color: '#ffffff',
            minWidth: 280,
            textAlign: 'center' as const,
          },
        },
        `${sa}  —  ${sb}`
      ),
      createElement(
        'div',
        { style: { flex: 1, textAlign: 'left' as const } },
        createElement(
          'div',
          { style: { fontSize: 42, fontWeight: 700, lineHeight: 1.2 } },
          teamB
        )
      )
    ),
    createElement(
      'div',
      {
        style: {
          marginTop: 40,
          fontSize: 22,
          color: '#888899',
        },
      },
      'proamrank.gg'
    )
  )

  const buf = await renderSatoriToPng(CARD_WIDTH, CARD_HEIGHT, tree)

  const key = `cards/${matchId}-${Date.now()}.png`
  return uploadPublicPng(key, buf)
}
