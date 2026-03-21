import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { Resvg } from '@resvg/resvg-js'
import { createElement } from 'react'
import satori from 'satori'
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

  const width = 1200
  const height = 630

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
  const buf = Buffer.from(png.render().asPng())

  const key = `cards/${matchId}-${Date.now()}.png`
  return uploadPublicPng(key, buf)
}
