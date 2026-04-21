/**
 * League announcement templates: copy, AI scene fragments, optional Midjourney export strings.
 * Image models stay text-free; typography is composited via Satori in card-generator.
 */

export type AnnouncementKind =
  | 'registration'
  | 'draft'
  | 'results'
  | 'playoffs'
  | 'champion'
  | 'awards'
  | 'schedule'

export type AnnouncementVibe =
  | 'esports_2k'
  | 'luxury'
  | 'hype'
  | 'broadcast'
  | 'championship'
  | 'cartoon_modern'

export const ANNOUNCEMENT_POST_TYPES = [
  'announcement_registration',
  'announcement_draft',
  'announcement_results',
  'announcement_playoffs',
  'announcement_champion',
  'announcement_awards',
  'announcement_schedule',
] as const

export type AnnouncementPostType = (typeof ANNOUNCEMENT_POST_TYPES)[number]

export interface AnnouncementPayload {
  /** Display season label, e.g. "Season 2" or "2" */
  season: string
  /** League season row id — used for dedupe and automation */
  season_id?: string
  draft_date?: string
  combine_dates?: string
  /** Human-readable e.g. "$1,500" */
  prize_pool?: string
  /** URL or path for signup (shown on graphic and caption) */
  cta: string
  cta_label?: string
  league_logo?: string | null
  vibe?: AnnouncementVibe
  headline_override?: string
  /** Extra lines for results (e.g. champion, standings note) */
  result_lines?: string[]
  champion_team?: string
  series_score?: string
  award_name?: string
  recipient_name?: string
  recipient_stats?: string
  game_count?: string
  start_date?: string
  bracket_size?: string
}

const VIBE_SCENES: Record<AnnouncementVibe, string> = {
  esports_2k:
    'High-energy esports basketball arena at night: dramatic spotlights from above, glowing hardwood court with strong reflections, subtle crowd silhouettes in deep shadow, motion streaks and light flares around the court plane, subtle particle haze in the beams. Slight NBA 2K–inspired stylization — sharp edges, glossy surfaces, cartoon-real hybrid, strong depth and implied motion. Neon accent light in green and championship gold on structural elements only — no text or logos in-world.',
  luxury:
    'Minimal luxury sports broadcast plate: matte black and deep charcoal planes, fine gold edge lighting on geometric panels, single soft overhead spot on empty court surface far below, no characters, no clutter. Premium tournament broadcast aesthetic — restrained, expensive, calm power.',
  hype:
    'Maximum hype arena energy: explosive rim lighting, shattered-glass reflections in dark glass surfaces, sparks and ember-like particles in the air, aggressive contrast, motion blur hints on peripheral architecture, electric violet and gold rim lights. Center arena depth; kinetic tension — still no readable text or logos in the scene.',
  broadcast:
    'Clean broadcast studio, polished dark panels, subtle lower-third framing, sharp key light on empty anchor desk, professional sports network aesthetic, restrained graphics, no text or logos',
  championship:
    'Gold confetti frozen mid-air, trophy spotlight, champagne shimmer',
  cartoon_modern:
    'Modern cartoon-stylized basketball arena: bold flat color blocks, simplified geometric architecture, thick clean shapes, playful contemporary illustration look — not photorealistic. Saturated primaries and secondaries, high contrast, minimal texture detail, smooth gradients only where they read as graphic design. Empty court as hero; exaggerated perspective; energy through color and composition, not clutter. No text, logos, or characters.',
}

const KIND_SCENES: Record<AnnouncementKind, string> = {
  registration:
    'Indoor basketball arena at night built for a league promo still: dark stands fading to silhouette, polished hardwood court as the hero plane, soft upper-center atmospheric haze with calmer detail so overlays read cleanly — premium broadcast energy, street-court soul implied by lighting only, no props that read as flyers, bulletin boards, or loose paper on walls.',
  draft:
    'Draft-night tension: sightlines toward a focal stage or center circle as if awaiting picks, broadcast truss and overhead grid barely visible, anticipation in the lighting.',
  results:
    'Season-closing gravitas: lower-key dramatic lighting, sense of finality, arena still charged but more somber — results and legacy energy.',
  playoffs:
    'Converging spotlights, elimination intensity, fully lit arena',
  champion:
    'Single triumphant spotlight, confetti, gold coronation halo',
  awards:
    'Elegant podium lighting, deep velvet-dark, individual excellence',
  schedule:
    'Pristine arena at dawn, panoramic view, anticipation',
}

const EMOJI_BY_KIND: Record<AnnouncementKind, string> = {
  registration: '🏀',
  draft: '📋',
  results: '📊',
  playoffs: '🔥',
  champion: '👑',
  awards: '⭐',
  schedule: '📅',
}

export function postTypeToKind(postType: string): AnnouncementKind | null {
  if (postType === 'announcement_registration') return 'registration'
  if (postType === 'announcement_draft') return 'draft'
  if (postType === 'announcement_results') return 'results'
  if (postType === 'announcement_playoffs') return 'playoffs'
  if (postType === 'announcement_champion') return 'champion'
  if (postType === 'announcement_awards') return 'awards'
  if (postType === 'announcement_schedule') return 'schedule'
  return null
}

export function kindToPostType(kind: AnnouncementKind): AnnouncementPostType {
  switch (kind) {
    case 'registration':
      return 'announcement_registration'
    case 'draft':
      return 'announcement_draft'
    case 'results':
      return 'announcement_results'
    case 'playoffs':
      return 'announcement_playoffs'
    case 'champion':
      return 'announcement_champion'
    case 'awards':
      return 'announcement_awards'
    case 'schedule':
      return 'announcement_schedule'
  }
}

/** Strip leading "Season" for compact headline token; uppercase for display. */
export function seasonHeadlineToken(season: string): string {
  const t = season.trim()
  if (!t) return '—'
  const stripped = t.replace(/^season\s+/i, '').trim()
  return stripped.length > 0 ? stripped.toUpperCase() : t.toUpperCase()
}

export function normalizeVibe(raw: string | undefined | null): AnnouncementVibe {
  const v = (raw ?? 'esports_2k').trim().toLowerCase()
  if (
    v === 'luxury' ||
    v === 'hype' ||
    v === 'esports_2k' ||
    v === 'broadcast' ||
    v === 'championship' ||
    v === 'cartoon_modern'
  )
    return v
  return 'esports_2k'
}

export function defaultHeadline(kind: AnnouncementKind, payload: AnnouncementPayload): string {
  if (payload.headline_override?.trim()) return payload.headline_override.trim()
  const tok = seasonHeadlineToken(payload.season)
  switch (kind) {
    case 'registration':
      return `SEASON ${tok} REGISTRATION OPEN`
    case 'draft':
      return `SEASON ${tok} DRAFT`
    case 'results':
      return `SEASON ${tok} RESULTS`
    case 'playoffs':
      return `SEASON ${tok} PLAYOFFS`
    case 'champion':
      return `SEASON ${tok} CHAMPION`
    case 'awards':
      return `SEASON ${tok} AWARDS`
    case 'schedule':
      return `SEASON ${tok} SCHEDULE`
  }
}

export function secondaryLines(kind: AnnouncementKind, payload: AnnouncementPayload): string[] {
  const lines: string[] = []
  if (kind === 'registration' || kind === 'draft') {
    if (payload.draft_date?.trim()) lines.push(`Draft Date: ${payload.draft_date.trim()}`)
    if (payload.combine_dates?.trim())
      lines.push(`Combine Tournament: ${payload.combine_dates.trim()}`)
    if (payload.prize_pool?.trim()) lines.push(`Prize Pool: ${payload.prize_pool.trim()}`)
  }
  if (kind === 'results') {
    if (payload.prize_pool?.trim()) lines.push(`Prize Pool: ${payload.prize_pool.trim()}`)
    for (const r of payload.result_lines ?? []) {
      if (typeof r === 'string' && r.trim()) lines.push(r.trim())
    }
  }
  if (kind === 'playoffs') {
    if (payload.bracket_size?.trim()) lines.push(`Bracket: ${payload.bracket_size.trim()}`)
    if (payload.start_date?.trim()) lines.push(`Starts: ${payload.start_date.trim()}`)
    if (payload.prize_pool?.trim()) lines.push(`Prize Pool: ${payload.prize_pool.trim()}`)
  }
  if (kind === 'champion') {
    if (payload.champion_team?.trim()) lines.push(`Champion: ${payload.champion_team.trim()}`)
    if (payload.series_score?.trim()) lines.push(`Series: ${payload.series_score.trim()}`)
    if (payload.prize_pool?.trim()) lines.push(`Prize Pool: ${payload.prize_pool.trim()}`)
  }
  if (kind === 'awards') {
    if (payload.award_name?.trim()) lines.push(payload.award_name.trim())
    if (payload.recipient_name?.trim()) lines.push(payload.recipient_name.trim())
    if (payload.recipient_stats?.trim()) lines.push(payload.recipient_stats.trim())
  }
  if (kind === 'schedule') {
    if (payload.game_count?.trim()) lines.push(`Games: ${payload.game_count.trim()}`)
    if (payload.start_date?.trim()) lines.push(`Starts: ${payload.start_date.trim()}`)
  }
  return lines
}

export function ctaDisplayLabel(kind: AnnouncementKind, payload: AnnouncementPayload): string {
  if (payload.cta_label?.trim()) return payload.cta_label.trim()
  switch (kind) {
    case 'registration':
      return 'Sign Up Now'
    case 'draft':
      return 'View Draft'
    case 'results':
      return 'View Results'
    case 'playoffs':
      return 'View Bracket'
    case 'champion':
      return 'Full Recap'
    case 'awards':
      return 'See All Awards'
    case 'schedule':
      return 'View Schedule'
  }
}

/** Collapse runs of blank lines in a string. */
function collapseBlankLines(s: string): string {
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

export function buildAnnouncementCaption(kind: AnnouncementKind, payload: AnnouncementPayload): string {
  const emoji = EMOJI_BY_KIND[kind]
  const headline = defaultHeadline(kind, payload)
  const headlineBlock = `${emoji} ${headline}`
  const details = secondaryLines(kind, payload)
  const detailsBlock = details.length > 0 ? details.join('\n') : ''
  const cta = payload.cta.trim()
  const urlLine = cta ? (cta.startsWith('http') ? cta : `https://${cta}`) : ''
  const label = ctaDisplayLabel(kind, payload)
  const ctaBlock =
    urlLine ? `${label}\n${urlLine}` : label.trim() ? label : ''

  const blocks = [headlineBlock, detailsBlock, ctaBlock].filter(b => b.length > 0)
  return collapseBlankLines(blocks.join('\n\n'))
}

/** Scene description for OpenAI/Imagen (no typography). */
export function buildAnnouncementAiScene(
  kind: AnnouncementKind,
  vibe: AnnouncementVibe
): string {
  return `${KIND_SCENES[kind]} ${VIBE_SCENES[vibe]}`
}

const ANNOUNCEMENT_BG_RULES =
  'No text, letters, numbers, logos, watermarks, UI, scoreboards, or written symbols anywhere. Never paint words or labels such as HEADLINE, TITLE, SUBTITLE, BACKGROUND, PLATE, LAYER, MOCKUP, TEMPLATE, SIGN UP, URL, or any placeholder typography — the image must be purely environmental. Preserve a clean upper-center zone with softer detail for logo and headline overlay added later in post. Wide cinematic framing; strong contrast; physically plausible light.'

export function announcementBackgroundRules(): string {
  return ANNOUNCEMENT_BG_RULES
}

/**
 * Full Midjourney-style prompt for designers (includes text instructions — not sent to worker image API).
 */
export function buildMidjourneyPromptExport(
  kind: AnnouncementKind,
  payload: AnnouncementPayload
): string {
  const vibe = normalizeVibe(payload.vibe)
  const headline = defaultHeadline(kind, payload)
  const lines = secondaryLines(kind, payload)
  const cta = ctaDisplayLabel(kind, payload)
  const url = payload.cta.trim()
  const scene = buildAnnouncementAiScene(kind, vibe)
  return [
    'High-energy esports promotional graphic for a basketball league, bold modern sports design.',
    scene,
    `League logo at top center (you provide asset). Main headline: "${headline}".`,
    lines.length ? `Secondary: ${lines.join(' | ')}` : '',
    `Bottom CTA: "${cta}" + ${url || 'URL'}.`,
    'Dark background, neon accents, cinematic lighting, professional esports graphic, 1:1.',
    '— External tool only; worker uses text-free AI plate + programmatic overlay.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function isAnnouncementPostType(postType: string): postType is AnnouncementPostType {
  return (ANNOUNCEMENT_POST_TYPES as readonly string[]).includes(postType)
}
