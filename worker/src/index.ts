import 'dotenv/config'
import { serve } from '@hono/node-server'
import { createServer } from './server.js'
import { startPoller } from './poller.js'
import { warnXAuthOnBoot } from './publisher.js'
import { runInstagramJob } from './instagram/pipeline.js'
import { logger } from './instagram/util/logger.js'

const PORT = Number(process.env.PORT ?? 3000)
const job = (process.env.JOB ?? '').trim()
const httpEnabled = process.env.HTTP_ENABLED !== 'false'
const xPollerEnabled = process.env.ENABLE_X_POLLER !== 'false'
const instagramJobsEnabled = process.env.ENABLE_INSTAGRAM_JOBS !== 'false'
const instagramIntervalMs = Number(
  process.env.INSTAGRAM_PIPELINE_INTERVAL_MS ?? 300_000
)

async function runInstagramPipelineSafe(): Promise<void> {
  if (!instagramJobsEnabled) return
  const stages: Array<() => Promise<void>> = [
    () => runInstagramJob('plan'),
    () => runInstagramJob('render'),
    () => runInstagramJob('renderVideo'),
    () => runInstagramJob('publish'),
    () => runInstagramJob('publishVideo'),
  ]
  for (const stage of stages) {
    try {
      await stage()
    } catch (e) {
      logger.error('Instagram pipeline stage failed', e)
    }
  }
}

/** One-shot cron mode (same JOB names as lba-social). */
async function runJobMode(): Promise<void> {
  await import('./instagram/loadEnv.js')
  const j = job || 'all'
  if (j === 'plan') await runInstagramJob('plan')
  else if (j === 'render') await runInstagramJob('render')
  else if (j === 'publish') await runInstagramJob('publish')
  else if (j === 'renderVideo') await runInstagramJob('renderVideo')
  else if (j === 'publishVideo') await runInstagramJob('publishVideo')
  else if (j === 'all') await runInstagramJob('all')
  else {
    throw new Error(
      `Unknown JOB: ${j}. Use plan|render|publish|renderVideo|publishVideo|all`
    )
  }
}

async function main(): Promise<void> {
  if (job && !httpEnabled) {
    await runJobMode()
    return
  }

  if (xPollerEnabled) {
    warnXAuthOnBoot()
  }

  if (httpEnabled) {
    const app = createServer()
    serve(
      {
        fetch: app.fetch,
        port: PORT,
      },
      info => {
        console.log(`[admin] http://localhost:${info.port}/admin`)
      }
    )
  }

  if (xPollerEnabled) {
    startPoller()
  }

  if (instagramJobsEnabled && httpEnabled) {
    void runInstagramPipelineSafe()
    setInterval(() => void runInstagramPipelineSafe(), instagramIntervalMs)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
