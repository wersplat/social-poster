import { readFileSync } from 'fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import decodeAvif, { init as initAvifDecode } from '@jsquash/avif/decode.js'
import { Resvg } from '@resvg/resvg-js'
import type { ReactElement } from 'react'
import { createElement } from 'react'
import satori from 'satori'
import sharp from 'sharp'
import {
  ctaDisplayLabel,
  defaultHeadline,
  postTypeToKind,
  secondaryLines,
  normalizeVibe,
} from './announcements/templates.js'
import { supabase } from './db.js'
import { toFetchableAssetUrl, resolveLeagueLogoForGraphicPayload } from './leagueLogo.js'
import { isR2Configured, uploadPublicPng } from './r2.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

type TeamRef = { name: string } | null

type MatchRow = {
  score_a: number | null
  score_b: number | null
  team_a: TeamRef
  team_b: TeamRef
}

function loadFonts(): { name: string; data: Buffer; weight: 400 | 600 | 700; style: 'normal' }[] {
  const regular = join(__dirname, '../fonts/Inter-Regular.ttf')
  const semibold = join(__dirname, '../fonts/Inter-SemiBold.ttf')
  const bold = join(__dirname, '../fonts/Inter-Bold.ttf')
  return [
    { name: 'Inter', data: readFileSync(regular), weight: 400, style: 'normal' },
    { name: 'Inter', data: readFileSync(semibold), weight: 600, style: 'normal' },
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

export async function renderSatoriToPng(width: number, height: number, tree: ReactElement): Promise<Buffer> {
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

function bufferLooksLikeSvg(buf: Buffer): boolean {
  const s = buf.subarray(0, Math.min(500, buf.length)).toString('utf8').trimStart().toLowerCase()
  return s.startsWith('<?xml') || s.startsWith('<svg') || s.includes('<svg')
}

/** ISO BMFF / HEIF (incl. AVIF); catches `.webp` URLs that serve AVIF bytes. */
function bufferLooksLikeHeifOrAvif(buf: Buffer): boolean {
  if (buf.length < 12) return false
  if (buf.subarray(4, 8).toString('ascii') !== 'ftyp') return false
  const brand = buf.subarray(8, 12).toString('ascii')
  return /^(avif|mif1|msf1|heic|heix|heim|heis|hevc|hevx)/.test(brand)
}

/** Major brand right after `ftyp` (byte offset 8). */
function bufferHeifMajorBrand(buf: Buffer): string | null {
  if (buf.length < 12) return null
  if (buf.subarray(4, 8).toString('ascii') !== 'ftyp') return null
  return buf.subarray(8, 12).toString('ascii')
}

/** AVIF primary brand: libvips often errors on these; decode with WASM first to avoid noisy Sharp logs. */
function bufferIsAvifMajorBrand(buf: Buffer): boolean {
  const major = bufferHeifMajorBrand(buf)
  return major === 'avif' || major === 'avis'
}

const requireFromHere = createRequire(import.meta.url)

let avifWasmInitPromise: Promise<void> | null = null

function ensureAvifWasmLoaded(): Promise<void> {
  if (!avifWasmInitPromise) {
    const wasmPath = requireFromHere.resolve('@jsquash/avif/codec/dec/avif_dec.wasm')
    avifWasmInitPromise = initAvifDecode({
      wasmBinary: readFileSync(wasmPath),
    }).then(() => undefined)
  }
  return avifWasmInitPromise
}

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buf.length)
  copy.set(buf)
  return copy.buffer
}

/** When libvips cannot decode AV1-in-HEIF (e.g. 10-bit), WASM decoder + sharp resize. */
async function rasterizeHeifAvifWithJsquash(buf: Buffer, maxSide: number): Promise<string | null> {
  try {
    await ensureAvifWasmLoaded()
    const ab = bufferToArrayBuffer(buf)
    const imageData = await decodeAvif(ab, { bitDepth: 8 })
    if (!imageData) return null
    const { width, height, data } = imageData
    if (!width || !height || !data.length) return null
    const raw = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    const resized = await sharp(raw, {
      raw: { width, height, channels: 4 },
    })
      .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
    return `data:image/png;base64,${resized.toString('base64')}`
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[card] jsquash AVIF decode failed (len=%s) %s', buf.length, msg)
  }
  return null
}

function rasterizeSvgWithResvg(buf: Buffer, maxSide: number): string | null {
  try {
    const resvg = new Resvg(buf, {
      fitTo: { mode: 'width', value: maxSide },
    })
    const png = resvg.render().asPng()
    return `data:image/png;base64,${Buffer.from(png).toString('base64')}`
  } catch {
    return null
  }
}

const IMAGE_FETCH_HEADERS = {
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  'User-Agent': 'social-poster/1.0 (+https://github.com)',
} as const

async function rasterizeRasterWithSharp(buf: Buffer, maxSide: number): Promise<string | null> {
  const attempts: Array<{ label: string; pipeline: sharp.Sharp }> = [
    {
      label: 'pages:1+failOn:none',
      pipeline: sharp(buf, { pages: 1, failOn: 'none' })
        .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
        .png(),
    },
    {
      label: 'failOn:none',
      pipeline: sharp(buf, { failOn: 'none' })
        .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
        .png(),
    },
    {
      label: 'default',
      pipeline: sharp(buf)
        .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
        .png(),
    },
  ]

  let lastErr: unknown
  for (const { label, pipeline } of attempts) {
    try {
      const resized = await pipeline.toBuffer()
      return `data:image/png;base64,${resized.toString('base64')}`
    } catch (e) {
      lastErr = e
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
  console.warn('[card] sharp rasterize failed (len=%s) %s', buf.length, msg)
  return null
}

/** Fetch remote / decode data URL and produce a PNG data URL for Satori <img>. */
export async function fetchImageDataUrl(
  url: string | null | undefined,
  maxSide: number
): Promise<string | null> {
  if (!url?.trim()) return null
  const trimmed = url.trim()
  try {
    let buf: Buffer
    let hintSvg = false

    if (trimmed.startsWith('data:')) {
      const comma = trimmed.indexOf(',')
      if (comma < 0) return null
      const meta = trimmed.slice(0, comma).toLowerCase()
      const payload = trimmed.slice(comma + 1)
      hintSvg = meta.includes('svg')
      if (meta.includes(';base64')) {
        buf = Buffer.from(payload, 'base64')
      } else {
        buf = Buffer.from(decodeURIComponent(payload), 'utf8')
      }
    } else {
      const href = toFetchableAssetUrl(trimmed)
      const lower = trimmed.toLowerCase()
      hintSvg = lower.endsWith('.svg') || lower.includes('.svg?')
      const res = await fetch(href, { headers: IMAGE_FETCH_HEADERS })
      if (!res.ok) {
        console.warn('[card] image fetch failed', res.status, href.slice(0, 120))
        return null
      }
      const ct = (res.headers.get('content-type') ?? '').toLowerCase()
      if (ct.includes('svg')) hintSvg = true
      buf = Buffer.from(await res.arrayBuffer())
    }

    if (hintSvg || bufferLooksLikeSvg(buf)) {
      const fromSvg = rasterizeSvgWithResvg(buf, maxSide)
      if (fromSvg) return fromSvg
    }

    const avifMajor = bufferIsAvifMajorBrand(buf)
    if (avifMajor) {
      const fromWasmFirst = await rasterizeHeifAvifWithJsquash(buf, maxSide)
      if (fromWasmFirst) return fromWasmFirst
    }

    // Skip Sharp for AVIF-primary BMFF: libvips often fails loudly; WASM already tried above.
    const fromSharp = avifMajor ? null : await rasterizeRasterWithSharp(buf, maxSide)
    if (fromSharp) return fromSharp

    if (bufferLooksLikeHeifOrAvif(buf) && !avifMajor) {
      const fromWasm = await rasterizeHeifAvifWithJsquash(buf, maxSide)
      if (fromWasm) return fromWasm
    }

    const fallbackSvg = rasterizeSvgWithResvg(buf, maxSide)
    if (fallbackSvg) return fallbackSvg

    console.warn('[card] could not rasterize image for overlay', trimmed.slice(0, 80))
    return null
  } catch (e) {
    console.warn('[card] fetchImageDataUrl error', trimmed.slice(0, 80), e)
    return null
  }
}

type MatchTeamsRow = {
  score_a: number | null
  score_b: number | null
  team_a: { name: string; logo_url: string | null } | null
  team_b: { name: string; logo_url: string | null } | null
}

export async function resolveFinalScoreGraphic(p: Record<string, unknown>) {
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

function announcementAccentColors(vibe: string): {
  headline: string
  secondary: string
  ctaBg: string
  ctaText: string
} {
  switch (vibe) {
    case 'luxury':
      return {
        headline: '#f5f0e6',
        secondary: '#c9a227',
        ctaBg: '#c9a227',
        ctaText: '#0a0a0c',
      }
    case 'hype':
      return {
        headline: '#ffffff',
        secondary: '#ff6b4a',
        ctaBg: '#ff3d5a',
        ctaText: '#ffffff',
      }
    case 'broadcast':
      return {
        headline: '#ffffff',
        secondary: '#4ea8de',
        ctaBg: '#c42032',
        ctaText: '#ffffff',
      }
    case 'championship':
      return {
        headline: '#fff8e1',
        secondary: '#ffd700',
        ctaBg: '#ffd700',
        ctaText: '#1a1a1a',
      }
    case 'cartoon_modern':
      return {
        headline: '#ffffff',
        secondary: '#00d4ff',
        ctaBg: '#ff3366',
        ctaText: '#ffffff',
      }
    default:
      return {
        headline: '#f0fff4',
        secondary: '#00e8a0',
        ctaBg: '#00c985',
        ctaText: '#0a0f0d',
      }
  }
}

async function announcementOverlayTree(
  postType: string,
  p: Record<string, unknown>
): Promise<ReactElement> {
  const kind = postTypeToKind(postType)
  if (!kind) {
    return createElement('div', {
      style: { width: CARD_WIDTH, height: CARD_HEIGHT, background: 'transparent' },
    })
  }

  const season = typeof p.season === 'string' ? p.season : ''
  const ctaRaw = typeof p.cta === 'string' ? p.cta : ''
  const resolvedLogoUrl = await resolveLeagueLogoForGraphicPayload(p)
  if (!resolvedLogoUrl) {
    const lid =
      p.league_id != null && String(p.league_id).trim() ? String(p.league_id).trim() : '(none)'
    console.warn(
      '[card] announcement: no logo URL — set leagues_info.lg_logo_url (or banner_url) for league_id',
      lid
    )
  }
  const payload = {
    season,
    season_id: typeof p.season_id === 'string' ? p.season_id : undefined,
    draft_date: typeof p.draft_date === 'string' ? p.draft_date : undefined,
    combine_dates: typeof p.combine_dates === 'string' ? p.combine_dates : undefined,
    prize_pool: typeof p.prize_pool === 'string' ? p.prize_pool : undefined,
    cta: ctaRaw || ' ',
    cta_label: typeof p.cta_label === 'string' ? p.cta_label : undefined,
    league_logo: resolvedLogoUrl,
    vibe: normalizeVibe(typeof p.vibe === 'string' ? p.vibe : undefined),
    headline_override:
      typeof p.headline_override === 'string' ? p.headline_override : undefined,
    result_lines: Array.isArray(p.result_lines)
      ? p.result_lines.filter((x): x is string => typeof x === 'string')
      : undefined,
    champion_team:
      typeof p.champion_team === 'string' && p.champion_team.trim()
        ? p.champion_team.trim()
        : undefined,
    series_score:
      typeof p.series_score === 'string' && p.series_score.trim()
        ? p.series_score.trim()
        : undefined,
    award_name:
      typeof p.award_name === 'string' && p.award_name.trim()
        ? p.award_name.trim()
        : undefined,
    recipient_name:
      typeof p.recipient_name === 'string' && p.recipient_name.trim()
        ? p.recipient_name.trim()
        : undefined,
    recipient_stats:
      typeof p.recipient_stats === 'string' && p.recipient_stats.trim()
        ? p.recipient_stats.trim()
        : undefined,
    game_count:
      typeof p.game_count === 'string' && p.game_count.trim()
        ? p.game_count.trim()
        : undefined,
    start_date:
      typeof p.start_date === 'string' && p.start_date.trim()
        ? p.start_date.trim()
        : undefined,
    bracket_size:
      typeof p.bracket_size === 'string' && p.bracket_size.trim()
        ? p.bracket_size.trim()
        : undefined,
  }

  const vibeKey = normalizeVibe(payload.vibe)
  const colors = announcementAccentColors(vibeKey)
  const headline = defaultHeadline(kind, payload)
  const lines = secondaryLines(kind, payload)
  const leagueSrc = await fetchImageDataUrl(resolvedLogoUrl, 120)
  const ctaLabel = ctaDisplayLabel(kind, payload)
  const urlLine = ctaRaw.trim() ? (ctaRaw.includes('://') ? ctaRaw : `https://${ctaRaw}`) : ''

  const lineEls = lines.map(line =>
    createElement(
      'div',
      {
        style: {
          fontSize: 26,
          fontWeight: 600,
          color: colors.secondary,
          textAlign: 'center' as const,
          letterSpacing: 1,
          maxWidth: 920,
        },
      },
      line
    )
  )

  return createElement(
    'div',
    {
      style: {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: 'transparent',
      },
    },
    createElement(
      'div',
      {
        style: {
          paddingTop: 36,
          paddingLeft: 88,
          paddingRight: 88,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0) 100%)',
        },
      },
      leagueSrc
        ? createElement('img', {
            src: leagueSrc,
            width: 88,
            height: 88,
            style: { objectFit: 'contain' as const },
          })
        : createElement('div', { style: { height: 24 } }),
      createElement(
        'div',
        {
          style: {
            fontSize: 42,
            fontWeight: 700,
            color: colors.headline,
            textAlign: 'center' as const,
            letterSpacing: 2,
            lineHeight: 1.2,
            maxWidth: 1000,
            textTransform: 'uppercase' as const,
            textShadow: '0 2px 12px rgba(0,0,0,0.85)',
          },
        },
        headline
      )
    ),
    createElement(
      'div',
      {
        style: {
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 10,
          paddingLeft: 88,
          paddingRight: 88,
        },
      },
      ...lineEls
    ),
    createElement(
      'div',
      {
        style: {
          paddingBottom: 44,
          paddingLeft: 88,
          paddingRight: 88,
          paddingTop: 24,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          background:
            'linear-gradient(0deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.35) 70%, rgba(0,0,0,0) 100%)',
        },
      },
      createElement(
        'div',
        {
          style: {
            fontSize: 30,
            fontWeight: 700,
            color: colors.ctaText,
            backgroundColor: colors.ctaBg,
            paddingLeft: 36,
            paddingRight: 36,
            paddingTop: 14,
            paddingBottom: 14,
            borderRadius: 8,
            letterSpacing: 2,
            textTransform: 'uppercase' as const,
          },
        },
        ctaLabel
      ),
      urlLine
        ? createElement(
            'div',
            {
              style: {
                fontSize: 26,
                fontWeight: 600,
                color: '#e8e8f0',
                textAlign: 'center' as const,
                maxWidth: 920,
                textShadow: '0 1px 8px rgba(0,0,0,0.9)',
              },
            },
            urlLine
          )
        : createElement('div', { style: { height: 0 } })
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
    } else if (postType.startsWith('announcement_')) {
      overlay = await renderSatoriToPng(
        CARD_WIDTH,
        CARD_HEIGHT,
        await announcementOverlayTree(postType, payload)
      )
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
        {
          style: {
            flex: 1,
            textAlign: 'right' as const,
            fontSize: 42,
            fontWeight: 700,
            lineHeight: 1.2,
          },
        },
        teamA
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
        {
          style: {
            flex: 1,
            textAlign: 'left' as const,
            fontSize: 42,
            fontWeight: 700,
            lineHeight: 1.2,
          },
        },
        teamB
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
