/**
 * Render video (Story and Reel) for scheduled posts.
 * Runs after renderPosts; requires status=rendered and boxscore processed for story.
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  fetchPostsForVideoRender,
  fetchPostByMatchId,
  fetchPostById,
  updateVideoFields,
  fetchMvpForMatch,
} from "../supabase/queries.js";
import { uploadBuffer } from "../storage/r2.js";
import { renderTemplate9x16 } from "../video/renderTemplate9x16.js";
import { buildStoryVideo } from "../video/buildStoryVideo.js";
import { buildReelVideo } from "../video/buildReelVideo.js";
import type { VideoSpec } from "../video/sceneScript.js";
import { getFallbackBackgroundUrl } from "../render/playwright.js";
import { parsePayload } from "../util/validate.js";
import type { FinalScorePayload } from "../util/validate.js";
import { logger } from "../util/logger.js";

const FPS = Number(process.env.VIDEO_FPS ?? 30);

export async function renderVideos() {
  logger.info("Starting renderVideos job");

  const storyMatchId = process.env.STORY_MATCH_ID;
  const finalScorePostId = process.env.FINAL_SCORE_POST_ID;
  const localMode = Boolean(storyMatchId || finalScorePostId);

  let posts: Awaited<ReturnType<typeof fetchPostsForVideoRender>>;
  if (finalScorePostId) {
    const post = await fetchPostById(finalScorePostId);
    posts = post ? [post] : [];
  } else if (storyMatchId) {
    const post = await fetchPostByMatchId(storyMatchId);
    posts = post ? [post] : [];
  } else {
    posts = await fetchPostsForVideoRender();
  }

  logger.info("Fetched posts for video render", { count: posts.length, localMode });

  for (const post of posts) {
    try {
      if (post.post_type !== "final_score") {
        logger.debug("Skipping non-final_score for video", { id: post.id });
        continue;
      }

      const payload = parsePayload(post.post_type, post.payload_json) as FinalScorePayload;
      const matchId = payload.match_id;
      const bgImageUrl = post.bg_image_url ?? getFallbackBackgroundUrl();
      const stylePack = post.bg_style_pack ?? "regular";

      const surfaces = post.publish_surface ?? [];
      const wantsStory = localMode || surfaces.includes("story");
      const wantsReel = localMode || surfaces.includes("reel");

      if (wantsStory && !post.boxscore_processed_story_url) {
        logger.warn("Skipping story video: no boxscore_processed_story_url", { id: post.id });
      }

      const tempDir = mkdtempSync(join(tmpdir(), "lba-video-"));
      try {
        let videoStoryUrl: string | null = null;
        let videoReelUrl: string | null = null;
        let videoSpec: VideoSpec | null = null;

        if (wantsStory && post.boxscore_processed_story_url) {
          const matchLabel = `${payload.away_team} vs ${payload.home_team}`;

          const storyFinalBuf = await renderTemplate9x16("story_final", {
            ...payload,
            bg_image_url: bgImageUrl,
          });
          const storyBoxscoreBuf = await renderTemplate9x16("story_boxscore", {
            boxscore_image_url: post.boxscore_processed_story_url,
            match_label: matchLabel,
          });
          const storyCtaBuf = await renderTemplate9x16("story_cta", {});

          const s1 = join(tempDir, "story_0.png");
          const s2 = join(tempDir, "story_1.png");
          const s3 = join(tempDir, "story_2.png");
          writeFileSync(s1, storyFinalBuf);
          writeFileSync(s2, storyBoxscoreBuf);
          writeFileSync(s3, storyCtaBuf);

          const storySpec: VideoSpec = {
            width: 1080,
            height: 1920,
            fps: FPS,
            scenes: [
              { imageUrlOrPath: s1, durationSec: 3.0 },
              { imageUrlOrPath: s2, durationSec: 4.0 },
              { imageUrlOrPath: s3, durationSec: 2.0 },
            ],
            transition: { type: "fade", durationSec: 0.3 },
            audio: { silent: true },
          };

          const storyMp4Path = join(tempDir, "story.mp4");
          await buildStoryVideo(storySpec, storyMp4Path, stylePack);

          if (localMode) {
            const outDir = join("/tmp", "lba-video", matchId);
            mkdirSync(outDir, { recursive: true });
            writeFileSync(join(outDir, "story.mp4"), readFileSync(storyMp4Path));
            logger.info("Wrote story to /tmp/lba-video", { matchId });
          } else {
            videoStoryUrl = await uploadBuffer(
              `lba/video/story/${matchId}/story.mp4`,
              readFileSync(storyMp4Path),
              "video/mp4"
            );
          }
          videoSpec = storySpec;
        }

        if (wantsReel) {
          const matchLabel = `${payload.away_team} vs ${payload.home_team}`;
          const mvp = await fetchMvpForMatch(matchId);

          const reelBumperBuf = await renderTemplate9x16("reel_bumper", {
            league_logo: payload.league_logo ?? "",
          });
          const reelFinalBuf = await renderTemplate9x16("reel_final", {
            ...payload,
            bg_image_url: bgImageUrl,
          });
          const reelLeadersBuf = await renderTemplate9x16("reel_leaders", {
            player_name: mvp?.player_name ?? "Player of the Game",
            stat_line: mvp?.stat_line ?? "—",
            team_name: mvp?.team_name ?? payload.home_team,
            team_logo: mvp?.team_logo ?? payload.home_team_logo ?? "",
            league_logo: payload.league_logo ?? "",
            bg_image_url: bgImageUrl,
          });
          const reelBoxscoreBuf = post.boxscore_processed_story_url
            ? await renderTemplate9x16("reel_boxscore", {
                boxscore_image_url: post.boxscore_processed_story_url,
                match_label: matchLabel,
              })
            : await renderTemplate9x16("story_cta", {});

          const reelOutroBuf = await renderTemplate9x16("reel_outro", {
            league_logo: payload.league_logo ?? "",
          });

          const r0 = join(tempDir, "reel_0.png");
          const r1 = join(tempDir, "reel_1.png");
          const r2 = join(tempDir, "reel_2.png");
          const r3 = join(tempDir, "reel_3.png");
          const r4 = join(tempDir, "reel_4.png");
          writeFileSync(r0, reelBumperBuf);
          writeFileSync(r1, reelFinalBuf);
          writeFileSync(r2, reelLeadersBuf);
          writeFileSync(r3, reelBoxscoreBuf);
          writeFileSync(r4, reelOutroBuf);

          const reelSpec: VideoSpec = {
            width: 1080,
            height: 1920,
            fps: FPS,
            scenes: [
              { imageUrlOrPath: r0, durationSec: 1.0 },
              { imageUrlOrPath: r1, durationSec: 3.0 },
              { imageUrlOrPath: r2, durationSec: 3.0 },
              { imageUrlOrPath: r3, durationSec: 4.0 },
              { imageUrlOrPath: r4, durationSec: 2.0 },
            ],
            transition: { type: "fade", durationSec: 0.3 },
            audio: { silent: true },
          };

          const reelMp4Path = join(tempDir, "reel.mp4");
          await buildReelVideo(reelSpec, reelMp4Path, stylePack);

          if (localMode) {
            const outDir = join("/tmp", "lba-video", matchId);
            mkdirSync(outDir, { recursive: true });
            writeFileSync(join(outDir, "reel.mp4"), readFileSync(reelMp4Path));
            logger.info("Wrote reel to /tmp/lba-video", { matchId });
          } else {
            videoReelUrl = await uploadBuffer(
              `lba/video/reel/${matchId}/reel.mp4`,
              readFileSync(reelMp4Path),
              "video/mp4"
            );
          }
          videoSpec = reelSpec;
        }

        if (!localMode) {
          await updateVideoFields(post.id, {
            video_story_url: videoStoryUrl ?? undefined,
            video_reel_url: videoReelUrl ?? undefined,
            video_status: "rendered",
            video_error: null,
            video_spec: videoSpec ? (videoSpec as unknown) : undefined,
          });
        }
        logger.info("Rendered video", {
          id: post.id,
          matchId,
          videoStoryUrl: !!videoStoryUrl,
          videoReelUrl: !!videoReelUrl,
          localMode,
        });
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Video render failed", err, { id: post.id });
      await updateVideoFields(post.id, {
        video_status: "failed",
        video_error: msg,
      });
    }
  }

  logger.info("renderVideos job complete");
}
