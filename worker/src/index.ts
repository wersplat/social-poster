import 'dotenv/config'
import { serve } from '@hono/node-server'
import { createServer } from './server.js'
import { startPoller } from './poller.js'
import { warnXAuthOnBoot } from './publisher.js'

const PORT = Number(process.env.PORT ?? 3000)

warnXAuthOnBoot()

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

startPoller()
