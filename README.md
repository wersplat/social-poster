# social-poster

A single **Node.js** process on Railway (or elsewhere) that:

1. **Polls** Supabase `scheduled_posts` on a timer, claims rows with an optimistic lock, builds captions (including game-result copy from `matches` / `player_stats`), optionally generates a **game card** image (Satori + Resvg) for `verified_game`, optionally generates an **AI background** (OpenAI Images or Google Imagen) for `final_score` / `player_of_game` / `weekly_power_rankings`, uploads images to **Cloudflare R2**, attaches media when URLs are present, posts via the **X API**, and updates row status with retries.
2. **Runs the Instagram pipeline** on an interval (default 5 minutes) when `ENABLE_INSTAGRAM_JOBS` is not `false`: unified **plan** (X + IG rows with surface-aware dedup), **render** (Playwright + boxscore), **renderVideo** (FFmpeg), **publish** / **publishVideo** (Meta Graph API). Disable pieces with `ENABLE_X_POLLER`, `ENABLE_X_PLANNING`, `ENABLE_INSTAGRAM_PLANNING`, or run legacy one-shot cron via `HTTP_ENABLED=false` and `JOB=plan|render|publish|renderVideo|publishVideo|all`.
3. **Serves** a small **Hono** HTTP server on `PORT`: `GET /admin` (static HTML UI), `GET /health`, and JSON APIs under `/api/*` protected by a shared **`ADMIN_SECRET`** (Bearer token) — except **`GET /api/x/oauth/callback`**, which X redirects to after OAuth — including **`POST /api/jobs/plan`** to run the **unified** planner (X and/or Instagram per env flags).

The runnable package lives under [`worker/`](./worker/) (`package.json` name: `social-publisher`).

## Requirements

- **Node.js** 20+ (ES2022; ESM). **Docker** image includes Chromium (Playwright) and **FFmpeg** for the Instagram path; see [`worker/Dockerfile`](./worker/Dockerfile).
- **Supabase** with the expected tables (see below)
- **X Developer** app credentials (API key/secret; user tokens per environment or per league)
- **Cloudflare R2** (optional) — needed for auto-generated PNG cards (`verified_game`) and for **AI background** images (stored under `social-poster/bg/…` on your bucket)
- **OpenAI** and/or **Google (Gemini / Imagen)** API keys — only if you use AI image generation (`AI_IMAGE_PROVIDER`)

## Quick start

```bash
cd worker
pnpm install   # or: npm install — runs playwright install chromium via postinstall
cp .env.example .env   # create .env — see Environment variables
pnpm run build
pnpm start
```

If Instagram render fails with **Executable doesn't exist** under `ms-playwright`, install browsers on this machine:

```bash
cd worker && npx playwright install chromium
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
| `ADMIN_SECRET` | Bearer token required for most `/api/*` routes, used to sign OAuth state cookies, and used by the admin UI login |
| `X_OAUTH_CALLBACK_URL` | Optional. Full URL of `GET /api/x/oauth/callback` (must match the callback registered on your [X app](https://developer.x.com/)). If omitted, the worker uses `{request Origin}/api/x/oauth/callback` (fine for local dev if you register that URL). |
| `R2_ENDPOINT` | Optional. Full S3 API URL, e.g. `https://<account-id>.r2.cloudflarestorage.com`. If set, used instead of building from `R2_ACCOUNT_ID` (same pattern as the lba-social worker). |
| `R2_ACCOUNT_ID` | Used only when `R2_ENDPOINT` is unset, to build `https://<id>.r2.cloudflarestorage.com`. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 S3 API token with **Object Read & Write**. If lengths look reversed (64 / 32 chars), the worker swaps them like lba-social. |
| `R2_BUCKET` | **lba-social semantics:** first `/`-separated segment is the **bucket name**; any further segments are an **object key prefix** prepended to uploads (e.g. `my-bucket` or `my-bucket/graphics/lba`). Not “last segment = bucket”. |
| `R2_PUBLIC_BASE_URL` | Public base URL for objects (no trailing slash), e.g. `https://pub-xxx.r2.dev` |
| `LEAGUE_ID` | League UUID (`leagues_info.id`) — required for **`POST /api/jobs/plan`**; optional default for `payload_json.league_id` on **`POST /api/posts`** |
| `PLAN_DEFAULT_STYLE_PACK` | Style preset for planned posts (`regular`, `playoffs`, …) — default `regular` |
| `POWER_RANKINGS_DAY` / `POWER_RANKINGS_HOUR` | When the plan job targets the next power-rankings post (day: 0=Sun; hour local server TZ) |
| `AI_IMAGE_PROVIDER` | `openai` (default) or `gemini` (Imagen) |
| `OPENAI_API_KEY` | Required when `AI_IMAGE_PROVIDER=openai` |
| `OPENAI_BASE_URL` | Optional override (default `https://api.openai.com/v1`) |
| `OPENAI_IMAGE_MODEL` / `OPENAI_IMAGE_SIZE` / `OPENAI_IMAGE_QUALITY` | Optional OpenAI Images API tuning |
| `GEMINI_API_KEY` | Required when `AI_IMAGE_PROVIDER=gemini`, and for the optional game-story background-prompt augmentation step |
| `GEMINI_BASE_URL` / `GEMINI_IMAGE_MODEL` / `GEMINI_IMAGE_ASPECT_RATIO` | Optional Imagen tuning |
| `AI_IMAGE_BRAND_RULES` | Optional plain-text prompt suffix replacing the default LBA color directive |
| `GAME_STORY_BG_AUGMENT` | Enable Gemini-driven game-story augmentation of the background prompt for `final_score` / `player_of_game` (`true`/`false`). Defaults to enabled when `GEMINI_API_KEY` is set. |
| `GEMINI_BG_AUGMENT_MODEL` | Gemini text model for the augmentation step (default `gemini-2.0-flash`). Separate from `GEMINI_MODEL` / `GEMINI_IMAGE_MODEL` so caption and image settings can stay untouched. |
| `GEMINI_BG_AUGMENT_TEMPERATURE` / `GEMINI_BG_AUGMENT_MAX_OUTPUT_TOKENS` / `GEMINI_BG_AUGMENT_TIMEOUT_MS` | Optional tuning for the augmentation step (defaults: `0.6`, `512`, `20000`) |
| `POG_SUPERHERO_MODE` | Enable superhero-themed **Instagram** `player_of_game` graphics (`true`/`false`, default `false`). When on, the AI image generates a **text-free** comic-style basketball plate (no stats/names in the image — avoids model typos and gibberish). Playwright then overlays the same fields as regular POG (badge, player name, stat line, team, league logo, date) on `player_of_game_hero.html`. When off, the abstract spotlight plate + full `player_of_game.html` overlay is used. |

**Per-league X tokens (optional):** If `webhook_config` has `x_access_token` and `x_access_secret` for a `league_id`, those are used instead of the default env tokens for posts tied to that league (resolved via `payload_json.league_id` or `matches.league_id`).

### Linking X accounts (3-legged OAuth 1.0a)

The admin **Policies** tab has **Link X** per league. That flow follows [X’s 3-legged OAuth](https://docs.x.com/fundamentals/authentication/oauth-1-0a/obtaining-user-access-tokens): request token → user authorizes on X → callback exchanges the verifier for access token + secret, which are written to `webhook_config` for that league.

1. In the [X developer portal](https://developer.x.com/), add **Callback / Redirect URL** exactly matching your deployed callback (e.g. `https://<your-host>/api/x/oauth/callback`), or the value of `X_OAUTH_CALLBACK_URL` if you set it.
2. Use **Read and Write** (or higher) app permissions so posting works.
3. Set a non-default **`ADMIN_SECRET`** — it signs the short-lived pending-OAuth cookie (the callback route is not Bearer-protected; the signed cookie binds the league to the request token).

**Security:** Most admin APIs use `ADMIN_SECRET` as Bearer token. `GET /api/x/oauth/callback` is called by X’s redirect and uses an HttpOnly cookie instead. The Supabase key is highly privileged — treat `.env` and Railway secrets accordingly.

Create a `.env` file in `worker/` with these values. Do not commit secrets.

## How it behaves

1. **Poll** — Every **30 seconds**, loads up to 10 rows from `scheduled_posts` where `status` is `pending` or `scheduled`, due (`scheduled_for` null or past), `retries` &lt; 3, and `publish_surface` contains `x`.
2. **Lock** — Updates the row to `processing` only if `status` is still the value seen when fetched; if the update returns no row, another replica claimed it — skip.
3. **Game card (optional)** — For `verified_game` with `match_id` and no `bg_image_url`, if R2 is configured, generates a PNG, uploads it, and sets `bg_image_url` before publish. On failure, continues text-only.
4. **AI background (optional)** — For `final_score`, `player_of_game`, `weekly_power_rankings`, and **`announcement_registration` / `announcement_draft` / `announcement_results`** with no `bg_image_url` and `payload_json.generate_image !== false`, if R2 and the chosen image API are configured, generates a plate, **composites team/league logos and headline text** (Satori + Sharp) at **1200×630** (not 1:1 — use external tools like Midjourney if you need square assets), uploads to R2, and sets `bg_image_url` (metadata in `payload_json.ai_bg_*`). When `GAME_STORY_BG_AUGMENT` is enabled and the post has a `match_id`, the worker first calls Gemini Flash with the base scene prompt plus the match's `match_game_stories.content`, receives a short **visual addendum** plus `sentiment` and `keywords`, and appends the addendum to the prompt before the OpenAI Images / Imagen call. The sentiment and keywords are persisted to `payload_json.ai_bg_sentiment` / `ai_bg_keywords`. If Gemini fails or no story exists, the base prompt is used unchanged. Final-score graphics resolve names and logos from `matches` / `teams` when `payload_json.match_id` is set. Announcement plates are **text-free** in the model; copy is drawn via Satori (same pattern as scores). On failure, continues text-only.
5. **Caption** — From `caption`, or built from match data for `verified_game`, or template text for planned post types and `announcement_*` types (`worker/src/announcements/templates.ts`), or `payload_json.body`, plus CTA/hashtags.
6. **Publish** — X media from `boxscore_processed_feed_url`, `bg_image_url`, or `asset_urls[0]` (PNG). Tweet id stored in `x_post_id`.
7. **Retries** — On error, `retries` increments; after 3 attempts, `status` becomes `failed` and `error` is set.
8. **Stuck rows** — Every **60 seconds**, `processing` rows older than **2 minutes** reset to `pending` (X-targeting rows only).

**Operations:** OpenAI / Imagen calls can take **30–60s** or more. They run inside the poller loop (batch size 10, interval 30s), so avoid running many concurrent AI posts on a single small instance if you hit timeouts.

### Planning job (`POST /api/jobs/plan`)

Runs once when called (use Railway Cron or another scheduler). Requires **`LEAGUE_ID`**. Inserts **`scheduled`** rows with `publish_surface = ['x']` and **`match_id` left null** (so they do not conflict with the unique X index on `match_id` used by `verified_game` auto-posts). Deduplication uses `payload_json.match_id` or `week_label` like the source worker.

- **final_score** — recent verified matches (+30 min)
- **player_of_game** — matches with `match_mvp` (+35 min)
- **weekly_power_rankings** — top 10 from `league_conference_standings` filtered by **`lba_teams`** (same as lba-social); failures in this block are reported in the JSON response but do not fail the whole job

### `POST /api/posts` (extended)

Optional JSON fields: `match_id`, `payload_json`, `generate_image`, `style_pack`, `style_version`, `league_id`, `bg_image_url`, `asset_urls`. If `LEAGUE_ID` is set in the environment and the body omits `payload_json.league_id`, the env value is copied into `payload_json` for X token resolution.

### League announcements (`POST /api/announcements/*`)

Authenticated like other admin APIs (`Authorization: Bearer ADMIN_SECRET`).

| Route | `post_type` |
| ----- | ----------- |
| `POST /api/announcements/registration` | `announcement_registration` |
| `POST /api/announcements/draft` | `announcement_draft` |
| `POST /api/announcements/results` | `announcement_results` |

**Body (JSON)** — common fields:

- **`season`** (string, required) — e.g. `Season 2`
- **`cta`** (string, required) — URL or host path, e.g. `lba.gg/signup/player`
- **`league_id`** (UUID, required unless `LEAGUE_ID` is set in the worker env)
- **`season_id`** (UUID, optional) — `league_seasons.id`; used with `league_id` and `post_type` for **deduplication** (returns **409** if a non-failed row already exists, unless `skip_dedupe: true` or `force: true`)
- **`draft_date`**, **`combine_dates`**, **`prize_pool`** (optional strings)
- **`cta_label`**, **`league_logo`**, **`headline_override`**, **`vibe`** (`esports_2k` \| `luxury` \| `hype`)
- **`result_lines`** (string array, optional; mainly for `results`)
- Same scheduling/caption flags as `POST /api/posts`: `scheduled_for`, `draft`, `caption`, `hashtags`, `generate_image`, `style_pack`, `style_version`

Example:

```json
{
  "season": "Season 2",
  "season_id": "00000000-0000-0000-0000-000000000000",
  "draft_date": "April 3",
  "combine_dates": "March 27–29",
  "prize_pool": "$1500",
  "cta": "lba.gg/signup/player",
  "vibe": "esports_2k"
}
```

**Preview (no image API call):** `GET /api/announcements/:kind/preview-prompt?season=Season%202&cta=…&vibe=esports_2k` — returns `ai_image_prompt`, `midjourney_prompt_export`, and `default_caption`.

**Admin:** Studio tab **Announcements**, or the “New announcement” form (text-only types remain; AI announcements are easiest from Studio).

### Season automation (Supabase)

Migration [`supabase/migrations/20260320140000_league_season_announcement_posts.sql`](supabase/migrations/20260320140000_league_season_announcement_posts.sql) defines a trigger on **`public.league_seasons`**: when **`is_active`** becomes **true** (and was not already active), it inserts three **`scheduled_posts`** rows (`announcement_registration`, `announcement_draft`, `announcement_results`) with `publish_surface = ['x']`, `match_id` null, `payload_json` built from `league_seasons` + `leagues_info` (`lg_logo_url`, `lg_url` for CTA, `prize_pool`, `season_number`, dates). **Apply that migration in your own Supabase project** (this repo does not run migrations remotely). Adjust the function if your column names differ.

## Database touchpoints

- `scheduled_posts` — scheduling, surfaces, captions, media URLs, `match_id`, `payload_json` (NOT NULL on insert), `retries`, etc.
- `webhook_config` — per-league `x_access_token` / `x_access_secret`
- `matches`, `teams`, `player_stats`, `match_mvp` — game captions and card art
- `leagues_info`, `post_policies` — admin policies UI and automation flags
- `players`, `lba_teams`, `league_conference_standings` — used only by the **plan** job (power rankings needs `lba_teams`; omit or fix env if those objects are absent in your project)
- `league_seasons` — optional trigger (see migration above) to enqueue announcement posts when a season is activated

AI prompt metadata is stored in **`payload_json`** (`ai_bg_prompt`, `ai_bg_generated_at`, `style_pack`, …) — no extra `scheduled_posts` columns are required.

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
        ├── r2.ts
        ├── announcements/    # league announcement copy + AI scene fragments + MJ export helper
        ├── ai/               # OpenAI / Imagen + prompts + R2 upload
        └── planning/         # plan job + Supabase queries
```

## Troubleshooting (X API)

- **`Request failed with code 401` / `Unauthorized`:** OAuth 1.0a user context was rejected. Common causes: **Access Token + Secret were issued for a different X app** than `X_API_KEY` / `X_API_SECRET`; tokens **expired** or were **regenerated**; app permissions are **read-only** (need **Read and Write** to post); or you’re using **per-league** `webhook_config` tokens that are wrong for the app keys in `.env`. Regenerate **User authentication** tokens in the [developer portal](https://developer.x.com/) under the same app that owns your Consumer Key/Secret.
- **`Request failed with code 402` / `[x tweet] … 402`:** Returned by X’s HTTP API when the request is rejected for **billing or access tier** reasons (wording varies). Confirm in the [X developer portal](https://developer.x.com/) that your project has the right **product / plan**, that **posting** is allowed for your app, and that user tokens are still valid. It is not caused by this worker’s scheduling logic.
- **`[x media] …`:** Failure while **downloading** the image URL or **uploading** media to X; check that the URL is public (e.g. R2) and that the file is valid PNG for the current upload path.

Errors are stored on `scheduled_posts.error` and logged by the poller with a `[x tweet]` or `[x media]` prefix when applicable.

## License

No license file is present in this repository; add one if you intend to distribute or open-source the code.
