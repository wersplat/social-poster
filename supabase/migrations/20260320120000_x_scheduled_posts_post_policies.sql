-- X / scheduled_posts extensions, post_policies, and verified-match enqueue trigger.
-- Schema verified: publish_surface is text[]; scheduled_posts.payload_json is NOT NULL.

-- Extend scheduled_posts for X
alter table public.scheduled_posts
  add column if not exists x_post_id text,
  add column if not exists x_account_id text,
  add column if not exists retries int not null default 0;

-- publish_surface is already text[] — use ARRAY['x'] / array['x'] in application inserts.

-- Dedup: one pending/active X post per match (text[]::text cast is not immutable, so we key exact ARRAY['x'])
create unique index if not exists scheduled_posts_match_x_dedup
  on public.scheduled_posts (match_id)
  where status not in ('failed', 'draft')
    and match_id is not null
    and publish_surface = array['x']::text[];

-- Worker poll index (narrower than existing status+scheduled_for index on all rows)
create index if not exists scheduled_posts_worker_x_idx
  on public.scheduled_posts (status, scheduled_for)
  where status in ('pending', 'scheduled');

-- Per-league automation policy for social posts
create table public.post_policies (
  id                          uuid primary key default gen_random_uuid(),
  league_id                   uuid not null references public.leagues_info (id) on delete cascade,
  auto_post_verified_games    bool not null default false,
  include_box_score_link      bool not null default true,
  include_hashtags            bool not null default true,
  min_stat_threshold          int not null default 0,
  updated_at                  timestamptz not null default now(),
  unique (league_id)
);

alter table public.post_policies enable row level security;

create policy "admin_all" on public.post_policies
  for all
  to authenticated
  using (auth.jwt() ->> 'role' in ('admin', 'commissioner', 'superadmin'))
  with check (auth.jwt() ->> 'role' in ('admin', 'commissioner', 'superadmin'));

-- X credentials: public.webhook_config (league_id, key, value), keys x_access_token / x_access_secret

create or replace function public.enqueue_verified_game_post ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  policy post_policies%rowtype;
  story text;
begin
  if new.verified = true and (old.verified is distinct from true) then
    select *
    into policy
    from public.post_policies
    where league_id = new.league_id;

    if found and policy.auto_post_verified_games then
      select content
      into story
      from public.match_game_stories
      where match_id = new.id;

      insert into public.scheduled_posts (
        post_type,
        status,
        match_id,
        caption,
        publish_surface,
        scheduled_for,
        payload_json
      )
      values (
        'verified_game',
        'pending',
        new.id,
        story,
        array['x']::text[],
        now(),
        '{}'::jsonb
      )
      on conflict (match_id)
        where status not in ('failed', 'draft')
          and match_id is not null
          and publish_surface = array['x']::text[]
        do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enqueue_verified_game_post on public.matches;

create trigger enqueue_verified_game_post
  after update of verified on public.matches
  for each row
  execute function public.enqueue_verified_game_post ();
