import {
  generateBackgroundForPost,
  isAiImagePostType,
} from './ai/generateBackground.js'
import { generateGameCard } from './card-generator.js'
import { supabase } from './db.js'
import { publishToX } from './publisher.js'
import { isR2Configured, uploadPublicPng } from './r2.js'
import { generateStaticCard } from './static-card-generator.js'
import { resolvePostBody } from './templates.js'
import type { ScheduledPost } from './types.js'

function shouldGenerateAiBg(post: ScheduledPost): boolean {
  if (!isAiImagePostType(post.post_type)) return false
  if (post.bg_image_url) return false
  if (post.payload_json.generate_image === false) return false
  return true
}

async function maybeGenerateAiBackground(
  working: ScheduledPost
): Promise<ScheduledPost> {
  if (!shouldGenerateAiBg(working)) return working
  if (!isR2Configured()) {
    console.warn('[poller] AI image skipped: R2 not configured')
    return working
  }
  const p = working.payload_json as Record<string, unknown>
  const stylePack =
    typeof p.style_pack === 'string' && p.style_pack.trim()
      ? p.style_pack.trim()
      : 'regular'
  const styleVersion =
    typeof p.style_version === 'number' && Number.isFinite(p.style_version)
      ? p.style_version
      : 1
  try {
    const { imageUrl, prompt, augmentMeta } = await generateBackgroundForPost({
      postType: working.post_type,
      stylePack,
      styleVersion,
      payload: p,
    })
    const nextPayload: Record<string, unknown> = {
      ...working.payload_json,
      ai_bg_prompt: prompt,
      ai_bg_generated_at: new Date().toISOString(),
    }
    if (augmentMeta) {
      nextPayload.ai_bg_sentiment = augmentMeta.sentiment
      nextPayload.ai_bg_keywords = augmentMeta.keywords
    }
    await supabase
      .from('scheduled_posts')
      .update({ bg_image_url: imageUrl, payload_json: nextPayload })
      .eq('id', working.id)
    return {
      ...working,
      bg_image_url: imageUrl,
      payload_json: nextPayload,
    }
  } catch (e) {
    console.warn('[poller] AI background failed, continuing text-only:', e)
    return working
  }
}

async function processPendingPosts() {
  const now = new Date().toISOString()

  const { data: posts, error } = await supabase
    .from('scheduled_posts')
    .select('*')
    .in('status', ['pending', 'scheduled'])
    .or(`scheduled_for.is.null,scheduled_for.lte.${now}`)
    .lt('retries', 3)
    .contains('publish_surface', ['x'])
    .limit(10)

  if (error) {
    console.error('[poller] fetch error:', error.message)
    return
  }

  for (const row of posts ?? []) {
    const raw = row as Record<string, unknown>
    const post: ScheduledPost = {
      ...(raw as ScheduledPost),
      payload_json:
        raw.payload_json && typeof raw.payload_json === 'object'
          ? (raw.payload_json as ScheduledPost['payload_json'])
          : {},
    }

    const { data: claimed, error: lockErr } = await supabase
      .from('scheduled_posts')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', post.id)
      .eq('status', post.status)
      .select('id')

    if (lockErr) {
      console.error('[poller] lock error:', lockErr.message)
      continue
    }
    if (!claimed?.length) continue

    try {
      let working: ScheduledPost = { ...post, status: 'processing' }

      if (
        working.post_type === 'verified_game' &&
        !working.bg_image_url &&
        working.match_id
      ) {
        try {
          const cardUrl = await generateGameCard(working.match_id)
          await supabase
            .from('scheduled_posts')
            .update({ bg_image_url: cardUrl })
            .eq('id', working.id)
          working = { ...working, bg_image_url: cardUrl }
        } catch (e) {
          console.warn('[poller] card gen failed, continuing text-only:', e)
        }
      }

      if (working.payload_json.use_static_template && !working.bg_image_url) {
        try {
          const buf = await generateStaticCard(
            working.post_type,
            working.payload_json as Record<string, unknown>
          )
          const url = await uploadPublicPng(`static/${working.id}.png`, buf)
          await supabase
            .from('scheduled_posts')
            .update({ bg_image_url: url })
            .eq('id', working.id)
          working = { ...working, bg_image_url: url }
        } catch (e) {
          console.warn('[poller] static card failed, continuing text-only:', e)
        }
      }

      working = await maybeGenerateAiBackground(working)

      const body = await resolvePostBody(working)
      const updates: Record<string, unknown> = {
        status: 'published',
        updated_at: new Date().toISOString(),
      }

      if ((working.publish_surface ?? []).includes('x')) {
        updates.x_post_id = await publishToX(working, body)
      }

      await supabase.from('scheduled_posts').update(updates).eq('id', working.id)
      console.log(`[poller] published post ${working.id}`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      const retries = (post.retries ?? 0) + 1
      console.error(`[poller] failed post ${post.id} (attempt ${retries}):`, message)

      await supabase
        .from('scheduled_posts')
        .update({
          status: retries >= 3 ? 'failed' : 'pending',
          retries,
          error: message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', post.id)
    }
  }
}

async function resetStuckPosts() {
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString()

  await supabase
    .from('scheduled_posts')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('status', 'processing')
    .lt('updated_at', cutoff)
    .contains('publish_surface', ['x'])
}

export function startPoller() {
  console.log('[poller] started')
  setInterval(processPendingPosts, 30_000)
  setInterval(resetStuckPosts, 60_000)
  void processPendingPosts()
}
