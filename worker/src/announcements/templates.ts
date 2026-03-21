/**
 * League announcement templates: copy, AI scene fragments, optional Midjourney export strings.
 * Image models stay text-free; typography is composited via Satori in card-generator.
 */

export type AnnouncementKind = 'registration' | 'draft' | 'results'

export type AnnouncementVibe = 'esports_2k' | 'luxury' | 'hype'

export const ANNOUNCEMENT_POST_TYPES = [
  'announcement_registration',
  'announcement_draft',
  'announcement_results',
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
}

const VIBE_SCENES: Record<AnnouncementVibe, string> = {
  esports_2k:
    'High-energy esports basketball arena at night: dramatic spotlights from above, glowing hardwood court with strong reflections, subtle crowd silhouettes in deep shadow, motion streaks and light flares around the court plane, subtle particle haze in the beams. Slight NBA 2K–inspired stylization — sharp edges, glossy surfaces, cartoon-real hybrid, strong depth and implied motion. Neon accent light in green and championship gold on structural elements only — no text or logos in-world.',
  luxury:
    'Minimal luxury sports broadcast plate: matte black and deep charcoal planes, fine gold edge lighting on geometric panels, single soft overhead spot on empty court surface far below, no characters, no clutter. Premium tournament broadcast aesthetic — restrained, expensive, calm power.',
  hype:
    'Maximum hype arena energy: explosive rim lighting, shattered-glass reflections in dark glass surfaces, sparks and ember-like particles in the air, aggressive contrast, motion blur hints on peripheral architecture, electric violet and gold rim lights. Center arena depth; kinetic tension — still no readable text or logos in the scene.',
}

const KIND_SCENES: Record<AnnouncementKind, string> = {
  registration:
    'Composition centered on the open court as the hero — registration / open season energy, doors-open feeling, pristine floor ready for new rosters.',
  draft:
    'Draft-night tension: sightlines toward a focal stage or center circle as if awaiting picks, broadcast truss and overhead grid barely visible, anticipation in the lighting.',
  results:
    'Season-closing gravitas: lower-key dramatic lighting, sense of finality, arena still charged but more somber — results and legacy energy.',
}

export function postTypeToKind(postType: string): AnnouncementKind | null {
  if (postType === 'announcement_registration') return 'registration'
  if (postType === 'announcement_draft') return 'draft'
  if (postType === 'announcement_results') return 'results'
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
  if (v === 'luxury' || v === 'hype' || v === 'esports_2k') return v
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
  return lines
}

export function ctaDisplayLabel(payload: AnnouncementPayload): string {
  return payload.cta_label?.trim() || 'Sign Up Now'
}

export function buildAnnouncementCaption(kind: AnnouncementKind, payload: AnnouncementPayload): string {
  const headline = defaultHeadline(kind, payload)
  const parts = [headline, ...secondaryLines(kind, payload)]
  const cta = payload.cta.trim()
  if (cta) parts.push(cta.startsWith('http') ? cta : `https://${cta}`)
  return parts.filter(Boolean).join('\n')
}

/** Scene description for OpenAI/Imagen (no typography). */
export function buildAnnouncementAiScene(
  kind: AnnouncementKind,
  vibe: AnnouncementVibe
): string {
  return `${KIND_SCENES[kind]} ${VIBE_SCENES[vibe]}`
}

const ANNOUNCEMENT_BG_RULES =
  'No text, letters, numbers, logos, watermarks, UI, scoreboards, or written symbols anywhere. Preserve a clean upper-center zone with softer detail for logo and headline overlay in post. Wide cinematic framing; strong contrast; physically plausible light.'

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
  const cta = ctaDisplayLabel(payload)
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
