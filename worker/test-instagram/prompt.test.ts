import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt } from "../src/instagram/ai/prompt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "../src/instagram/ai/fixtures");

function loadFixture(name: string) {
  const raw = readFileSync(resolve(fixturesDir, name), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

test("buildPrompt includes post_type and payload data", () => {
  const payload = loadFixture("final_score.json");
  const { instructions, user } = buildPrompt("final_score", payload);

  assert.ok(instructions.includes("caption max 2200"));
  assert.ok(user.includes("post_type: final_score"));
  assert.ok(user.includes(String(payload.home_team)));
});

test("buildPrompt includes guidance for power rankings", () => {
  const payload = loadFixture("power_rankings.json");
  const { instructions } = buildPrompt("weekly_power_rankings", payload);

  assert.ok(instructions.includes("Engagement question (mandatory)"));
  assert.ok(instructions.includes("#LBAPowerRankings"));
});
