import { planXLeaguePosts } from './planPosts.js'
import { planPosts as planInstagramLeaguePosts } from '../instagram/jobs/planPosts.js'
import { logger } from '../instagram/util/logger.js'

function xPlanningEnabled(): boolean {
  return process.env.ENABLE_X_PLANNING !== 'false'
}

function instagramPlanningEnabled(): boolean {
  return process.env.ENABLE_INSTAGRAM_PLANNING !== 'false'
}

/**
 * Plan scheduled posts for X and/or Instagram (separate rows / surfaces; IG dedup ignores X-only rows).
 */
export async function planPosts(): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = []
  let inserted = 0

  if (xPlanningEnabled()) {
    const r = await planXLeaguePosts()
    inserted += r.inserted
    errors.push(...r.errors)
  }

  if (instagramPlanningEnabled()) {
    try {
      await planInstagramLeaguePosts()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`instagram_plan: ${msg}`)
      logger.error('Instagram planPosts failed', e)
    }
  }

  return { inserted, errors }
}
