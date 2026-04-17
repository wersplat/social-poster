/**
 * Game-story–driven background prompt augmentation.
 *
 * Runs a small Gemini-Flash text step before image generation. Given the base
 * scene prompt (from `buildBgPrompt`) and the match's narrative game story,
 * Gemini returns structured JSON with sentiment, keywords, and a short visual
 * addendum. The addendum is appended to the base prompt so OpenAI Images /
 * Imagen still sees the full structural plate, with mood nudged by the match.
 *
 * This module is intentionally isolated from Hono / Instagram-only helpers so
 * both pipelines (X + Instagram) can import it from `worker/src/ai/…`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sha256Hex } from './hash.js'

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_MODEL = 'gemini-2.5-flash'
const DEFAULT_TEMPERATURE = 0.6
const DEFAULT_MAX_OUTPUT_TOKENS = 512
const DEFAULT_TIMEOUT_MS = 20_000
const MAX_STORY_CHARS = 6000
const MAX_ADDENDUM_CHARS = 900
const MAX_KEYWORDS = 8

export interface GameStoryAugmentMeta {
  sentiment: string
  keywords: string[]
}

export interface AugmentBackgroundPromptParams {
  basePrompt: string
  gameStory: string | null | undefined
  postType: string
  supabase?: SupabaseClient
  matchId?: string | null
}

export interface AugmentBackgroundPromptResult {
  finalPrompt: string
  meta: GameStoryAugmentMeta | null
  /** Short stable suffix derived from the story used, or null if no augmentation applied. */
  storyHashSuffix: string | null
  /** Raw story text that participated in augmentation (trimmed to MAX_STORY_CHARS), if any. */
  storyUsed: string | null
}

interface GeminiAugmentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> }
    finishReason?: string
  }>
  error?: { message?: string; code?: number }
}

class NonRetryableGeminiError extends Error {
  override name = 'NonRetryableGeminiError'
}

/** Post types where the game story is a meaningful signal for backgrounds. */
const GAME_STORY_POST_TYPES = new Set<string>(['final_score', 'player_of_game'])

export function isGameStoryPostType(postType: string): boolean {
  return GAME_STORY_POST_TYPES.has(postType)
}

/** Short stable suffix derived from story text, safe to include in cache keys. */
export function computeGameStoryHashSuffix(story: string): string {
  const trimmed = story.length > MAX_STORY_CHARS ? story.slice(0, MAX_STORY_CHARS) : story
  return sha256Hex(trimmed).slice(0, 12)
}

export interface ResolveGameStoryParams {
  postType: string
  inlineStory?: string | null
  matchId?: string | null
  supabase?: SupabaseClient
}

export interface ResolveGameStoryResult {
  story: string | null
  storyHashSuffix: string | null
}

/**
 * Pre-flight: resolve the game story (from payload or DB) and compute a stable
 * hash suffix for cache keys — without calling Gemini. Returns nulls when
 * augmentation is disabled, the post type is ineligible, or no story exists.
 * Safe to call before background dedup lookups.
 */
export async function resolveGameStoryForAugment(
  params: ResolveGameStoryParams
): Promise<ResolveGameStoryResult> {
  if (!isAugmentEnabled() || !isGameStoryPostType(params.postType)) {
    return { story: null, storyHashSuffix: null }
  }
  let story = typeof params.inlineStory === 'string' ? params.inlineStory.trim() : ''
  if (!story && params.supabase && params.matchId) {
    const fetched = await fetchGameStoryForMatch(params.supabase, params.matchId)
    if (fetched) story = fetched
  }
  if (!story) {
    return { story: null, storyHashSuffix: null }
  }
  return { story, storyHashSuffix: computeGameStoryHashSuffix(story) }
}

/** Controls whether augmentation runs. Defaults to `true` when GEMINI_API_KEY is set. */
export function isAugmentEnabled(): boolean {
  const flag = process.env.GAME_STORY_BG_AUGMENT?.trim().toLowerCase()
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') {
    return false
  }
  if (flag === '1' || flag === 'true' || flag === 'on' || flag === 'yes') {
    return Boolean(process.env.GEMINI_API_KEY?.trim())
  }
  return Boolean(process.env.GEMINI_API_KEY?.trim())
}

/** Fetch game story content from `match_game_stories` for a match. Returns null if missing or on error. */
export async function fetchGameStoryForMatch(
  supabase: SupabaseClient,
  matchId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('match_game_stories')
      .select('content')
      .eq('match_id', matchId)
      .maybeSingle<{ content: string | null }>()
    if (error) {
      console.warn('[bg-augment] fetch game story failed:', error.message)
      return null
    }
    const content = data?.content?.trim()
    return content && content.length > 0 ? content : null
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[bg-augment] fetch game story threw:', msg)
    return null
  }
}

const AUGMENT_SCHEMA = {
  type: 'object',
  properties: {
    sentiment: {
      type: 'string',
      description:
        "One to three words describing the emotional tone of the matchup (e.g. 'dominant blowout', 'gritty comeback', 'tense overtime').",
    },
    keywords: {
      type: 'array',
      description:
        'Short visual-mood keywords distilled from the narrative. No player names, no scores, no team names.',
      items: { type: 'string' },
      minItems: 1,
      maxItems: MAX_KEYWORDS,
    },
    visual_addendum: {
      type: 'string',
      description:
        'One to three sentences describing additional lighting, atmosphere, color temperature, or mood cues that reinforce the story. Must not mention text, logos, scoreboards, UI elements, or people.',
    },
  },
  required: ['sentiment', 'keywords', 'visual_addendum'],
} as const

const SYSTEM_INSTRUCTIONS = [
  'You are a visual art director for a premium sports broadcast background plate.',
  'You receive (1) an existing long-form scene prompt and (2) a narrative game story.',
  'Return JSON only. Do not modify or restate the existing prompt.',
  'The visual_addendum must be short, compatible with the existing scene, and purely about mood/lighting/atmosphere.',
  'Never describe text, logos, scoreboards, UI overlays, player faces, jerseys, or specific identifiable likenesses.',
  'Do not contradict any constraint in the base prompt (e.g. no neon, no cartoon, preserve upper-third negative space).',
].join(' ')

/**
 * Build the Gemini user prompt.
 */
function buildUserPrompt(basePrompt: string, gameStory: string, postType: string): string {
  const trimmedStory =
    gameStory.length > MAX_STORY_CHARS
      ? `${gameStory.slice(0, MAX_STORY_CHARS)}\n…[truncated]`
      : gameStory
  return [
    `Post type: ${postType}`,
    '',
    '---- BASE SCENE PROMPT (do not restate) ----',
    basePrompt,
    '',
    '---- GAME STORY ----',
    trimmedStory,
  ].join('\n')
}

async function callGeminiAugment(
  basePrompt: string,
  gameStory: string,
  postType: string
): Promise<GameStoryAugmentMeta & { visualAddendum: string }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) {
    throw new NonRetryableGeminiError('GEMINI_API_KEY must be set for background prompt augmentation')
  }
  const baseUrl = (process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  const model = process.env.GEMINI_BG_AUGMENT_MODEL?.trim() || DEFAULT_MODEL
  const temperature = parseNumber(process.env.GEMINI_BG_AUGMENT_TEMPERATURE, DEFAULT_TEMPERATURE)
  const maxOutputTokens = parseNumber(
    process.env.GEMINI_BG_AUGMENT_MAX_OUTPUT_TOKENS,
    DEFAULT_MAX_OUTPUT_TOKENS
  )
  const timeoutMs = parseNumber(process.env.GEMINI_BG_AUGMENT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: `${SYSTEM_INSTRUCTIONS}\n\n${buildUserPrompt(basePrompt, gameStory, postType)}` }],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema: AUGMENT_SCHEMA,
    },
  }

  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  const data = (await response.json()) as GeminiAugmentResponse
  if (data.error?.message) {
    throw new NonRetryableGeminiError(`Gemini augment error: ${data.error.message}`)
  }
  if (!response.ok) {
    throw new Error(`Gemini augment HTTP ${response.status}: ${JSON.stringify(data)}`)
  }

  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .filter(p => !p.thought)
    .map(p => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim()
  if (!text) {
    throw new Error('Gemini augment: empty response')
  }

  const parsed = safeParseJson(text)
  if (!parsed) {
    console.warn('[bg-augment] unparseable response preview:', text.slice(0, 300))
    throw new Error('Gemini augment: response was not valid JSON')
  }
  return validateAugmentShape(parsed)
}

function validateAugmentShape(
  raw: unknown
): GameStoryAugmentMeta & { visualAddendum: string } {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Gemini augment: response is not an object')
  }
  const obj = raw as Record<string, unknown>
  const sentiment = typeof obj.sentiment === 'string' ? obj.sentiment.trim() : ''
  const keywordsRaw = Array.isArray(obj.keywords) ? obj.keywords : []
  const keywords = keywordsRaw
    .filter((k): k is string => typeof k === 'string')
    .map(k => k.trim())
    .filter(k => k.length > 0)
    .slice(0, MAX_KEYWORDS)
  const addendumRaw =
    typeof obj.visual_addendum === 'string' ? obj.visual_addendum.trim() : ''
  const visualAddendum =
    addendumRaw.length > MAX_ADDENDUM_CHARS
      ? addendumRaw.slice(0, MAX_ADDENDUM_CHARS)
      : addendumRaw

  if (!sentiment || keywords.length === 0 || !visualAddendum) {
    throw new Error(
      'Gemini augment: response missing sentiment, keywords, or visual_addendum'
    )
  }
  return { sentiment, keywords, visualAddendum }
}

function stripMarkdownFences(text: string): string {
  const s = text.trim()
  const m = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/)
  return m ? m[1].trim() : s
}

function safeParseJson(text: string): unknown {
  const cleaned = stripMarkdownFences(text)
  try {
    return JSON.parse(cleaned)
  } catch {
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Augment a background prompt using the match's game story.
 * On any failure (missing story, disabled, Gemini error, invalid shape) returns
 * the original `basePrompt` unchanged and `storyHashSuffix: null` so callers can
 * keep existing cache keys stable.
 */
export async function augmentBackgroundPromptWithGameStory(
  params: AugmentBackgroundPromptParams
): Promise<AugmentBackgroundPromptResult> {
  const { basePrompt, postType } = params

  if (!isAugmentEnabled()) {
    return { finalPrompt: basePrompt, meta: null, storyHashSuffix: null, storyUsed: null }
  }

  let story = typeof params.gameStory === 'string' ? params.gameStory.trim() : ''
  if (!story && params.supabase && params.matchId) {
    const fetched = await fetchGameStoryForMatch(params.supabase, params.matchId)
    if (fetched) story = fetched
  }
  if (!story) {
    return { finalPrompt: basePrompt, meta: null, storyHashSuffix: null, storyUsed: null }
  }

  const storyForHash = story.length > MAX_STORY_CHARS ? story.slice(0, MAX_STORY_CHARS) : story
  const storyHashSuffix = sha256Hex(storyForHash).slice(0, 12)

  try {
    const { sentiment, keywords, visualAddendum } = await callGeminiAugment(
      basePrompt,
      storyForHash,
      postType
    )
    const finalPrompt = `${basePrompt}\n\nAdditional mood from the matchup narrative (sentiment: ${sentiment}): ${visualAddendum}`
    return {
      finalPrompt,
      meta: { sentiment, keywords },
      storyHashSuffix,
      storyUsed: storyForHash,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[bg-augment] Gemini augmentation failed, using base prompt:', msg)
    return { finalPrompt: basePrompt, meta: null, storyHashSuffix: null, storyUsed: null }
  }
}
