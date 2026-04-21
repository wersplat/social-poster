import test from "node:test";
import assert from "node:assert/strict";
import { parsePayload } from "../src/instagram/util/validate.js";
import { buildBgPrompt } from "../src/instagram/ai/bgPrompts.js";

test("parsePayload accepts announcement_registration", () => {
  const raw = {
    season: "Season 3",
    season_id: "550e8400-e29b-41d4-a716-446655440000",
    league_id: "660e8400-e29b-41d4-a716-446655440001",
    cta: "lba.gg/signup/player",
    cta_label: "Sign Up Now",
    vibe: "esports_2k",
  };
  const data = parsePayload("announcement_registration", raw);
  assert.equal((data as { season: string }).season, "Season 3");
  assert.equal((data as { cta: string }).cta, "lba.gg/signup/player");
});

test("Instagram buildBgPrompt delegates announcement_* to worker prompts", () => {
  const prompt = buildBgPrompt({
    postType: "announcement_registration",
    stylePack: "regular",
    payload: { vibe: "esports_2k", season: "Season 3", cta: "lba.gg" },
  });
  assert.ok(prompt.toLowerCase().includes("wide cinematic indoor basketball arena"));
  assert.ok(!prompt.toLowerCase().includes("background plate"));
});
