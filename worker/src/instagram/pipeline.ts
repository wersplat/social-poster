import { planPosts as unifiedPlanPosts } from '../planning/unifiedPlanPosts.js'
import { renderPosts } from './jobs/renderPosts.js'
import { renderVideos } from './jobs/renderVideos.js'
import { publishPosts } from './jobs/publishPosts.js'
import { publishVideos } from './jobs/publishVideos.js'
import { logger } from './util/logger.js'

/** Same order as lba-social `JOB=all`; plan step runs X + IG unified planner. */
export async function runInstagramPipelineAll(): Promise<void> {
  await unifiedPlanPosts()
  await renderPosts()
  await renderVideos()
  await publishPosts()
  await publishVideos()
}

export async function runInstagramJob(
  job: 'plan' | 'render' | 'publish' | 'renderVideo' | 'publishVideo' | 'all'
): Promise<void> {
  logger.info('Instagram job starting', { job })
  if (job === 'plan') await unifiedPlanPosts()
  else if (job === 'render') await renderPosts()
  else if (job === 'publish') await publishPosts()
  else if (job === 'renderVideo') await renderVideos()
  else if (job === 'publishVideo') await publishVideos()
  else if (job === 'all') await runInstagramPipelineAll()
  else throw new Error(`Unknown Instagram job: ${job}`)
  logger.info('Instagram job complete', { job })
}
