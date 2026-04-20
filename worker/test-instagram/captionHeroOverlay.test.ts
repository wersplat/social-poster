import test from "node:test";
import assert from "node:assert/strict";
import { captionForHeroOverlay } from "../src/instagram/render/templateData.js";

test("captionForHeroOverlay strips hashtags and duplicate stat line", () => {
  const merged =
    "ChapuhVVS dictated tempo. 30 PTS / 1 REB / 11 AST. Outlaws rise. #LBA #MVP";
  const out = captionForHeroOverlay(merged, {
    statLine: "30 PTS / 1 REB / 11 AST",
    playerName: "ChapuhVVS",
  });
  assert.ok(!out.includes("30 PTS"));
  assert.ok(!out.includes("#LBA"));
  assert.ok(out.includes("dictated tempo"));
  assert.ok(out.includes("Outlaws"));
});

test("captionForHeroOverlay removes name|stats bar pattern", () => {
  const merged = "CHAPUHVVS | 30 PTS / 1 REB / 11 AST — what a night.";
  const out = captionForHeroOverlay(merged, {
    statLine: "30 PTS / 1 REB / 11 AST",
    playerName: "CHAPUHVVS",
  });
  assert.ok(!out.includes("PTS"));
  assert.ok(out.includes("what a night"));
});

test("captionForHeroOverlay returns empty when caption is only echoed stats", () => {
  const merged = "30 PTS / 1 REB / 11 AST";
  const out = captionForHeroOverlay(merged, {
    statLine: "30 PTS / 1 REB / 11 AST",
    playerName: "Nobody",
  });
  assert.equal(out, "");
});
