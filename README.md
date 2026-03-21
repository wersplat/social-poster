# social-poster

A single **Node.js** process on Railway (or elsewhere) that:

1. **Polls** Supabase `scheduled_posts` on a timer, claims rows with an optimistic lock, builds captions (including game-result copy from `matches` / `player_stats`), optionally generates a **game card** image (Satori + Resvg) and uploads it to **Cloudflare R2**, attaches media when URLs are present, posts via the **X API**, and updates row status with retries.
2. **Serves** a small **Hono** HTTP server on `PORT`: `GET /admin` (static HTML UI), `GET /health`, and JSON APIs under `/api/*` protected by a shared **`ADMIN_SECRET`** (Bearer token).

The runnable package lives under [`worker/`](./worker/) (`package.json` name: `social-publisher`).

## Requirements

- **Node.js** 18+ (ES2022; `fetch` and modern APIs; ESM via `"type": "module"`)
- **Supabase** with the expected tables (see below)
- **X Developer** app credentials (API key/secret; user tokens per environment or per league)
- **Cloudflare R2** (optional) — only needed if you want auto-generated PNG cards for `verified_game` posts missing `bg_image_url`

## Quick start

```bash
cd worker
pnpm install   # or: npm install
cp .env.example .env   # create .env — see Environment variables
pnpm run build
pnpm start
```

The entrypoint loads `worker/.env` automatically via `dotenv` (so `pnpm dev` / `pnpm start` pick up `SUPABASE_URL` and other vars without exporting them in the shell).

Then open `http://localhost:3000/admin` (or your Railway URL + `/admin`) and sign in with `ADMIN_SECRET`.

For local development with reload, use `pnpm run dev` (runs `tsx watch src/index.ts`).

## Environment variables

| Variable | Purpose |
| -------- | ------- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service role key (bypasses RLS for the worker **and** the admin API) |
| `X_API_KEY` | X app API key |
| `X_API_SECRET` | X app API secret |
| `X_ACCESS_TOKEN` | Default user access token (used when no per-league tokens exist) |
| `X_ACCESS_SECRET` | Default user access token secret |
| `PORT` | HTTP listen port (Railway sets this automatically) |
| `ADMIN_SECRET` | Bearer token required for `/api/*` and used by the admin UI login |
| `R2_ACCOUNT_ID` | Cloudflare account id for S3-compatible endpoint |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token |
| `R2_BUCKET` | Bucket name |
| `R2_PUBLIC_BASE_URL` | Public base URL for objects (no trailing slash), e.g. `https://pub-xxx.r2.dev` |

**Per-league X tokens (optional):** If `webhook_config` has `x_access_token` and `x_access_secret` for a `league_id`, those are used instead of the default env tokens for posts tied to that league (resolved via `payload_json.league_id` or `matches.league_id`).

**Security:** The admin UI and APIs rely on `ADMIN_SECRET` only. The Supabase key is highly privileged — treat `.env` and Railway secrets accordingly.

Create a `.env` file in `worker/` with these values. Do not commit secrets.

## How it behaves

1. **Poll** — Every **30 seconds**, loads up to 10 rows from `scheduled_posts` where `status` is `pending` or `scheduled`, due (`scheduled_for` null or past), `retries` &lt; 3, and `publish_surface` contains `x`.
2. **Lock** — Updates the row to `processing` only if `status` is still the value seen when fetched; if the update returns no row, another replica claimed it — skip.
3. **Game card (optional)** — For `verified_game` with `match_id` and no `bg_image_url`, if R2 is configured, generates a PNG, uploads it, and sets `bg_image_url` before publish. On failure, continues text-only.
4. **Caption** — From `caption`, or built from match data for `verified_game`, or `payload_json.body`, plus CTA/hashtags.
5. **Publish** — X media from `boxscore_processed_feed_url`, `bg_image_url`, or `asset_urls[0]` (PNG). Tweet id stored in `x_post_id`.
6. **Retries** — On error, `retries` increments; after 3 attempts, `status` becomes `failed` and `error` is set.
7. **Stuck rows** — Every **60 seconds**, `processing` rows older than **2 minutes** reset to `pending` (X-targeting rows only).

## Database touchpoints

- `scheduled_posts` — scheduling, surfaces, captions, media URLs, `match_id`, `payload_json` (NOT NULL on insert), `retries`, etc.
- `webhook_config` — per-league `x_access_token` / `x_access_secret`
- `matches`, `teams`, `player_stats`, `match_mvp` — game captions and card art
- `leagues_info`, `post_policies` — admin policies UI and automation flags

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
    ├── railway.toml
    ├── public/
    │   └── admin.html
    ├── fonts/
    │   ├── Inter-Regular.ttf
    │   └── Inter-Bold.ttf
    └── src/
        ├── index.ts          # HTTP server + start poller
        ├── poller.ts
        ├── server.ts
        ├── db.ts
        ├── types.ts
        ├── templates.ts
        ├── publisher.ts
        ├── card-generator.ts
        └── r2.ts
```

## Troubleshooting (X API)

- **`Request failed with code 401` / `Unauthorized`:** OAuth 1.0a user context was rejected. Common causes: **Access Token + Secret were issued for a different X app** than `X_API_KEY` / `X_API_SECRET`; tokens **expired** or were **regenerated**; app permissions are **read-only** (need **Read and Write** to post); or you’re using **per-league** `webhook_config` tokens that are wrong for the app keys in `.env`. Regenerate **User authentication** tokens in the [developer portal](https://developer.x.com/) under the same app that owns your Consumer Key/Secret.
- **`Request failed with code 402` / `[x tweet] … 402`:** Returned by X’s HTTP API when the request is rejected for **billing or access tier** reasons (wording varies). Confirm in the [X developer portal](https://developer.x.com/) that your project has the right **product / plan**, that **posting** is allowed for your app, and that user tokens are still valid. It is not caused by this worker’s scheduling logic.
- **`[x media] …`:** Failure while **downloading** the image URL or **uploading** media to X; check that the URL is public (e.g. R2) and that the file is valid PNG for the current upload path.

Errors are stored on `scheduled_posts.error` and logged by the poller with a `[x tweet]` or `[x media]` prefix when applicable.

## License

No license file is present in this repository; add one if you intend to distribute or open-source the code.
