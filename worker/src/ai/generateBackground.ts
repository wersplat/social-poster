import { composeAiPostGraphic } from '../card-generator.js'
import { uploadPublicPng } from '../r2.js'
import { sha256Hex } from './hash.js'
import { buildBgPrompt, normalizeStylePack } from './bgPrompts.js'
import { generateImage } from './imageClient.js'

export const AI_IMAGE_POST_TYPES = [
  'final_score',
  'player_of_game',
  'weekly_power_rankings',
  'beat_writer_milestone_flash',
  'announcement_registration',
  'announcement_draft',
  'announcement_results',
  'announcement_playoffs',
  'announcement_champion',
  'announcement_awards',
  'announcement_schedule',
] as const

export type AiImagePostType = (typeof AI_IMAGE_POST_TYPES)[number]

export function isAiImagePostType(postType: string): postType is AiImagePostType {
  return (AI_IMAGE_POST_TYPES as readonly string[]).includes(postType)
}

export function getBackgroundCacheKey(
  postType: string,
  stylePack: string,
  styleVersion: number,
  payload: Record<string, unknown>
): string {
  const parts: string[] = [postType, stylePack, String(styleVersion)]
  if (postType === 'weekly_power_rankings' && payload.week_label) {
    parts.push(String(payload.week_label))
  }
  if (
    (postType === 'final_score' || postType === 'player_of_game') &&
    payload.match_id
  ) {
    parts.push(String(payload.match_id))
  }
  if (postType === 'beat_writer_milestone_flash') {
    parts.push(String(payload.writer_name ?? payload.beat_writer_name ?? ''))
    parts.push(String(payload.milestone_headline ?? payload.milestone ?? payload.headline ?? ''))
    if (payload.milestone_id) parts.push(String(payload.milestone_id))
    if (payload.match_id) parts.push(String(payload.match_id))
  }
  if (
    postType.startsWith('announcement_') &&
    (payload.season_id || payload.season)
  ) {
    parts.push(String(payload.season_id ?? payload.season))
    parts.push(String(payload.vibe ?? ''))
    parts.push(String(payload.draft_date ?? ''))
    parts.push(String(payload.combine_dates ?? ''))
    parts.push(String(payload.prize_pool ?? ''))
    parts.push(String(payload.headline_override ?? ''))
    parts.push(String(payload.champion_team ?? ''))
    parts.push(String(payload.award_name ?? ''))
    parts.push(String(payload.recipient_name ?? ''))
  }
  return sha256Hex(parts.join(':'))
}

export interface GenerateBackgroundForPostParams {
  postType: string
  stylePack: string
  styleVersion: number
  payload: Record<string, unknown>
}

export interface GenerateBackgroundForPostResult {
  imageUrl: string
  prompt: string
}

/** Build prompt, generate image, upload to R2 under social-poster/bg/… */
export async function generateBackgroundForPost(
  params: GenerateBackgroundForPostParams
): Promise<GenerateBackgroundForPostResult> {
  const stylePack = normalizeStylePack(params.stylePack)
  const prompt = buildBgPrompt({
    postType: params.postType,
    stylePack,
    payload: params.payload,
  })
  const buffer = await generateImage(prompt)
  let outBuf = buffer
  try {
    outBuf = await composeAiPostGraphic(
      params.postType,
      params.payload,
      buffer
    )
  } catch (e) {
    console.warn('[ai] compose graphic failed, using raw background:', e)
  }
  const cacheKey = getBackgroundCacheKey(
    params.postType,
    stylePack,
    params.styleVersion,
    params.payload
  )
  const key = `social-poster/bg/${stylePack}/${cacheKey}.png`
  const imageUrl = await uploadPublicPng(key, outBuf)
  return { imageUrl, prompt }
}
