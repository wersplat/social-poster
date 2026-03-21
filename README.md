# social-poster

A Node.js worker that reads **scheduled social posts** from Supabase and publishes them to **X (Twitter)**. It runs on a timer: it picks up due rows from `scheduled_posts`, builds captions (including optional game-result copy from `matches` / `player_stats`), attaches media when URLs are present, posts via the X API, and updates row status with retries for failures.

The runnable package lives under [`worker/`](./worker/) (`package.json` name: `social-publisher`).

## Requirements

- **Node.js** 18+ (ES2022; `fetch` and modern APIs)
- A **Supabase** project with the expected tables (see below)
- **X Developer** app credentials (API key/secret; user tokens per environment or per league)

## Quick start

```bash
cd worker
pnpm install   # or: npm install
cp .env.example .env   # create .env — see Environment variables
pnpm run build
pnpm start
```

For local development with reload, use `pnpm run dev` (runs `tsx watch src/index.ts`).

## Environment variables

| Variable | Purpose |
| -------- | ------- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service role key (bypasses RLS for the worker) |
| `X_API_KEY` | X app API key |
| `X_API_SECRET` | X app API secret |
| `X_ACCESS_TOKEN` | Default user access token (used when no per-league tokens exist) |
| `X_ACCESS_SECRET` | Default user access token secret |

**Per-league X tokens (optional):** If `webhook_config` has `x_access_token` and `x_access_secret` for a `league_id`, those are used instead of the default env tokens for posts tied to that league (resolved via `payload_json.league_id` or `matches.league_id`).

Create a `.env` file in `worker/` with these values. Do not commit secrets.

## How it behaves

1. **Poll** — Every **30 seconds**, the worker loads up to 10 rows from `scheduled_posts` where:
   - `status` is `pending` or `scheduled`
   - `scheduled_for` is null or in the past
   - `retries` &lt; 3
   - `publish_surface` contains `x`
2. **Lock** — Each row is moved to `processing` (optimistic update on current `status`).
3. **Caption** — Text comes from `caption`, or for `verified_game` + `match_id` from match/stats, or from `payload_json.body`, then CTA and hashtags are appended as configured.
4. **Publish** — For X, media is uploaded if `boxscore_processed_feed_url`, `bg_image_url`, or `asset_urls[0]` is set (upload assumes PNG). The tweet id is stored in `x_post_id` on success.
5. **Retries** — On error, `retries` increments; after 3 attempts, `status` becomes `failed` and `error` is set.
6. **Stuck rows** — Every **60 seconds**, rows stuck in `processing` for more than **2 minutes** are reset to `pending` (X-targeting rows only).

## Database touchpoints

The worker expects (at minimum) these Supabase tables/columns to exist and align with the queries in `worker/src/index.ts`:

- `scheduled_posts` — scheduling, surfaces, captions, media URLs, `match_id`, `payload_json`, `retries`, etc.
- `webhook_config` — `league_id`, `key` / `value` for optional per-league X tokens
- `matches` — scores, teams, MVP, `player_stats`, `league_id` when building game captions

Schema changes belong in your Supabase migration workflow; this repo does not run migrations against your project.

## Scripts (`worker/package.json`)

| Script | Command |
| ------ | ------- |
| `build` | `tsc` → `dist/` |
| `start` | `node dist/index.js` |
| `dev` | `tsx watch src/index.ts` |

## Project layout

```
social-poster/
├── README.md
└── worker/
    ├── package.json
    ├── tsconfig.json
    └── src/
        └── index.ts
```

## License

No license file is present in this repository; add one if you intend to distribute or open-source the code.
