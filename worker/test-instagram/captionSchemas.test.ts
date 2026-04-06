import test from "node:test";
import assert from "node:assert/strict";
import { CaptionSchema } from "../src/instagram/ai/captionSchemas.js";

test("CaptionSchema validates a correct payload", () => {
  const valid = {
    caption: "Final: Combine A 90 - 100 Combine B. #LBA",
    hashtags: ["#LBA", "#FinalScore", "#Esports", "#Hoops", "#NYC"],
    alt_text: "Final score graphic for Combine A vs Combine B.",
    cta: null,
    tone: "pro",
    emoji_level: "light",
    variants: null,
  };

  const result = CaptionSchema.safeParse(valid);
  assert.equal(result.success, true);
});

test("CaptionSchema rejects invalid hashtags", () => {
  const invalid = {
    caption: "Caption",
    hashtags: ["LBA", "#FinalScore", "#Esports", "#Hoops", "#NYC"],
    alt_text: "Alt",
    cta: null,
    tone: "pro",
    emoji_level: "none",
    variants: null,
  };

  const result = CaptionSchema.safeParse(invalid);
  assert.equal(result.success, false);
});
