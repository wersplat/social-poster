/**
 * Style pack presets for AI background generation (ported from lba-social).
 * Override brand copy with AI_IMAGE_BRAND_RULES (plain text appended to each prompt).
 */

import {
  announcementBackgroundRules,
  buildAnnouncementAiScene,
  normalizeVibe,
  postTypeToKind,
} from '../announcements/templates.js'

export type StylePack =
  | 'regular'
  | 'playoffs'
  | 'rivalry'
  | 'sponsor_safe'
  | 'regular_season_launch'
  | 'stage_combine_playground'

const STYLE_ADDONS: Record<StylePack, string> = {
  regular:
    'Cinematic indoor basketball arena at night, rendered as an architectural study in controlled darkness. The primary light source is a single wide beam from directly overhead, cutting through a faint atmospheric haze and landing on a section of polished hardwood court floor — the wood grain visible in sharp detail in the beam, disappearing into deep shadow at the edges. Background elements — arena seating tiers, structural steel, ceiling rigging — are rendered in silhouette or near-silhouette, providing depth without competing for attention. Surface materials: sealed hardwood, brushed steel, matte concrete. The overall scene reads as a professional indoor stadium at off-hours — quiet power, not spectacle.',
  playoffs:
    'Elite sports broadcast stage designed for a championship moment. Layered background architecture built from dark tempered glass panels angled at slight perspective — each panel edge catching a thin line of warm amber-gold light, creating a repeating geometric rhythm that recedes into depth. The primary light source is a tight overhead spot in the center-rear of frame, creating a narrow cone of illumination that falls on empty court or stage floor. The surrounding atmosphere is deep obsidian with subtle violet light bleed from off-screen sources low on the left and right. Gold appears only as edge catches and reflected surface detail — never as a fill or flood. The scene should feel like the stage has been set and the Legends are about to walk out.',
  rivalry:
    'High-stakes sports broadcast backdrop communicating urgency and competition without abstraction. The scene is an indoor arena corridor or tunnel space — dark concrete walls flanked by recessed strip lighting in deep violet. The perspective is a long vanishing-point shot down the corridor, creating extreme depth. Atmospheric haze fills the midground, partially obscuring the far end. The color contrast is sharp: near-black foreground surfaces, violet-lit midground atmosphere, and a barely perceptible warm glow at the far vanishing point. The energy is compressed and building — like two teams about to emerge from opposite ends. No motion blur, no streaks; the tension is structural, not kinetic.',
  sponsor_safe:
    'Minimal, clean sports broadcast background plate designed for maximum sponsor overlay compatibility. Near-flat dark gradient from deep navy-black at the top to slightly lighter charcoal at the bottom — subtle enough to provide a professional base without drawing the eye. No textures, no atmospheric effects, no lighting drama, no bokeh, no haze. The entire frame must be usable as a background for logo placement — no quadrant is more visually active than another. Color: deepest possible navy-black. Suitable for white, gold, or violet logo overlays. This background is invisible on purpose.',
  regular_season_launch:
    'Indoor professional arena on opening night — the most important aesthetic moment in the season. The arena is vast and largely dark, with the court itself as the primary visual subject: a wide expanse of perfectly sealed hardwood reflecting the overhead lighting in long, parallel streaks. Three angled violet light beams — one from the upper left, one from center-top, one from the upper right — converge on the court surface, creating a triangular illumination zone with deep shadow at the corners. Background arena seating is barely visible in silhouette — hinting at scale without revealing detail. A single line of warm championship gold light traces the outer rim of the court boundary, the only warm element in an otherwise cool-toned scene. The atmospheric haze is thin but present, giving the light beams definition. This is the arena before the first tip-off of a new era — charged, pristine, ready.',
  stage_combine_playground:
    'Outdoor basketball court at night under sodium-vapor overhead lights — the kind of court that has produced real players before any league came calling. Raw asphalt surface with faint painted court markings, worn at the three-point arc from years of foot traffic. The overhead lights cast a warm amber cone directly downward, leaving the perimeter in deep shadow. In the soft distance: chain-link fencing, metal stadium framework, the silhouette of a city skyline barely visible through atmospheric haze. The surface of the asphalt reflects the overhead light in subtle wet-looking patches. The purple and violet tones appear only in the ambient sky above — city light pollution creating an atmospheric bleed at the upper frame. The scene is gritty and unadorned, but the lighting is cinematic — this court earned its reputation, and the image should feel like that.',
}

const BASE_RULES =
  'No text, letters, numbers, logos, watermarks, or any written symbols of any kind anywhere in the image. No UI elements, scoreboards, or graphic overlays. Preserve the upper third of the frame as clean negative space — this area will carry text overlays and must be free of distracting detail. Wide-angle cinematic perspective. Shallow depth of field with soft bokeh on background elements. Volumetric lighting with physically plausible light sources. Photorealistic render quality equivalent to high-end sports broadcast production design — not CGI fantasy, not gaming aesthetic. Avoid flat gradients, neon glow, lens flares, chromatic aberration, and cartoon-like saturation. Avoid generic stock-photo sports imagery.'

const DEFAULT_BRAND_DIRECTIVE =
  'Color palette anchored to the LBA brand: Primary base is deep midnight navy-black (the darkest possible blue-black, like an indoor arena at 2am with lights cut to a third). Secondary is a rich dynasty purple (deep jewel-toned violet — not lavender, not neon, not pastel). Accent is championship gold (warm, slightly metallic, used as edge light or surface catch-light only, never as a fill). Secondary accent is legacy violet (a lighter amethyst, used for atmospheric glow or distant light bleed). Color grading style: high contrast, shadow-forward, with lifted blacks that reveal texture rather than crushing to pure black. Moody, controlled, and premium — the visual language of a top-tier sports broadcast, not an esports gaming poster.'

function brandDirective(): string {
  const custom = process.env.AI_IMAGE_BRAND_RULES?.trim()
  return custom && custom.length > 0 ? custom : DEFAULT_BRAND_DIRECTIVE
}

const STYLE_PACK_SET = new Set<string>(Object.keys(STYLE_ADDONS))

export function normalizeStylePack(raw: string | undefined | null): StylePack {
  const s = (raw ?? 'regular').trim().toLowerCase()
  if (STYLE_PACK_SET.has(s)) return s as StylePack
  return 'regular'
}

export function buildBgPrompt(params: {
  postType: string
  stylePack: StylePack
  payload: Record<string, unknown>
}): string {
  const { postType, stylePack, payload } = params
  const kind = postTypeToKind(postType)
  if (kind) {
    const vibe = normalizeVibe(
      typeof payload.vibe === 'string' ? payload.vibe : undefined
    )
    const scene = buildAnnouncementAiScene(kind, vibe)
    const rules = announcementBackgroundRules()
    const brand = brandDirective()
    return `Abstract basketball league announcement background plate — ${scene} ${rules} ${brand}`
  }

  const styleAddon = STYLE_ADDONS[stylePack]
  const stylePart = `${styleAddon} ${BASE_RULES}`
  const brand = brandDirective()

  if (postType === 'final_score') {
    return `Abstract sports broadcast background evoking the decisive end of a competitive match. The composition is bilaterally symmetrical: a wide, low-angle view of a dark arena stage, with a single tight spotlight on the left side and a matching spotlight on the right side — both aimed downward at the court surface, creating two pools of cold-white illumination separated by a wide band of deep shadow in the center. The center shadow zone is the compositional anchor — negative space that will hold score graphics. The court surface in each light pool shows polished wood grain detail and a faint violet atmospheric reflection. Brushed metal structural elements frame the upper corners. The scene communicates finality — the last moment of the game, the arena emptying, the result permanent. ${stylePart}. ${brand}`
  }
  if (postType === 'player_of_game') {
    return `Abstract sports broadcast background built around a single mythic hero moment. One narrow, high-contrast spotlight beam descends from directly above the upper-center frame, hitting a textured dark hardwood floor and creating a tight circle of illumination no wider than a player's wingspan. Everything outside that circle falls into controlled near-black shadow. The beam itself has physical presence — thin atmospheric haze makes the column of light visible from source to surface, with the haze slightly denser near the floor. The arena seating in the far background is a soft dark blur, barely distinguishable from shadow. The upper two-thirds of the frame are deep, clean darkness with no competing light source — this is the hero's moment, and nothing else exists in it. The light is championship gold-warm at the beam's core, cooling to blue-white at the edges. ${stylePart}. ${brand}`
  }
  if (postType === 'weekly_power_rankings') {
    return `Abstract sports broadcast background designed as an authoritative power-structure visual. A front-facing wall of precision-cut obsidian stone panels — each panel floor to ceiling, with hairline gaps between them. Recessed within each gap is a thin LED strip emitting a low, cool violet light — creating a grid of vertical glowing lines against the dark panels. The lighting is directional from a single source off the upper left, casting a slight diagonal shadow across the right half of the panels and revealing the surface texture of the stone in the lit half. The center of the frame has deliberate negative space — slightly brighter ambient light here to accommodate ranking list graphics. The overall impression is a council chamber or press conference backdrop designed specifically for a league that takes its power structure seriously. ${stylePart}. ${brand}`
  }
  if (postType === 'beat_writer_milestone_flash') {
    return `Abstract sports media backdrop celebrating editorial craft and league storytelling — not a game recap. A quiet press-box or broadcast booth atmosphere at night: deep navy void, a single soft gold reading lamp glow on a dark surface in the lower third, subtle violet rim light along one vertical edge suggesting broadcast monitors out of frame. Upper third stays clean and dark for headline typography. Evokes respected sports journalism and milestone recognition — dignified, not flashy. ${stylePart}. ${brand}`
  }
  return `Abstract sports broadcast background, professional arena vibe. ${stylePart}. ${brand}`
}
