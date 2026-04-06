/**
 * Builds story MP4 from scene images.
 * Uses FFmpeg with Ken Burns zoom, fade transitions, optional VFX overlay.
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runFfmpeg } from "./ffmpeg.js";
import type { VideoSpec } from "./sceneScript.js";

const FPS = Number(process.env.VIDEO_FPS ?? 30);
const WIDTH = 1080;
const HEIGHT = 1920;
const BITRATE = "8M";
const FADE_DURATION = 0.3;

/**
 * Build story MP4 from VideoSpec and scene image paths.
 * @param spec - VideoSpec with scenes (paths to PNGs)
 * @param outputPath - Output MP4 path
 * @param stylePack - Optional style pack for VFX overlay (e.g. regular_season_launch, stage_combine_playground)
 */
export async function buildStoryVideo(
  spec: VideoSpec,
  outputPath: string,
  stylePack?: string
): Promise<void> {
  const scenes = spec.scenes;
  if (scenes.length === 0) throw new Error("No scenes in VideoSpec");

  const tempDir = mkdtempSync(join(tmpdir(), "lba-story-"));
  try {
    const clipPaths: string[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const durationSec = scene.durationSec;
      const frames = Math.round(durationSec * FPS);
      const zoomFrom = scene.motion?.zoomFrom ?? 1;
      const zoomTo = scene.motion?.zoomTo ?? 1.04;
      const zoomStep = (zoomTo - zoomFrom) / Math.max(frames - 1, 1);

      // zoompan: z='min(zoom+step,zoomTo)' d=frames s=WxH fps=FPS
      const zoomExpr = `'min(zoom+${zoomStep.toFixed(6)},${zoomTo})'`;
      const clipPath = join(tempDir, `scene_${i}.mp4`);

      const vf = `zoompan=z=${zoomExpr}:d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`;
      // Optional overlay: getOverlayPath(stylePack) returns path if asset exists; applying
      // overlay requires filter_complex with multiple inputs - deferred for follow-up

      await runFfmpeg([
        "-y",
        "-loop", "1",
        "-i", scene.imageUrlOrPath,
        "-vf", vf,
        "-t", String(durationSec),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", String(FPS),
        clipPath,
      ]);
      clipPaths.push(clipPath);
    }

    await concatWithFade(clipPaths, outputPath, spec);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function concatWithFade(
  clipPaths: string[],
  outputPath: string,
  spec: VideoSpec
): Promise<void> {
  const fadeDur = spec.transition?.durationSec ?? FADE_DURATION;
  const durations = spec.scenes.map((s) => s.durationSec);

  if (clipPaths.length === 1) {
    await runFfmpeg([
      "-y",
      "-i", clipPaths[0],
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-c:v", "copy",
      "-c:a", "aac",
      "-shortest",
      "-movflags", "+faststart",
      "-b:v", BITRATE,
      outputPath,
    ]);
    return;
  }

  // Build filter_complex: trim each clip, then chain xfade
  const inputs: string[] = clipPaths.flatMap((p) => ["-i", p]);
  const parts: string[] = [];
  let offset = durations[0] - fadeDur;
  let prevOut = "v0";

  for (let i = 0; i < clipPaths.length; i++) {
    parts.push(`[${i}:v]trim=0:${durations[i]},setpts=PTS-STARTPTS[v${i}];`);
  }

  for (let i = 1; i < clipPaths.length; i++) {
    const outLabel = i === clipPaths.length - 1 ? "outv" : `x${i}`;
    parts.push(`[${prevOut}][v${i}]xfade=transition=fade:duration=${fadeDur}:offset=${offset}[${outLabel}];`);
    prevOut = outLabel;
    offset += durations[i] - fadeDur;
  }

  const filterComplex = parts.join("").replace(/;$/, "");

  await runFfmpeg([
    "-y",
    ...inputs,
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-filter_complex", filterComplex,
    "-map", "[outv]",
    "-map", `${clipPaths.length}:a`,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-shortest",
    "-movflags", "+faststart",
    "-b:v", BITRATE,
    "-r", String(FPS),
    outputPath,
  ]);
}
