-- Auto-enqueue X announcement posts when a league_seasons row becomes active.
-- Schema verified (public.league_seasons): id, league_id, season_number, start_date, end_date,
-- is_active (boolean), prize_pool (integer), status (season_status enum).
-- Apply in Supabase SQL editor or CLI; do not assume RLS on scheduled_posts (none in reference project).

create or replace function public.enqueue_x_announcements_on_league_season_activated ()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  lg_logo text;
  lg_url text;
  season_label text;
  prize text;
  sched_reg timestamptz;
  sched_draft timestamptz;
  sched_results timestamptz;
  cta text;
  draft_label text;
begin
  if not coalesce(new.is_active, false) then
    return new;
  end if;

  if tg_op = 'update' and coalesce(old.is_active, false) then
    return new;
  end if;

  if new.league_id is null then
    return new;
  end if;

  if exists (
    select 1
    from public.scheduled_posts sp
    where sp.post_type = 'announcement_registration'
      and sp.publish_surface = array['x']::text[]
      and sp.status <> 'failed'
      and (sp.payload_json ->> 'season_id') = new.id::text
  ) then
    return new;
  end if;

  select li.lg_logo_url, li.lg_url
  into lg_logo, lg_url
  from public.leagues_info li
  where li.id = new.league_id;

  season_label := 'Season ' || new.season_number::text;

  if new.prize_pool is not null then
    prize := '$' || new.prize_pool::text;
  else
    prize := null;
  end if;

  cta := coalesce(nullif(btrim(coalesce(lg_url, '')), ''), 'lba.gg/signup/player');

  draft_label := to_char(new.start_date at time zone 'UTC', 'FMMonth FMDD');

  sched_reg := now() + interval '2 minutes';
  sched_draft := greatest(new.start_date, now() + interval '3 days');
  sched_results := new.end_date;

  insert into public.scheduled_posts (
    post_type,
    scheduled_for,
    payload_json,
    caption,
    status,
    publish_surface,
    match_id
  )
  values (
    'announcement_registration',
    sched_reg,
    jsonb_strip_nulls(jsonb_build_object(
      'season', season_label,
      'season_id', new.id::text,
      'league_id', new.league_id::text,
      'cta', cta,
      'cta_label', 'Sign Up Now',
      'league_logo', lg_logo,
      'prize_pool', prize,
      'vibe', 'esports_2k',
      'generate_image', true,
      'style_pack', 'regular',
      'style_version', 1
    )),
    null,
    'scheduled',
    array['x']::text[],
    null
  );

  insert into public.scheduled_posts (
    post_type,
    scheduled_for,
    payload_json,
    caption,
    status,
    publish_surface,
    match_id
  )
  values (
    'announcement_draft',
    sched_draft,
    jsonb_strip_nulls(jsonb_build_object(
      'season', season_label,
      'season_id', new.id::text,
      'league_id', new.league_id::text,
      'cta', cta,
      'cta_label', 'Sign Up Now',
      'league_logo', lg_logo,
      'prize_pool', prize,
      'draft_date', draft_label,
      'vibe', 'esports_2k',
      'generate_image', true,
      'style_pack', 'regular',
      'style_version', 1
    )),
    null,
    'scheduled',
    array['x']::text[],
    null
  );

  insert into public.scheduled_posts (
    post_type,
    scheduled_for,
    payload_json,
    caption,
    status,
    publish_surface,
    match_id
  )
  values (
    'announcement_results',
    sched_results,
    jsonb_strip_nulls(jsonb_build_object(
      'season', season_label,
      'season_id', new.id::text,
      'league_id', new.league_id::text,
      'cta', cta,
      'cta_label', 'Sign Up Now',
      'league_logo', lg_logo,
      'prize_pool', prize,
      'result_lines', '[]'::jsonb,
      'vibe', 'luxury',
      'generate_image', true,
      'style_pack', 'regular',
      'style_version', 1
    )),
    null,
    'scheduled',
    array['x']::text[],
    null
  );

  return new;
end;
$$;

drop trigger if exists tr_league_seasons_enqueue_x_announcements on public.league_seasons;

create trigger tr_league_seasons_enqueue_x_announcements
  after insert or update of is_active on public.league_seasons
  for each row
  execute function public.enqueue_x_announcements_on_league_season_activated ();

comment on function public.enqueue_x_announcements_on_league_season_activated () is
  'When is_active becomes true, inserts three scheduled_posts (registration, draft, results) for X if not already queued for season_id.';
