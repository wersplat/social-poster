/**
 * Helper to run FFmpeg in containers.
 * Uses child_process.spawn with proper error capture.
 */

import { spawn } from "child_process";
import { logger } from "../util/logger.js";

const FFMPEG_PATH = process.env.FFMPEG_PATH ?? "ffmpeg";

export async function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        logger.error("FFmpeg failed", undefined, { code, stderr: stderr.slice(-2000) });
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`FFmpeg spawn failed: ${err.message}`));
    });
  });
}
