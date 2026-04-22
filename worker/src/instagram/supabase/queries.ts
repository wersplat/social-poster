import { supabase } from "./client.js";
import { getCurrentSeasonIdForLeague } from "../../currentSeason.js";
import type { FinalScorePayload, PlayerOfGamePayload, PowerRankingsPayload } from "../util/validate.js";
import { logger } from "../util/logger.js";

// Row types for match MVP queries (aligned with DB columns)
interface MatchMvpSelectRow {
  id: string;
  played_at: string | null;
  verified_at: string | null;
  team_a_id: string | null;
  team_b_id: string | null;
  winner_id: string | null;
}

interface MatchMvpRow {
  match_id: string;
  player_id: string;
}

interface PlayerMvpSelectRow {
  id: string;
  gamertag: string;
  alternate_gamertag: string | null;
}

interface PlayerStatsMvpSelectRow {
  match_id: string;
  player_id: string | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  display_gt: string | null;
  player_name: string | null;
}

interface TeamMvpSelectRow {
  id: string;
  name: string;
  logo_url: string | null;
}

function getInstagramLeagueId(): string {
  const id = process.env.LEAGUE_ID?.trim();
  if (!id) throw new Error("LEAGUE_ID must be set for Instagram jobs");
  return id;
}

export interface ScheduledPostRow {
  id: string;
  post_type: string;
  scheduled_for: string;
  payload_json: unknown;
  caption: string | null;
  hashtags: string[] | null;
  alt_text: string | null;
  cta: string | null;
  tone: string | null;
  emoji_level: string | null;
  ai_variants: unknown | null;
  force_regen: boolean | null;
  asset_urls: string[];
  status: string;
  ig_creation_id: string | null;
  ig_media_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  bg_image_url: string | null;
  bg_prompt: string | null;
  bg_style_pack: string | null;
  bg_cache_key: string | null;
  bg_status: string | null;
  bg_error: string | null;
  style_version: number | null;
  boxscore_source_url: string | null;
  boxscore_processed_feed_url: string | null;
  boxscore_processed_story_url: string | null;
  boxscore_crop_preset: string | null;
  boxscore_status: string | null;
  boxscore_error: string | null;
  match_id: string | null;
  video_story_url: string | null;
  video_reel_url: string | null;
  video_status: string | null;
  video_error: string | null;
  video_spec: unknown | null;
  publish_surface: string[];
}

export interface BgAssetRow {
  id: string;
  cache_key: string;
  style_pack: string;
  prompt: string;
  image_url: string;
  created_at: string;
}

export async function fetchBgAssetByCacheKey(cacheKey: string): Promise<BgAssetRow | null> {
  const { data, error } = await supabase
    .from("bg_assets")
    .select("*")
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (error) throw error;
  return data as BgAssetRow | null;
}

export async function insertBgAsset(params: {
  cache_key: string;
  style_pack: string;
  prompt: string;
  image_url: string;
}) {
  const { error } = await supabase.from("bg_assets").insert(params);
  if (error) throw error;
}

export async function updatePostBackground(
  id: string,
  params: {
    bg_image_url: string;
    bg_prompt: string;
    bg_style_pack: string;
    bg_cache_key: string;
    bg_status: "generated";
  }
) {
  const { error } = await supabase
    .from("scheduled_posts")
    .update({ ...params, bg_error: null })
    .eq("id", id);
  if (error) throw error;
}

export async function updatePostBackgroundFailed(id: string, bgError: string) {
  const { error } = await supabase
    .from("scheduled_posts")
    .update({ bg_status: "failed", bg_error: bgError })
    .eq("id", id);
  if (error) throw error;
}

// --- boxscore: update boxscore processing fields ---
export interface BoxscoreFieldsUpdate {
  boxscore_source_url?: string;
  boxscore_processed_feed_url?: string;
  boxscore_processed_story_url?: string;
  boxscore_crop_preset?: string;
  boxscore_status?: string;
  boxscore_error?: string | null;
}

export async function updateBoxscoreFields(
  id: string,
  fields: BoxscoreFieldsUpdate
) {
  const updateData: Record<string, unknown> = {};
  if (fields.boxscore_source_url !== undefined)
    updateData.boxscore_source_url = fields.boxscore_source_url;
  if (fields.boxscore_processed_feed_url !== undefined)
    updateData.boxscore_processed_feed_url = fields.boxscore_processed_feed_url;
  if (fields.boxscore_processed_story_url !== undefined)
    updateData.boxscore_processed_story_url = fields.boxscore_processed_story_url;
  if (fields.boxscore_crop_preset !== undefined)
    updateData.boxscore_crop_preset = fields.boxscore_crop_preset;
  if (fields.boxscore_status !== undefined)
    updateData.boxscore_status = fields.boxscore_status;
  if (fields.boxscore_error !== undefined)
    updateData.boxscore_error = fields.boxscore_error;

  const { error } = await supabase
    .from("scheduled_posts")
    .update(updateData)
    .eq("id", id);

  if (error) throw error;
}

// --- planPosts: fetch completed matches (verified field = true) ---
export async function fetchCompletedMatches(limit = 10) {
  const { data: matches, error } = await supabase
    .from("matches")
    .select("id, team_a_id, team_b_id, score_a, score_b, played_at, verified_at, boxscore_url")
    .eq("verified", true)
    .eq("league_id", getInstagramLeagueId())
    .not("team_a_id", "is", null)
    .not("team_b_id", "is", null)
    .order("verified_at", { ascending: false, nullsFirst: false })
    .order("played_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  if (!matches?.length) return [];

  const teamIds = [
    ...new Set(
      matches.flatMap((m) => [m.team_a_id, m.team_b_id].filter(Boolean) as string[])
    ),
  ];
  const { data: teams } = await supabase.from("teams").select("id, name, logo_url").in("id", teamIds);
  const teamMap = new Map((teams ?? []).map((t) => [t.id, { name: t.name, logo_url: t.logo_url }]));

  const { data: league } = await supabase
    .from("leagues_info")
    .select("lg_logo_url")
    .eq("id", getInstagramLeagueId())
    .single();
  const leagueLogo = league?.lg_logo_url ?? undefined;

  return matches.map((m) => {
    const home = teamMap.get(m.team_a_id);
    const away = teamMap.get(m.team_b_id);
    return {
      id: m.id,
      score_a: m.score_a,
      score_b: m.score_b,
      played_at: m.played_at,
      verified_at: m.verified_at,
      home_team: home?.name ?? "TBD",
      away_team: away?.name ?? "TBD",
      home_team_logo: home?.logo_url,
      away_team_logo: away?.logo_url,
      league_logo: leagueLogo,
      boxscore_url: m.boxscore_url as string | null,
    };
  });
}

// --- planPosts: fetch matches with MVP and stats ---
export type MatchWithMvpResult = {
  match_id: string;
  played_at: string;
  player_id: string;
  player_name: string;
  stat_line: string;
  team_name: string;
  team_logo?: string | null;
  league_logo?: string | null;
};

export async function fetchMatchesWithMvp(limit = 10): Promise<MatchWithMvpResult[]> {
  const { data: matchesData, error } = await supabase
    .from("matches")
    .select("id, played_at, verified_at, team_a_id, team_b_id, winner_id")
    .eq("verified", true)
    .eq("league_id", getInstagramLeagueId())
    .order("verified_at", { ascending: false, nullsFirst: false })
    .order("played_at", { ascending: false })
    .limit(limit * 2); // fetch extra in case we filter MVPs

  if (error) throw error;
  const matches = (matchesData ?? []) as MatchMvpSelectRow[];
  if (!matches.length) return [];

  const matchIds = matches.map((m) => m.id);
  const { data: mvpsData } = await supabase
    .from("match_mvp")
    .select("match_id, player_id")
    .in("match_id", matchIds);

  const mvps = (mvpsData ?? []) as MatchMvpRow[];
  if (!mvps.length) return [];
  const mvpByMatch = new Map(mvps.map((m) => [m.match_id, m.player_id]));

  const playerIds = [...new Set(mvps.map((m) => m.player_id))];
  const { data: playersData } = await supabase
    .from("players")
    .select("id, gamertag, alternate_gamertag")
    .in("id", playerIds);
  const players = (playersData ?? []) as PlayerMvpSelectRow[];
  const playerMap = new Map(players.map((p) => [p.id, p]));

  const { data: statsData } = await supabase
    .from("player_stats")
    .select("match_id, player_id, points, rebounds, assists, steals, blocks, display_gt, player_name")
    .in("match_id", matchIds);
  const stats = (statsData ?? []) as PlayerStatsMvpSelectRow[];
  const statMap = new Map(
    stats.map((s) => [`${s.match_id}:${s.player_id}`, s])
  );

  const { data: teamsData } = await supabase.from("teams").select("id, name, logo_url");
  const teams = (teamsData ?? []) as TeamMvpSelectRow[];
  const teamMap = new Map(teams.map((t) => [t.id, { name: t.name, logo_url: t.logo_url }]));

  const { data: league } = await supabase
    .from("leagues_info")
    .select("lg_logo_url")
    .eq("id", getInstagramLeagueId())
    .single();
  const leagueLogo = (league as { lg_logo_url?: string | null } | null)?.lg_logo_url ?? undefined;

  const results: MatchWithMvpResult[] = [];

  for (const m of matches.slice(0, limit)) {
    const playerId = mvpByMatch.get(m.id);
    if (!playerId) continue;
    const player = playerMap.get(playerId);
    if (!player) continue;
    const s = statMap.get(`${m.id}:${playerId}`);
    const pts = s?.points ?? 0;
    const reb = s?.rebounds ?? 0;
    const ast = s?.assists ?? 0;
    const stl = s?.steals ?? 0;
    const blk = s?.blocks ?? 0;
    const statLine = `${pts} PTS / ${reb} REB / ${ast} AST` + (stl || blk ? ` / ${stl} STL / ${blk} BLK` : "");
    const winnerTeam = m.winner_id ? teamMap.get(m.winner_id) : null;
    const teamName = winnerTeam?.name ?? "TBD";
    const teamLogo = winnerTeam?.logo_url;
    const friendlyName =
      s?.display_gt ?? s?.player_name ?? player.alternate_gamertag ?? player.gamertag ?? "Unknown";

    results.push({
      match_id: m.id,
      played_at: m.played_at ?? m.verified_at ?? new Date().toISOString(),
      player_id: playerId,
      player_name: friendlyName,
      stat_line: statLine,
      team_name: teamName,
      team_logo: teamLogo,
      league_logo: leagueLogo,
    });
  }

  return results;
}

/** Fetch MVP for a single match (for reel_leaders scene). */
export async function fetchMvpForMatch(
  matchId: string
): Promise<MatchWithMvpResult | null> {
  const results = await fetchMatchesWithMvp(100);
  return results.find((r) => r.match_id === matchId) ?? null;
}

// --- planPosts: fetch top 10 power rankings (scoped to league, only lba_teams) ---
export async function fetchTop10PowerRankings() {
  const leagueId = getInstagramLeagueId();
  const seasonId = await getCurrentSeasonIdForLeague(leagueId);
  if (!seasonId) {
    return { teams: [], league_logo: undefined };
  }

  const { data: lbaTeamIds, error: lbaErr } = await supabase
    .from("lba_teams")
    .select("team_id");

  if (lbaErr) throw lbaErr;
  const allowedTeamIds = new Set((lbaTeamIds ?? []).map((r) => r.team_id));
  if (allowedTeamIds.size === 0) return { teams: [], league_logo: undefined };

  const { data: standings, error } = await supabase
    .from("league_conference_standings")
    .select("team_id, team_name, team_logo, wins, losses")
    .eq("league_id", leagueId)
    .eq("season_id", seasonId)
    .order("wins", { ascending: false })
    .order("losses", { ascending: true })
    .limit(50);

  if (error) throw error;
  if (!standings?.length) return { teams: [], league_logo: undefined };

  const { data: league } = await supabase
    .from("leagues_info")
    .select("lg_logo_url")
    .eq("id", leagueId)
    .single();
  const leagueLogo = league?.lg_logo_url ?? undefined;

  const filtered = standings.filter((s) => allowedTeamIds.has(s.team_id));
  return {
    teams: filtered.slice(0, 10).map((s, i) => ({
      id: s.team_id,
      name: s.team_name,
      rank: i + 1,
      record: `${s.wins ?? 0}-${s.losses ?? 0}`,
      team_logo: s.team_logo,
    })),
    league_logo: leagueLogo,
  };
}

// --- Idempotency checks (Instagram channel only — X-only rows must not block IG) ---
const IG_SURFACES = new Set(["feed", "story", "reel"]);

function isInstagramScheduledRow(surfaces: string[] | null | undefined): boolean {
  if (!surfaces || surfaces.length === 0) return true;
  if (surfaces.length === 1 && surfaces[0] === "x") return false;
  return surfaces.some((s) => IG_SURFACES.has(s));
}

export async function existsScheduledByPayload(
  postType: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const matchId = payload.match_id as string | undefined;
  const weekLabel = payload.week_label as string | undefined;
  const needle = postType === "weekly_power_rankings" ? weekLabel : matchId;
  if (!needle) return false;

  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("id, payload_json, publish_surface")
    .eq("post_type", postType)
    .limit(200);

  if (error) throw error;
  const rows = data ?? [];
  return rows.some((r) => {
    if (!isInstagramScheduledRow(r.publish_surface as string[] | null)) return false;
    const j = r.payload_json as Record<string, unknown>;
    if (postType === "weekly_power_rankings") return j?.week_label === needle;
    return j?.match_id === needle;
  });
}

// --- Insert scheduled post ---
export async function insertScheduledPost(
  postType: string,
  scheduledFor: string,
  payload: FinalScorePayload | PlayerOfGamePayload | PowerRankingsPayload,
  caption?: string,
  publishSurface?: string[]
) {
  const matchId =
    "match_id" in payload && typeof payload.match_id === "string"
      ? payload.match_id
      : null;

  const insertData: Record<string, unknown> = {
    post_type: postType,
    scheduled_for: scheduledFor,
    payload_json: payload,
    caption: caption ?? null,
    status: "planned",
    match_id: matchId,
  };
  if (publishSurface !== undefined && publishSurface.length > 0) {
    insertData.publish_surface = publishSurface;
  }

  const { data, error } = await supabase
    .from("scheduled_posts")
    .insert(insertData)
    .select("id")
    .single();

  if (error) throw error;
  logger.info("Inserted scheduled post", { id: data?.id, postType, scheduledFor });
  return data?.id;
}

// --- renderPosts: fetch draft/planned ---
export async function fetchPostsToRender() {
  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("*")
    .in("status", ["draft", "planned"])
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true });

  if (error) throw error;
  const rows = (data ?? []) as ScheduledPostRow[];
  return rows.filter((r) => isInstagramScheduledRow(r.publish_surface));
}

// --- renderPosts: update after render ---
export interface CaptionMeta {
  hashtags: string[];
  alt_text: string;
  cta: string | null;
  tone: string;
  emoji_level: string;
  ai_variants: unknown | null;
}

export async function updatePostRendered(
  id: string,
  assetUrls: string[],
  caption: string,
  meta?: CaptionMeta
) {
  const updateData: Record<string, unknown> = {
    asset_urls: assetUrls,
    caption,
    status: "rendered",
  };
  if (meta) {
    updateData.hashtags = meta.hashtags;
    updateData.alt_text = meta.alt_text;
    updateData.cta = meta.cta;
    updateData.tone = meta.tone;
    updateData.emoji_level = meta.emoji_level;
    updateData.ai_variants = meta.ai_variants;
  }

  const { error } = await supabase
    .from("scheduled_posts")
    .update(updateData)
    .eq("id", id);

  if (error) throw error;
}

// --- fetch single post by ID (for one-off publish script) ---
export async function fetchPostById(id: string): Promise<ScheduledPostRow | null> {
  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as ScheduledPostRow | null;
}

// --- fetch post by match_id (for local video render) ---
export async function fetchPostByMatchId(
  matchId: string
): Promise<ScheduledPostRow | null> {
  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("*")
    .eq("match_id", matchId)
    .eq("post_type", "final_score")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as ScheduledPostRow | null;
}

// --- publishPosts: fetch rendered ---
export async function fetchPostsToPublish() {
  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("*")
    .eq("status", "rendered")
    .order("scheduled_for", { ascending: true });

  if (error) throw error;
  const rows = (data ?? []) as ScheduledPostRow[];
  return rows.filter((r) => isInstagramScheduledRow(r.publish_surface));
}

// --- publishPosts: set publishing (allows retry from "failed" for publish-one script) ---
export async function setPostPublishing(id: string) {
  const { error } = await supabase
    .from("scheduled_posts")
    .update({ status: "publishing" })
    .eq("id", id)
    .in("status", ["rendered", "failed"]);

  if (error) throw error;
}

// --- publishPosts: update on success ---
export async function updatePostPublished(id: string, igMediaId: string) {
  const { error } = await supabase
    .from("scheduled_posts")
    .update({ status: "published", ig_media_id: igMediaId, error: null })
    .eq("id", id);

  if (error) throw error;
}

// --- publishPosts: update on failure ---
export async function updatePostFailed(id: string, errMsg: string) {
  const { error } = await supabase
    .from("scheduled_posts")
    .update({ status: "failed", error: errMsg })
    .eq("id", id);

  if (error) throw error;
}

// --- Video: fetch posts ready for video render ---
export async function fetchPostsForVideoRender(): Promise<ScheduledPostRow[]> {
  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("*")
    .eq("status", "rendered")
    .eq("video_status", "none")
    .overlaps("publish_surface", ["story", "reel"])
    .order("scheduled_for", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ScheduledPostRow[];
}

// --- Video: fetch posts ready for video publish ---
export async function fetchPostsForVideoPublish(): Promise<ScheduledPostRow[]> {
  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("*")
    .eq("video_status", "rendered")
    .overlaps("publish_surface", ["story", "reel"])
    .order("scheduled_for", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ScheduledPostRow[];
}

// --- Video: update video fields ---
export interface VideoFieldsUpdate {
  video_story_url?: string | null;
  video_reel_url?: string | null;
  video_status?: string;
  video_error?: string | null;
  video_spec?: unknown | null;
}

export async function updateVideoFields(
  id: string,
  fields: VideoFieldsUpdate
) {
  const updateData: Record<string, unknown> = {};
  if (fields.video_story_url !== undefined) updateData.video_story_url = fields.video_story_url;
  if (fields.video_reel_url !== undefined) updateData.video_reel_url = fields.video_reel_url;
  if (fields.video_status !== undefined) updateData.video_status = fields.video_status;
  if (fields.video_error !== undefined) updateData.video_error = fields.video_error;
  if (fields.video_spec !== undefined) updateData.video_spec = fields.video_spec;

  const { error } = await supabase
    .from("scheduled_posts")
    .update(updateData)
    .eq("id", id);

  if (error) throw error;
}
