# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

All commands run from `worker/`:

```bash
npm install      # postinstall runs playwright install chromium (needed for IG templates locally)
npm run build    # TypeScript compile to dist/
npm start        # Production run (node dist/index.js)
npm test         # node:test + tsx (Instagram unit tests under test-instagram/)
npm run preview-templates  # tsx src/instagram/preview.ts [final_score|...]
npm run publish-one        # POST_ID=... tsx publish one rendered post
```

Do not run `npm run dev` unless the user explicitly asks to start the dev server.

## Deployment

Railway via `worker/railway.toml`. Build uses **Dockerfile** (Chromium + FFmpeg + Playwright). Restart policy: ON_FAILURE, max 3 retries.

## Architecture

Unified Node.js/TypeScript worker for the LBA: **X (Twitter)** via a poller + **Instagram** via Playwright/FFmpeg + Meta Graph API. Shared Supabase `scheduled_posts`; `publish_surface` separates queues (`x` vs `feed`/`story`/`reel`).

### Core Flow

1. **Hono HTTP server** (`server.ts`) — REST API + static admin UI; `/api/*` uses `Authorization: Bearer ADMIN_SECRET` (except X OAuth callback).
2. **X poller** (`poller.ts`) — every 30s claims `pending`/`scheduled` rows with `publish_surface` containing `x`.
3. **Instagram pipeline** (`instagram/pipeline.ts`, started from `index.ts`) — on an interval (default 5 min): unified **plan** → render → renderVideo → publish → publishVideo. Stages are isolated with try/catch so one failure does not crash the process.
4. **Unified planning** (`planning/unifiedPlanPosts.ts`) — calls `planXLeaguePosts` (`planning/planPosts.ts`) and Instagram `planPosts` (`instagram/jobs/planPosts.ts`) with env flags `ENABLE_X_PLANNING` / `ENABLE_INSTAGRAM_PLANNING`. Instagram dedup ignores X-only rows.
5. **Publisher** (`publisher.ts`) — X API v2; per-league tokens from `webhook_config`.
6. **Card generator** (`card-generator.ts`) — React → Satori → resvg → PNG for X cards.
7. **X AI backgrounds** (`ai/`) — OpenAI or Gemini/Imagen to R2 (`r2.ts` includes `uploadBuffer` for IG too).
8. **Instagram stack** under `src/instagram/` — jobs, `render/` (Playwright HTML templates), `video/` (FFmpeg), `ig/` (Meta), `supabase/queries.ts` (uses root `db.ts`).

### One-shot cron mode

`HTTP_ENABLED=false` and `JOB=plan|render|publish|renderVideo|publishVideo|all` runs the matching Instagram job (with unified plan for `JOB=plan`/`all`) and exits — same pattern as legacy lba-social.

### Post Types

- `final_score` / `player_of_game` / `weekly_power_rankings` — planned for X and/or IG
- `announcement_*` — admin Studio (X-oriented); `verified_game` trigger posts for X

### Key Modules

- `planning/unifiedPlanPosts.ts` — combined planner entry used by `POST /api/jobs/plan` and the IG pipeline plan stage
- `instagram/` — full former lba-social worker tree
- `templates.ts` / `announcements/templates.ts` — X copy and studio
- `r2.ts` — R2 uploads (`uploadPublicPng`, `uploadBuffer`)
- `db.ts` — Supabase client (`SUPABASE_SERVICE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`)

### Database

Supabase. Key tables: `scheduled_posts`, `webhook_config`, `matches`, `bg_assets`, etc.

### Patterns

- **ESM** + `NodeNext`; imports use `.js` extensions in TypeScript source.
